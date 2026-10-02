// Thermal-printer sound for the X film, synthesized from code (no samples), synced
// to the receipt rows: one "zzzt" per screen update while the receipt prints, then
// the paper tearing. Writes out/turn-receipt/receipt.wav and muxes it into
// out/turn-receipt/turn-receipt-x-sound.mp4.  Usage: node turn-receipt/sound.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const out = path.join(here, '..', 'out', 'turn-receipt')
const rec = JSON.parse(readFileSync(path.join(here, 'rec.json'), 'utf8'))
const { keys, fps } = JSON.parse(readFileSync(path.join(here, 'edit.json'), 'utf8')).film
const SECONDS = keys[keys.length - 1][0]
const RATE = 48000

// Recording time → film time, the inverse of shoot.mjs's map
const toFilm = (r) => {
  for (let i = 1; i < keys.length; i++) if (r <= keys[i][1]) {
    const [v0, r0] = keys[i - 1], [v1, r1] = keys[i]
    return v0 + (v1 - v0) * (r - r0) / (r1 - r0)
  }
  return SECONDS
}

// The screen updates that print receipt rows: from the top tear to the bottom one
const text = (b) => Buffer.from(b, 'base64').toString('utf8')
const first = rec.events.findIndex(([, b]) => text(b).includes('╲╱╲╱'))
const last = rec.events.findLastIndex(([, b]) => text(b).includes('╱╲╱╲'))
const rows = rec.events.slice(first, last + 1).map(([t]) => toFilm(t))
console.log('print bursts at', rows.map(t => t.toFixed(2)).join(' '))

const buf = new Float32Array(Math.ceil(SECONDS * RATE))
let seed = 7
const noise = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff) - 1

// A biquad band-pass, state kept per voice
function bandpass(f, q) {
  const w = 2 * Math.PI * f / RATE, a = Math.sin(w) / (2 * q), c = Math.cos(w)
  const b0 = a / (1 + a), b2 = -a / (1 + a), a1 = -2 * c / (1 + a), a2 = (1 - a) / (1 + a)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x) => { const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y }
}

// One print burst: the head's hiss chopped by the stepper, over the motor's square tone
function burst(at, len) {
  const hiss = bandpass(4200, 1.1), body = bandpass(900, 0.9)
  const n = Math.floor(len * RATE), start = Math.floor(at * RATE)
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE
    const env = Math.min(1, t / 0.004) * Math.min(1, (len - t) / 0.03)
    const step = Math.sin(2 * Math.PI * 118 * t) > -0.2 ? 1 : 0.35 // stepper chopping
    const motor = Math.sign(Math.sin(2 * Math.PI * 337 * t)) * 0.5
    buf[start + i] += env * (hiss(noise()) * 1.6 * step + body(motor) * 0.9)
  }
}

// The tear: a rising band of crackle, grains of paper fibre giving way
function tear(at, len) {
  const n = Math.floor(len * RATE), start = Math.floor(at * RATE)
  let grain = 1, f = bandpass(2200, 0.8)
  for (let i = 0; i < n && start + i < buf.length; i++) {
    const t = i / RATE, p = t / len
    if (i % 160 === 0) { grain = 0.25 + Math.abs(noise()) ** 2 * 1.5; f = bandpass(1800 + 4200 * p, 0.8) }
    const env = Math.sin(Math.PI * Math.min(1, p * 1.15)) ** 0.7
    buf[start + i] += env * grain * f(noise()) * 1.9
  }
}

for (let i = 0; i < rows.length; i++) {
  const gap = (rows[i + 1] ?? rows[i] + 0.2) - rows[i]
  burst(rows[i], Math.min(0.16, gap * 0.85))
}
tear(rows[rows.length - 1] + 0.32, 0.3)

// A short slap off the desk for body, then peak-normalise to -3 dBFS
const d = Math.floor(0.021 * RATE)
for (let i = buf.length - 1; i >= d; i--) buf[i] += buf[i - d] * 0.22
const peak = buf.reduce((m, x) => Math.max(m, Math.abs(x)), 0)
const gain = 10 ** (-3 / 20) / peak

// 16-bit stereo WAV
const pcm = Buffer.alloc(44 + buf.length * 4)
pcm.write('RIFF', 0); pcm.writeUInt32LE(36 + buf.length * 4, 4); pcm.write('WAVEfmt ', 8)
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22); pcm.writeUInt32LE(RATE, 24)
pcm.writeUInt32LE(RATE * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34); pcm.write('data', 36)
pcm.writeUInt32LE(buf.length * 4, 40)
for (let i = 0; i < buf.length; i++) {
  const s = Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767)
  pcm.writeInt16LE(s, 44 + i * 4); pcm.writeInt16LE(s, 46 + i * 4)
}
const wav = path.join(out, 'receipt.wav')
writeFileSync(wav, pcm)

const film = path.join(out, 'turn-receipt-x.mp4'), mp4 = path.join(out, 'turn-receipt-x-sound.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', film, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
  '-af', 'alimiter=limit=0.84:level=false', '-c:a', 'aac', '-b:a', '192k', '-shortest', mp4], { stdio: 'inherit' })
console.log('wrote', mp4)
