# Recording times at which each text first reaches the screen: python3 when.py <mod> text...
import json, base64, re, sys
rec = json.load(open(f'{sys.argv[1]}/rec.json'))
strip = lambda b: re.sub(rb'\x1b\[[0-9;?<>=]*[a-zA-Z]|\x1b\][^\x07]*\x07|\s', b'', b)
seen = b''
todo = {strip(t.encode()): t for t in sys.argv[2:]}
for t, b in rec['events']:
    seen += strip(base64.b64decode(b))
    for k in list(todo):
        if k in seen: print(f'{t:8.2f}  {todo.pop(k)}')
for k in todo.values(): print('   never ', k)
