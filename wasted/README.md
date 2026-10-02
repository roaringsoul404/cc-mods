# wasted

A Claude Code mod. When a tool call fails, the spinner dies: its word drains to grey and **WASTED** fades in, in hand-drawn pixel lettering. Then the spinner comes back.

![WASTED in the terminal](demo.gif)

- Fires on any tool call that reports an error, including a Bash command with a non-zero exit code.
- Lasts about 2.5 s: ~0.5 s grey-out, ~1 s zoom-and-fade entrance, then a hold.
- Silent by default. Add your own sound as `sounds/custom.wav` (see below).
- Failures while the effect is playing are ignored, so a burst of errors shows it once.
- Terminal: a 76 × 10 cell `Raster`, repainted with `$.ui.blit` at 20 fps. Needs a terminal at least 76 columns wide.
- Original lettering, drawn in code. No third-party fonts, logos, sounds or game assets.

## Install

```
/plugin marketplace add roaringsoul404/cc-mods
/plugin install wasted@roaringsoul
```

To receive new versions on their own: `/plugin` → **Marketplaces** → `roaringsoul` → **Enable auto-update**. To turn it off, disable it in `/plugin`.

To try it without installing:

```bash
git clone https://github.com/roaringsoul404/cc-mods
claude --plugin-dir ./cc-mods/wasted
```

Then ask for something that fails:

> Run ./HESOYAM with Bash. Full health, full armor, $250k. What could go wrong?

**Desktop app:** the effect has a desktop branch (the same pixels as an `Svg`, 10 fps), and its drawing test passes. The Claude Code build bundled with the Desktop app (2.1.284 at the time of writing) loads installed mods only with `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` in its environment, and the effect hasn't been watched there yet.

## Check that it loaded

`/plugin` shows `1 mod active · wasted`. Or start with `--debug-file /tmp/wasted.log` and run:

```bash
grep "wasted@inline" /tmp/wasted.log
```

`loaded` means it's on. `not loaded: ... the rollout switch served off` means Claude Code switched mods off remotely for that launch; restart and check again.

## Files

| File | What it does |
| :- | :- |
| `hooks/register.js` | Hooks: detects failures (`tool.call`), replaces the spinner (`ui.render`), runs the animation clock, plays `sounds/custom.wav` if present |
| `hooks/draw.js` | Pure drawing: the lettering, the timeline and the shared pixel model, plus its terminal and SVG renderings |
| `sounds/` | Empty: where your `custom.wav` goes |
| `scripts/render-frames.mjs` | Renders terminal frames to PNG in `frames/`: `node scripts/render-frames.mjs 80` |
| `tests/wasted.test.ts` | `claude plugin test`: a failed call draws a Raster on terminal and an Svg on desktop |
| `video/` | Records a real session and renders the 7 s demo video; see `video/README.md` |

## Disclaimer

A fan project inspired by a meme. Not affiliated with, endorsed by or connected to Rockstar Games or Take-Two Interactive. "Grand Theft Auto" and related names are their trademarks. This repository contains no game assets: the lettering is original and no audio is included. Any file you add as `sounds/custom.wav` is your responsibility.
