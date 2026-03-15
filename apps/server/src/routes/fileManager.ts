import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'

type SortField = 'size' | 'type' | 'uploadedAt' | 'uploader'

export const fileManagerRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/file-manager/files?sort=size|type|uploadedAt|uploader&limit=100&cursor=<id>
  app.get<{ Querystring: { sort?: string; limit?: string; cursor?: string } }>(
    '/files',
    async (req) => {
      const { userId } = req.user as { userId: string }
      const sort = (req.query.sort as SortField) ?? 'uploadedAt'
      const limit = Math.min(Number(req.query.limit ?? 100), 500)
      const cursor = req.query.cursor

      // Get channels the user is a member of (for DM/GROUP access checks)
      const memberships = await prisma.channelMember.findMany({
        where: { userId },
        select: { channelId: true },
      })
      const memberChannelIds = new Set(memberships.map(m => m.channelId))

      const orderBy = (() => {
        switch (sort) {
          case 'size': return { size: 'desc' as const }
          case 'type': return { mimeType: 'asc' as const }
          case 'uploader': return { uploader: { displayName: 'asc' as const } }
          default: return { uploadedAt: 'desc' as const }
        }
      })()

      const files = await prisma.attachment.findMany({
        where: { messageId: { not: null } },
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          uploader: { select: { displayName: true } },
          message: {
            select: {
              channel: { select: { id: true, name: true, type: true } },
            },
          },
        },
      })

      // Filter out DM/GROUP channels where the user is not a member
      const filtered = files.filter(f => {
        const type = f.message?.channel?.type
        if (type === 'DM' || type === 'GROUP') {
          return memberChannelIds.has(f.message!.channel.id)
        }
        return true
      })

      const hasMore = filtered.length > limit
      const page = hasMore ? filtered.slice(0, limit) : filtered
      const nextCursor = hasMore ? page[page.length - 1].id : null

      return { files: page, nextCursor }
    },
  )

  // GET /api/file-manager/stats
  app.get('/stats', async (req) => {
    const { userId } = req.user as { userId: string }

    const memberships = await prisma.channelMember.findMany({
      where: { userId },
      select: { channelId: true },
    })
    const memberChannelIds = new Set(memberships.map(m => m.channelId))

    // All linked attachments
    const allFiles = await prisma.attachment.findMany({
      where: { messageId: { not: null } },
      include: {
        message: {
          select: {
            channel: { select: { id: true, name: true, type: true } },
          },
        },
      },
    })

    // Filter by access
    const accessible = allFiles.filter(f => {
      const type = f.message?.channel?.type
      if (type === 'DM' || type === 'GROUP') {
        return memberChannelIds.has(f.message!.channel.id)
      }
      return true
    })

    const totalSize = accessible.reduce((sum, f) => sum + f.size, 0)
    const fileCount = accessible.length

    // Group by channel
    const channelMap = new Map<string, { channelId: string; channelName: string; fileCount: number; totalSize: number }>()
    for (const f of accessible) {
      const ch = f.message?.channel
      if (!ch) continue
      const existing = channelMap.get(ch.id) ?? { channelId: ch.id, channelName: ch.name, fileCount: 0, totalSize: 0 }
      existing.fileCount++
      existing.totalSize += f.size
      channelMap.set(ch.id, existing)
    }

    const limitGb = process.env.STORAGE_LIMIT_GB ? Number(process.env.STORAGE_LIMIT_GB) : null
    const limitBytes = limitGb !== null && !isNaN(limitGb) ? Math.round(limitGb * 1e9) : null

    return {
      totalSize,
      fileCount,
      byChannel: [...channelMap.values()].sort((a, b) => b.totalSize - a.totalSize),
      limitBytes,
    }
  })
}
