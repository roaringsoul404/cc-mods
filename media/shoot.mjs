// node shoot.mjs <mod> preview t1,t2,...  → stills at recording times in out/<mod>/preview/
// node shoot.mjs <mod> gif               → ../<mod>/demo.gif from <mod>/edit.json
// node shoot.mjs <mod> film              → out/<mod>/<mod>-x.mp4, 1080 × 1080 for X, from edit.json's film
// edit.json: { fps, width, keys: [[videoT, recT], ...], film: { fps, keys, top, bottom } }
// keys map video time to recording time; top and bottom are the film's captions
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const [mod, mode, arg] = process.argv.slice(2)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', headless: true,
  args: [`--force-device-scale-factor=${mode === 'film' ? 1 : 2}`],
})
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewport({ width: 1400, height: 1100 })
  await page.goto(`http://127.0.0.1:${server.address().port}/player.html?mod=${mod}${mode === 'film' ? '&square=1' : ''}`)
  await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 })
  const err = await page.evaluate(() => window.__error)
  if (err || errors.length) throw new Error(err || errors.join('\n'))
  const stage = await page.$('#stage')
  const out = path.join(root, 'out', mod)

  if (mode === 'preview') {
    const dir = path.join(out, 'preview'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    for (const t of arg.split(',').map(Number).sort((a, b) => a - b)) {
      await page.evaluate(t => window.feedUntil(t), t)
      await stage.screenshot({ path: path.join(dir, `rec-${t.toFixed(2).padStart(6, '0')}.png`) })
    }
    console.log('marks', await page.evaluate(() => window.marks))
  } else {
    const all = JSON.parse(readFileSync(path.join(root, mod, 'edit.json'), 'utf8'))
    const edit = mode === 'film' ? all.film : all
    const dir = path.join(out, 'frames'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const k = edit.keys
    const seconds = k[k.length - 1][0]
    const recAt = (v) => {
      for (let i = 1; i < k.length; i++) if (v <= k[i][0]) {
        const [v0, r0] = k[i - 1], [v1, r1] = k[i]
        return r0 + (r1 - r0) * (v - v0) / (v1 - v0)
      }
      return k[k.length - 1][1]
    }
    const N = Math.round(edit.fps * seconds)
    for (let i = 0; i < N; i++) {
      await page.evaluate(t => window.feedUntil(t), recAt(i / edit.fps))
      await stage.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`) })
    }
    if (mode === 'film') {
      const mp4 = path.join(out, `${mod}-x.mp4`)
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(edit.fps), '-i', path.join(dir, '%04d.png'),
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { stdio: 'inherit' })
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', 'fps=3,scale=270:-2,tile=6x6', '-frames:v', '1',
        path.join(out, `${mod}-x-contact.jpg`)], { stdio: 'inherit' })
      console.log('wrote', mp4, (statSync(mp4).size / 1e6).toFixed(2), 'MB', N, 'frames')
    } else {
      // Two-pass palette: one palette for the whole clip, only changed pixels redrawn
      const gif = path.join(root, '..', mod, 'demo.gif')
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(edit.fps), '-i', path.join(dir, '%04d.png'),
        '-vf', `scale=${edit.width || 800}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
        gif], { stdio: 'inherit' })
      console.log('wrote', gif, (statSync(gif).size / 1e6).toFixed(2), 'MB', N, 'frames')
    }
  }
} finally { await browser.close(); server.close() }
