import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { notifyUsersAtOrAbove } from '../lib/notifier.js'
import { writeAuditLog } from '../lib/auth.js'

const BCRYPT_ROUNDS = 12

export const RECOVERY_QUESTIONS = [
  'What was the name of the street you lived on when you started secondary school?',
  'What was the model of the first car your family owned?',
  'What was the name of your first pet\'s vet?',
  'What was your childhood nickname (the one you hated)?',
  'What brand was your very first mobile phone?',
  'What was the name of the first album you owned?',
  'What city were you in when you had your first job interview?',
  'What was the name of your imaginary friend as a child?',
  'What was the first name of your year 7 form tutor?',
  'What was the make/model of the car you learned to drive in?',
  'What was the name of the road your primary school was on?',
  'What is your oldest cousin\'s middle name?',
  'What was the name of the first band you saw live?',
  'What was the name of the corner shop nearest to where you grew up?',
  'What was the last name of your first school best friend?',
]

function normalise(s: string) {
  return s.trim().toLowerCase()
}

export const recoveryRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/recovery/questions — list of available questions (public)
  app.get('/questions', async () => ({ questions: RECOVERY_QUESTIONS }))

  // GET /api/recovery/status — does the current user have recovery set up?
  app.get('/status', async (req, reply) => {
    try { await req.jwtVerify() } catch { return reply.status(401).send({ error: 'Unauthorized' }) }
    const { userId } = req.user as { userId: string }
    const rec = await prisma.userRecovery.findUnique({ where: { userId }, select: { userId: true } })
    return { hasRecovery: rec !== null }
  })

  // POST /api/recovery/setup — save recovery questions (authenticated)
  app.post('/setup', async (req, reply) => {
    try { await req.jwtVerify() } catch { return reply.status(401).send({ error: 'Unauthorized' }) }
    const { userId } = req.user as { userId: string }
    const { question1, answer1, question2, answer2, question3, answer3 } = req.body as {
      question1: string; answer1: string
      question2: string; answer2: string
      question3: string; answer3: string
    }

    if ([question1, answer1, question2, answer2, question3, answer3].some(v => !v?.trim())) {
      return reply.status(400).send({ error: 'All questions and answers required' })
    }
    if (new Set([question1, question2, question3]).size < 3) {
      return reply.status(400).send({ error: 'Questions must be distinct' })
    }

    const [h1, h2, h3] = await Promise.all([
      bcrypt.hash(normalise(answer1), BCRYPT_ROUNDS),
      bcrypt.hash(normalise(answer2), BCRYPT_ROUNDS),
      bcrypt.hash(normalise(answer3), BCRYPT_ROUNDS),
    ])

    await prisma.userRecovery.upsert({
      where: { userId },
      create: { userId, question1, answer1: h1, question2, answer2: h2, question3, answer3: h3 },
      update: { question1, answer1: h1, question2, answer2: h2, question3, answer3: h3 },
    })

    return reply.status(204).send()
  })

  // GET /api/recovery/user-questions/:username — return the 3 chosen question texts for a user (public)
  app.get('/user-questions/:username', async (req, reply) => {
    const { username } = req.params as { username: string }
    const user = await prisma.user.findUnique({ where: { username }, select: { id: true } })
    if (!user) return reply.status(404).send({ error: 'Unknown username' })
    const rec = await prisma.userRecovery.findUnique({ where: { userId: user.id }, select: { question1: true, question2: true, question3: true } })
    if (!rec) return reply.status(404).send({ error: 'No recovery questions set up for this account' })
    return { questions: [rec.question1, rec.question2, rec.question3] }
  })

  // POST /api/recovery/reset — submit reset request after answering security questions
  app.post('/reset', async (req, reply) => {
    const { username, newPassword, answers } = req.body as {
      username: string
      newPassword: string
      answers: {
        msgNumber: string
        creator: string
        answer1: string
        answer2: string
        answer3: string
      }
    }

    if (!username || !newPassword || !answers) {
      return reply.status(400).send({ error: 'Missing required fields' })
    }
    if (newPassword.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' })
    }

    const user = await prisma.user.findUnique({ where: { username } })
    if (!user) return reply.status(404).send({ error: 'Unknown username' })

    const rec = await prisma.userRecovery.findUnique({ where: { userId: user.id } })
    if (!rec) return reply.status(400).send({ error: 'No recovery questions set up for this account' })

    // Check for existing pending request
    const existing = await prisma.passwordResetRequest.findFirst({
      where: { userId: user.id, status: 'PENDING' },
    })
    if (existing) return reply.status(409).send({ error: 'A reset request is already pending admin approval' })

    // Verify the 5 questions — need 4/5 correct
    let correct = 0

    // 1. Most recent post number (±10 tolerance)
    const { _max } = await prisma.message.aggregate({ _max: { postNumber: true } })
    const maxPost = _max.postNumber ?? 0
    const submittedPost = parseInt(normalise(answers.msgNumber), 10)
    if (!isNaN(submittedPost) && Math.abs(submittedPost - maxPost) <= 10) correct++

    // 2. Creator of the program
    if (normalise(answers.creator) === 'rory') correct++

    // 3-5. User-chosen questions
    const [ok1, ok2, ok3] = await Promise.all([
      bcrypt.compare(normalise(answers.answer1), rec.answer1),
      bcrypt.compare(normalise(answers.answer2), rec.answer2),
      bcrypt.compare(normalise(answers.answer3), rec.answer3),
    ])
    if (ok1) correct++
    if (ok2) correct++
    if (ok3) correct++

    if (correct < 4) {
      return reply.status(400).send({ error: `${correct}/5 answers correct — need at least 4` })
    }

    const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    const resetReq = await prisma.passwordResetRequest.create({
      data: { userId: user.id, newPasswordHash },
    })

    await writeAuditLog(null, 'password_reset.requested', user.id, 'user', {
      username: user.username,
      correctAnswers: correct,
    })

    await notifyUsersAtOrAbove(
      'SUPERADMIN',
      'admin:reset_request',
      `Password reset request: ${user.displayName}`,
      `${user.username} has passed security questions (${correct}/5) and is requesting a password reset. Review in admin panel.`,
      { resetRequestId: resetReq.id, userId: user.id, username: user.username },
    )

    return { message: 'Reset request submitted — pending admin approval' }
  })
}
