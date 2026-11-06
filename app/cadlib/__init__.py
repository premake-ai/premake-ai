"""Shared CAD build library for the vibe-manufacturing app.

Usage:  PYTHONPATH=<app dir> <venv python> -m cadlib.build <design_dir> [--no-thumb]
"""

# quietcrash: OpenCascade can segfault on a bad fillet (live previews run half-written design.py, so this happens).
# A crash used to raise macOS's "Python quit unexpectedly" window every time; instead exit at once with code 139
# (128 + SIGSEGV), which the server already reports as a failed build/preview. C-level handler: Python's own signal
# handlers can't run after a segfault.
def _quiet_crashes():
    import ctypes, signal, sys
    if sys.platform != 'darwin':
        return
    try:
        libc = ctypes.CDLL(None)
        exit_fn = ctypes.cast(libc._exit, ctypes.c_void_p).value
        libc.signal.restype = ctypes.c_void_p
        libc.signal.argtypes = [ctypes.c_int, ctypes.c_void_p]
        for sig in (signal.SIGSEGV, signal.SIGBUS, signal.SIGABRT):
            libc.signal(int(sig), exit_fn)  # _exit(signum): no crash report, no window
    except Exception:
        pass
_quiet_crashes()
