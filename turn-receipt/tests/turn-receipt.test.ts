import { expect, mock, test } from 'claude-code/testing'
import { fmtTime, fmtTokens } from '../hooks/receipt.js'

// The line that closes a turn in the terminal transcript ("Baked for 1m 4s")
const CLOSING_LINE = {
  plugin: 'turn-receipt',
  component: 'TurnDuration',
  requestId: 'msg-1',
  surface: 'terminal',
  viewport: { columns: 80, rows: 30 },
  props: { word: 'Baked', durationMs: 64000 },
} as const

const USAGE = { input_tokens: 1234, output_tokens: 3456, cache_read_input_tokens: 48100, cache_creation_input_tokens: 900, model: 'claude-opus-5-5' }

// Claude Code's side: session cost, surfaces, tool results and the closing line
function stubEngine(on, surfaces: string[]) {
  const clock = mock.clock(on)
  const spent = { usd: 1.25 }
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000, percent: 10, model: 'm' }, rateLimits: [], cost: { usd: spent.usd } } }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  // Bash `false` fails as exit 1 does; everything else succeeds
  on('tool.call', ($, e) =>
    e.tool === 'Bash' && e.command === 'false'
      ? { isError: true, result: 'Exit code 1', text: 'Exit code 1' }
      : { isError: false, result: 'ok', text: 'ok' },
  )
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Baked for 1m 4s'] }))
  return { clock, spent }
}

// 2 Edits, 1 Write, 2 Bash of which one fails; the turn costs $0.184
async function busyTurn($, spent) {
  await $.turn.start({ text: 'ship it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/someone/proj/src/app.js', old_string: 'a\nb\nc', new_string: 'a\nB\nc' })
  await $.tool.call({ tool: 'Edit', file_path: '/Users/someone/proj/src/util.js', old_string: 'x', new_string: 'x\ny\nz' })
  await $.tool.call({ tool: 'Write', file_path: '/Users/someone/proj/README.md', content: '# a\n\nb\nc\nd\n' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Bash', command: 'false' })
  spent.usd += 0.184
  return $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 64000, isAborted: false, reason: 'answer', usage: USAGE })
}

test('desktop: a busy turn prints the full receipt under the answer', async ($, on) => {
  const { spent } = stubEngine(on, ['desktop'])
  const r = await busyTurn($, spent)
  const text: string = r.text

  expect(text.startsWith('```\n')).toBe(true)
  expect(text).toMatch(/^app\.js +\+1 +−1$/m)
  expect(text).toMatch(/^util\.js +\+2 *$/m)
  expect(text).toMatch(/^README\.md +\+5 *$/m)
  expect(text).toMatch(/^BASH +2 runs · 1 failed$/m)
  expect(text).toMatch(/^TOOLS +5$/m)
  expect(text).toMatch(/^TIME +1m 04s$/m)
  expect(text).toMatch(/^TOKENS IN +1\.2k$/m)
  expect(text).toMatch(/^TOKENS OUT +3\.5k$/m)
  expect(text).toMatch(/^CACHE READ +48\.1k$/m)
  expect(text).toMatch(/^CACHE WRITE +900$/m)
  expect(text).toMatch(/^TOTAL +\$0\.184$/m)
  // Only file names, never where they live
  expect(text).not.toMatch(/Users|someone|proj/)
})

test('desktop: a turn without tools is one compact line', async ($, on) => {
  const { spent } = stubEngine(on, ['desktop'])
  await $.turn.start({ text: 'hi', turnId: 't2' })
  spent.usd += 0.004
  const r = await $.turn.complete({ turnId: 't2', answer: 'hello', durationMs: 4200, isAborted: false, reason: 'answer', usage: USAGE })

  const lines = r.text.split('\n').filter(l => !l.startsWith('```'))
  expect(lines.length).toBe(1)
  expect(lines[0]).toMatch(/^- (- )*4\.2s · 1\.2k in · 3\.5k out · \$0\.004 (- )*-$/)
  expect(r.text).not.toMatch(/TOTAL/)
})

test('terminal: the closing line becomes the receipt, printed row by row', async ($, on) => {
  const { clock, spent } = stubEngine(on, ['terminal'])
  const r = await busyTurn($, spent)
  // The terminal draws the receipt itself: the answer stays as it was
  expect(r.text).toBe('done')

  const ui = await $.ui.mount(CLOSING_LINE)
  expect(await ui.find({ type: 'Text', text: 'Baked for' })).toBeUndefined()
  // The printer starts with the torn edge alone, the header one row later
  expect(await ui.find({ type: 'Text', text: 'CLAUDE CODE' })).toBeUndefined()
  await clock.advance(40)
  // Mid-print: the header is out, the total is not yet
  expect(await ui.find({ type: 'Text', text: 'CLAUDE CODE' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'TOTAL' })).toBeUndefined()

  await clock.advance(2000)
  expect(await ui.find({ type: 'Text', text: 'app.js' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 runs · 1 failed' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'BAKED' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$0.184' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'CACHE WRITE' })).toBeDefined()
  // The header in Claude orange
  expect((await ui.find({ type: 'Text', text: 'CLAUDE CODE' }))?.props.color).toBe('#D77757')
  await ui.unmount()
})

test('terminal: a turn without tools is one dim line', async ($, on) => {
  const { spent } = stubEngine(on, ['terminal'])
  await $.turn.start({ text: 'hi', turnId: 't3' })
  spent.usd += 0.004
  await $.turn.complete({ turnId: 't3', answer: 'hello', durationMs: 4200, isAborted: false, reason: 'answer', usage: USAGE })

  const ui = await $.ui.mount({ ...CLOSING_LINE, requestId: 'msg-3', props: { word: 'Baked', durationMs: 4200 } })
  expect(await ui.find({ type: 'Text', text: /4\.2s · .* · \$0\.004/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'TOTAL' })).toBeUndefined()
  await ui.unmount()
})

test('a closing line already on screen before the turn keeps its own text', async ($, on) => {
  const { clock, spent } = stubEngine(on, ['terminal'])
  // A resumed session's line, drawn before any turn, as long as the new turn
  const old = await $.ui.mount({ ...CLOSING_LINE, requestId: 'old-msg' })
  expect(await old.find({ type: 'Text', text: 'Baked for' })).toBeDefined()

  await busyTurn($, spent)
  await clock.advance(2000)
  expect(await old.find({ type: 'Text', text: 'Baked for' })).toBeDefined()
  expect(await old.find({ type: 'Text', text: 'TOTAL' })).toBeUndefined()
  await old.unmount()

  // The turn's own line still gets the receipt
  const own = await $.ui.mount(CLOSING_LINE)
  await clock.advance(2000)
  expect(await own.find({ type: 'Text', text: '$0.184' })).toBeDefined()
  await own.unmount()
})

test('a terminal too narrow for paper keeps the engine line', async ($, on) => {
  const { spent } = stubEngine(on, ['terminal'])
  await busyTurn($, spent)
  const ui = await $.ui.mount({ ...CLOSING_LINE, viewport: { columns: 12, rows: 30 } })
  expect(await ui.find({ type: 'Text', text: 'Baked for' })).toBeDefined()
  await ui.unmount()
})

test('times and token counts round without spilling over', () => {
  expect(fmtTime(4200)).toBe('4.2s')
  expect(fmtTime(59970)).toBe('1m 00s')
  expect(fmtTime(119600)).toBe('2m 00s')
  expect(fmtTime(64000)).toBe('1m 04s')
  expect(fmtTokens(999)).toBe('999')
  expect(fmtTokens(48100)).toBe('48.1k')
  expect(fmtTokens(999960)).toBe('1.00M')
})
