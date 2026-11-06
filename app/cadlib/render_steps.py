"""Offscreen VTK renders for build-guide steps:

    python -m cadlib.render_steps <design_dir> <steps.json> <out_dir>

steps.json: {"steps": [{"show": ["stl/a.stl", ...], "new": ["stl/a.stl", ...]}, ...]}
  show = every part assembled so far (files relative to design_dir, as in manifest.json)
  new  = the parts this step adds; drawn in the highlight colour, the rest in light grey.
  A step with an empty "new" list shows "show" in the parts' own colours (e.g. a final check).

Writes <out_dir>/step-<n>.png (1-based, 800x600) and prints one JSON line:
{"images": ["step-1.png", null, ...], "errors": [...]}. A step that fails to render gets null;
the script never exits non-zero for a single bad step. Run by the server (VTK needs the window server).
"""
import json
import os
import sys

from cadlib.render_thumb import VIEWS, actors_for, hex_rgb

W, H = 800, 600
SS = 2
HIGHLIGHT = "#f26b1d"
OLD = (0.80, 0.81, 0.83)


def _set_color(acts, rgb, opacity=1.0):
    body = acts[0]
    body.GetProperty().SetColor(*rgb)
    body.GetProperty().SetOpacity(opacity)
    for e in acts[1:]:
        e.GetProperty().SetColor(*(c * 0.45 for c in rgb))


def main():
    if len(sys.argv) < 4:
        print("usage: python -m cadlib.render_steps <design_dir> <steps.json> <out_dir>", file=sys.stderr)
        return 2
    import vtk  # imported late so a broken VTK still prints a readable error line

    design_dir, steps_file, out_dir = (os.path.abspath(a) for a in sys.argv[1:4])
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(design_dir, "manifest.json")) as f:
        man = json.load(f)
    with open(steps_file) as f:
        steps = json.load(f).get("steps", [])

    colors = {p["file"]: p.get("color", "#8a8f98") for p in man.get("parts", [])}
    ren = vtk.vtkRenderer()
    ren.GradientBackgroundOn()
    ren.SetBackground(0.90, 0.91, 0.92)
    ren.SetBackground2(0.985, 0.985, 0.99)
    ren.SetUseDepthPeeling(1)
    ren.SetMaximumNumberOfPeels(16)
    kit = vtk.vtkLightKit()
    kit.SetKeyLightIntensity(0.85)
    kit.SetKeyToFillRatio(1.9)
    kit.SetKeyLightElevation(55)
    kit.SetKeyLightAzimuth(15)
    kit.AddLightsToRenderer(ren)

    acts = {}
    root = os.path.realpath(design_dir)
    for rel in colors:
        from cadlib.safepath import inside
        path = inside(design_dir, rel)  # no symlinks either (security C2)
        if not path:
            continue
        a = actors_for(path, hex_rgb(colors[rel]), 1.0, edges=True)
        for x in a:
            x.VisibilityOff()
            ren.AddActor(x)
        acts[rel] = a

    win = vtk.vtkRenderWindow()
    win.SetOffScreenRendering(1)
    win.SetMultiSamples(0)
    win.AddRenderer(ren)
    win.SetSize(W * SS, H * SS)

    images, errors = [], []
    d, up = VIEWS["iso"]
    for i, st in enumerate(steps, 1):
        try:
            show = [f for f in st.get("show", []) if f in acts]
            new = set(f for f in st.get("new", []) if f in acts)
            if not show:
                images.append(None)
                continue
            for rel, a in acts.items():
                vis = rel in show
                for x in a:
                    x.SetVisibility(vis)
                if not vis:
                    continue
                if not new:
                    _set_color(a, hex_rgb(colors[rel]))
                elif rel in new:
                    _set_color(a, hex_rgb(HIGHLIGHT))
                else:
                    _set_color(a, OLD, 0.9)
            cam = ren.GetActiveCamera()
            bounds = ren.ComputeVisiblePropBounds()
            cx, cy, cz = (bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2
            cam.SetFocalPoint(cx, cy, cz)
            cam.SetPosition(cx + d[0] * 1000, cy + d[1] * 1000, cz + d[2] * 1000)
            cam.SetViewUp(*up)
            cam.SetViewAngle(20)
            ren.ResetCamera(bounds)
            cam.OrthogonalizeViewUp()
            cam.Zoom(1.0)
            ren.ResetCameraClippingRange()
            win.Render()
            w2i = vtk.vtkWindowToImageFilter()
            w2i.SetInput(win)
            w2i.SetInputBufferTypeToRGB()
            w2i.ReadFrontBufferOff()
            w2i.Update()
            rs = vtk.vtkImageResize()
            rs.SetInputConnection(w2i.GetOutputPort())
            rs.SetOutputDimensions(W, H, 1)
            rs.InterpolateOn()
            rs.Update()
            name = f"step-{i}.png"
            tmp = os.path.join(out_dir, name + ".tmp.png")
            wr = vtk.vtkPNGWriter()
            wr.SetFileName(tmp)
            wr.SetInputConnection(rs.GetOutputPort())
            wr.Write()
            os.replace(tmp, os.path.join(out_dir, name))
            images.append(name)
        except Exception as e:  # one bad step must not lose the others
            images.append(None)
            errors.append(f"step {i}: {e}")
    try:
        win.Finalize()
    except Exception:
        pass
    print(json.dumps({"images": images, "errors": errors}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(json.dumps({"images": [], "errors": [str(e)]}))
        sys.exit(1)
