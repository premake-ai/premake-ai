"""Bambu Studio project for a design's printed parts (the Make tab's "Open in Bambu Studio").

    python -m cadlib.bambu3mf <design dir> <out.3mf> [bed mm, default 256]

Every printed part in bom.json, turned so its biggest flat face sits on the bed (of the 6 square-on orientations: the
most face area touching the bed, then the lowest), laid out in rows on as many bed-sized plates as it takes, side by
side with a gap. Parts bigger than the bed are put last, on their own, and listed. Prints a JSON summary.
"""
import json, os, sys, zipfile
from xml.sax.saxutils import quoteattr

import numpy as np
import trimesh

GAP = 6.0  # mm between parts
PLATE_GAP = 0.2  # Bambu Studio's plates sit one fifth of a bed apart


def rotations():
    """The 6 rotations that put each +/- axis face-down."""
    I = np.eye(4)
    out = [I]
    for axis, ang in (([1, 0, 0], np.pi / 2), ([1, 0, 0], -np.pi / 2), ([0, 1, 0], np.pi / 2), ([0, 1, 0], -np.pi / 2), ([1, 0, 0], np.pi)):
        out.append(trimesh.transformations.rotation_matrix(ang, axis))
    return out


def lay_flat(mesh):
    best, score = None, None
    for R in rotations():
        m = mesh.copy(); m.apply_transform(R)
        z0 = m.bounds[0][2]
        down = (m.face_normals[:, 2] < -0.985) & (m.triangles[:, :, 2].max(axis=1) < z0 + 0.15)
        s = (round(float(m.area_faces[down].sum()), 1), -float(m.extents[2]))
        if score is None or s > score: best, score = m, s
    best.apply_translation(-best.bounds[0])  # min corner at the origin
    return best


def write_3mf(out, objects):
    """A plain 3MF (core spec): one object per part, named, in mm, placed where it lies. Written to a temp file first."""
    xml = ['<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>']
    for i, (name, m) in enumerate(objects, 1):
        v = '\n'.join(f'<vertex x="{a:.4f}" y="{b:.4f}" z="{c:.4f}"/>' for a, b, c in m.vertices)
        t = '\n'.join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in m.faces)
        xml.append(f'<object id="{i}" name={quoteattr(name)} type="model"><mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh></object>')
    xml.append('</resources><build>' + ''.join(f'<item objectid="{i}"/>' for i in range(1, len(objects) + 1)) + '</build></model>')
    tmp = out + '.part'
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr('3D/3dmodel.model', ''.join(xml))
    os.replace(tmp, out)


def main(src, out, bed=256.0):
    bom = json.load(open(os.path.join(src, 'bom.json')))
    parts, too_big = [], []
    for p in bom.get('printed') or []:
        f = os.path.join(src, str(p.get('file') or ''))
        if not f.endswith('.stl') or not os.path.isfile(f): continue
        m = lay_flat(trimesh.load(f, force='mesh'))
        name = str(p.get('name') or os.path.basename(f)[:-4])
        (too_big if max(m.extents[0], m.extents[1]) > bed or m.extents[2] > bed else parts).append((name, m))
    if not parts and not too_big: print(json.dumps({'error': 'no printed parts'})); return 2
    # shelf packing, tallest first: rows across a plate, a new plate when one is full
    parts.sort(key=lambda t: -t[1].extents[1])
    objects, plate, x, y, row = [], 0, 0.0, 0.0, 0.0
    step = bed * (1 + PLATE_GAP)
    placed = []
    for name, m in parts:
        w, d = m.extents[0], m.extents[1]
        if x + w > bed: x, y, row = 0.0, y + row + GAP, 0.0
        if y + d > bed: plate, x, y, row = plate + 1, 0.0, 0.0, 0.0
        m.apply_translation([plate * step + x, y, 0])
        objects.append((name, m))
        placed.append({'name': name, 'plate': plate + 1})
        x += w + GAP; row = max(row, d)
    for name, m in too_big:  # off to the side, so the user sees them and can split or scale them
        plate += 1
        m.apply_translation([plate * step, 0, 0])
        objects.append((name, m))
    write_3mf(out, objects)
    print(json.dumps({'parts': len(placed), 'plates': (placed[-1]['plate'] if placed else 0), 'too_big': [n for n, _ in too_big]}))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 256.0))
