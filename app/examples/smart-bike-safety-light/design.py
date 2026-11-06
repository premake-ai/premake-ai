import cadquery as cq
from cadlib.dims import dim

from cadlib.parts import info
for k in ["holder_18650", "cell_18650", "esp32_c3_supermini", "xiao_esp32s3", "tact_12x12", "m3x10_bhcs", "m3_insert", "m2x8_shcs", "m2_insert"]:
    try:
        i = info(k)
        print(k, i.get("dims"), i.get("bbox_min"), i.get("bbox_max"), i.get("price_usd", i.get("price")))
    except Exception as e:
        print(k, "ERR", e)

W, D, H = 86, 36, 82        # rear light body
RW, RD, RH = 58, 34, 18     # remote


def parts():
    body = cq.Workplane("XY").box(W, D, H).translate((0, 0, H / 2))
    lens = cq.Workplane("XY").box(W, 3, H).translate((0, -D / 2 - 1.5, H / 2))
    remote = cq.Workplane("XY").box(RW, RD, RH).translate((140, 0, RH / 2))
    return [
        {"name": "Light body", "shape": body, "group": "case"},
        {"name": "Diffuser lens", "shape": lens, "group": "case", "process": "laser",
         "params": {"material": "acrylic", "thickness_mm": 3}},
        {"name": "Remote base", "shape": remote, "group": "case"},
    ]
