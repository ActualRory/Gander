import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

function todayDate(): string {
  const d = new Date()
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const gandleRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/gandle/today
  // Returns the current user's result for today (if any)
  app.get('/today', async (req) => {
    const { userId } = req.user as { userId: string }
    const date = todayDate()
    const result = await prisma.gandleResult.findUnique({
      where: { userId_date: { userId, date } },
    })
    return {
      date,
      played: result !== null,
      result: result
        ? { guesses: JSON.parse(result.guesses) as string[], solved: result.solved }
        : null,
    }
  })

  // POST /api/gandle/submit  { date, guesses: string[], solved: boolean }
  app.post<{ Body: { date: string; guesses: string[]; solved: boolean } }>(
    '/submit',
    async (req, reply) => {
      const { userId } = req.user as { userId: string }
      const { date, guesses, solved } = req.body

      if (date !== todayDate()) {
        return reply.status(400).send({ error: 'Can only submit for today' })
      }
      if (!Array.isArray(guesses) || guesses.length < 1 || guesses.length > 6) {
        return reply.status(400).send({ error: 'Invalid guesses' })
      }
      for (const g of guesses) {
        if (typeof g !== 'string' || !/^[a-z]{6}$/.test(g)) {
          return reply.status(400).send({ error: 'Each guess must be 6 lowercase letters' })
        }
      }

      // Check for existing result (no overwriting)
      const existing = await prisma.gandleResult.findUnique({
        where: { userId_date: { userId, date } },
      })
      if (existing) {
        return reply.status(409).send({ error: 'Already submitted for today' })
      }

      const result = await prisma.gandleResult.create({
        data: {
          userId,
          date,
          guesses: JSON.stringify(guesses),
          solved,
        },
      })

      return reply.status(201).send({
        date: result.date,
        guesses: guesses,
        solved: result.solved,
      })
    },
  )

  // GET /api/gandle/leaderboard?date=YYYY-MM-DD
  // Returns all completed results for the given date.
  // Guesses are only included in the response if the requesting user has also played that date.
  app.get<{ Querystring: { date?: string } }>('/leaderboard', async (req) => {
    const { userId } = req.user as { userId: string }
    const date = req.query.date ?? todayDate()

    // Check if the requesting user has played
    const myResult = await prisma.gandleResult.findUnique({
      where: { userId_date: { userId, date } },
    })
    const hasPlayed = myResult !== null

    const results = await prisma.gandleResult.findMany({
      where: { date },
      include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: [
        { solved: 'desc' },
        { createdAt: 'asc' },
      ],
    })

    return results.map(r => {
      const guesses = JSON.parse(r.guesses) as string[]
      return {
        userId: r.userId,
        displayName: r.user.displayName,
        avatarUrl: r.user.avatarUrl,
        solved: r.solved,
        guessCount: guesses.length,
        // Reveal guesses only after the viewer has completed their own game
        guesses: hasPlayed ? guesses : null,
        completedAt: r.createdAt,
      }
    })
  })
}
