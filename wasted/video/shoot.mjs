// node shoot.mjs preview t1,t2,...   → recording-time stills in out/preview/
// node shoot.mjs film                 → full 15s film via edit.json map
import puppeteer from 'puppeteer-core'
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const root = path.dirname(new URL(import.meta.url).pathname)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }
const server = createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
  if (!p.startsWith(root) || !existsSync(p) || statSync(p).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p))
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await puppeteer.launch({
  executablePath: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--force-device-scale-factor=1'],
})
const [mode, arg] = process.argv.slice(2)
try {
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  await page.setViewport({ width: 1080, height: 1080 })
  await page.goto(`http://127.0.0.1:${server.address().port}/player.html`)
  await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 })
  const err = await page.evaluate(() => window.__error)
  if (err || errors.length) throw new Error(err || errors.join('\n'))
  const stage = await page.$('#stage')
  const shot = (file) => stage.screenshot({ path: file })

  if (mode === 'preview') {
    const dir = path.join(root, 'out', 'preview'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    for (const t of arg.split(',').map(Number).sort((a, b) => a - b)) {
      await page.evaluate(t => window.feedUntil(t), t)
      await shot(path.join(dir, `rec-${t.toFixed(2).padStart(6, '0')}.png`))
    }
    console.log('marks', await page.evaluate(() => window.marks),
      'raster0', await page.evaluate(() => window.firstRaster(window.marks.enter0)),
      'raster1', await page.evaluate(() => window.firstRaster(window.marks.enter1)))
  } else {
    // edit.json: { fps, seconds, keys: [[videoT, recT], ...] }
    const edit = JSON.parse(readFileSync(path.join(root, 'edit.json'), 'utf8'))
    const dir = path.join(root, 'out', 'frames'); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
    const N = Math.round(edit.fps * edit.seconds)
    const recAt = (v) => {
      const k = edit.keys
      for (let i = 1; i < k.length; i++) if (v <= k[i][0]) {
        const [v0, r0] = k[i - 1], [v1, r1] = k[i]
        return r0 + (r1 - r0) * (v - v0) / (v1 - v0)
      }
      return k[k.length - 1][1]
    }
    for (let i = 0; i < N; i++) {
      const v = i / edit.fps
      await page.evaluate(t => window.feedUntil(t), recAt(v))
      await shot(path.join(dir, `${String(i).padStart(4, '0')}.png`))
      if ((i + 1) % 60 === 0) console.log(`${i + 1}/${N}`)
    }
    const out = path.join(root, 'out', 'wasted-x.mp4')
    const video = ['-framerate', String(edit.fps), '-i', path.join(dir, '%04d.png')]
    const venc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
    if (edit.audio) {
      // The sound, placed so its hit lands on WASTED's first pixel; a fixed gain into a
      // -1.5 dBFS limiter (loudnorm misses its target on a short clip mostly silence)
      const recToVideo = (r) => {
        const k = edit.keys
        for (let i = 1; i < k.length; i++) if (r <= k[i][1]) {
          const [v0, r0] = k[i - 1], [v1, r1] = k[i]
          return v0 + (v1 - v0) * (r - r0) / (r1 - r0)
        }
      }
      const startMs = Math.round((recToVideo(edit.audio.hitAtRec) - edit.audio.hitInFile) * 1000)
      console.log('sound starts at', startMs, 'ms')
      execFileSync('ffmpeg', ['-v', 'error', '-y', ...video, '-i', path.join(root, edit.audio.file),
        '-filter_complex', `[1:a]adelay=${startMs}|${startMs},apad,aresample=48000,volume=${edit.audio.gainDb || 0}dB,alimiter=limit=0.84:level=false,afade=t=out:st=${edit.seconds - 0.6}:d=0.6[a]`,
        '-map', '0:v', '-map', '[a]', ...venc, '-c:a', 'aac', '-b:a', '192k', '-t', String(edit.seconds), out], { stdio: 'inherit' })
    } else {
      execFileSync('ffmpeg', ['-v', 'error', '-y', ...video, ...venc, out], { stdio: 'inherit' })
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', out, '-vf', 'fps=4,scale=270:-2,tile=7x4', '-frames:v', '1',
      path.join(root, 'out', 'wasted-x-contact.jpg')], { stdio: 'inherit' })
    console.log('wrote', out)
  }
} finally { await browser.close(); server.close() }
