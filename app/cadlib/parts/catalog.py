"""The parts catalog: key -> builder, default params, display name, typical price, search term, origin convention.

Prices are typical single-unit street prices (USD, 2026) for the cheapest reliable listing; search terms go into an
Amazon search URL (never a made-up product link).
"""
import re
from urllib.parse import quote_plus


SCREW_SIZES = (2, 2.5, 3, 4, 5, 6)
SCREW_USD = {2: 0.07, 2.5: 0.08, 3: 0.09, 4: 0.12, 5: 0.16, 6: 0.22}
SELFTAP_SIZES = (2, 2.5, 3, 3.5, 4)
# Pilot hole (mm) printed for a self-tapping screw in PLA / PETG / ASA (vertical holes print ~0.2 mm small, already allowed for).
PILOT = {2: 1.6, 2.5: 2.0, 3: 2.5, 3.5: 2.9, 4: 3.3}


def _d(v):
    v = float(v)
    return int(v) if v == int(v) else v


def _mm(v):
    v = float(v)
    return f"{int(v)}" if v == int(v) else f"{v:g}"


def _screw_price(p):
    return round(SCREW_USD.get(_d(p["d"]), 0.15) * (1 + float(p["length"]) / 100.0), 3)


def _builder(name):
    def call(**kw):
        from . import models
        return getattr(models, name)(**kw)
    return call


BOARD = "PCB centred on the origin, bottom on z=0, long side along X, USB at -X"
FAST = "axis Z, bottom on z=0"

# key: spec. name/price/search may be callables of the resolved params.
CATALOG = {
    # ---- microcontrollers
    "esp32_devkitc": dict(build=_builder("esp32_devkitc"), defaults={"variant": "v4"}, choices={"variant": ("v4", "v1")},
                          name=lambda p: "ESP32 DevKitC (WROOM-32, 38 pin)" if p["variant"] == "v4" else "ESP32 DevKit V1 (30 pin)",
                          price=lambda p: 7.5 if p["variant"] == "v4" else 6.0, mass=10,
                          search=lambda p: "ESP32 DevKitC WROOM-32 38 pin" if p["variant"] == "v4" else "ESP32 DevKit V1 30 pin",
                          port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 54.4 x 27.9 (v1: 51.5 x 28.3), headers 25.4 apart, pins 8.5 below"),
    "esp32_s3_devkitc": dict(build=_builder("esp32_s3_devkitc"), name="ESP32-S3-DevKitC-1", price=14.0, mass=12,
                             search="ESP32-S3-DevKitC-1 N16R8", port=dict(type="usb-c", dir=(-1, 0, 0), near=(0, -5.6, 0)), origin=BOARD + "; 62.7 x 25.5, headers 22.86 apart"),
    "esp32_c3_supermini": dict(build=_builder("esp32_c3_supermini"), defaults={"headers": False}, name="ESP32-C3 SuperMini",
                               price=4.0, mass=2, search="ESP32-C3 SuperMini", port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 22.5 x 18 x 1"),
    "xiao_esp32s3": dict(build=_builder("xiao_esp32s3"), name="Seeed XIAO ESP32S3", price=8.0, mass=3,
                         search="Seeed XIAO ESP32S3", port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 21 x 17.8"),
    "arduino_nano": dict(build=_builder("arduino_nano"), defaults={"headers": True}, name="Arduino Nano (compatible)",
                         price=6.0, mass=7, search="Arduino Nano V3 ATmega328P", port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 43.2 x 18.0, rows 15.24 apart"),
    "rpi_pico": dict(build=_builder("rpi_pico"), defaults={"headers": True}, name="Raspberry Pi Pico", price=4.0, mass=3,
                     search="Raspberry Pi Pico", port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 51 x 21, 4 x 2.1 holes 47 x 11.4"),
    # ---- motion
    "nema17": dict(build=_builder("nema17"), defaults={"length": 48}, choices={"length": (34, 40, 48, 60)},
                   name=lambda p: f"NEMA17 stepper motor {_mm(p['length'])} mm",
                   price=lambda p: {34: 9.0, 40: 11.0, 48: 13.0, 60: 16.0}[int(p["length"])],
                   mass=lambda p: {34: 230, 40: 280, 48: 360, 60: 480}[int(p["length"])],
                   search=lambda p: f"NEMA17 stepper motor {_mm(p['length'])}mm",
                   origin="mounting face on z=0, body below, shaft up +Z; 42.3 square, 4 x M3 on 31 mm, 22 mm boss"),
    "tmc2209": dict(build=_builder("stepstick"), defaults={"driver": "tmc2209"}, fixed=True, name="TMC2209 stepper driver",
                    price=5.0, mass=4, search="TMC2209 stepstick", origin=BOARD + "; 20.3 x 15.2, pins down 12.7 apart"),
    "a4988": dict(build=_builder("stepstick"), defaults={"driver": "a4988"}, fixed=True, name="A4988 stepper driver",
                  price=1.8, mass=3, search="A4988 stepper driver", origin=BOARD + "; 20.3 x 15.2"),
    "sg90": dict(build=_builder("sg90"), name="SG90 micro servo", price=2.5, mass=9, search="SG90 micro servo",
                 origin="body 22.8 x 12.2 centred, bottom on z=0, tabs at z 15.9 (holes 27.8 apart), output shaft +Z at x=+5.5"),
    "gt2_pulley_20t": dict(build=_builder("gt2_pulley"), name="GT2 pulley 20T 5 mm bore", price=1.5, search="GT2 20T pulley 5mm bore",
                           origin=FAST + ", hub end down, 16 mm tall"),
    # ---- bearings
    **{f"bearing_{k}": dict(build=_builder("bearing"), defaults={"od": od, "idia": i, "w": w, "seal": "zz"}, locked=("od", "idia", "w"),
                            choices={"seal": ("zz", "2rs")},
                            name=(lambda k: lambda p: f"{k}{'ZZ' if p['seal'] == 'zz' else '-2RS'} bearing")(k),
                            price=pr, search=f"{k}ZZ bearing", origin=f"{FAST}; {od:g} OD x {i:g} ID x {w:g}")
       for k, od, i, w, pr in (("608", 22, 8, 7, 0.6), ("625", 16, 5, 5, 0.8), ("623", 10, 3, 4, 0.7), ("688", 16, 8, 5, 0.9))},
    # ---- fasteners
    "shcs": dict(build=_builder("screw"), defaults={"d": 3, "length": 10, "material": "black", "head": "socket"}, locked=("head",),
                 choices={"d": SCREW_SIZES, "material": ("black", "stainless", "zinc")},
                 name=lambda p: f"M{_mm(p['d'])}×{_mm(p['length'])} socket head screw", price=_screw_price,
                 search=lambda p: f"M{_mm(p['d'])}x{_mm(p['length'])} socket head cap screw", origin="underside of the head on z=0, head up, shank down"),
    "bhcs": dict(build=_builder("screw"), defaults={"d": 3, "length": 10, "material": "black", "head": "button"}, locked=("head",),
                 choices={"d": SCREW_SIZES, "material": ("black", "stainless", "zinc")},
                 name=lambda p: f"M{_mm(p['d'])}×{_mm(p['length'])} button head screw", price=_screw_price,
                 search=lambda p: f"M{_mm(p['d'])}x{_mm(p['length'])} button head screw", origin="underside of the head on z=0, head up"),
    "csk": dict(build=_builder("screw"), defaults={"d": 3, "length": 10, "material": "black", "head": "countersunk"}, locked=("head",),
                choices={"d": SCREW_SIZES, "material": ("black", "stainless", "zinc")},
                name=lambda p: f"M{_mm(p['d'])}×{_mm(p['length'])} countersunk screw", price=_screw_price,
                search=lambda p: f"M{_mm(p['d'])}x{_mm(p['length'])} countersunk screw", origin="head top flush at z=0, cone and shank below"),
    # self-tapping (thread-forming) screw straight into a printed pilot hole: the default fastener for plastic parts
    "selftap": dict(build=_builder("screw"), defaults={"d": 3, "length": 10, "material": "zinc", "head": "pan"}, locked=("head",),
                    choices={"d": SELFTAP_SIZES, "material": ("black", "stainless", "zinc")},
                    name=lambda p: f"M{_mm(p['d'])}×{_mm(p['length'])} self-tapping screw for plastic",
                    price=lambda p: round(SCREW_USD.get(_d(p["d"]), 0.1) * 0.6 * (1 + float(p["length"]) / 100.0), 3),
                    search=lambda p: f"M{_mm(p['d'])} x {_mm(p['length'])}mm pan head self tapping screws for plastic",
                    origin="underside of the head on z=0, head up, pointed shank down. Printed pilot hole: "
                           + ", ".join(f"M{_mm(k)} {v:g}" for k, v in PILOT.items()) + " mm; boss OD >= 2.5 x d"),
    "nut": dict(build=_builder("nut"), defaults={"d": 3, "kind": "hex", "material": "zinc"}, choices={"d": SCREW_SIZES, "kind": ("hex", "nylock")},
                name=lambda p: f"M{_mm(p['d'])} {'nylock' if p['kind'] == 'nylock' else 'hex'} nut",
                price=lambda p: round(0.03 + 0.01 * float(p["d"]) + (0.03 if p["kind"] == "nylock" else 0), 3),
                search=lambda p: f"M{_mm(p['d'])} {'nylon lock' if p['kind'] == 'nylock' else 'hex'} nut", origin=FAST),
    "washer": dict(build=_builder("washer"), defaults={"d": 3, "material": "zinc"}, choices={"d": SCREW_SIZES},
                   name=lambda p: f"M{_mm(p['d'])} washer", price=lambda p: round(0.015 + 0.005 * float(p["d"]), 3),
                   search=lambda p: f"M{_mm(p['d'])} flat washer", origin=FAST),
    "insert": dict(build=_builder("insert"), defaults={"d": 3}, choices={"d": SCREW_SIZES},
                   name=lambda p: f"M{_mm(p['d'])} heat-set insert", price=lambda p: round(0.06 + 0.02 * float(p["d"]), 3),
                   search=lambda p: f"M{_mm(p['d'])} heat set insert brass",
                   origin=FAST + "; top flush with the plastic. Hole dia: M2 3.2, M2.5 3.6, M3 4.0, M4 5.6, M5 6.4"),
    "standoff": dict(build=_builder("standoff"), defaults={"d": 3, "length": 10, "kind": "ff"}, choices={"d": (2, 2.5, 3, 4), "kind": ("ff", "mf")},
                     name=lambda p: f"M{_mm(p['d'])}×{_mm(p['length'])} brass standoff",
                     price=lambda p: round(0.12 + 0.006 * float(p["length"]), 3),
                     search=lambda p: f"M{_mm(p['d'])} brass standoff {_mm(p['length'])}mm", origin=FAST + "; mf: 6 mm stud below z=0"),
    # ---- power
    "lm2596": dict(build=_builder("lm2596"), name="LM2596 buck converter", price=2.0, mass=12, search="LM2596 buck converter module",
                   origin=BOARD + "; 43 x 21, 2 x 3 mm holes at (-15,-7.5) (15,7.5)"),
    "mp1584": dict(build=_builder("mp1584"), name="MP1584 mini buck converter", price=1.2, mass=2, search="MP1584EN buck module",
                   origin=BOARD + "; 22 x 17"),
    "cell_18650": dict(build=_builder("cell_18650"), name="18650 Li-ion cell", price=5.0, mass=46, search="18650 battery protected 3000mAh",
                       origin="lying along X, centred, bottom on z=0, + end at +X; 18.4 dia x 65"),
    "holder_18650": dict(build=_builder("holder_18650"), name="18650 holder, 1 cell", price=1.0, mass=8, search="18650 battery holder 1 slot",
                         origin="77 x 21 x 15 centred, bottom on z=0; a cell_18650 at the same `at` with z+1.2 sits in it"),
    "dc_jack_panel": dict(build=_builder("dc_jack_panel"), name="DC barrel jack, panel mount 5.5×2.1", price=0.8, mass=6,
                          search="DC-022 panel mount barrel jack 5.5x2.1", port=dict(type="dc-barrel", dir=(0, 0, 1)), origin="panel outer face on z=0, plug enters from +Z, 11 mm hole, body below"),
    "dc_jack_pcb": dict(build=_builder("dc_jack_pcb"), name="DC barrel jack, PCB 5.5×2.1", price=0.4, mass=2,
                        search="DC-005 barrel jack PCB", port=dict(type="dc-barrel", dir=(-1, 0, 0)), origin="14 x 9 x 11 centred, bottom on z=0, opening faces -X"),
    "usbc_breakout": dict(build=_builder("usbc_breakout"), name="USB-C power breakout", price=0.9, mass=2,
                          search="USB-C female breakout board", port=dict(type="usb-c", dir=(-1, 0, 0)), origin=BOARD + "; 14 x 12, socket opening at -X"),
    # ---- IO
    "tact_6x6": dict(build=_builder("tact"), defaults={"size": 6, "height": 5.0}, locked=("size",), name="6×6 mm tactile button",
                     price=0.08, search="6x6mm tactile push button", origin=FAST + ", plunger up, legs below"),
    "tact_12x12": dict(build=_builder("tact"), defaults={"size": 12, "height": 7.3}, locked=("size",), name="12×12 mm tactile button",
                       price=0.2, search="12x12mm tactile push button", origin=FAST + ", plunger up"),
    "oled_096": dict(build=_builder("oled_096"), name='0.96" OLED display (SSD1306)', price=3.5, mass=4,
                     search="0.96 inch OLED SSD1306 I2C", origin=BOARD + "; 27.3 x 27.8, screen up, 4 x M2 holes 23.3 x 23.8"),
    "relay_5v": dict(build=_builder("relay_module"), name="5V relay module, 1 channel", price=2.5, mass=16,
                     search="5V relay module 1 channel", origin=BOARD + "; 50 x 26, 4 x M3 holes 44 x 20"),
    "fan_30": dict(build=_builder("fan"), defaults={"size": 30, "thick": 10}, locked=("size",), name="5V fan 30×30×10",
                   price=3.0, mass=8, search="5V fan 30x30x10mm", origin=FAST + ", airflow +Z, M3 holes 24 mm apart"),
    "fan_40": dict(build=_builder("fan"), defaults={"size": 40, "thick": 10}, locked=("size",), name="5V fan 40×40×10",
                   price=3.0, mass=14, search="5V fan 40x40x10mm", origin=FAST + ", airflow +Z, M3 holes 32 mm apart"),
    "ws2812_strip": dict(build=_builder("ws2812_strip"), defaults={"length": 100, "per_m": 60}, choices={"per_m": (30, 60, 144)},
                         name=lambda p: f"WS2812B LED strip, {max(1, int(float(p['length']) * float(p['per_m']) / 1000 + 1e-6))} LEDs",
                         price=lambda p: round(max(1, int(float(p["length"]) * float(p["per_m"]) / 1000 + 1e-6)) * 10.0 / float(p["per_m"]), 2),
                         search=lambda p: f"WS2812B {int(p['per_m'])} LED/m 5V", origin="tape along +X from x=0, 10 mm wide, bottom on z=0"),
    "led_5mm": dict(build=_builder("led_5mm"), defaults={"color": "red"}, name=lambda p: f"5 mm LED ({p['color']})", price=0.05,
                    search="5mm LED assortment", origin=FAST + ", legs below; 5 mm hole"),
    # ---- structure (extrusion is priced by the shop, not bought)
    **{f"extrusion_{pf}": dict(build=_builder("extrusion"), defaults={"length": 200, "profile": pf}, locked=("profile",),
                               process="extrusion", name=(lambda pf: lambda p: f"{pf} extrusion {_mm(p['length'])} mm")(pf),
                               price=None, search=f"{pf} aluminum extrusion",
                               origin="along +X from x=0, cross-section centred on the X axis")
       for pf in ("2020", "2040", "3030")},
    "bracket_2020": dict(build=_builder("corner_bracket_2020"), name="2020 corner bracket", price=0.6, mass=10,
                         search="2020 corner bracket", origin="inside corner on the origin, legs along +X (below z=0) and +Z (behind x=0)"),
}

# shorthand keys -> (key, params)
ALIASES = {
    "esp32_devkit_v1": ("esp32_devkitc", {"variant": "v1"}), "esp32_wroom": ("esp32_devkitc", {}),
    "esp32_c3_mini": ("esp32_c3_supermini", {}), "pico": ("rpi_pico", {}), "nano": ("arduino_nano", {}),
    "relay_module": ("relay_5v", {}), "oled": ("oled_096", {}), "18650": ("cell_18650", {}),
    **{f"nema17_{n}": ("nema17", {"length": n}) for n in (34, 40, 48, 60)},
    **{f"bearing_{k}_2rs": (f"bearing_{k}", {"seal": "2rs"}) for k in ("608", "625", "623", "688")},
    **{f"tact_{s}": (f"tact_{s}x{s}", {}) for s in (6, 12)},
}
for _d_ in SCREW_SIZES:
    _n = _mm(_d_).replace(".", "")
    ALIASES[f"m{_n}_shcs"] = ("shcs", {"d": _d_})
    ALIASES[f"m{_n}_bhcs"] = ("bhcs", {"d": _d_})
    ALIASES[f"m{_n}_csk"] = ("csk", {"d": _d_})
    ALIASES[f"m{_n}_nut"] = ("nut", {"d": _d_})
    ALIASES[f"m{_n}_nylock"] = ("nut", {"d": _d_, "kind": "nylock"})
    ALIASES[f"m{_n}_washer"] = ("washer", {"d": _d_})
    ALIASES[f"m{_n}_insert"] = ("insert", {"d": _d_})
    if _d_ in SELFTAP_SIZES:
        ALIASES[f"m{_n}_selftap"] = ("selftap", {"d": _d_})
    if _d_ in (2, 2.5, 3, 4):
        ALIASES[f"m{_n}_standoff"] = ("standoff", {"d": _d_})

ALIASES["m35_selftap"] = ("selftap", {"d": 3.5})
SCREW_RE = re.compile(r"^m(2|25|2\.5|3|35|3\.5|4|5|6)x(\d+(?:\.\d+)?)_(shcs|bhcs|csk|selftap)$")
STANDOFF_RE = re.compile(r"^m(2|25|2\.5|3|4)x(\d+(?:\.\d+)?)_standoff$")


def resolve(key, params):
    """(key, params) -> (catalog key, full params). Raises KeyError / ValueError with a helpful message."""
    k = str(key).strip().lower().replace("-", "_")
    extra = {}
    mm = SCREW_RE.match(k) or STANDOFF_RE.match(k)
    if mm:
        d = {"25": 2.5, "2.5": 2.5, "35": 3.5, "3.5": 3.5}.get(mm.group(1)) or int(mm.group(1))
        extra = {"d": d, "length": float(mm.group(2))}
        k = mm.group(3) if mm.re is SCREW_RE else "standoff"
    elif k in ALIASES:
        k, extra = ALIASES[k]
    if k not in CATALOG:
        near = [x for x in list(CATALOG) + list(ALIASES) if k.split("_")[0] in x][:8]
        raise KeyError(f"unknown library part {key!r}" + (f"; did you mean {', '.join(near)}?" if near else "; see cadlib.parts.KEYS"))
    spec = CATALOG[k]
    out = dict(spec.get("defaults", {}))
    out.update(extra)
    for pk, pv in (params or {}).items():
        if pk not in out:
            raise ValueError(f"library part {k!r} has no parameter {pk!r} (has: {', '.join(out) or 'none'})")
        if pk in spec.get("locked", ()) and pv != out[pk]:
            raise ValueError(f"library part {k!r}: {pk} is fixed to {out[pk]!r}")
        out[pk] = pv
    for pk, ch in spec.get("choices", {}).items():
        v = out[pk]
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            v = _d(v)
        if v not in ch:
            raise ValueError(f"library part {k!r}: {pk} must be one of {', '.join(map(str, ch))}, got {out[pk]!r}")
        out[pk] = v
    for pk in ("length", "height"):
        if pk in out and out[pk] is not None:
            out[pk] = _d(out[pk])
            if not 0 < float(out[pk]) <= 2000:
                raise ValueError(f"library part {k!r}: {pk} out of range")
    if "d" in out:
        out["d"] = _d(out["d"])
    return k, out


def value(spec, field, params, default=None):
    v = spec.get(field, default)
    return v(params) if callable(v) else v


PRIME_ONLY = "&rh=p_85%3A2470955011"  # Amazon's Prime-eligible refinement; same URL as server/prices/suppliers.js


def search_url(term):
    return "https://www.amazon.com/s?k=" + quote_plus(term) + PRIME_ONLY


def bom_line(key, params):
    """The bought-part line a placement adds to bom.json (None for shop-made parts such as extrusion)."""
    spec = CATALOG[key]
    if spec.get("process", "bought") != "bought":
        return None
    term = value(spec, "search", params, "")
    return {"name": value(spec, "name", params, key), "unit_cost_usd": value(spec, "price", params, 0.0),
            "supplier": "Amazon", "url": search_url(term) if term else "", "notes": f"search: {term}" if term else ""}


# Defaults built by build_cache.py: every key at its defaults plus the common sizes / lengths.
SCREW_LENGTHS = {2: (6, 8, 10, 12), 2.5: (6, 8, 10, 12), 3: (6, 8, 10, 12, 16, 20, 25, 30), 4: (8, 10, 12, 16, 20, 25, 30),
                 5: (8, 10, 12, 16, 20, 25, 30, 40), 6: (10, 12, 16, 20, 25, 30, 40)}


def prebuild_list():
    out = [(k, {}) for k in CATALOG if not k.startswith("extrusion_") and k not in ("shcs", "bhcs", "csk", "nut", "washer", "insert", "standoff", "selftap")]
    out += [("selftap", {"d": d, "length": L}) for d, lens in ((2, (6, 8)), (2.5, (8, 10)), (3, (8, 10, 12, 16, 20)), (3.5, (12, 16)), (4, (12, 16, 20))) for L in lens]
    out += [("esp32_devkitc", {"variant": "v1"}), ("esp32_c3_supermini", {"headers": True})]
    out += [("nema17", {"length": n}) for n in (34, 40, 60)]
    out += [(f"bearing_{k}", {"seal": "2rs"}) for k in ("608", "625")]
    for d, lens in SCREW_LENGTHS.items():
        out += [("shcs", {"d": d, "length": L}) for L in lens]
        out += [("bhcs", {"d": d, "length": L}) for L in lens[:4]]
        out += [("csk", {"d": d, "length": L}) for L in lens[:4]]
        out += [("nut", {"d": d}), ("nut", {"d": d, "kind": "nylock"}), ("washer", {"d": d}), ("insert", {"d": d})]
    for d in (2.5, 3):
        out += [("standoff", {"d": d, "length": L}) for L in (5, 6, 8, 10, 12, 15, 20, 25)]
    out += [("standoff", {"d": 2, "length": L}) for L in (5, 10)]
    for pf in ("2020", "3030"):
        out += [(f"extrusion_{pf}", {"length": L}) for L in (100, 200, 250, 300, 400, 500)]
    out += [("ws2812_strip", {"length": L}) for L in (50, 200, 300, 500, 1000)]
    return out
