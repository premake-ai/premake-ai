import sys, os
sys.path.insert(0, os.getcwd()); os.environ.setdefault("FORMA_NO_RENDER", "")
from PIL import Image, ImageDraw, ImageFilter
from cadlib.render_share import font, hero_image
W, H = 1200, 630
img = Image.new("RGB", (W, H), (250, 249, 247))
d = ImageDraw.Draw(img)
# faint CAD grid on the right
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(glow)
gd.ellipse([620, 330, 1260, 820], fill=(232, 89, 12, 40)); glow = glow.filter(ImageFilter.GaussianBlur(90))
img.paste(glow, (0, 0), glow)
def place(slug, cx, cy, h):
    im = hero_image(os.path.join("data/examples", slug))
    r = h / im.height; im = im.resize((int(im.width * r), int(h)), Image.LANCZOS)
    if im.width > 330: r = 330 / im.width; im = im.resize((330, int(im.height * r)), Image.LANCZOS)
    img.paste(im, (int(cx - im.width / 2), int(cy - im.height / 2)), im)
place("arc-desk-lamp", 760, 250, 330)
place("spin-turntable", 1010, 330, 270)
place("twist-planter", 860, 480, 220)
# left text column
d.rounded_rectangle([64, 64, 100, 100], 9, fill=(232, 89, 12))
d.text((114, 82), "Premake", font=font("bold", 30), fill=(27, 26, 23), anchor="lm")
d.text((64, 190), "Build something", font=font("bold", 64), fill=(27, 26, 23))
d.text((64, 262), "you can hold", font=font("bold", 64), fill=(27, 26, 23))
d.line([(64, 360), (124, 360)], fill=(232, 89, 12), width=4)
f = font("regular", 27)
for i, t in enumerate(["Describe a product. Watch it take", "shape in 3D. Order 1 to 500."]):
    d.text((64, 390 + i * 38), t, font=f, fill=(90, 87, 80))
d.text((64, 556), "premake.ai", font=font("semibold", 26), fill=(232, 89, 12))
img.save(sys.argv[1], optimize=True)
print("ok", os.path.getsize(sys.argv[1]))
