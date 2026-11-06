"""Motion for the viewer's Move button (CONTRACT.md "motion()").

design.py may define an optional `motion()`. build.py calls it after parts(), samples it into motion.json
(per moving part, per frame: position + quaternion relative to the built pose) and lists it in manifest.json.
Pure math here (numpy only), so it runs inside the build sandbox and the warm worker.

motion() returns any of:
  - a function pose(t) -> {key: transform}, t in [0, 1) over one loop
  - a list of declarative tracks
  - a dict {"duration": s (default 6), "frames": n (default 90), "pose": pose, "tracks": [...]}

key: a part's "id" (or "slug"), or its "name" (a name shared by several parts moves all of them).
transform, relative to the built pose (rotation about the pivot first, then the translation):
  {"translate": [x, y, z]}
  {"rotate": [ax, ay, az], "deg": a, "pivot": [x, y, z]}        ("rad" instead of "deg" is fine)
  {"quat": [x, y, z, w], "pivot": [x, y, z]}
  {"matrix": 4x4 or 3x3 nested list}
  keys can be combined in one dict ({"rotate", "deg", "pivot", "translate"}). Helpers below build them:
  move(v), rot(axis, deg, pivot), link(a0, b0, a1, b1), then(first, second).

Declarative track:
  {"part": "Lid" | ["Lid", "Handle"], "type": "rotate" | "slide" | "spin",
   "axis": [x, y, z], "pivot": [x, y, z] (rotate / spin),
   "range": [a, b]  (rotate: degrees, or "unit": "rad"; slide: mm along axis) -> smooth a -> b -> a over the loop,
   "keys": [[t, value], ...]  instead of range: eased between keyframes (t 0..1),
   "turns": 1 (spin: full turns per loop)}
  Several tracks on one part compose with the FIRST listed outermost: list a chain from base to tip and give each
  joint every part it carries (shoulder: arm + forearm + hand; elbow: forearm + hand).
"""
import math

import numpy as np

DEFAULT_DURATION = 6.0
DEFAULT_FRAMES = 90


class MotionError(Exception):
    pass


# ------------------------------------------------------------------ helpers for design.py
def _m4(R=None, t=None):
    m = np.eye(4)
    if R is not None:
        m[:3, :3] = R
    if t is not None:
        m[:3, 3] = t
    return m


def _axis_angle(axis, ang):
    a = np.asarray(axis, float)
    n = np.linalg.norm(a)
    if n < 1e-12:
        raise MotionError("rotation axis is zero")
    x, y, z = a / n
    c, s, C = math.cos(ang), math.sin(ang), 1 - math.cos(ang)
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s],
                     [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
                     [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])


def _about(R, pivot):
    p = np.asarray(pivot if pivot is not None else (0, 0, 0), float)
    return _m4(R, p - R @ p)


def move(v):
    """Translate by v (mm)."""
    return {"matrix": _m4(t=np.asarray(v, float)).tolist()}


def rot(axis, deg, pivot=(0, 0, 0)):
    """Rotate deg degrees about axis through pivot (right-hand rule)."""
    return {"matrix": _about(_axis_angle(axis, math.radians(deg)), pivot).tolist()}


def link(a0, b0, a1, b1):
    """Rigid link (rod, arm, connecting rod): the transform that carries a part built between points a0 -> b0 so it
    runs a1 -> b1 (end a lands exactly on a1; |b1 - a1| should equal |b0 - a0|). Minimal rotation, no roll."""
    a0, b0, a1, b1 = (np.asarray(p, float) for p in (a0, b0, a1, b1))
    u, w = b0 - a0, b1 - a1
    nu, nw = np.linalg.norm(u), np.linalg.norm(w)
    if nu < 1e-9 or nw < 1e-9:
        raise MotionError("link(): the two points of a link coincide")
    u, w = u / nu, w / nw
    c = float(np.clip(u @ w, -1, 1))
    ax = np.cross(u, w)
    if np.linalg.norm(ax) < 1e-9:
        if c > 0:
            R = np.eye(3)
        else:  # 180 degrees: any axis perpendicular to u
            ax = np.cross(u, [1, 0, 0]) if abs(u[0]) < 0.9 else np.cross(u, [0, 1, 0])
            R = _axis_angle(ax, math.pi)
    else:
        R = _axis_angle(ax, math.acos(c))
    return {"matrix": _m4(R, a1 - R @ a0).tolist()}


def then(first, second):
    """Apply `first`, then `second` (both transforms)."""
    return {"matrix": (to_matrix(second) @ to_matrix(first)).tolist()}


def ease(x):
    """Smoothstep 0..1 (zero speed at both ends)."""
    x = min(1.0, max(0.0, float(x)))
    return x * x * (3 - 2 * x)


# ------------------------------------------------------------------ parsing
def to_matrix(tr):
    """A transform dict (or 4x4 / 3x3 array) -> 4x4 numpy matrix."""
    if tr is None:
        return np.eye(4)
    if isinstance(tr, np.ndarray) or isinstance(tr, (list, tuple)):
        m = np.asarray(tr, float)
        if m.shape == (4, 4):
            return m
        if m.shape == (3, 3):
            return _m4(m)
        raise MotionError(f"a matrix transform must be 4x4 or 3x3, got shape {m.shape}")
    if not isinstance(tr, dict):
        raise MotionError(f"a transform must be a dict, got {type(tr).__name__}")
    unknown = set(tr) - {"matrix", "rotate", "axis", "deg", "rad", "angle", "pivot", "quat", "translate"}
    if unknown:
        raise MotionError(f"unknown transform keys {sorted(unknown)} (use translate / rotate+deg+pivot / quat+pivot / matrix)")
    m = np.eye(4)
    if "matrix" in tr:
        m = to_matrix(np.asarray(tr["matrix"], float))
    pivot = tr.get("pivot")
    if "quat" in tr:
        x, y, z, w = (float(v) for v in tr["quat"])
        n = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
        x, y, z, w = x / n, y / n, z / n, w / n
        R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        m = _about(R, pivot) @ m
    axis = tr.get("rotate", tr.get("axis"))
    if axis is not None:
        if "rad" in tr:
            ang = float(tr["rad"])
        else:
            ang = math.radians(float(tr.get("deg", tr.get("angle", 0.0))))
        m = _about(_axis_angle(axis, ang), pivot) @ m
    if "translate" in tr:
        m = _m4(t=np.asarray(tr["translate"], float)) @ m
    return m


def _keyed(keys, t):
    ks = sorted((float(a), float(b)) for a, b in keys)
    if not ks:
        raise MotionError("track 'keys' is empty")
    if t <= ks[0][0]:
        return ks[0][1]
    for (t0, v0), (t1, v1) in zip(ks, ks[1:]):
        if t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0) if t1 > t0 else 1.0)
    return ks[-1][1]


def track_matrix(tr, t):
    typ = tr.get("type", "rotate")
    axis = tr.get("axis")
    if axis is None:
        raise MotionError(f"track for {tr.get('part')!r} needs an 'axis'")
    if typ == "spin":
        val = 2 * math.pi * float(tr.get("turns", 1)) * t
        return _about(_axis_angle(axis, val), tr.get("pivot"))
    if "keys" in tr:
        val = _keyed(tr["keys"], t)
    else:
        rg = tr.get("range")
        if not (isinstance(rg, (list, tuple)) and len(rg) == 2):
            raise MotionError(f"track for {tr.get('part')!r} needs 'range': [a, b] or 'keys'")
        a, b = float(rg[0]), float(rg[1])
        val = a + (b - a) * (1 - math.cos(2 * math.pi * t)) / 2  # a -> b -> a, smooth
    if typ == "rotate":
        ang = val if tr.get("unit") == "rad" else math.radians(val)
        return _about(_axis_angle(axis, ang), tr.get("pivot"))
    if typ in ("slide", "translate", "linear"):
        a = np.asarray(axis, float)
        n = np.linalg.norm(a)
        if n < 1e-12:
            raise MotionError("slide axis is zero")
        return _m4(t=a / n * val)
    raise MotionError(f"track type must be rotate, slide or spin, got {typ!r}")


def _quat(R):
    """Rotation matrix -> unit quaternion [x, y, z, w] (re-orthonormalised first)."""
    U, _, Vt = np.linalg.svd(R)
    R = U @ Vt
    if np.linalg.det(R) < 0:
        raise MotionError("a transform mirrors the part (negative determinant)")
    tr = R[0, 0] + R[1, 1] + R[2, 2]
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        w, x, y, z = 0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        w, x, y, z = (R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        w, x, y, z = (R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        w, x, y, z = (R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s
    q = np.array([x, y, z, w])
    return q / np.linalg.norm(q)


# ------------------------------------------------------------------ sampling (called by build.py)
def resolver(rows):
    """key -> list of row indices. A key matches a part's id/slug first, else every part with that name."""
    by_slug, by_name = {}, {}
    for i, r in enumerate(rows):
        by_slug[r["slug"]] = [i]
        for n in {r["name"], r.get("raw_name") or r["name"]}:
            by_name.setdefault(n, []).append(i)

    def find(key):
        k = str(key)
        if k in by_slug:
            return by_slug[k]
        if k in by_name:
            return by_name[k]
        s = "".join(c if c.isalnum() else "-" for c in k.lower()).strip("-")
        while "--" in s:
            s = s.replace("--", "-")
        return by_slug.get(s, [])
    return find


def sample(spec, rows):
    """Sample a motion() result for the manifest rows. Returns (motion.json dict or None, [warnings])."""
    warns = []
    pose_fn, tracks, duration, frames = None, [], DEFAULT_DURATION, DEFAULT_FRAMES
    if callable(spec):
        pose_fn = spec
    elif isinstance(spec, (list, tuple)):
        tracks = list(spec)
    elif isinstance(spec, dict):
        pose_fn = spec.get("pose")
        tracks = list(spec.get("tracks") or [])
        if "part" in spec and not tracks and pose_fn is None:  # a single track
            tracks = [spec]
        try:
            duration = float(spec.get("duration", DEFAULT_DURATION))
            frames = int(spec.get("frames", DEFAULT_FRAMES))
        except (TypeError, ValueError):
            raise MotionError("motion 'duration' and 'frames' must be numbers")
        if pose_fn is not None and not callable(pose_fn):
            raise MotionError("motion 'pose' must be a function pose(t) -> {part: transform}")
    elif spec is None:
        return None, warns
    else:
        raise MotionError("motion() must return a function, a list of tracks or a dict")
    duration = min(30.0, max(1.0, duration))
    frames = min(240, max(12, frames))
    find = resolver(rows)

    track_rows = []
    for tr in tracks:
        if not isinstance(tr, dict):
            raise MotionError("each motion track must be a dict")
        names = tr.get("part")
        names = names if isinstance(names, (list, tuple)) else [names]
        idx = []
        for n in names:
            hit = find(n)
            if not hit:
                warns.append(f"motion track: no part named {n!r}")
            idx += hit
        track_rows.append((tr, idx))

    n = len(rows)
    mats = np.tile(np.eye(4), (frames, n, 1, 1))
    unknown = set()
    for f in range(frames):
        t = f / frames
        for tr, idx in track_rows:
            M = track_matrix(tr, t)
            for i in idx:
                mats[f, i] = mats[f, i] @ M  # first listed track is outermost
        if pose_fn is not None:
            res = pose_fn(t)
            if res is None:
                continue
            if not isinstance(res, dict):
                raise MotionError(f"pose(t) must return a dict {{part: transform}}, got {type(res).__name__}")
            for key, tr in res.items():
                idx = find(key)
                if not idx:
                    unknown.add(str(key))
                    continue
                M = to_matrix(tr)
                for i in idx:
                    mats[f, i] = M @ mats[f, i]
    for k in sorted(unknown):
        warns.append(f"motion pose: no part named {k!r} (use a part's \"id\" or its exact \"name\")")

    out = {}
    for i, r in enumerate(rows):
        series = mats[:, i]
        if np.allclose(series, np.eye(4), atol=1e-6):
            continue
        pos, quat, prev = [], [], None
        for M in series:
            q = _quat(M[:3, :3])
            if prev is not None and q @ prev < 0:
                q = -q  # keep neighbouring frames on the same hemisphere so the viewer interpolates the short way
            prev = q
            pos.append([round(float(v), 3) for v in M[:3, 3]])
            quat.append([round(float(v), 5) for v in q])
        out[f"stl/{r['slug']}.stl"] = {"name": r["name"], "pos": pos, "quat": quat}
    if not out:
        warns.append("motion() moved no parts")
        return None, warns
    return {"version": 1, "duration": round(duration, 3), "frames": frames, "loop": True, "parts": out}, warns
