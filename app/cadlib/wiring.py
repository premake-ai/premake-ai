"""Pin-to-pin wiring list (./wiring.json), checked on every build.

    {"wires": [{"from": {"part": "ESP32 DevKitC (WROOM-32, 38 pin)", "pin": "GPIO18"},
                "to":   {"part": "ULN2003 driver board", "pin": "IN1"},
                "color": "yellow", "kind": "dupont", "note": "optional"}]}

`part` is a part name from the model (parts() names, library part names) or a bom.json line. The build fails when a wire
names a part that doesn't exist or has no pin, so the list always matches the design; a later viewer draws it in 3D.
"""
import json
import os
import re

COLORS = {"red", "black", "white", "yellow", "green", "blue", "orange", "purple", "brown", "grey", "gray", "pink"}
ELECTRONIC = re.compile(r"\b(esp32|esp8266|arduino|raspberry|pico|xiao|ws2812|neopixel|led strip|cob strip|relay|buck|boost|lm2596|mp1584|"
                        r"tmc2209|a4988|uln2003|driver|stepper|nema ?17|servo|sg90|mg996|motor|oled|lcd|display|sensor|pir|hc-sr|"
                        r"bme280|ds18b20|18650|battery|tp4056|charger|usb-?c (breakout|pd|trigger)|dc jack|barrel jack|"
                        r"potentiometer|encoder|tact|push button|buzzer|speaker|fan)\b", re.I)
MAX_WIRES = 400


def _key(s):
    s = re.sub(r"\s*[×x]\s*\d+\s*$", "", str(s or "")).strip().lower()  # "M3 screw ×4" -> "m3 screw"
    return re.sub(r"\s+", " ", s)


def known_parts(rows, bom):
    """name key -> display name, from the model rows (incl. their raw names) and every bom.json parts line."""
    out = {}
    for r in rows or []:
        for n in (r.get("name"), r.get("raw_name")):
            if n:
                out.setdefault(_key(n), str(n))
    for p in (bom or {}).get("parts") or []:
        if isinstance(p, dict) and p.get("name"):
            out.setdefault(_key(p["name"]), str(p["name"]))
    return out


def has_electronics(rows, bom):
    names = [r.get("name", "") for r in rows or [] if r.get("group") == "component"]
    names += [p.get("name", "") for p in (bom or {}).get("parts") or [] if isinstance(p, dict)]
    return [n for n in names if ELECTRONIC.search(str(n))]


def check(design_dir, rows, bom):
    """-> (errors, warnings, summary or None). summary goes into manifest.json as "wiring"."""
    path = os.path.join(design_dir, "wiring.json")
    elec = has_electronics(rows, bom)
    if not os.path.isfile(path):
        warn = []
        if elec:
            warn.append(f"WIRING MISSING: this design has electronics ({', '.join(sorted(set(map(str, elec)))[:4])}) "
                        "but no ./wiring.json. Write the pin-to-pin list (see the prompt).")
        return [], warn, None
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as e:  # noqa
        return [f"wiring.json is not valid JSON: {e}"], [], None
    wires = data.get("wires") if isinstance(data, dict) else data
    if not isinstance(wires, list):
        return ['wiring.json must be {"wires": [{"from": {"part", "pin"}, "to": {"part", "pin"}, "color", "kind"}]}'], [], None
    if len(wires) > MAX_WIRES:
        return [f"wiring.json has {len(wires)} wires (max {MAX_WIRES})"], [], None
    names = known_parts(rows, bom)
    errors, warnings, used = [], [], set()
    for i, w in enumerate(wires):
        if not isinstance(w, dict):
            errors.append(f"wire {i + 1}: must be an object")
            continue
        for end in ("from", "to"):
            e = w.get(end)
            if not isinstance(e, dict) or not str(e.get("part") or "").strip() or not str(e.get("pin") or "").strip():
                errors.append(f"wire {i + 1}: \"{end}\" needs a part and a pin")
                continue
            k = _key(e["part"])
            if k not in names:
                near = [v for kk, v in names.items() if k and (k in kk or kk in k)][:3]
                errors.append(f"wire {i + 1}: {end} part {e['part']!r} is not in the model or bom.json"
                              + (f" (did you mean {', '.join(repr(n) for n in near)}?)" if near else ""))
            else:
                used.add(names[k])
        kind = str(w.get("kind") or w.get("gauge") or "").strip().lower()
        if kind in ("solder", "soldered") and not (bom or {}).get("needs_soldering"):
            warnings.append(f"wire {i + 1} is soldered but bom.json has no \"needs_soldering\": true (+ \"soldering_reason\")")
        c = str(w.get("color") or "").strip().lower()
        if c and c not in COLORS and not re.fullmatch(r"#[0-9a-f]{6}", c):
            warnings.append(f"wire {i + 1}: color {w.get('color')!r} is not a common wire colour")
    summary = {"file": "wiring.json", "wires": len(wires), "parts": sorted(used)}
    return errors, warnings, summary
