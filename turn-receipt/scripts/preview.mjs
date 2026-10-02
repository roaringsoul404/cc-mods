// Prints sample receipts as plain text inside an 80-column frame, to judge
// the layout without a live session: node scripts/preview.mjs
import { layout, rowText, compactLine, WIDTH } from '../hooks/receipt.js'

const COLS = 80
const busy = {
  turn: 7,
  at: new Date('2026-10-02T14:32:00').getTime(),
  model: 'claude-opus-5-5',
  durationMs: 64000,
  usage: { input: 1234, output: 3456, cacheRead: 48100, cacheWrite: 12400 },
  usd: 0.184,
  files: [
    { name: 'register.js', add: 42, del: 7 },
    { name: 'turn-receipt.test.ts', add: 88, del: 0 },
    { name: 'receipt.js', add: 12, del: 3 },
    { name: 'plugin.json', add: 6, del: 0 },
    { name: 'README.md', add: 1, del: 1 },
  ],
  bash: 4,
  bashFailed: 1,
  tools: 11,
  aborted: false,
}
const quick = { ...busy, durationMs: 4200, usage: { input: 1234, output: 380, cacheRead: 0 }, usd: 0.004, tools: 0 }

const ruler = '┌' + '─'.repeat(COLS - 2) + '┐'
const frame = line => '│' + line.padEnd(COLS - 2) + '│'

console.log(ruler)
console.log(frame('> ship the receipt mod'))
console.log(frame(''))
console.log(frame('⏺ Done. Tests pass, validator green.'))
console.log(frame(''))
for (const row of layout(busy, WIDTH, 'Baked')) console.log(frame('  ' + rowText(row, WIDTH)))
console.log(frame(''))
console.log(frame('> thanks'))
console.log(frame(''))
console.log(frame('⏺ Anytime.'))
console.log(frame(''))
console.log(frame('  ' + compactLine(quick)))
console.log('└' + '─'.repeat(COLS - 2) + '┘')
