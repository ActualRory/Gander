import type { FastifyPluginAsync } from 'fastify'
import type { ReactionSummary } from '@gander/shared'
import { prisma } from '../lib/prisma.js'
import { broadcast } from '../ws/handler.js'

const ALLOWED_REACTIONS = new Set([
  '+1', '-1', 'lol', 'rip', 'gg', '<3', 'o7', 'wtf', 'F', 'nice', 'lmao', 'yikes', 'pog', 'based', 'honk',
])

async function broadcastReactionUpdate(channelId: string, messageId: string) {
  const rows = await prisma.reaction.findMany({
    where: { messageId },
    select: { reaction: true, userId: true },
  })
  const map = new Map<string, string[]>()
  for (const r of rows) {
    if (!map.has(r.reaction)) map.set(r.reaction, [])
    map.get(r.reaction)!.push(r.userId)
  }
  const reactions: ReactionSummary[] = [...map.entries()].map(([reaction, userIds]) => ({
    reaction,
    count: userIds.length,
    userIds,
  }))
  broadcast(channelId, { type: 'reaction:updated', payload: { messageId, channelId, reactions } })
}

export const reactionRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // POST /api/reactions/:messageId  — add a reaction
  app.post('/:messageId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { messageId } = req.params as { messageId: string }
    const { reaction } = req.body as { reaction: string }

    if (!ALLOWED_REACTIONS.has(reaction)) {
      return reply.status(400).send({ error: 'Invalid reaction' })
    }

    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, channelId: true } })
    if (!message) return reply.status(404).send({ error: 'Message not found' })

    await prisma.reaction.upsert({
      where: { messageId_userId_reaction: { messageId, userId, reaction } },
      create: { messageId, userId, reaction },
      update: {},
    })

    await broadcastReactionUpdate(message.channelId, messageId)
    return reply.status(204).send()
  })

  // DELETE /api/reactions/:messageId?reaction=<tag>  — remove a reaction
  app.delete('/:messageId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { messageId } = req.params as { messageId: string }
    const { reaction } = req.query as { reaction: string }

    const message = await prisma.message.findUnique({ where: { id: messageId }, select: { id: true, channelId: true } })
    if (!message) return reply.status(404).send({ error: 'Message not found' })

    await prisma.reaction.deleteMany({ where: { messageId, userId, reaction } })

    await broadcastReactionUpdate(message.channelId, messageId)
    return reply.status(204).send()
  })
}
