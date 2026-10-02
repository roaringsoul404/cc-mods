// Pure drawing for the WASTED effect. No mods API here, so a plain node
// script can render the same frames to PNG (scripts/render-frames.mjs).

export const DURATION_MS = 2500
export const COLUMNS = 76
export const ROWS = 10 // 1 word row + 9 rows of half-block pixels

const DEFAULT = 0x01000000 // terminal default color
const PX_W = COLUMNS
const PX_H = (ROWS - 1) * 2 // 18 pixels tall, two per cell with ▀/▄

const CLAUDE_ORANGE = 0xd77757
const DEAD_GREY = 0x6e6e6e
const RED = 0xd3302f
const SHADOW = 0x1a0606

// Timeline
const GREY_END = 500 // word drains to grey
const IN_START = 450 // lettering starts to appear
const IN_END = 1400 // lettering settled, then holds until DURATION_MS
const SCALE_FROM = 2.15
const SCALE_TO = 2
const SHADOW_OFF = 1 // shadow offset in output pixels, right and down

// Hand-drawn 5x7 lettering. Original glyphs, not any existing typeface.
const GLYPHS = {
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
}

// The word as one bitmap: 6 glyphs, 1 pixel gap -> 35 x 7
const BITMAP = (() => {
  const rows = []
  for (let y = 0; y < 7; y++) {
    rows.push([...'WASTED'].map((ch) => GLYPHS[ch][y]).join('.'))
  }
  return rows
})()
const BM_W = BITMAP[0].length
const BM_H = BITMAP.length

const clamp01 = (x) => Math.max(0, Math.min(1, x))
const easeOut = (x) => 1 - Math.pow(1 - x, 3)

function lerpColor(a, b, t) {
  const ch = (shift) => Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * t)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

// Is output pixel (px, py) inside the lettering at this scale, centered?
function inLetters(px, py, scale) {
  const bx = Math.floor((px + 0.5 - PX_W / 2) / scale + BM_W / 2)
  const by = Math.floor((py + 0.5 - PX_H / 2) / scale + BM_H / 2)
  if (bx < 0 || by < 0 || bx >= BM_W || by >= BM_H) return false
  return BITMAP[by][bx] === '#'
}

// The shared pixel model: one frame of the effect, independent of surface.
// `label` and `wordColor` are the dead spinner line; `pixels` is a
// PX_W x PX_H grid, row-major, each a 0xRRGGBB color or null (transparent).
export function frameModel(tMs, word) {
  const wordColor = lerpColor(CLAUDE_ORANGE, DEAD_GREY, easeOut(clamp01(tMs / GREY_END)))
  // A Raster refuses the whole tree over one cell that isn't a width-1
  // character, so anything but printable Latin becomes '?'
  const printable = (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0x24f)
  const safe = [...(word || 'Working')].map((ch) => (printable(ch.codePointAt(0)) ? ch : '?')).join('')
  const label = '✻ ' + safe + '…'

  // WASTED, zooming in from slightly bigger and fading up from black
  const p = clamp01((tMs - IN_START) / (IN_END - IN_START))
  const alpha = easeOut(p)
  const scale = SCALE_FROM + (SCALE_TO - SCALE_FROM) * easeOut(p)
  const red = lerpColor(0x000000, RED, alpha)
  const shadow = lerpColor(0x000000, SHADOW, alpha)

  const pixels = new Array(PX_W * PX_H).fill(null)
  if (p > 0) {
    for (let py = 0; py < PX_H; py++) {
      for (let px = 0; px < PX_W; px++) {
        if (inLetters(px, py, scale)) pixels[py * PX_W + px] = red
        else if (inLetters(px - SHADOW_OFF, py - SHADOW_OFF, scale)) pixels[py * PX_W + px] = shadow
      }
    }
  }
  return { label, wordColor, width: PX_W, height: PX_H, pixels }
}

// Terminal: the model as a flat array of [codePoint, fg, bg] per cell,
// row-major, two pixels per cell with ▀/▄.
export function modelCells(model) {
  const cells = new Array(COLUMNS * ROWS * 3)
  const put = (col, row, ch, fg, bg) => {
    const i = (row * COLUMNS + col) * 3
    cells[i] = ch.codePointAt(0)
    cells[i + 1] = fg
    cells[i + 2] = bg
  }

  const label = [...model.label].slice(0, COLUMNS)
  for (let c = 0; c < COLUMNS; c++) put(c, 0, label[c] ?? ' ', model.wordColor, DEFAULT)

  const pixel = (x, y) => model.pixels[y * PX_W + x]
  for (let row = 1; row < ROWS; row++) {
    const top = (row - 1) * 2
    for (let c = 0; c < COLUMNS; c++) {
      const a = pixel(c, top)
      const b = pixel(c, top + 1)
      if (a === null && b === null) put(c, row, ' ', DEFAULT, DEFAULT)
      else if (b === null) put(c, row, '▀', a, DEFAULT)
      else if (a === null) put(c, row, '▄', b, DEFAULT)
      else put(c, row, '▀', a, b)
    }
  }
  return cells
}

// Pack cells into the base64 string a Raster takes: u32 little-endian triples.
export function packCells(cells) {
  return new Uint8Array(Uint32Array.from(cells).buffer).toBase64()
}

export const hex = (color) => '#' + color.toString(16).padStart(6, '0')

// Desktop: the model's pixels as an SVG document, one <rect> per pixel,
// grouped by color. Same grid as the terminal, square pixels.
export const SVG_PX = 6 // CSS pixels per model pixel
export const SVG_MAX = 131072

export function modelSvg(model) {
  const byColor = new Map()
  model.pixels.forEach((color, i) => {
    if (color === null) return
    const rect = `<rect x="${i % model.width}" y="${Math.floor(i / model.width)}" width="1" height="1"/>`
    byColor.set(color, (byColor.get(color) ?? '') + rect)
  })
  let groups = ''
  for (const [color, rects] of byColor) groups += `<g fill="${hex(color)}">${rects}</g>`
  const w = model.width * SVG_PX
  const h = model.height * SVG_PX
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${model.width} ${model.height}" shape-rendering="crispEdges">${groups}</svg>`
  )
}

// Terminal Raster props for one frame
export function frame(tMs, word) {
  return { columns: COLUMNS, rows: ROWS, cells: packCells(modelCells(frameModel(tMs, word))) }
}
