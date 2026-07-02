// Minimal image dimension probing for PNG / JPEG / GIF / WebP headers.
// Hand-rolled to avoid a dependency — only these four formats are accepted
// as image uploads (see attachments.ts ALLOWED_MIME_TYPES).

export function probeImageSize(buf: Buffer): { width: number; height: number } | null {
  try {
    if (isPng(buf)) return pngSize(buf)
    if (isGif(buf)) return gifSize(buf)
    if (isWebp(buf)) return webpSize(buf)
    if (isJpeg(buf)) return jpegSize(buf)
  } catch { /* malformed header — treat as unknown */ }
  return null
}

function valid(d: { width: number; height: number } | null): { width: number; height: number } | null {
  if (!d) return null
  if (d.width <= 0 || d.height <= 0 || d.width > 65535 * 4 || d.height > 65535 * 4) return null
  return d
}

function isPng(buf: Buffer): boolean {
  return buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
}

function pngSize(buf: Buffer) {
  return valid({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) })
}

function isGif(buf: Buffer): boolean {
  return buf.length > 10 && buf.toString('ascii', 0, 4) === 'GIF8'
}

function gifSize(buf: Buffer) {
  return valid({ width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) })
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8
}

function jpegSize(buf: Buffer) {
  // Walk markers until a Start-Of-Frame (SOFn) carrying the dimensions
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    if (marker === 0xff) { i++; continue }
    // SOF0–SOF15, excluding DHT (C4), DNL (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return valid({ height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) })
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}

function isWebp(buf: Buffer): boolean {
  return buf.length > 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
}

function webpSize(buf: Buffer) {
  const chunk = buf.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') {
    // Lossy: 14-bit dimensions at offset 26/28
    return valid({ width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff })
  }
  if (chunk === 'VP8L') {
    // Lossless: packed 14-bit fields after the 0x2f signature byte
    const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]
    return valid({
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    })
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit minus-one dimensions at offset 24/27
    return valid({ width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) })
  }
  return null
}
