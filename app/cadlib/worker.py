"""Warm build worker:  python -m cadlib.worker <design_dir>

Started by the server (server/server.js warmWorker) inside the SAME Seatbelt sandbox and empty environment as
./build.sh, scoped to one project dir. It imports cadquery + cadlib once (~2.5 s), then waits for build requests,
so a build costs only design.py itself.

Protocol (all files in <design_dir>/.build/, written by ./build.sh):
  req.<n>    build.sh asks for a build          -> the worker renames it to ack.<n> (the "I've got it" signal)
  out.<n>    the build's stdout + stderr (same text as a cold build prints)
  done.<n>   the exit code, written last (atomic rename)
Each build runs in a forked child, so design.py gets a fresh interpreter state and can't break the worker.
build.sh falls back to a normal cold build when no worker answers within ~1.5 s.

The worker exits after FORMA_WORKER_IDLE seconds without a request (default 600), when the server that started it
goes away, or when another worker already holds the lock for this dir.
"""
import fcntl
import os
import sys
import time

POLL_S = 0.03
BUILD_TIMEOUT_S = 300  # build.sh gives up after 600 s; a stuck build is killed well before that


def main():
    if len(sys.argv) != 2:
        print("usage: python -m cadlib.worker <design_dir>", file=sys.stderr)
        return 2
    design_dir = os.path.abspath(sys.argv[1])
    wdir = os.path.join(design_dir, ".build")
    os.makedirs(wdir, exist_ok=True)
    lock = open(os.path.join(wdir, "worker.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0  # another worker serves this dir
    idle = float(os.environ.get("FORMA_WORKER_IDLE") or 600)
    parent = os.getppid()

    t0 = time.time()
    import cadquery as cq  # noqa: F401  the slow part, done once
    import trimesh  # noqa: F401
    from cadlib import build, fab, meshcheck  # noqa: F401
    import scipy.ndimage  # noqa: F401  build.fit_checks' overlap depth
    # No warm-up geometry here: OCC's mesher starts a thread pool, and fork() from a multi-threaded process deadlocks.
    # The parent must stay single-threaded; every build runs in a forked child.

    pidf = os.path.join(wdir, "worker.pid")
    with open(pidf + ".tmp", "w") as f:
        f.write(str(os.getpid()))
    os.replace(pidf + ".tmp", pidf)
    sys.stderr.write(f"worker ready in {time.time() - t0:.1f}s\n")
    sys.stderr.flush()

    last = time.time()
    try:
        while True:
            if os.getppid() != parent or not os.path.isdir(design_dir):
                break  # the server went away (or the project was deleted)
            reqs = sorted(n for n in os.listdir(wdir) if n.startswith("req.") and len(n) < 80 and "/" not in n)
            if not reqs:
                if time.time() - last > idle:
                    break
                time.sleep(POLL_S)
                continue
            for name in reqs:
                tag = name[4:]
                try:
                    os.rename(os.path.join(wdir, name), os.path.join(wdir, "ack." + tag))
                except OSError:
                    continue  # build.sh gave up on it
                code = run_one(design_dir, wdir, tag)
                done = os.path.join(wdir, "done." + tag)
                with open(done + ".tmp", "w") as f:
                    f.write(str(code))
                os.replace(done + ".tmp", done)
            last = time.time()
    finally:
        try:
            if open(pidf).read().strip() == str(os.getpid()):
                os.remove(pidf)
        except OSError:
            pass
    return 0


def run_one(design_dir, wdir, tag):
    out = os.path.join(wdir, "out." + tag)
    pid = os.fork()
    if pid == 0:  # child: one build, then exit without running the parent's cleanup
        code = 1
        try:
            fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
            os.dup2(fd, 1)
            os.dup2(fd, 2)
            os.close(fd)
            sys.stdout = os.fdopen(1, "w", buffering=1)
            sys.stderr = os.fdopen(2, "w", buffering=1)
            os.chdir(design_dir)
            from cadlib import build
            print("(warm build worker)")
            code = build.main([design_dir])
        except BaseException as e:  # noqa
            try:
                print(f"BUILD FAILED: worker error {type(e).__name__}: {e}", file=sys.stderr)
            except Exception:
                pass
        finally:
            try:
                sys.stdout.flush()
                sys.stderr.flush()
            except Exception:
                pass
            os._exit(int(code) if isinstance(code, int) else 1)
    # wait, but never forever: a hung design.py (or the server going away) kills the child
    deadline = time.time() + BUILD_TIMEOUT_S
    parent = os.getppid()
    while True:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            break
        if time.time() > deadline or os.getppid() != parent:
            try:
                os.kill(pid, 9)
            except OSError:
                pass
            _, status = os.waitpid(pid, 0)
            break
        time.sleep(0.02)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    try:
        with open(out, "a") as f:
            f.write(f"\nBUILD FAILED: the build process was killed (signal {os.WTERMSIG(status) if os.WIFSIGNALED(status) else '?'})\n")
    except OSError:
        pass
    return 1


if __name__ == "__main__":
    sys.exit(main())
