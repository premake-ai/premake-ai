import cadquery as cq


def parts():
    # Phone stand: angled back support with a front lip/ledge
    # Dimensions
    width = 80        # stand width
    depth = 70        # base depth
    wall = 3          # wall thickness
    base_h = 5        # base plate height
    lip_h = 15        # front lip to hold phone bottom
    lip_depth = 12    # how far the lip extends
    back_h = 90       # back support height
    angle = 15        # lean-back angle in degrees from vertical

    import math
    rad = math.radians(angle)

    # Base plate
    base = (
        cq.Workplane("XY")
        .box(width, depth, base_h)
        .translate((0, 0, base_h / 2))
    )

    # Front lip — sits at the front edge of the base
    lip = (
        cq.Workplane("XY")
        .box(width, lip_depth, lip_h)
        .translate((0, -depth / 2 + lip_depth / 2, base_h + lip_h / 2))
    )

    # Back support — angled slab leaning back
    back_depth = wall
    back_support = (
        cq.Workplane("XY")
        .box(width, back_depth, back_h)
        .translate((0, 0, back_h / 2))
    )
    # Rotate to lean back, pivot at bottom-back edge
    back_support = (
        back_support
        .rotate((0, 0, 0), (1, 0, 0), -angle)
        .translate((0, depth / 2 - wall, base_h))
    )

    # Union everything
    stand = base.union(lip).union(back_support)

    # Try gentle fillets for strength/looks
    try:
        stand = stand.edges().fillet(1.5)
    except Exception:
        try:
            stand = stand.edges().fillet(0.8)
        except Exception:
            pass

    return [
        {
            "name": "Phone Stand",
            "shape": stand,
            "group": "case",
            "color": "#5b8c6e",
        }
    ]
