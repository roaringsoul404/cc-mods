# Record a real interactive Claude Code session with the wasted mod, with timing.
# Output: rec.json = {cols, rows, events: [[t, base64 bytes], ...], marks: {...}}
import os, pty, sys, time, json, base64, select, fcntl, termios, struct, signal, re

COLS, ROWS = 80, 30
CWD = '/tmp/ship-it'
PROMPTS = [
    'Run ./HESOYAM with Bash. Full health, full armor, $250k. What could go wrong?',
]
ALLOW = ['Bash(./HESOYAM)']
# Not shown on screen: scripts Claude's reply for the demo, and keeps it to the one command
ANSWER = 'Mission failed. You woke up outside the hospital. They kept the $250k for the bill.'
SYSTEM = ('This session is a comedy demo recording. Run exactly the command the user asks for, once, and no other '
          'command or tool. When it fails, reply with exactly this text and nothing else: ' + ANSWER)

env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE')}
env.update(TERM='xterm-256color', COLORTERM='truecolor', LANG='en_US.UTF-8')
# No user settings: they list extra directories under the home path, which Claude may
# mention on screen. Load the mod explicitly instead of through settings env.
MOD = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = ['claude', '--model', 'claude-sonnet-5-5', '--setting-sources', 'local', '--permission-mode', 'auto', '--plugin-dir', MOD,
        '--append-system-prompt', SYSTEM, '--allowedTools', *ALLOW]

pid, fd = pty.fork()
if pid == 0:
    os.chdir(CWD)
    os.execvpe(argv[0], argv, env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))

t0 = time.time()
events, marks, screen = [], {}, b''
def pump(seconds):
    global screen
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.02)
        if r:
            try: data = os.read(fd, 65536)
            except OSError: return
            if not data: return
            events.append([round(time.time() - t0, 4), base64.b64encode(data).decode()])
            screen = (screen + data)[-20000:]
def send(s):
    os.write(fd, s.encode())
def mark(name):
    marks[name] = round(time.time() - t0, 4)
    print(name, marks[name], flush=True)

def plain():
    return re.sub(rb'\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07|\s', b'', screen).lower()
pump(5)
if b'itrustthisfolder' in plain():
    send('\x1b[B'); pump(0.4); send('\r'); pump(5)

for i, p in enumerate(PROMPTS):
    mark(f'type{i}')
    for ch in p:
        send(ch); pump(0.03)
    pump(0.6)
    mark(f'enter{i}')
    send('\r')
    pump(22)
    mark(f'done{i}')
send('/exit\r'); pump(2)
try: os.kill(pid, signal.SIGKILL)
except ProcessLookupError: pass
# The mod drew if WASTED's half-block pixels reached the screen; else mods were off this launch
fired = sum(1 for t, b in events if '\u2584'.encode() in base64.b64decode(b))
print('raster chunks', fired, flush=True)
if fired == 0: sys.exit(3)
# Keep the take only if the failure on screen is ./HESOYAM itself, not a check Claude ran first
first = next(i for i, (t, b) in enumerate(events) if '\u2584'.encode() in base64.b64decode(b))
before = re.sub(rb'\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07|\s', b'', b''.join(base64.b64decode(b) for t, b in events[:first]))
if b'nosuchfileordirectory:./HESOYAM' not in before:
    print('take rejected: first failure was not ./HESOYAM', flush=True)
    sys.exit(4)
# The scripted reply must be on screen, and must land after WASTED's 2.5 s (else the spinner vanished mid-effect)
flat = lambda chunks: re.sub(rb'\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07|\s', b'', b''.join(base64.b64decode(b) for t, b in chunks))
key = re.sub(r'\s', '', ANSWER).encode()
said = next((events[i][0] for i in range(len(events)) if key in flat(events[:i + 1])), None)
t_raster = events[first][0]
print('raster', t_raster, 'answer', said, flush=True)
if said is None or said - t_raster < 2.1:
    print('take rejected: answer missing or it cut the effect short', flush=True)
    sys.exit(5)
json.dump({'cols': COLS, 'rows': ROWS, 'events': events, 'marks': marks}, open('rec.json', 'w'))
print('events', len(events), 'duration', events[-1][0])
