import cadquery as cq


def parts():
    # --- Climbing hold: large crack-style hold ---
    # Bigger body ~150x100mm, 3 bolt holes, 1" (25.4mm) wide crack, 2" (50.8mm) deep

    # Main body: large elliptical dome
    body = (
        cq.Workplane("XY")
        .ellipse(75, 50)
        .extrude(65)
    )

    # Dome the top with a large sphere
    dome = cq.Workplane("XY").sphere(85).translate((0, 0, 0))
    body = body.intersect(dome)

    # Flat bottom for printing and wall mounting
    flat_cut = (
        cq.Workplane("XY")
        .transformed(offset=(0, 0, -50))
        .rect(200, 150)
        .extrude(50)
    )
    body = body.cut(flat_cut)

    # Crack down the middle: 25.4mm wide (1"), 50.8mm deep (2"), runs full length
    crack = (
        cq.Workplane("XY")
        .transformed(offset=(0, 0, 85 - 50.8))
        .rect(25.4, 120)
        .extrude(60)
    )
    body = body.cut(crack)

    # Three bolt holes in a triangle pattern for 3/8"-16
    bolt_positions = [(0, 0), (-40, -20), (40, -20)]
    for bx, by in bolt_positions:
        bolt_hole = (
            cq.Workplane("XY")
            .transformed(offset=(bx, by, -1))
            .circle(10.5 / 2)
            .extrude(90)
        )
        body = body.cut(bolt_hole)
        # Counterbore from top for bolt head
        cbore = (
            cq.Workplane("XY")
            .transformed(offset=(bx, by, 60))
            .circle(22 / 2)
            .extrude(30)
        )
        body = body.cut(cbore)

    # Hollow out the bottom to save material (8mm walls — thick enough for climbing loads)
    wall = 8
    hollow = (
        cq.Workplane("XY")
        .transformed(offset=(0, 0, -1))
        .ellipse(75 - wall, 50 - wall)
        .extrude(50)
    )
    hollow_dome = cq.Workplane("XY").sphere(85 - wall).translate((0, 0, 0))
    hollow = hollow.intersect(hollow_dome)
    # Cut flat bottom of hollow
    hollow_flat = (
        cq.Workplane("XY")
        .transformed(offset=(0, 0, -50))
        .rect(200, 150)
        .extrude(50)
    )
    hollow = hollow.cut(hollow_flat)
    body = body.cut(hollow)

    # Fillet edges for comfort
    try:
        body = body.edges().fillet(2)
    except Exception:
        pass

    # Move so it sits on Z=0
    bb = body.val().BoundingBox()
    body = body.translate((0, 0, -bb.zmin))

    # --- T-nut dummies ---
    tnuts = []
    for i, (bx, by) in enumerate(bolt_positions):
        tnut = (
            cq.Workplane("XY")
            .transformed(offset=(bx, by, 0))
            .circle(11)
            .extrude(2)
            .faces(">Z").workplane(centerOption="CenterOfBoundBox")
            .circle(5)
            .extrude(10)
        )
        tnuts.append(tnut)

    # Union all t-nuts into one component shape
    tnut_all = tnuts[0]
    for t in tnuts[1:]:
        tnut_all = tnut_all.union(t)

    return [
        {
            "name": "Climbing Hold",
            "shape": body,
            "group": "case",
            "color": "#e8913a",
            "explode": [0, 0, 1],
        },
        {
            "name": "3/8\"-16 T-Nuts",
            "shape": tnut_all,
            "group": "component",
            "color": "#888888",
            "explode": [0, 0, -1],
        },
    ]
