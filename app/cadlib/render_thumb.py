"""Offscreen VTK thumbnail:  python -m cadlib.render_thumb <design_dir> [out.png] [--view iso|iso_low|iso_back|front|top|side]

Reads <design_dir>/manifest.json, renders a 640x480 iso view to thumb.png.
Case parts in their colours; components muted and slightly transparent.
"""
import json
import os
import sys

import math

import numpy as np
import vtk
from vtk.util.numpy_support import vtk_to_numpy

W, H = 640, 480
SS = 2  # supersample factor
VIEWS = {
    "iso": ((0.95, -1.35, 0.85), (0, 0, 1)),
    "iso_low": ((0.95, -1.35, -0.25), (0, 0, 1)),
    "iso_back": ((-0.95, 1.35, 0.85), (0, 0, 1)),
    "front": ((0, -1, 0.0), (0, 0, 1)),
    "side": ((1, 0, 0.0), (0, 0, 1)),
    "top": ((0, 0, 1), (0, 1, 0)),
}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def mute(rgb, k=0.45, grey=(0.72, 0.73, 0.75)):
    return tuple(c * (1 - k) + g * k for c, g in zip(rgb, grey))


def actors_for(path, rgb, opacity, edges):
    reader = vtk.vtkSTLReader()
    reader.SetFileName(path)
    clean = vtk.vtkCleanPolyData()
    clean.SetInputConnection(reader.GetOutputPort())
    normals = vtk.vtkPolyDataNormals()
    normals.SetInputConnection(clean.GetOutputPort())
    normals.SetFeatureAngle(32)
    normals.SplittingOn()
    mapper = vtk.vtkPolyDataMapper()
    mapper.SetInputConnection(normals.GetOutputPort())
    a = vtk.vtkActor()
    a.SetMapper(mapper)
    p = a.GetProperty()
    p.SetColor(*rgb)
    p.SetOpacity(opacity)
    p.SetAmbient(0.18)
    p.SetDiffuse(0.82)
    p.SetSpecular(0.18)
    p.SetSpecularPower(25)
    p.SetInterpolationToPhong()
    out = [a]
    if edges:
        fe = vtk.vtkFeatureEdges()
        fe.SetInputConnection(clean.GetOutputPort())
        fe.SetFeatureAngle(38)
        fe.BoundaryEdgesOff(); fe.ManifoldEdgesOff(); fe.NonManifoldEdgesOff(); fe.FeatureEdgesOn()
        em = vtk.vtkPolyDataMapper()
        em.SetInputConnection(fe.GetOutputPort())
        em.ScalarVisibilityOff()
        em.SetResolveCoincidentTopologyToPolygonOffset()
        ea = vtk.vtkActor()
        ea.SetMapper(em)
        ea.GetProperty().SetColor(*(c * 0.45 for c in rgb))
        ea.GetProperty().SetLineWidth(1.0 * SS)
        ea.GetProperty().SetOpacity(0.55)
        out.append(ea)
    return out


def model_points(ren, cap=60000):
    out = []
    acts = ren.GetActors()
    acts.InitTraversal()
    for _ in range(acts.GetNumberOfItems()):
        a = acts.GetNextActor()
        d = a.GetMapper().GetInput()
        if d is None or d.GetPoints() is None:
            continue
        out.append(vtk_to_numpy(d.GetPoints().GetData()))
    pts = np.concatenate(out) if out else np.zeros((1, 3))
    if len(pts) > cap:
        pts = pts[:: len(pts) // cap + 1]
    return pts


def render(items, out_png, view="iso", size=(W, H)):
    """items: list of (stl_path, '#rrggbb', group)."""
    ren = vtk.vtkRenderer()
    ren.GradientBackgroundOn()
    ren.SetBackground(0.86, 0.87, 0.89)    # bottom
    ren.SetBackground2(0.965, 0.968, 0.975)  # top
    has_case = any(g == "case" for _, _, g in items)
    for path, color, group in items:
        rgb = hex_rgb(color)
        if group == "component" and has_case:
            acts = actors_for(path, mute(rgb), 0.82, edges=False)
        else:
            acts = actors_for(path, rgb, 1.0, edges=True)
        for a in acts:
            ren.AddActor(a)
    ren.SetUseDepthPeeling(1)
    ren.SetMaximumNumberOfPeels(16)
    ren.SetOcclusionRatio(0.05)

    kit = vtk.vtkLightKit()
    kit.SetKeyLightIntensity(0.85)
    kit.SetKeyToFillRatio(1.9)
    kit.SetKeyToHeadRatio(3.0)
    kit.SetKeyLightElevation(55)
    kit.SetKeyLightAzimuth(15)
    kit.AddLightsToRenderer(ren)

    win = vtk.vtkRenderWindow()
    win.SetOffScreenRendering(1)
    win.SetMultiSamples(0)
    win.SetAlphaBitPlanes(1)
    win.AddRenderer(ren)
    win.SetSize(size[0] * SS, size[1] * SS)

    d, up = VIEWS.get(view, VIEWS["iso"])
    cam = ren.GetActiveCamera()
    ren.ResetCamera()
    fp = cam.GetFocalPoint()
    cam.SetPosition(fp[0] + d[0] * 1000, fp[1] + d[1] * 1000, fp[2] + d[2] * 1000)
    cam.SetViewUp(*up)
    cam.SetViewAngle(20)
    ren.ResetCamera()
    cam.OrthogonalizeViewUp()
    # tight fit: project bounds to the view and dolly so the model fills ~85% of the frame
    sw, sh = size[0] * SS, size[1] * SS
    pts = model_points(ren)
    for _ in range(2):  # recentre + zoom on the projected silhouette points
        ren.ResetCameraClippingRange()
        m = cam.GetCompositeProjectionTransformMatrix(sw / sh, -1, 1)
        M = np.array([[m.GetElement(i, j) for j in range(4)] for i in range(4)])
        hp = np.c_[pts, np.ones(len(pts))] @ M.T
        ndc = hp[:, :2] / hp[:, 3:4]
        x0, y0 = ndc.min(axis=0)
        x1, y1 = ndc.max(axis=0)
        span = max((x1 - x0) / 2, (y1 - y0) / 2)
        if span <= 0:
            break
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        # shift camera in its own plane so the silhouette centre lands mid-frame
        dist = cam.GetDistance()
        half_h = math.tan(math.radians(cam.GetViewAngle() / 2)) * dist
        half_w = half_h * sw / sh
        right = np.cross(np.array(cam.GetDirectionOfProjection()), np.array(cam.GetViewUp()))
        right /= np.linalg.norm(right)
        upv = np.array(cam.GetViewUp())
        shift = right * cx * half_w + upv * cy * half_h
        f = np.array(cam.GetFocalPoint()) + shift
        p = np.array(cam.GetPosition()) + shift
        cam.SetFocalPoint(*f)
        cam.SetPosition(*p)
        cam.Zoom(0.84 / span)
    ren.ResetCameraClippingRange()
    win.Render()

    w2i = vtk.vtkWindowToImageFilter()
    w2i.SetInput(win)
    w2i.SetInputBufferTypeToRGB()
    w2i.ReadFrontBufferOff()
    w2i.Update()
    rs = vtk.vtkImageResize()
    rs.SetInputConnection(w2i.GetOutputPort())
    rs.SetOutputDimensions(size[0], size[1], 1)
    rs.InterpolateOn()
    rs.Update()
    tmp = out_png + ".tmp.png"
    wr = vtk.vtkPNGWriter()
    wr.SetFileName(tmp)
    wr.SetInputConnection(rs.GetOutputPort())
    wr.Write()
    os.replace(tmp, out_png)
    win.Finalize()


def render_design(design_dir, out_png=None, view="iso"):
    design_dir = os.path.abspath(design_dir)
    with open(os.path.join(design_dir, "manifest.json")) as f:
        man = json.load(f)
    from cadlib.safepath import inside  # manifest paths are untrusted: project files only (security C2)
    items = []
    for p in man.get("parts", []):
        subs = [(inside(design_dir, s.get("file")), s) for s in (p.get("subparts") or []) if isinstance(s, dict)]
        subs = [(f, s) for f, s in subs if f]
        if subs:  # library part: its own colours (PCB, pins, metal ...)
            for f, s in subs:
                items.append((f, s.get("color", "#8a8f98"), p.get("group", "component")))
            continue
        path = inside(design_dir, p.get("file"))
        if path:
            items.append((path, p.get("color", "#8a8f98"), p.get("group", "case")))
    if not items:
        raise SystemExit("no STL files to render")
    render(items, out_png or os.path.join(design_dir, "thumb.png"), view=view)


def main():
    args = [a for a in sys.argv[1:]]
    view = "iso"
    if "--view" in args:
        i = args.index("--view")
        view = args[i + 1]
        del args[i:i + 2]
    if not args:
        print("usage: python -m cadlib.render_thumb <design_dir> [out.png] [--view iso|iso_low|iso_back|front|top|side]")
        return 2
    render_design(args[0], args[1] if len(args) > 1 else None, view)
    return 0


if __name__ == "__main__":
    sys.exit(main())
