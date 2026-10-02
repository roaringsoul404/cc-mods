# turn-receipt

A Claude Code mod. At the end of every turn Claude prints a receipt: the files it touched, the commands it ran, the tokens it used and what the turn cost.

![turn-receipt in the terminal](demo.gif)

As plain text:

```
╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱
              CLAUDE CODE
            · turn receipt ·
#0007  02 OCT 2026                 14:32
- - - - - - - - - - - - - - - - - - - -
register.js                     +42   −7
turn-receipt.test.ts            +88
receipt.js                      +12   −3
  + 2 more files
- - - - - - - - - - - - - - - - - - - -
BASH                   4 runs · 1 failed
TOOLS                                 11
BAKED                             1m 04s
- - - - - - - - - - - - - - - - - - - -
opus 5.5
TOKENS IN                           1.2k
TOKENS OUT                          3.5k
CACHE READ                         48.1k
CACHE WRITE                        12.4k
════════════════════════════════════════
TOTAL                             $0.184
════════════════════════════════════════
         thank you · come again
╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲

- - - - - 4.2s · 1.2k in · 380 out · $0.004 - - - - -
```

- Replaces the line that closes a turn in the terminal (`Baked for 1m 4s`); the time row keeps Claude's word (`BAKED`, `COOKED`…).
- Prints row by row, one every 35 ms, the first time it is drawn. Scrolling back redraws it whole.
- A turn with no tools gets the one-line strip at the bottom instead of the full receipt.
- Files show by name only, never by path. `+`/`−` are an estimate: the lines an `Edit` changed, past what old and new share at both ends, and every line of a `Write`. Files written by a Bash command are not counted.
- `TOTAL` is what the session's cost grew by during the turn, so it includes anything else billed meanwhile.
- An interrupted turn is stamped `VOID`.

## Install

```
/plugin marketplace add roaringsoul404/cc-mods
/plugin install turn-receipt@roaringsoul
```

To receive new versions on their own: `/plugin` → **Marketplaces** → `roaringsoul` → **Enable auto-update**. To turn it off, disable it in `/plugin`.

To try it without installing:

```bash
git clone https://github.com/roaringsoul404/cc-mods
claude --plugin-dir ./cc-mods/turn-receipt
```

Ask for anything that edits a file or runs a command, then look under the answer.

**Desktop app:** there is no closing line there, so the receipt is added under the answer as monospaced text (no colors, no printing animation). It is covered by the tests but hasn't been watched in the app yet.

## Check that it loaded

Start with `--debug-file /tmp/receipt.log` and run:

```bash
grep "turn-receipt@inline" /tmp/receipt.log
```

`loaded` means it's on. `not loaded: ... the rollout switch served off` means Claude Code switched mods off remotely for that launch; restart and check again.

## Files

| File | What it does |
| :- | :- |
| `hooks/register.js` | Hooks: tallies the turn (`turn.start`, `tool.call`), builds the receipt (`turn.complete`), draws it in place of the closing line (`ui.render`) |
| `hooks/receipt.js` | Pure layout: tallies, number formats and the rows, shared by terminal, desktop and the preview |
| `scripts/preview.mjs` | Prints a sample receipt in an 80-column frame: `node scripts/preview.mjs` |
| `demo.gif` | A real session, recorded by `media/capture.py turn-receipt` and rendered by `media/shoot.mjs` |
| `tests/turn-receipt.test.ts` | `claude plugin test`: the numbers of a busy turn, the compact strip, the printing, stale lines and narrow terminals |
