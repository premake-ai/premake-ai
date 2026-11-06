// wires: the coloured wire tubes shared by the build steps player (web/assembly.js, wiring steps) and the Wiring view
// (web/wireview.js, every wire with pin labels). Pure three.js helpers, no DOM.
//  - WIRE_HEX / hexCss: true wire colours (red +V, black GND, ...), 0xb8b2a7 for an unknown colour.
//  - partBox(it): an item's geometry box (model coordinates, explode offset not included).
//  - faceEnds(ba, bb): the build steps' anchors: the nearest face point of each box towards the other, pulled in a little.
//  - bowCurve(pa, pb, j, n, R): the build steps' route: fanned sideways (bundles read as separate wires), arcing up.
//  - wireMesh(curve, opts): one tube (MeshBasic, never picked, userData.fx so captures leave it out).
import * as THREE from 'three';

export const WIRE_HEX = { red: 0xd93025, black: 0x26231f, white: 0xf2f1ee, yellow: 0xf4c20d, green: 0x1e8e3e, blue: 0x1a73e8, orange: 0xf57c00, purple: 0x8e44ad, brown: 0x795548, grey: 0x9e9e9e, gray: 0x9e9e9e, pink: 0xe91e63 };
export const NO_COLOR = 0xb8b2a7;
export const hexCss = c => '#' + (WIRE_HEX[c] ?? NO_COLOR).toString(16).padStart(6, '0');

export const partBox = it => { const g = it.cgeo || it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox; };
export const okBox = b => !!b && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite);

/** Nearest face point of each box towards the other one, pulled 18 % towards its own centre. */
export function faceEnds(ba, bb) {
  const ca = ba.getCenter(new THREE.Vector3()), cb = bb.getCenter(new THREE.Vector3());
  return [ba.clampPoint(cb, new THREE.Vector3()).lerp(ca, 0.18), bb.clampPoint(ca, new THREE.Vector3()).lerp(cb, 0.18)];
}

/** Wire j of n between the same two points: both ends fanned sideways, the middle arcing up (model Z is up). Moves pa / pb. */
export function bowCurve(pa, pb, j, n, R) {
  const d = pa.distanceTo(pb);
  const dir = pb.clone().sub(pa).normalize(), side = new THREE.Vector3(0, 0, 1).cross(dir); if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
  const fan = (j - (n - 1) / 2) * Math.max(0.9, R * 0.012);
  side.normalize().multiplyScalar(fan); pa.add(side); pb.add(side);
  const mid = pa.clone().add(pb).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, Math.min(R * 0.25, d * 0.3 + 4)));
  return new THREE.QuadraticBezierCurve3(pa, mid, pb);
}

/** opts: { color (hex), radius, opacity, onTop (no depth test), order, segments } */
export function wireMesh(curve, opts = {}) {
  const geo = new THREE.TubeGeometry(curve, opts.segments || 28, opts.radius, opts.radial || 6, false);
  const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? NO_COLOR, transparent: true, opacity: opts.opacity ?? 1, depthTest: !opts.onTop, depthWrite: false });
  if (opts.toneMapped === false) mat.toneMapped = false;
  if (opts.side) mat.side = opts.side;
  const m = new THREE.Mesh(geo, mat);
  m.raycast = () => {}; m.userData.fx = true; m.renderOrder = opts.order ?? 2;
  return m;
}
export function disposeMesh(m) { m.parent?.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
