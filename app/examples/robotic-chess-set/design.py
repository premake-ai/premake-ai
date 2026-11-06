import cadquery as cq
import inspect
from cadlib.parts import part, info
from cadlib import motion

SQ = 25.0          # square size
H = 45.0           # case half height, board surface at z=H
CW, CD = 260.0, 160.0
S = (0.0, 131.0)   # shoulder axis

def box(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0).translate(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))

def parts():
    for k in ["nema17_34", "gt2_pulley_20t", "sg90", "oled_096", "bearing_608"]:
        i = info(k)
        print(k, i.get("dims"), i.get("bbox_min"), i.get("bbox_max"))
    for n in ["move", "rot", "link"]:
        print(inspect.getsource(getattr(motion, n)))
    return [
        {"name": "Human half", "shape": box(-130, 130, -161, -1, 0, H), "color": "#c9a97a"},
        {"name": "Robot half", "shape": box(-130, 130, 1, 161, 0, H), "color": "#c9a97a"},
        {"name": "Tower", "shape": box(-80, 80, 102, 160, H, 105), "color": "#333333"},
        {"name": "Link 1", "shape": box(0, 130, 114, 148, 114, 119.5).translate((0, 0, 0)), "color": "#444444"},
    ]
