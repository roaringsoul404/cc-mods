import { frame, frameModel, modelSvg, hex, DURATION_MS } from './draw.js'

const KEY = 'wasted'
const FRAME_MS = 50 // terminal: blit at 20 fps
const DESKTOP_EVERY = 2 // desktop: redraw every 2nd tick, 10 fps

// When the current death started, or null when nothing is playing
let diedAt = null
// The word the spinner showed when the tool failed
let deathWord = 'Working'
// The terminal spinner (agent id) whose Raster is on screen, or null
let mounted = null
// Whether a desktop spinner is drawing the effect
let onDesktop = false
let tick = 0
// Whether this death's sound has started
let played = false

export function register(on) {
  on('session.start', async ($, e, next) => {
    $.clock.every(FRAME_MS, async () => {
      if (diedAt === null) return
      const t = Date.now() - diedAt
      tick += 1
      if (t >= DURATION_MS) {
        // Effect over: give the spinner back
        diedAt = null
        mounted = null
        onDesktop = false
        $.ui.invalidate('ui.render')
        return
      }
      // The mod ships no sound: it plays sounds/custom.wav if the user added one,
      // and only once the effect is on screen (no sound from `claude -p`,
      // background subagents, or an Esc that took the spinner away)
      if (!played && (mounted !== null || onDesktop)) {
        played = true
        // Not awaited: play resolves only when the clip ends. No file, or no
        // player on this machine: silence.
        $.audio.play({ asset: 'sounds/custom.wav' }).catch(() => {})
      }
      // Desktop has no blit: redraw the site, which runs the render hook again
      if (onDesktop && tick % DESKTOP_EVERY === 0) $.ui.invalidate('ui.render')
      if (mounted === null) return
      const r = await $.ui.blit({ requestId: mounted, key: KEY, ...frame(t, deathWord) })
      if (r && r.deny) {
        // Raster no longer mounted: ask for a redraw, which draws the current
        // frame if the spinner is still on screen (also covers a site that
        // refuses blits, at the slower invalidate rate)
        mounted = null
        $.ui.invalidate('ui.render')
      }
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    // Ignore failures while a death is already playing
    if (r && r.isError && diedAt === null) {
      diedAt = Date.now()
      tick = 0
      played = false
      $.ui.invalidate('ui.render')
    }
    return r
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (diedAt === null || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      if (e.props && e.props.word) deathWord = e.props.word
      return next(e)
    }
    const t = Date.now() - diedAt
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      mounted = e.requestId
      return Raster({ key: KEY, ...frame(t, deathWord) })
    }
    // Desktop: the same pixel model, drawn as SVG
    const { Box, Text, Svg } = $.ui.resolve(e)
    const model = frameModel(t, deathWord)
    onDesktop = true
    return Box({
      flexDirection: 'column',
      children: [
        Text({ color: hex(model.wordColor), children: [model.label] }),
        Svg({ source: modelSvg(model), alt: 'WASTED' }),
      ],
    })
  })
}
