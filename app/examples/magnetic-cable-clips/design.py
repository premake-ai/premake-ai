"""Magnetic cable clips: a slim desk rail with five magnet seats and five snap-in cable clips.

Each clip carries a 10 x 3 mm magnet in its base, so it parks on the rail, a steel desk leg or a
monitor stand and lifts off with the cable when you need it. The cable channel is a flexure:
the 2-3 mm entry slot springs open and the cable clicks in. Channel sizes are parameters.

Z up, mm, front faces -Y. Everything prints flat side down, no supports.
"""
import cadquery as cq

P = {
    "channels": [3.6, 4.4, 5.2, 6.0, 7.2],   # cable channel diameters (mm), one clip each
    "pitch": 25.0,        # clip spacing on the rail
    "clip_d": 21.0,       # clip footprint
    "clip_h": 15.0,
    "rail_w": 20.0, "rail_t": 6.0,
    "mag_d": 10.2, "mag_t": 3.1,   # 10 x 3 mm N52 disc, press fit
}
COLORS = ["#ff8a5b", "#ffd166", "#06d6a0", "#118ab2", "#ef476f"]


def rail():
    n = len(P["channels"])
    L = (n - 1) * P["pitch"] + P["clip_d"] + 8
    w, t = P["rail_w"], P["rail_t"]
    r = cq.Workplane("XY").slot2D(L, w, 0).extrude(t)
    try:
        r = r.faces(">Z").edges().fillet(2.0)
    except Exception:
        pass
    for i in range(n):
        x = (i - (n - 1) / 2) * P["pitch"]
        # shallow locating seat + flush magnet pocket
        r = r.cut(cq.Workplane("XY").center(x, 0).circle(P["clip_d"] / 2 + 0.4).extrude(1.0).translate((0, 0, t - 1.0)))
        r = r.cut(cq.Workplane("XY").center(x, 0).circle(P["mag_d"] / 2).extrude(P["mag_t"]).translate((0, 0, t - 1.0 - P["mag_t"])))
    # recess for a 3M VHB strip underneath
    r = r.cut(cq.Workplane("XY").rect(L - 24, w - 6).extrude(0.6))
    return r


def clip(ch_d, x, z0):
    d, h = P["clip_d"], P["clip_h"]
    body = cq.Workplane("XY").circle(d / 2).extrude(h)
    try:
        body = body.faces(">Z").edges().fillet(5.0)
    except Exception:
        pass
    try:
        body = body.faces("<Z").edges().chamfer(0.6)
    except Exception:
        pass
    cz = h - ch_d / 2 - 2.6
    slot_w = max(2.0, ch_d * 0.62)
    chan = cq.Workplane("XZ").center(0, cz).circle(ch_d / 2 + 0.15).extrude(d / 2 + 1, both=True)
    slot = cq.Workplane("XY").rect(slot_w, d + 2).extrude(h).translate((0, 0, cz))
    # flared lead-in so the cable finds the slot
    flare = (cq.Workplane("XZ").moveTo(-slot_w / 2, h - 3.2).lineTo(-slot_w / 2 - 3.5, h + 0.5)
             .lineTo(slot_w / 2 + 3.5, h + 0.5).lineTo(slot_w / 2, h - 3.2).close().extrude(d / 2 + 1, both=True))
    body = body.cut(chan).cut(slot).cut(flare)
    body = body.cut(cq.Workplane("XY").circle(P["mag_d"] / 2).extrude(P["mag_t"]))
    return body.translate((x, 0, z0))


def cables():
    n = len(P["channels"])
    out = None
    for i, ch in enumerate(P["channels"]):
        x = (i - (n - 1) / 2) * P["pitch"]
        cz = P["rail_t"] - 1.0 + P["clip_h"] - ch / 2 - 2.6
        c = cq.Workplane("XZ").center(x, cz).circle(ch / 2 - 0.2).extrude(45, both=True)
        out = c if out is None else out.union(c)
    return out


def magnets():
    n = len(P["channels"])
    out = None
    for i in range(n):
        x = (i - (n - 1) / 2) * P["pitch"]
        m = cq.Workplane("XY").center(x, 0).circle(5).extrude(6).translate((0, 0, P["rail_t"] - 1.0 - 3.0))
        out = m if out is None else out.union(m)
    return out


def parts():
    n = len(P["channels"])
    out = [{"name": "Desk rail", "shape": rail(), "group": "case", "color": "#3a3f47", "explode": [0, 0, -1]}]
    for i, ch in enumerate(P["channels"]):
        x = (i - (n - 1) / 2) * P["pitch"]
        out.append({"name": f"Clip {ch:.1f} mm", "shape": clip(ch, x, P["rail_t"] - 1.0), "group": "case",
                    "color": COLORS[i % len(COLORS)], "explode": [0, 0, 1]})
    out.append({"name": "10 x 3 mm magnets (x10)", "shape": magnets(), "group": "component", "color": "#9aa0a6",
                "explode": [0, 0, 0]})
    out.append({"name": "Cables (not included)", "shape": cables(), "group": "component", "color": "#f2f2f2",
                "explode": [0, -1, 0]})
    return out
