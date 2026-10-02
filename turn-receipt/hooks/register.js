import { WIDTH, STRIP_WIDTH, LINE_MS, newTally, lineCount, editDelta, addFile, layout, compactLine, receiptText } from './receipt.js'

const INDENT = 2 // lines up with the answer's text, past the ⏺
const KEEP = 50 // receipts kept so older turns redraw theirs on scroll

// What the running turn has done so far, reset on every turn.start
let tally = newTally()
let turns = 0
let costAtStart = null
// Finished receipts, newest last, and which TurnDuration row drew each one
const receipts = []
const drawnBy = new Map()
// The turn count when each closing line was first drawn: a line already on
// screen before a turn started (a resumed session's) never takes its receipt
const firstSeen = new Map()
// Whether a redraw is already queued for the printing animation
let printing = false

// One receipt row as Box/Text: items push their right side to the edge
function drawRow(Box, Text, row, width) {
  const style = s => ({ ...(s.dim ? { dimColor: true } : {}), ...(s.bold ? { bold: true } : {}), ...(s.color ? { color: s.color } : {}) })
  switch (row.kind) {
    case 'tear':
    case 'rule':
      return Text({ dimColor: true, children: [row.pattern.repeat(width).slice(0, width)] })
    case 'center':
      return Box({ width, justifyContent: 'center', children: [Text({ ...style(row), children: [row.text] })] })
    case 'item':
      return Box({
        width,
        justifyContent: 'space-between',
        children: [
          Text({ ...style(row), children: [row.left] }),
          Text({ ...style(row), ...(row.rightColor ? { color: row.rightColor } : {}), children: [row.right] }),
        ],
      })
    default:
      return Text({ ...style(row), children: [row.text] })
  }
}

export function register(on) {
  on('turn.start', async ($, e, next) => {
    tally = newTally()
    turns += 1
    const usage = await $.session.usage()
    costAtStart = usage.cost ? usage.cost.usd : null
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    tally.tools += 1
    if (e.tool === 'Bash') {
      tally.bash += 1
      if (r && r.isError === true) tally.bashFailed += 1
    } else if ((e.tool === 'Edit' || e.tool === 'Write') && typeof e.file_path === 'string' && !(r && r.isError === true)) {
      addFile(tally, e.file_path, e.tool === 'Edit' ? editDelta(e.old_string, e.new_string) : { add: lineCount(e.content), del: 0 })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    // A subagent's turn is part of the main one: its tools already counted
    if (e.agentId) return r
    const usage = await $.session.usage()
    const receipt = {
      turn: turns,
      at: await $.clock.now(),
      model: e.usage ? e.usage.model : '',
      durationMs: e.durationMs,
      usage: e.usage
        ? { input: e.usage.input_tokens, output: e.usage.output_tokens, cacheRead: e.usage.cache_read_input_tokens, cacheWrite: e.usage.cache_creation_input_tokens }
        : null,
      usd: usage.cost && costAtStart !== null ? usage.cost.usd - costAtStart : null,
      files: [...tally.files.values()],
      bash: tally.bash,
      bashFailed: tally.bashFailed,
      tools: tally.tools,
      aborted: e.isAborted,
    }
    receipts.push(receipt)
    if (receipts.length > KEEP) receipts.shift()
    // The terminal may have drawn the closing line already: redraw it as the receipt
    $.ui.invalidate('ui.render')

    // Desktop has no TurnDuration: the receipt goes under the answer, monospaced
    const surfaces = await $.session.surfaces()
    if (!surfaces.includes('desktop') || surfaces.includes('terminal')) return r
    const text = '```\n' + receiptText(receipt) + '\n```'
    return { ...r, text: r.text && r.text !== e.answer ? `${r.text}\n\n${text}` : text }
  })

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const columns = (e.viewport ? e.viewport.columns : 80) - INDENT - 2
    // Too narrow for paper: the engine's own line
    if (columns < 20) return next(e)
    if (!firstSeen.has(e.requestId)) {
      firstSeen.set(e.requestId, turns)
      if (firstSeen.size > KEEP * 4) firstSeen.delete(firstSeen.keys().next().value)
    }
    let receipt = drawnBy.get(e.requestId)
    if (!receipt) {
      // The newest receipt not drawn yet, of a turn this line appeared in, that
      // lasted as long as the line says
      const seenAt = firstSeen.get(e.requestId)
      receipt = receipts.findLast(x => !x.drawn && x.turn === seenAt && Math.abs(x.durationMs - e.props.durationMs) < 1000)
      if (!receipt) return next(e)
      receipt.drawn = true
      drawnBy.set(e.requestId, receipt)
      if (drawnBy.size > KEEP) drawnBy.delete(drawnBy.keys().next().value)
    }

    const { Box, Text } = $.ui.resolve(e)
    const width = Math.min(WIDTH, columns)
    if (receipt.tools === 0) {
      return Box({ marginLeft: INDENT, children: [Text({ dimColor: true, children: [compactLine(receipt, Math.min(STRIP_WIDTH, columns))] })] })
    }

    // Print: one more row every LINE_MS from the first time it is drawn
    const rows = layout(receipt, width, e.props.word || 'time')
    const now = await $.clock.now()
    if (receipt.printedAt === undefined) receipt.printedAt = now
    const shown = Math.min(rows.length, Math.floor((now - receipt.printedAt) / LINE_MS) + 1)
    if (shown < rows.length && !printing) {
      printing = true
      $.clock.after(LINE_MS, () => {
        printing = false
        $.ui.invalidate('ui.render')
      })
    }
    return Box({
      flexDirection: 'column',
      marginTop: 1,
      marginLeft: INDENT,
      width,
      children: rows.slice(0, shown).map(row => drawRow(Box, Text, row, width)),
    })
  })
}
