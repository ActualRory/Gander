import type { FastifyPluginAsync } from 'fastify'
import type { OgData } from '@gander/shared'

interface CacheEntry { data: OgData | null; fetchedAt: number }
const cache = new Map<string, CacheEntry>()
const TTL = 60 * 60 * 1000 // 1 hour

function getMeta(html: string, ...properties: string[]): string | null {
  for (const prop of properties) {
    // Match <meta property="..." content="..."> or <meta name="..." content="..."> in any attribute order
    const re = /<meta\s+[^>]*>/gi
    let match
    while ((match = re.exec(html)) !== null) {
      const tag = match[0]
      const propMatch = tag.match(/(?:property|name)=["']([^"']+)["']/i)
      if (!propMatch || propMatch[1].toLowerCase() !== prop.toLowerCase()) continue
      const contentMatch = tag.match(/content=["']([^"']*)["']/i)
      if (contentMatch) return decode(contentMatch[1])
    }
  }
  return null
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function parseOg(html: string, baseUrl: string): OgData {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  const pageTitle = titleMatch ? decode(titleMatch[1].trim()) : null

  let imageUrl = getMeta(html, 'og:image', 'twitter:image')
  if (imageUrl && !imageUrl.startsWith('http')) {
    try { imageUrl = new URL(imageUrl, baseUrl).toString() } catch { imageUrl = null }
  }

  return {
    title: getMeta(html, 'og:title', 'twitter:title') ?? pageTitle,
    description: getMeta(html, 'og:description', 'twitter:description', 'description'),
    siteName: getMeta(html, 'og:site_name'),
    imageUrl,
  }
}

export const ogRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (req, reply) => {
    try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
  })

  // GET /api/og?url=<encoded>  — fetch OG metadata for a URL
  app.get('/', async (req, reply) => {
    const { url } = req.query as { url?: string }
    if (!url) return reply.status(400).send({ error: 'url required' })

    let parsed: URL
    try { parsed = new URL(url) } catch { return reply.status(400).send({ error: 'invalid url' }) }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reply.status(400).send({ error: 'invalid protocol' })
    }

    const cached = cache.get(url)
    if (cached && Date.now() - cached.fetchedAt < TTL) return reply.send(cached.data)

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Gander/1.0 (link preview)' },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      })
      const ct = res.headers.get('content-type') ?? ''
      if (!ct.includes('text/html')) {
        cache.set(url, { data: null, fetchedAt: Date.now() })
        return reply.send(null)
      }
      // Read up to 200KB — enough for <head> without pulling huge bodies
      const reader = res.body?.getReader()
      if (!reader) { cache.set(url, { data: null, fetchedAt: Date.now() }); return reply.send(null) }
      const chunks: Uint8Array[] = []
      let total = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done || !value) break
        chunks.push(value)
        total += value.length
        if (total > 200 * 1024) { reader.cancel(); break }
      }
      const html = new TextDecoder().decode(
        chunks.reduce((acc, c) => { const n = new Uint8Array(acc.length + c.length); n.set(acc); n.set(c, acc.length); return n }, new Uint8Array(0))
      )
      const data = parseOg(html, url)
      cache.set(url, { data, fetchedAt: Date.now() })
      return reply.send(data)
    } catch {
      cache.set(url, { data: null, fetchedAt: Date.now() })
      return reply.send(null)
    }
  })
}
