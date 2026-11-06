#!/usr/bin/env python3
"""Bundle each example's saved shop quotes (a studio's <data>/.sourcing cache) as examples/<slug>/quotes.json, so a
fresh install prices the examples without asking any shop. server/sourcing.js reads it when it has no quote of its
own; a quote whose part set no longer matches the files is ignored there (its key is the STL hashes).
  scripts/import-quotes.py <studio data dir>
"""
import json, os, sys
data = sys.argv[1]
ex_dir = os.path.join(os.path.dirname(__file__), '..', 'examples')
showcase = json.load(open(os.path.join(data, 'showcase.json'))) if os.path.exists(os.path.join(data, 'showcase.json')) else {}
n = 0
for slug in sorted(os.listdir(ex_dir)):
    cands = [os.path.join(data, '.sourcing', 'examples', slug, 'cache.json')]
    if showcase.get(slug, {}).get('project'): cands.append(os.path.join(data, '.sourcing', 'projects', showcase[slug]['project'], 'cache.json'))
    for c in cands:
        try: j = json.load(open(c))
        except Exception: continue
        s = j.get('slant') or {}
        if not s.get('set'): continue  # only real quotes, never a failure
        json.dump({'slant': s}, open(os.path.join(ex_dir, slug, 'quotes.json'), 'w'))
        n += 1; break
print(f'{n} examples have saved quotes')
