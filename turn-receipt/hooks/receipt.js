// The receipt itself: tallies, number formats and the row layout. Pure, no
// hooks and no $, so the terminal tree, the desktop text and
// scripts/preview.mjs all print the same paper.

export const WIDTH = 40 // paper width, in columns
export const LINE_MS = 35 // printer speed: one row every 35 ms
export const STRIP_WIDTH = 56 // the one-line strip of a turn without tools
const BRAND = '#D77757' // Claude orange
const MAX_FILES = 4 // compact receipt: the rest fold into "+ N more files"

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export function newTally() {
  return { files: new Map(), bash: 0, bashFailed: 0, tools: 0 }
}

// Lines in a text, 0 when empty
export function lineCount(s) {
  if (!s) return 0
  return s.replace(/\n$/, '').split('\n').length
}

// Rough +/− of an Edit: drop the lines old and new share at both ends, count the rest
export function editDelta(oldStr = '', newStr = '') {
  const a = oldStr.split('\n')
  const b = newStr.split('\n')
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { add: b.length - head - tail, del: a.length - head - tail }
}

// Files are keyed by full path but only the name is ever kept for printing
export function addFile(tally, path, delta) {
  const f = tally.files.get(path) ?? { name: path.split(/[\\/]/).pop(), add: 0, del: 0 }
  f.add += delta.add
  f.del += delta.del
  tally.files.set(path, f)
}

export function fmtTokens(n) {
  if (n < 1000) return String(n)
  // Cut where rounding would print 1000.0k
  if (n < 999950) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1e6).toFixed(2)}M`
}

export function fmtUsd(usd) {
  if (usd === null || !Number.isFinite(usd)) return '—'
  return `$${Math.max(0, usd).toFixed(usd < 10 ? 3 : 2)}`
}

export function fmtTime(ms) {
  // Under a minute as it will print: 59.97 s rounds up to 1m 00s, not 60.0s
  if (ms < 59950) return `${(ms / 1000).toFixed(1)}s`
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// claude-opus-5-5 → opus 5.5, claude-haiku-4-5-20251001 → haiku 4.5
export function fmtModel(id) {
  if (!id) return ''
  const m = id.replace(/^claude-/, '').match(/^([a-z]+)-(\d+)-(\d+)/)
  return m ? `${m[1]} ${m[2]}.${m[3]}` : id
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

function stamp(at) {
  const d = new Date(at)
  const p = n => String(n).padStart(2, '0')
  return { date: `${p(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, time: `${p(d.getHours())}:${p(d.getMinutes())}` }
}

// An item row whose left side is cut to leave room for the right one
function item(left, right, width, style = {}) {
  const room = width - right.length - 1
  const cut = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}…` : left
  return { kind: 'item', left: cut, right, ...style }
}

/**
 * The full receipt as rows. `r` is what the turn left behind:
 * { turn, at, model, durationMs, usage: { input, output, cacheRead, cacheWrite }, usd, files, bash, bashFailed, tools, aborted }
 * `timeLabel` is the terminal's past-tense word (BAKED), TIME elsewhere.
 */
export function layout(r, width = WIDTH, timeLabel = 'time') {
  const { date, time } = stamp(r.at)
  const rows = [
    { kind: 'tear', pattern: '╲╱' },
    { kind: 'center', text: 'CLAUDE CODE', bold: true, color: BRAND },
    { kind: 'center', text: '· turn receipt ·', dim: true },
    item(`#${String(r.turn).padStart(4, '0')}  ${date}`, time, width, { dim: true }),
    { kind: 'rule', pattern: '- ' },
  ]

  if (r.files.length > 0) {
    const shown = r.files.length > MAX_FILES ? MAX_FILES - 1 : r.files.length
    for (const f of r.files.slice(0, shown)) {
      // Two fixed columns, so the + and − line up down the list
      const right = `+${f.add}`.padStart(5) + (f.del > 0 ? `−${f.del}`.padStart(5) : ' '.repeat(5))
      rows.push(item(f.name, right, width))
    }
    if (shown < r.files.length) rows.push({ kind: 'note', text: `  + ${r.files.length - shown} more files`, dim: true })
    rows.push({ kind: 'rule', pattern: '- ' })
  }

  if (r.bash > 0) {
    rows.push(item('BASH', `${plural(r.bash, 'run')} · ${r.bashFailed} failed`, width, r.bashFailed > 0 ? { rightColor: 'error' } : {}))
  }
  rows.push(item('TOOLS', String(r.tools), width))
  rows.push(item(timeLabel.toUpperCase(), fmtTime(r.durationMs), width))

  if (r.usage) {
    rows.push({ kind: 'rule', pattern: '- ' })
    if (r.model) rows.push({ kind: 'note', text: fmtModel(r.model), dim: true })
    rows.push(item('TOKENS IN', fmtTokens(r.usage.input), width))
    rows.push(item('TOKENS OUT', fmtTokens(r.usage.output), width))
    rows.push(item('CACHE READ', fmtTokens(r.usage.cacheRead), width))
    rows.push(item('CACHE WRITE', fmtTokens(r.usage.cacheWrite), width))
  }

  rows.push({ kind: 'rule', pattern: '═' })
  rows.push(item('TOTAL', fmtUsd(r.usd), width, { bold: true }))
  rows.push({ kind: 'rule', pattern: '═' })
  rows.push({ kind: 'center', text: r.aborted ? '** VOID · interrupted **' : 'thank you · come again', dim: true })
  rows.push({ kind: 'tear', pattern: '╱╲' })
  return rows
}

// The one-liner for a turn that touched no tools
export function compactLine(r, width = STRIP_WIDTH) {
  const parts = [fmtTime(r.durationMs)]
  if (r.usage) parts.push(`${fmtTokens(r.usage.input)} in`, `${fmtTokens(r.usage.output)} out`)
  parts.push(fmtUsd(r.usd))
  const core = ` ${parts.join(' · ')} `
  const dashes = '- '.repeat(Math.max(1, Math.floor((width - core.length + 2) / 4))).trimEnd()
  return `${dashes}${core}${dashes}`
}

// One row as plain text, exactly `width` wide (trailing blanks trimmed)
export function rowText(row, width = WIDTH) {
  switch (row.kind) {
    case 'tear':
    case 'rule':
      return row.pattern.repeat(width).slice(0, width).trimEnd()
    case 'center': {
      const pad = Math.max(0, Math.floor((width - row.text.length) / 2))
      return ' '.repeat(pad) + row.text
    }
    case 'item':
      return (row.left + ' '.repeat(Math.max(1, width - row.left.length - row.right.length)) + row.right).trimEnd()
    default:
      return row.text
  }
}

export function receiptText(r, width = WIDTH) {
  if (r.tools === 0) return compactLine(r)
  return layout(r, width).map(row => rowText(row, width)).join('\n')
}
