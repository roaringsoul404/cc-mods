// Render frames of the WASTED effect to PNG, the way a dark terminal would.
// Usage: node scripts/render-frames.mjs [columns]   (default 80)
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Node 22 has no Uint8Array.prototype.toBase64
if (!Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function () {
    return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString('base64')
  }
}

const { frame, DURATION_MS } = await import('../hooks/draw.js')

const TERM_COLS = Number(process.argv[2] ?? 80)
const CW = 9 // cell width in px
const CH = 18 // cell height in px
const TERM_BG = 0x1e1e1e
const TERM_FG = 0xcccccc
const DEFAULT = 0x01000000
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'frames')
mkdirSync(OUT, { recursive: true })

// CRC + PNG writer
const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
const crc32 = (buf) => {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function render(f, name) {
  // Decode the packed base64 exactly as Claude Code would receive it
  const u32 = new Uint32Array(new Uint8Array(Buffer.from(f.cells, 'base64')).buffer)
  const padRows = 2
  const w = TERM_COLS * CW
  const h = (f.rows + padRows * 2) * CH
  const img = Buffer.alloc(w * h * 3)
  const fill = (x0, y0, x1, y1, color) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < Math.min(x1, w); x++) {
        const i = (y * w + x) * 3
        img[i] = (color >> 16) & 255
        img[i + 1] = (color >> 8) & 255
        img[i + 2] = color & 255
      }
  }
  fill(0, 0, w, h, TERM_BG)
  const res = (c, d) => (c === DEFAULT ? d : c)
  for (let r = 0; r < f.rows; r++)
    for (let c = 0; c < f.columns && c < TERM_COLS; c++) {
      const i = (r * f.columns + c) * 3
      const ch = String.fromCodePoint(u32[i])
      const fg = res(u32[i + 1], TERM_FG)
      const bg = res(u32[i + 2], TERM_BG)
      const x = c * CW
      const y = (r + padRows) * CH
      fill(x, y, x + CW, y + CH, bg)
      if (ch === '▀') fill(x, y, x + CW, y + CH / 2, fg)
      else if (ch === '▄') fill(x, y + CH / 2, x + CW, y + CH, fg)
      else if (ch !== ' ') fill(x + 2, y + 5, x + CW - 2, y + CH - 4, fg) // text glyph stand-in
    }
  writeFileSync(join(OUT, name), png(w, h, img))
}

const times = [250, 600, 900, 1200, 2000]
for (const t of times) render(frame(t, 'Clauding'), `frame-${String(t).padStart(4, '0')}ms.png`)
console.log(`wrote ${times.length} frames at ${TERM_COLS} columns to ${OUT} (effect lasts ${DURATION_MS} ms)`)
