"""Ad hero renders:  python -m cadlib.render_hero <design_dir> [--size 1600] [--show-components]

Reads <design_dir>/manifest.json and writes four transparent-background PNGs to
<design_dir>/ads/renders/:  hero.png, low.png, front.png, detail.png

Product only: soft studio lighting, case parts in their colours, a soft contact
shadow on an invisible ground plane. Bought-part dummies (group "component") are
hidden unless --show-components is passed. Prints one JSON line on success:
{"renders": ["ads/renders/hero.png", ...], "seconds": float}
"""
import json
import math
import os
import sys
import time

import numpy as np
import vtk
from PIL import Image, ImageFilter
from vtk.util.numpy_support import vtk_to_numpy

from cadlib.render_thumb import hex_rgb

SS = 1.5  # supersample factor (render at SS x size, downsample)

# name -> (camera direction from target, zoom fill, perspective view angle, vertical bias)
VIEWS = [
    ("hero", (1.0, -1.45, 0.8), 0.80, 22, 0.0),
    ("low", (0.75, -1.5, 0.1), 0.80, 34, 0.0),
    ("front", (0.0, -1.0, 0.12), 0.78, 18, 0.0),
    ("detail", (-0.9, -1.25, 0.65), 1.35, 26, 0.3),
]


def load_mesh(path):
    reader = vtk.vtkSTLReader()
    reader.SetFileName(path)
    clean = vtk.vtkCleanPolyData()
    clean.SetInputConnection(reader.GetOutputPort())
    normals = vtk.vtkPolyDataNormals()
    normals.SetInputConnection(clean.GetOutputPort())
    normals.SetFeatureAngle(32)
    normals.SplittingOn()
    normals.Update()
    return normals.GetOutput()


def make_actor(poly, rgb):
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputData(poly)
    a = vtk.vtkActor()
    a.SetMapper(mapper)
    p = a.GetProperty()
    p.SetColor(*rgb)
    p.SetAmbient(0.22)
    p.SetDiffuse(0.78)
    p.SetSpecular(0.28)
    p.SetSpecularPower(38)
    p.SetSpecularColor(1, 1, 1)
    p.SetInterpolationToPhong()
    return a


def edge_actor(poly, rgb, scale):
    fe = vtk.vtkFeatureEdges()
    fe.SetInputData(poly)
    fe.SetFeatureAngle(40)
    fe.BoundaryEdgesOff(); fe.ManifoldEdgesOff(); fe.NonManifoldEdgesOff(); fe.FeatureEdgesOn()
    em = vtk.vtkPolyDataMapper()
    em.SetInputConnection(fe.GetOutputPort())
    em.ScalarVisibilityOff()
    em.SetResolveCoincidentTopologyToPolygonOffset()
    ea = vtk.vtkActor()
    ea.SetMapper(em)
    ea.GetProperty().SetColor(*(c * 0.55 for c in rgb))
    ea.GetProperty().SetLineWidth(0.9 * scale)
    ea.GetProperty().SetOpacity(0.35)
    return ea


def project(cam, pts, aspect=1.0):
    m = cam.GetCompositeProjectionTransformMatrix(aspect, -1, 1)
    M = np.array([[m.GetElement(i, j) for j in range(4)] for i in range(4)])
    hp = np.c_[pts, np.ones(len(pts))] @ M.T
    return hp[:, :2] / hp[:, 3:4]


def pan(cam, cx, cy):
    """Shift the camera in its own plane so NDC point (cx, cy) lands mid-frame."""
    half = math.tan(math.radians(cam.GetViewAngle() / 2)) * cam.GetDistance()
    right = np.cross(np.array(cam.GetDirectionOfProjection()), np.array(cam.GetViewUp()))
    right /= np.linalg.norm(right)
    shift = right * cx * half + np.array(cam.GetViewUp()) * cy * half
    cam.SetFocalPoint(*(np.array(cam.GetFocalPoint()) + shift))
    cam.SetPosition(*(np.array(cam.GetPosition()) + shift))


def frame(ren, cam, pts, direction, fill, angle, bias):
    """Aim the camera along direction and dolly/shift so the silhouette fills `fill` of the frame."""
    c = (pts.min(axis=0) + pts.max(axis=0)) / 2
    d = np.array(direction, float)
    d /= np.linalg.norm(d)
    radius = float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0))) / 2 or 1.0
    dist = radius / math.sin(math.radians(angle / 2)) * 1.05
    cam.SetFocalPoint(*c)
    cam.SetPosition(*(c + d * dist))
    cam.SetViewUp(0, 0, 1)
    cam.SetViewAngle(angle)
    cam.OrthogonalizeViewUp()
    target = min(fill, 0.8)
    for _ in range(3):
        ren.ResetCameraClippingRange()
        ndc = project(cam, pts)
        x0, y0 = ndc.min(axis=0)
        x1, y1 = ndc.max(axis=0)
        span = max((x1 - x0) / 2, (y1 - y0) / 2)
        if span <= 0:
            break
        pan(cam, (x0 + x1) / 2, (y0 + y1) / 2)
        cam.Dolly(target / span)
    if fill > target:  # close-up: aim at the upper part of the silhouette, then narrow the lens
        ren.ResetCameraClippingRange()
        ndc = project(cam, pts)
        y0, y1 = ndc[:, 1].min(), ndc[:, 1].max()
        pan(cam, 0, bias * (y1 - y0) / 2)
        cam.Zoom(fill / target)
    ren.ResetCameraClippingRange()


def shadow_layer(cam, pts, zmin, size, fill_k):
    """Soft ground shadow: footprint (all points dropped to the ground) + darker contact band."""
    w = h = size
    foot = pts.copy()
    foot[:, 2] = zmin
    contact = pts[pts[:, 2] < zmin + max(2.0, (pts[:, 2].max() - zmin) * 0.03)].copy()
    contact[:, 2] = zmin

    def raster(p, radius):
        img = Image.new("L", (w, h), 0)
        if not len(p):
            return img
        ndc = project(cam, p)
        xs = ((ndc[:, 0] + 1) / 2 * w).astype(int)
        ys = ((1 - (ndc[:, 1] + 1) / 2) * h).astype(int)
        ok = (xs >= -radius) & (xs < w + radius) & (ys >= -radius) & (ys < h + radius)
        arr = np.zeros((h, w), np.uint8)
        xs, ys = np.clip(xs[ok], 0, w - 1), np.clip(ys[ok], 0, h - 1)
        arr[ys, xs] = 255
        img = Image.fromarray(arr).filter(ImageFilter.MaxFilter(radius * 2 + 1))
        return img

    r = max(1, int(size * 0.006))
    a = np.asarray(raster(foot, r).filter(ImageFilter.GaussianBlur(size * 0.035)), np.float32) / 255
    b = np.asarray(raster(contact, r).filter(ImageFilter.GaussianBlur(size * 0.010)), np.float32) / 255
    alpha = np.clip(a * 0.30 + b * 0.38, 0, 0.55) * fill_k
    out = np.zeros((h, w, 4), np.uint8)
    out[..., 0:3] = (18, 16, 14)
    out[..., 3] = (alpha * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def render_images(design_dir, size=1600, show_components=False, only=None):
    """Yield (name, RGBA PIL image) per view: the product with its soft ground shadow on a transparent background."""
    design_dir = os.path.abspath(design_dir)
    with open(os.path.join(design_dir, "manifest.json")) as f:
        man = json.load(f)
    from cadlib.safepath import inside  # manifest paths are untrusted: project files only (security C2)
    items = []
    for p in man.get("parts", []):
        path = inside(design_dir, p.get("file"))
        if not path:
            continue
        group = p.get("group", "case")
        if group == "component" and not show_components:
            continue
        items.append((path, p.get("color") or "#8a8f98"))
    if not items:  # nothing printed? fall back to everything
        items = [(inside(design_dir, p.get("file")), p.get("color") or "#8a8f98")
                 for p in man.get("parts", []) if inside(design_dir, p.get("file"))]
    if not items:
        raise SystemExit("no STL files to render")

    big = int(size * SS)
    ren = vtk.vtkRenderer()
    ren.SetBackground(0.5, 0.5, 0.5)
    ren.SetBackgroundAlpha(0.0)
    all_pts = []
    for path, color in items:
        poly = load_mesh(path)
        if poly.GetNumberOfPoints() == 0:
            continue
        rgb = hex_rgb(color)
        ren.AddActor(make_actor(poly, rgb))
        ren.AddActor(edge_actor(poly, rgb, SS))
        all_pts.append(vtk_to_numpy(poly.GetPoints().GetData()))
    pts = np.concatenate(all_pts)
    if len(pts) > 80000:
        pts = pts[:: len(pts) // 80000 + 1]
    zmin = float(pts[:, 2].min())

    # soft studio lighting: big soft key from upper left-front, fill, rim from behind
    ren.AutomaticLightCreationOff()
    ren.RemoveAllLights()
    kit = vtk.vtkLightKit()
    kit.SetKeyLightIntensity(0.95)
    kit.SetKeyToFillRatio(2.2)
    kit.SetKeyToHeadRatio(3.2)
    kit.SetKeyToBackRatio(2.0)
    kit.SetKeyLightElevation(50)
    kit.SetKeyLightAzimuth(-25)
    kit.SetFillLightElevation(-10)
    kit.SetFillLightAzimuth(40)
    kit.AddLightsToRenderer(ren)
    try:
        ren.UseSSAOOn()
        diag = float(np.linalg.norm(pts.max(axis=0) - pts.min(axis=0)))
        ren.SetSSAORadius(diag * 0.04)
        ren.SetSSAOBias(diag * 0.002)
        ren.SetSSAOKernelSize(64)
        ren.SSAOBlurOn()
    except AttributeError:
        pass

    win = vtk.vtkRenderWindow()
    win.SetOffScreenRendering(1)
    win.SetMultiSamples(0)
    win.SetAlphaBitPlanes(1)
    win.AddRenderer(ren)
    win.SetSize(big, big)

    cam = ren.GetActiveCamera()
    try:
        for name, direction, fill, angle, bias in VIEWS:
            if only and name not in only:
                continue
            frame(ren, cam, pts, direction, fill, angle, bias)
            win.Render()
            w2i = vtk.vtkWindowToImageFilter()
            w2i.SetInput(win)
            w2i.SetInputBufferTypeToRGBA()
            w2i.ReadFrontBufferOff()
            w2i.Update()
            img = w2i.GetOutput()
            arr = vtk_to_numpy(img.GetPointData().GetScalars()).reshape(big, big, 4)[::-1].copy()
            # opaque product pixels have alpha 255; un-premultiply any partial edges
            prod = Image.fromarray(arr, "RGBA")
            prod = prod.convert("RGBa").resize((size, size), Image.LANCZOS).convert("RGBA")
            shadow = shadow_layer(cam, pts, zmin, size, 0.0 if name == "detail" else 1.0)
            yield name, Image.alpha_composite(shadow, prod)
    finally:
        win.Finalize()


def render_hero(design_dir, size=1600, show_components=False, only=None):
    t0 = time.time()
    out_dir = os.path.join(os.path.abspath(design_dir), "ads", "renders")
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, out in render_images(design_dir, size, show_components, only):
        dst = os.path.join(out_dir, name + ".png")
        tmp = dst + ".tmp.png"
        out.save(tmp, optimize=False, compress_level=4)
        os.replace(tmp, dst)
        written.append(f"ads/renders/{name}.png")
    return {"renders": written, "seconds": round(time.time() - t0, 2)}


def main():
    args = sys.argv[1:]
    size = 1600
    show = False
    if "--size" in args:
        i = args.index("--size")
        size = int(args[i + 1])
        del args[i:i + 2]
    if "--show-components" in args:
        args.remove("--show-components")
        show = True
    if not args:
        print(__doc__)
        return 2
    print(json.dumps(render_hero(args[0], size=size, show_components=show)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
