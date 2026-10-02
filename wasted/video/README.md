# wasted — X video

7 s, 1080×1080, 30 fps, with sound. A real Claude Code session (2.1.287, Sonnet 5.5) with the mod
loaded, recorded through a pty and replayed through xterm.js (DOM renderer) in headless Brave.

| Video | Recording | What |
|---|---|---|
| 0–0.9 s | 9.5–12.4 (3.2×) | prompt sent, Claude starts |
| 0.9–3.7 | real time | `Bash(./HESOYAM)` fails, WASTED, the sound's hit on its first pixel |
| 3.7–4.1 | 4× | Claude replies |
| 4.1–7.0 | real time | the reply, held |

Claude's reply is scripted for the joke: `capture.py` passes it through `--append-system-prompt` (not shown on
screen), with an instruction to run only the one command. Everything else on screen is the live session.

## Rebuild

```bash
npm install
python3 capture.py            # new take → rec.json; retries if mods are off, ./HESOYAM didn't fail first,
                              # or the reply is missing or landed before WASTED finished
node shoot.mjs preview 13.5   # stills at recording times → out/preview/
node shoot.mjs film           # edit.json → out/wasted-x.mp4 + out/wasted-x-contact.jpg
```

`capture.py` runs in `/tmp/ship-it` (empty, trusted) with `--setting-sources local`, so Claude never sees user
settings that list folders under the home path, and with no `--debug-file`, whose notice prints the home path.
After a new take, read its timestamps and update `edit.json`: `keys` maps video time to recording time,
`audio.hitAtRec` is when WASTED's first pixel reaches the screen.

The sound is `../sounds/custom.wav`, a third-party clip kept local: it is not in this repository, and neither is the
rendered `out/wasted-x.mp4`, which contains it. `edit.json` sets the gain (`audio.gainDb`) into a −1.5 dBFS limiter.
