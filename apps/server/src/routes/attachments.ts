import type { FastifyPluginAsync } from 'fastify'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-msdownload',
  'application/vnd.microsoft.portable-executable',
])

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'application/x-msdownload': '.exe',
  'application/vnd.microsoft.portable-executable': '.exe',
}

export const attachmentRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // POST /api/attachments  — upload files (multipart/form-data, field name: "file")
  app.post('/', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const uploadsDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads')

    const results: Array<{
      id: string
      filename: string
      mimeType: string
      size: number
      url: string
    }> = []

    const parts = req.files()
    let fileCount = 0

    for await (const part of parts) {
      if (fileCount >= 5) {
        await part.toBuffer()
        continue
      }
      fileCount++

      const mimeType = part.mimetype
      if (!ALLOWED_MIME_TYPES.has(mimeType)) {
        await part.toBuffer()
        return reply.status(415).send({ error: `Unsupported media type: ${mimeType}` })
      }

      const ext = MIME_TO_EXT[mimeType]
      const storedName = `${randomBytes(16).toString('hex')}${ext}`
      const destPath = join(uploadsDir, storedName)

      await pipeline(part.file, createWriteStream(destPath))

      const size = (part.file as unknown as { bytesRead: number }).bytesRead ?? 0
      const safeFilename = part.filename.replace(/[/\\]/g, '_').slice(0, 255)

      const attachment = await prisma.attachment.create({
        data: { filename: safeFilename, storedName, mimeType, size, uploaderId: userId },
      })

      results.push({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        url: `/uploads/${storedName}`,
      })
    }

    if (results.length === 0) {
      return reply.status(400).send({ error: 'No valid files uploaded' })
    }

    return reply.status(201).send({ attachments: results })
  })
}
