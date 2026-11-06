"""Security C2/B3: manifest.json is written by the design agent, so its "file" fields are untrusted.
inside(design_dir, rel) returns the real path of a regular, non-symlink file under design_dir, or None for anything
absolute, with "..", outside the project, a symlink or missing."""
import os


def inside(design_dir, rel):
    if not isinstance(rel, str) or not rel or "\0" in rel or os.path.isabs(rel) or ".." in rel.replace("\\", "/").split("/"):
        return None
    root = os.path.realpath(design_dir)
    p = os.path.join(root, rel)
    try:
        if os.path.islink(p) or not os.path.isfile(p):
            return None
    except OSError:
        return None
    real = os.path.realpath(p)
    return real if real.startswith(root + os.sep) else None
