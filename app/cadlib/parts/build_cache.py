"""Prebuild the parts cache:  PYTHONPATH=<app> .venv/bin/python -m cadlib.parts.build_cache [--force] [-j N] [key ...]

Builds every catalog part at its defaults plus the common sizes (catalog.prebuild_list) into cadlib/parts/cache/.
Entries that are already cached (same LIB_VERSION) are skipped unless --force. Run it outside the build sandbox
(the sandbox can read cadlib/ but not write it). Parts missing from the cache are still built lazily on first use.
"""
import multiprocessing as mp
import os
import shutil
import sys
import time


def _one(job):
    key, params, force = job
    from cadlib import parts
    eid = parts.entry_id(key, params)
    d = os.path.join(parts.CACHE, eid)
    if not force and parts._valid(d):
        return eid, 0.0, "cached"
    t = time.time()
    try:
        parts.build_entry(key, params, root=parts.CACHE)
        return eid, time.time() - t, "ok"
    except Exception as e:  # noqa
        return eid, time.time() - t, f"FAILED {type(e).__name__}: {e}"


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    force = "--force" in argv
    jobs = max(1, (os.cpu_count() or 2) - 1)
    if "-j" in argv:
        jobs = int(argv[argv.index("-j") + 1])
    keys = [a for i, a in enumerate(argv) if not a.startswith("-") and (i == 0 or argv[i - 1] != "-j")]
    from cadlib import parts
    todo = []
    for key, p in parts.prebuild_list():
        if keys and key not in keys:
            continue
        k, full = parts.resolve(key, p)
        todo.append((k, full, force))
    seen, uniq = set(), []
    for j in todo:
        eid = parts.entry_id(j[0], j[1])
        if eid not in seen:
            seen.add(eid)
            uniq.append(j)
    os.makedirs(parts.CACHE, exist_ok=True)
    t0 = time.time()
    # spawn, not fork: OCC starts threads, and fork() from a threaded process can deadlock
    with mp.get_context("spawn").Pool(jobs) as pool:
        bad = 0
        for eid, s, status in pool.imap_unordered(_one, uniq):
            if status != "cached":
                print(f"{status:8s} {eid} ({s:.1f}s)", flush=True)
            bad += status.startswith("FAILED")
    # drop entries from older library versions
    for name in os.listdir(parts.CACHE):
        d = os.path.join(parts.CACHE, name)
        stale_tmp = name.startswith(".") and time.time() - os.path.getmtime(d) > 600  # a build in flight is younger
        if os.path.isdir(d) and (stale_tmp or (not name.startswith(".") and not parts._valid(d))):
            shutil.rmtree(d, ignore_errors=True)
    n = len([x for x in os.listdir(parts.CACHE) if not x.startswith(".")])
    print(f"parts cache: {n} entries in {parts.CACHE} ({time.time() - t0:.0f}s, {bad} failed)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
