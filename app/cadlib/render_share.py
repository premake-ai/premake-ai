"""Build guide share card:  python -m cadlib.render_share <design_dir> <out.png> '<info json>'

A 1200x630 PNG for og:image / twitter:image: the hero render big on the right, the title, how to get it and the
Premake wordmark on the left. Light theme, orange accent. Info JSON keys: title, parts, hours, price, site.

The hero comes from <design_dir>/ads/renders/hero.png when it is newer than manifest.json, else a fresh VTK render
(cadlib.render_hero, nothing written into the design). Prints one JSON line on success: {"out": ..., "seconds": ...}
"""
import json
import os
import sys
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
SS = 2  # draw at 2x, downsample: smooth text and shapes
INK = (27, 26, 23)
INK2 = (74, 73, 69)
MUTED = (117, 115, 109)
LINE = (229, 227, 221)
ACCENT = (232, 89, 12)
ACCENT_LIGHT = (255, 138, 61)
SOFT = (246, 245, 242)

HERE = os.path.dirname(os.path.abspath(__file__))
HOME = os.path.expanduser("~")


def _first(paths):
    for p in paths:
        if os.path.isfile(p):
            return p
    return None


def font(weight, px):
    """Inter when a static TTF is around, else SF Pro (variable), else Helvetica Neue, else Pillow's default."""
    names = {"bold": ["Inter-Bold.ttf", "Inter_24pt-Bold.ttf", "inter-700.ttf"],
             "semibold": ["Inter-SemiBold.ttf", "Inter_24pt-SemiBold.ttf", "inter-600.ttf"],
             "medium": ["Inter-Medium.ttf", "Inter_24pt-Medium.ttf", "inter-500.ttf"],
             "regular": ["Inter-Regular.ttf", "Inter_24pt-Regular.ttf", "inter-400.ttf"]}[weight]
    dirs = [os.path.join(HERE, "fonts"), os.path.join(HOME, "Library", "Fonts"), "/Library/Fonts"]
    p = _first([os.path.join(d, n) for d in dirs for n in names])
    if p:
        return ImageFont.truetype(p, px)
    sf = "/System/Library/Fonts/SFNS.ttf"
    if os.path.isfile(sf):
        try:
            f = ImageFont.truetype(sf, px)
            f.set_variation_by_name({"bold": "Bold", "semibold": "Semibold", "medium": "Medium", "regular": "Regular"}[weight])
            return f
        except Exception:
            pass
    hn = "/System/Library/Fonts/HelveticaNeue.ttc"
    if os.path.isfile(hn):
        return ImageFont.truetype(hn, px, index={"bold": 1, "semibold": 1, "medium": 10, "regular": 0}[weight])
    return ImageFont.load_default(px)


def hero_image(design_dir):
    """RGBA product render (transparent background, soft shadow), cropped to its content."""
    man = os.path.join(design_dir, "manifest.json")
    cached = os.path.join(design_dir, "ads", "renders", "hero.png")
    img = None
    try:
        if os.path.getmtime(cached) >= os.path.getmtime(man):
            img = Image.open(cached).convert("RGBA")
    except OSError:
        pass
    if img is None:
        from cadlib.render_hero import render_images
        for _, im in render_images(design_dir, size=1400, only=["hero"]):
            img = im
    if img is None:
        thumb = os.path.join(design_dir, "thumb.png")
        if os.path.isfile(thumb):  # last resort: the opaque grey thumbnail
            return Image.open(thumb).convert("RGBA")
        raise SystemExit("nothing to render")
    box = img.getchannel("A").point(lambda a: 255 if a > 6 else 0).getbbox()
    return img.crop(box) if box else img


def wrap(draw, text, f, max_w, max_lines):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= max_w or not cur:
            cur = t
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        last = lines[-1]
        while last and draw.textlength(last + "…", font=f) > max_w:
            last = last[:-1].rstrip()
        lines[-1] = last + "…"
    return lines


def hours_text(h):
    h = float(h or 0)
    if h <= 0:
        return ""
    if h < 1:
        return f"{max(5, round(h * 60 / 5) * 5)} min"
    return f"{round(h) if h >= 10 else round(h, 1):g} h"


def card(design_dir, info):
    s = SS
    im = Image.new("RGB", (W * s, H * s), (255, 255, 255))
    d = ImageDraw.Draw(im)

    # right: soft panel with the product
    px0 = 600 * s
    panel = Image.new("RGB", (W * s - px0, H * s), SOFT)
    glow = Image.new("L", panel.size, 0)
    ImageDraw.Draw(glow).ellipse([60 * s, 40 * s, panel.size[0] - 60 * s, panel.size[1] - 40 * s], fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(90 * s))
    panel.paste(Image.new("RGB", panel.size, (255, 255, 255)), (0, 0), glow)
    im.paste(panel, (px0, 0))
    d.line([(px0, 0), (px0, H * s)], fill=LINE, width=s)

    hero = hero_image(design_dir)
    box_w, box_h = (W * s - px0) - 70 * s, H * s - 80 * s
    k = min(box_w / hero.width, box_h / hero.height)
    hero = hero.resize((max(1, int(hero.width * k)), max(1, int(hero.height * k))), Image.LANCZOS)
    hx = px0 + ((W * s - px0) - hero.width) // 2
    hy = (H * s - hero.height) // 2 + 6 * s
    im.paste(hero, (hx, hy), hero)

    # left: wordmark, title, facts, how to get it, address
    x = 64 * s
    max_w = px0 - x - 48 * s
    mk = 34 * s
    grad = Image.new("RGB", (mk, mk))
    gd = ImageDraw.Draw(grad)
    for i in range(mk * 2):  # 135deg gradient #ff8a3d -> #e8590c
        t = i / (mk * 2 - 1)
        c = tuple(int(a + (b - a) * t) for a, b in zip(ACCENT_LIGHT, ACCENT))
        gd.line([(i, 0), (0, i)], fill=c, width=2)
    mask = Image.new("L", (mk, mk), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, mk - 1, mk - 1], radius=9 * s, fill=255)
    im.paste(grad, (x, 58 * s), mask)
    fw = font("bold", 30 * s)
    d.text((x + mk + 14 * s, 58 * s + mk // 2), "Premake", font=fw, fill=INK, anchor="lm")

    title = (info.get("title") or "Build guide").strip()
    size = 64
    while True:
        ft = font("bold", size * s)
        lines = wrap(d, title, ft, max_w, 3)
        if (len(lines) <= 2 and all(not l.endswith("…") for l in lines)) or size <= 44:
            break
        size -= 4
    lh = int(size * 1.12) * s
    facts = [p for p in [
        f"{info['parts']} part{'s' if info['parts'] != 1 else ''}" if info.get("parts") else "",
        f"prints in {hours_text(info.get('hours'))}" if hours_text(info.get("hours")) else "",
    ] if p]
    fm = font("medium", 26 * s)
    fb = font("semibold", 27 * s)
    price = info.get("price")
    rows = [("Print it yourself · free files", INK2, fb)]
    if price:
        rows.append((f"Or get it made · ${round(float(price)):,}", ACCENT, fb))

    block_h = len(lines) * lh + (22 * s + 34 * s if facts else 0) + 40 * s + len(rows) * 44 * s
    y = max(130 * s, (H * s - block_h) // 2 + 4 * s)
    for ln in lines:
        d.text((x, y), ln, font=ft, fill=INK)
        y += lh
    if facts:
        y += 18 * s
        d.text((x, y), " · ".join(facts), font=fm, fill=MUTED)
        y += 34 * s
    y += 36 * s
    d.line([(x, y - 18 * s), (x + 56 * s, y - 18 * s)], fill=ACCENT, width=4 * s)
    for text, col, f in rows:
        d.text((x, y), text, font=f, fill=col)
        y += 44 * s

    d.text((x, H * s - 56 * s), info.get("site") or "premake.ai", font=font("medium", 22 * s), fill=MUTED, anchor="ls")
    return im.resize((W, H), Image.LANCZOS)


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    t0 = time.time()
    design_dir, out = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    info = json.loads(sys.argv[3])
    img = card(design_dir, info)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp.png"
    img.save(tmp, optimize=True)
    os.replace(tmp, out)
    print(json.dumps({"out": out, "seconds": round(time.time() - t0, 2)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
