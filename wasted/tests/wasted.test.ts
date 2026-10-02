import { expect, test } from 'claude-code/testing'

// What Claude Code passes to a ui.render hook for the spinner, apart from the app
const SPINNER = {
  plugin: 'wasted',
  component: 'Spinner',
  requestId: 'main',
  viewport: { columns: 100, rows: 30 },
  props: { word: 'Clauding', message: null, suffix: '…', mode: 'tool-use' },
} as const

test('a failed tool call draws WASTED on terminal and desktop', async ($, on) => {
  // Fail every tool call in Claude Code's place, as Bash does on exit 1
  on('tool.call', () => ({ isError: true, result: 'Exit code 1', text: 'Exit code 1' }))
  // Claude Code's own spinner, for when the mod passes the site on
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['Clauding…'] }))

  // Before any failure the spinner is Claude Code's
  const idle = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  expect(await idle.find({ type: 'Raster' })).toBeUndefined()
  await idle.unmount()

  const r = await $.tool.call({ tool: 'Bash', command: 'ls /nope' })
  expect(r.isError).toBe(true)

  const term = await $.ui.mount({ ...SPINNER, surface: 'terminal' })
  const raster = await term.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(76)
  expect(raster?.props.rows).toBe(10)
  await term.unmount()

  const desk = await $.ui.mount({ ...SPINNER, surface: 'desktop' })
  const svg = await desk.find({ type: 'Svg' })
  expect(svg?.props.alt).toBe('WASTED')
  expect(String(svg?.props.source).length).toBeLessThan(131072)
  expect(await desk.find({ type: 'Text', text: /Clauding/ })).toBeDefined()
  await desk.unmount()
})
