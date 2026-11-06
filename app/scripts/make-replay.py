#!/usr/bin/env python3
"""Package a real design run as a replay (web/replay.js plays it back sped up).

  make-replay.py <project dir> <agent transcript .jsonl> <example dir> <rounds, e.g. 1,4,8,10> <cadlib app dir>

Writes <example dir>/replay/: replay.json (the real step labels, the agent's real in-between messages and the real
first sketch, with their real times) and one model per build that changed the design in the chosen rounds, rebuilt
from the design.py the agent had at that moment. The last chosen round ends on the example's own model.
Nothing is invented: every label, message and model comes from the run.
"""
import json, os, re, shutil, subprocess, sys

proj, transcript, example, rounds_arg, appdir = sys.argv[1:6]
ROUNDS = [int(x) for x in rounds_arg.split(',')]
out = os.path.join(example, 'replay')
shutil.rmtree(out, ignore_errors=True); os.makedirs(out)

def label(name, inp):  # server.js stepText()
    base = lambda f: os.path.basename(str(f)) if f else 'file'
    if name == 'Read': return f"Reading {base(inp.get('file_path'))}"
    if name == 'Write': return f"Writing {base(inp.get('file_path'))}"
    if name in ('Edit', 'MultiEdit'): return f"Editing {base(inp.get('file_path'))}"
    if name == 'Glob': return 'Looking through files'
    if name == 'Grep':
        ws = [w for w in dict.fromkeys(re.findall(r'[A-Za-z][A-Za-z0-9_]{2,}', re.sub(r'\\[a-z]', ' ', str(inp.get('pattern', '')))))
              if w not in ('def', 'class', 'import', 'from', 'return', 'self')][:3]
        ws = [w.replace('_', ' ').lower() for w in ws]
        return 'Looking up ' + (' and '.join([', '.join(ws[:-1]), ws[-1]]) if len(ws) > 1 else ws[0]) if ws else 'Looking through files'
    if name == 'TodoWrite': return 'Planning'
    if name == 'Bash':
        c = inp.get('command', '')
        return 'Building model' if 'build.sh' in c else 'Looking at the model from all sides' if 'views.sh' in c else (inp.get('description') or 'Running a command')
    return name

def ts(s):  # ISO -> seconds
    from datetime import datetime
    return datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()

# ---- walk the transcript: rounds = real user turns
rounds, cur = {}, None
for line in open(transcript):
    d = json.loads(line); c = d.get('message', {}).get('content')
    if d.get('type') == 'user' and (isinstance(c, str) or (isinstance(c, list) and any(b.get('type') == 'text' for b in c))):
        cur = {'start': ts(d['timestamp']), 'ev': []}; rounds[len(rounds) + 1] = cur; continue
    if cur is None or d.get('type') != 'assistant' or not isinstance(c, list): continue
    for b in c:
        if b['type'] == 'text' and b['text'].strip(): cur['ev'].append(('text', ts(d['timestamp']), b['text'].strip()))
        elif b['type'] == 'tool_use': cur['ev'].append(('tool', ts(d['timestamp']), b['name'], b['input']))

# ---- replay the design.py edits so every build has the code it really built
def build(code, tag):
    w = os.path.join(out, tag); os.makedirs(w)
    open(os.path.join(w, 'design.py'), 'w').write(code)
    env = dict(os.environ, FORMA_NO_RENDER='1', PYTHONPATH=appdir)
    r = subprocess.run([os.path.join(appdir, '.venv/bin/python'), '-m', 'cadlib.build', '.'], cwd=w, env=env, capture_output=True, text=True)
    if r.returncode: sys.exit(f'build {tag} failed: {r.stderr[-400:]}')
    for f in os.listdir(w):
        if f not in ('manifest.json', 'stl'): p = os.path.join(w, f); shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
    return tag

versions = os.path.join(proj, '.versions')
events, t0 = [], rounds[ROUNDS[0]]['start']
last_built = None
for n in ROUNDS:
    R = rounds[n]
    code = open(os.path.join(versions, str(n), 'before', 'design.py')).read() if n > 1 else ''
    if n != ROUNDS[0]: events.append({'t': R['start'] - t0, 'type': 'round', 'n': n})
    final = n == ROUNDS[-1]
    builds = [i for i, e in enumerate(R['ev']) if e[0] == 'tool' and e[2] == 'Bash' and 'build.sh' in e[3].get('command', '')]
    for i, e in enumerate(R['ev']):
        t = e[1] - t0
        if e[0] == 'text':  # the first paragraph: the headline of what it did or decided (long replies end on questions)
            para = re.split(r'\n\s*\n', e[2].strip())[0].strip()
            if not para.endswith('?'): events.append({'t': t, 'type': 'text', 'text': para})
            continue
        name, inp = e[2], e[3]
        if inp.get('file_path', '').endswith('design.py'):
            if name == 'Write': code = inp['content']
            elif name == 'Edit':
                old, new = inp['old_string'], inp['new_string']
                code = code.replace(old, new) if inp.get('replace_all') else code.replace(old, new, 1)
        events.append({'t': t, 'type': 'step', 'text': label(name, inp)})
        if i in builds and code != last_built:
            last_built = code
            if final and i == builds[-1]: events.append({'t': t, 'type': 'model', 'model': 'final'})
            else: events.append({'t': t, 'type': 'model', 'model': build(code, f'r{n}-{len(events)}')})
    after = open(os.path.join(versions, str(n), 'after', 'design.py')).read()
    if code != after: print(f'warning: round {n}: replayed edits differ from the saved version', file=sys.stderr)
    if final and not any(x.get('model') == 'final' for x in events): events.append({'t': R['ev'][-1][1] - t0, 'type': 'model', 'model': 'final'})

msgs = json.load(open(os.path.join(proj, 'messages.json')))
user = [m for m in msgs if m['role'] == 'user']
end = rounds[max(rounds)]['ev'][-1][1]
sketch = json.load(open(os.path.join(proj, '.sketch.json'))) if os.path.exists(os.path.join(proj, '.sketch.json')) else None
json.dump({'v': 1, 'rounds_total': len(rounds), 'rounds': ROUNDS, 'started': t0, 'ended': end,
           'minutes': round((end - t0) / 60), 'first_prompt': user[0]['text'], 'sketch': sketch, 'events': events},
          open(os.path.join(out, 'replay.json'), 'w'), indent=1)
print(f"{len(events)} events, models: {[e['model'] for e in events if e['type'] == 'model']}, {round((end - t0) / 60)} min real")
