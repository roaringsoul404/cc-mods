# Record a real interactive Claude Code session with one mod loaded, with timing.
# Usage: python3 capture.py <mod>   (reads <mod>/take.json, writes <mod>/rec.json)
# take.json: { prompts: [...], allow: [...], system: "...", env: {...}, wait: seconds per prompt, expect: "text the mod draws" }
import os, pty, sys, time, json, base64, select, fcntl, termios, struct, signal, re, shutil

MOD = sys.argv[1]
HERE = os.path.dirname(os.path.abspath(__file__))
TAKE = json.load(open(os.path.join(HERE, MOD, 'take.json')))
COLS, ROWS = TAKE.get('cols', 80), TAKE.get('rows', 30)
# An empty folder with a neutral name: the welcome box prints the working directory
CWD = f'/tmp/demo-{MOD}'
shutil.rmtree(CWD, ignore_errors=True); os.makedirs(CWD)

env = {k: v for k, v in os.environ.items() if not k.startswith('CLAUDE')}
env.update(TERM='xterm-256color', COLORTERM='truecolor', LANG='en_US.UTF-8', **TAKE.get('env', {}))
# No user settings: they list directories under the home path. The mod loads by --plugin-dir alone.
argv = ['claude', '--model', 'claude-sonnet-5-5', '--setting-sources', 'local', '--permission-mode', 'auto',
        '--plugin-dir', os.path.join(os.path.dirname(HERE), MOD)]
if TAKE.get('system'): argv += ['--append-system-prompt', TAKE['system']]
if TAKE.get('allow'): argv += ['--allowedTools', *TAKE['allow']]

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
def send(s): os.write(fd, s.encode())
def mark(name):
    marks[name] = round(time.time() - t0, 4)
    print(name, marks[name], flush=True)
strip = lambda b: re.sub(rb'\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07|\s', b'', b)

pump(5)
if b'itrustthisfolder' in strip(screen).lower():
    send('\x1b[B'); pump(0.4); send('\r'); pump(5)

for i, p in enumerate(TAKE['prompts']):
    mark(f'type{i}')
    for ch in p:
        send(ch); pump(0.03)
    pump(0.6)
    mark(f'enter{i}')
    send('\r')
    pump(TAKE.get('wait', 30))
    mark(f'done{i}')
send('\x03'); pump(0.5); send('/exit\r'); pump(2)
try: os.kill(pid, signal.SIGKILL)
except ProcessLookupError: pass

whole = strip(b''.join(base64.b64decode(b) for t, b in events))
# The mod drew, or mods were switched off this launch
if strip(TAKE['expect'].encode()) not in whole:
    print('take rejected: the mod never drew', flush=True); sys.exit(3)
# Nothing on screen that leads back to a person or a home folder
# Words that would identify the person recording: one per line in blocklist.txt, kept out of git
words = [w.strip() for w in open(os.path.join(HERE, 'blocklist.txt')).read().splitlines() if w.strip()] \
    if os.path.exists(os.path.join(HERE, 'blocklist.txt')) else []
leak = re.search('(?i)' + '|'.join([r'/users/\w', r'/home/\w', '@gmail'] + [re.escape(w) for w in words]), whole.decode('utf-8', 'replace'))
if leak:
    print('take rejected: identifying text on screen:', leak.group(0), flush=True); sys.exit(4)
json.dump({'cols': COLS, 'rows': ROWS, 'events': events, 'marks': marks}, open(os.path.join(HERE, MOD, 'rec.json'), 'w'))
print('events', len(events), 'duration', events[-1][0])
