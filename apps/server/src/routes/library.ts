import type { FastifyPluginAsync } from 'fastify'
import { createWriteStream, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

const BOOK_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'application/epub+zip',
])

const COVER_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const MIME_TO_EXT: Record<string, string> = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'application/epub+zip': '.epub',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
}

export const libraryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/library/shelves
  app.get('/shelves', async () => {
    const shelves = await prisma.libraryShelf.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { books: true } } },
    })
    return shelves
  })

  // POST /api/library/shelves
  app.post<{ Body: { name: string } }>('/shelves', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { name } = req.body as { name: string }
    if (!name?.trim()) return reply.status(400).send({ error: 'name required' })
    const shelf = await prisma.libraryShelf.create({
      data: { name: name.trim(), creatorId: userId },
      include: { _count: { select: { books: true } } },
    })
    return reply.status(201).send(shelf)
  })

  // PATCH /api/library/shelves/:shelfId (rename)
  app.patch<{ Params: { shelfId: string }; Body: { name: string } }>('/shelves/:shelfId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const { name } = req.body as { name: string }
    if (!name?.trim()) return reply.status(400).send({ error: 'name required' })
    const shelf = await prisma.libraryShelf.findUnique({ where: { id: req.params.shelfId } })
    if (!shelf) return reply.status(404).send({ error: 'Not found' })
    if (shelf.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })
    const updated = await prisma.libraryShelf.update({
      where: { id: req.params.shelfId },
      data: { name: name.trim() },
      include: { _count: { select: { books: true } } },
    })
    return updated
  })

  // DELETE /api/library/shelves/:shelfId
  app.delete<{ Params: { shelfId: string } }>('/shelves/:shelfId', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const shelf = await prisma.libraryShelf.findUnique({ where: { id: req.params.shelfId } })
    if (!shelf) return reply.status(404).send({ error: 'Not found' })
    if (shelf.creatorId !== userId) return reply.status(403).send({ error: 'Forbidden' })
    await prisma.libraryShelf.delete({ where: { id: req.params.shelfId } })
    return reply.status(204).send()
  })

  // GET /api/library/books/search?q=&genre=
  app.get<{ Querystring: { q?: string; genre?: string } }>('/books/search', async (req) => {
    const { q, genre } = req.query as { q?: string; genre?: string }
    const term = q?.trim()
    const books = await prisma.libraryBook.findMany({
      where: {
        ...(genre ? { genre } : {}),
        ...(term ? {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { author: { contains: term, mode: 'insensitive' } },
            { series: { contains: term, mode: 'insensitive' } },
          ],
        } : {}),
      },
      orderBy: { uploadedAt: 'desc' },
      include: {
        uploader: { select: { displayName: true } },
        shelf: { select: { id: true, name: true } },
      },
      take: 200,
    })
    return books
  })

  // GET /api/library/shelves/:shelfId/books
  app.get<{ Params: { shelfId: string } }>('/shelves/:shelfId/books', async (req, reply) => {
    const shelf = await prisma.libraryShelf.findUnique({ where: { id: req.params.shelfId } })
    if (!shelf) return reply.status(404).send({ error: 'Not found' })
    const books = await prisma.libraryBook.findMany({
      where: { shelfId: req.params.shelfId },
      orderBy: { uploadedAt: 'asc' },
      include: { uploader: { select: { displayName: true } } },
    })
    return books
  })

  // POST /api/library/shelves/:shelfId/books  (multipart: file + optional cover + title field)
  app.post<{ Params: { shelfId: string } }>('/shelves/:shelfId/books', async (req, reply) => {
    const { userId } = req.user as { userId: string }
    const uploadsDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads')

    const shelf = await prisma.libraryShelf.findUnique({ where: { id: req.params.shelfId } })
    if (!shelf) return reply.status(404).send({ error: 'Not found' })

    let title: string | null = null
    let author: string | null = null
    let series: string | null = null
    let genre: string | null = null
    let bookStoredName: string | null = null
    let bookFilename: string | null = null
    let bookMimeType: string | null = null
    let bookSize = 0
    let coverUrl: string | null = null

    // Override global fields:0 limit to allow the title/author/series fields
    const parts = req.parts({ limits: { fields: 10, fileSize: 50 * 1024 * 1024 } })

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'title') {
        title = String(part.value).trim()
        continue
      }
      if (part.type === 'field' && part.fieldname === 'author') {
        author = String(part.value).trim() || null
        continue
      }
      if (part.type === 'field' && part.fieldname === 'series') {
        series = String(part.value).trim() || null
        continue
      }
      if (part.type === 'field' && part.fieldname === 'genre') {
        genre = String(part.value).trim() || null
        continue
      }
      if (part.type !== 'file') continue

      if (part.fieldname === 'file') {
        if (!BOOK_MIME_TYPES.has(part.mimetype)) {
          await part.toBuffer()
          return reply.status(415).send({ error: `Unsupported book type: ${part.mimetype}` })
        }
        const ext = MIME_TO_EXT[part.mimetype]
        bookStoredName = `book_${randomBytes(16).toString('hex')}${ext}`
        bookFilename = part.filename.replace(/[/\\]/g, '_').slice(0, 255)
        bookMimeType = part.mimetype
        await pipeline(part.file, createWriteStream(join(uploadsDir, bookStoredName)))
        bookSize = (part.file as unknown as { bytesRead: number }).bytesRead ?? 0
      } else if (part.fieldname === 'cover') {
        if (!COVER_MIME_TYPES.has(part.mimetype)) {
          await part.toBuffer()
          continue // skip invalid cover silently
        }
        const ext = MIME_TO_EXT[part.mimetype]
        const coverStoredName = `cover_${randomBytes(16).toString('hex')}${ext}`
        await pipeline(part.file, createWriteStream(join(uploadsDir, coverStoredName)))
        coverUrl = `/uploads/${coverStoredName}`
      } else {
        await part.toBuffer()
      }
    }

    if (!bookStoredName || !bookFilename || !bookMimeType) {
      return reply.status(400).send({ error: 'Book file required (field name: "file")' })
    }
    if (!title) title = bookFilename

    try {
      const book = await prisma.libraryBook.create({
        data: {
          title,
          author,
          series,
          genre,
          filename: bookFilename,
          storedName: bookStoredName,
          mimeType: bookMimeType,
          size: bookSize,
          coverUrl,
          uploaderId: userId,
          shelfId: req.params.shelfId,
        },
        include: { uploader: { select: { displayName: true } } },
      })
      return reply.status(201).send(book)
    } catch (err) {
      // Clean up stored file on DB error
      try { unlinkSync(join(uploadsDir, bookStoredName)) } catch {}
      throw err
    }
  })

  // PATCH /api/library/shelves/:shelfId/books/:bookId (move shelf or update metadata)
  app.patch<{ Params: { shelfId: string; bookId: string }; Body: { shelfId?: string; title?: string; author?: string; series?: string; genre?: string } }>(
    '/shelves/:shelfId/books/:bookId',
    async (req, reply) => {
      const { userId } = req.user as { userId: string }
      const book = await prisma.libraryBook.findUnique({
        where: { id: req.params.bookId },
        include: { shelf: true },
      })
      if (!book || book.shelfId !== req.params.shelfId) return reply.status(404).send({ error: 'Not found' })
      if (book.uploaderId !== userId && book.shelf.creatorId !== userId) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
      const body = req.body as { shelfId?: string; title?: string; author?: string; series?: string; genre?: string }
      const data: Record<string, unknown> = {}
      if (body.shelfId) data.shelfId = body.shelfId
      if (body.title !== undefined) data.title = body.title
      if (body.author !== undefined) data.author = body.author || null
      if (body.series !== undefined) data.series = body.series || null
      if (body.genre !== undefined) data.genre = body.genre || null
      const updated = await prisma.libraryBook.update({
        where: { id: req.params.bookId },
        data,
        include: { uploader: { select: { displayName: true } } },
      })
      return updated
    },
  )

  // DELETE /api/library/shelves/:shelfId/books/:bookId
  app.delete<{ Params: { shelfId: string; bookId: string } }>(
    '/shelves/:shelfId/books/:bookId',
    async (req, reply) => {
      const { userId } = req.user as { userId: string }
      const book = await prisma.libraryBook.findUnique({
        where: { id: req.params.bookId },
        include: { shelf: true },
      })
      if (!book || book.shelfId !== req.params.shelfId) return reply.status(404).send({ error: 'Not found' })
      if (book.uploaderId !== userId && book.shelf.creatorId !== userId) {
        return reply.status(403).send({ error: 'Forbidden' })
      }
      await prisma.libraryBook.delete({ where: { id: req.params.bookId } })
      return reply.status(204).send()
    },
  )
}
