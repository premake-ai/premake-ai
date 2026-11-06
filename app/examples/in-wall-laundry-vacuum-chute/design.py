import cadquery as cq

SCENE = "floor"

PIPE_OD = 159.4      # 6" SDR35 PVC
W = 390              # catch chamber outer (350 mm bars + 2 x 20)
H = 600
WALL_Y = W / 2       # wall behind the chamber
PORT_Z = 1000        # inlet height on the wall
PORT_XS = [-650, -1050]


def box(x, y, z, cx=0, cy=0, z0=0):
    return cq.Workplane("XY").box(x, y, z, centered=(True, True, False)).translate((cx, cy, z0))


def cyl(d, h, at, axis="z"):
    wp = {"z": "XY", "y": "XZ", "x": "YZ"}[axis]
    return cq.Workplane(wp).circle(d / 2).extrude(h).translate(at)


def parts():
    out = []
    out.append({"name": "Catch chamber", "shape": box(W, W, H), "group": "case", "color": "#c9a979"})
    out.append({"name": "Blower (dust collector)", "shape": box(380, 480, 800, cx=520), "group": "component", "color": "#2f6fb0"})
    out.append({"name": "Riser pipe", "shape": cyl(PIPE_OD, 900, (0, 0, H)), "group": "component", "color": "#f2f2f2"})
    for i, x in enumerate(PORT_XS):
        out.append({"name": f"Inlet port {i+1}", "shape": box(220, 40, 240, cx=x, cy=WALL_Y - 20, z0=PORT_Z - 120), "group": "case"})
    return out
