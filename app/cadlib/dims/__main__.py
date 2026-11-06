"""python -m cadlib.dims [key ...]: print the index, or entries."""
import sys

from . import describe, entry, index

if len(sys.argv) > 1:
    for k in sys.argv[1:]:
        e = entry(k)
        print(describe(k))
        if e.get("notes"):
            print("  notes:", e["notes"])
else:
    print("\n".join(index()))
