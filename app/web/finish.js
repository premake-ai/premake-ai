// Library-part sub-parts (manifest part.subparts: [{file, color, finish}]): one merged geometry per part with a
// per-vertex colour and a per-vertex (metalness, roughness) pair, so a part stays ONE mesh with ONE material (fades,
// ghost, see-through, picking and render mode keep working unchanged) while its PCB, gold pins, metal and plastic
// each look like themselves. Used by viewer.js (CAD look) and render.js (render mode).
import * as THREE from 'three';

/** finish -> [metalness, roughness] */
export const FINISHES = {
  pcb: [0.0, 0.42],      // solder mask: satin
  metal: [0.92, 0.34],   // steel, aluminium, brass, black oxide
  gold: [1.0, 0.24],     // header pins, pads
  plastic: [0.0, 0.58],
  rubber: [0.0, 0.92],
  glass: [0.0, 0.07],    // OLED glass, LED lenses
};
const fin = f => FINISHES[f] || FINISHES.plastic;

/** Merge sub-part STL geometries (non-indexed) into one with `color` and `pbr` attributes. subs: [{geo, color, finish}]. */
export function mergeSubparts(subs, colorFn = hex => new THREE.Color(hex)) {
  let n = 0;
  for (const s of subs) n += s.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), pbr = new Float32Array(n * 2);
  const ranges = [];
  let o = 0;
  for (const s of subs) {
    const p = s.geo.attributes.position, c = s.geo.attributes.position.count;
    pos.set(p.array.subarray(0, c * 3), o * 3);
    const [m, r] = fin(s.finish);
    for (let i = 0; i < c; i++) { pbr[(o + i) * 2] = m; pbr[(o + i) * 2 + 1] = r; }
    ranges.push({ start: o, count: c, color: s.color, finish: s.finish });
    o += c;
    s.geo.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('pbr', new THREE.BufferAttribute(pbr, 2));
  g.userData.ranges = ranges;
  recolor(g, colorFn);
  g.computeVertexNormals();
  return g;
}

/** (Re)write the colour attribute, e.g. after the CAD backdrop changed (display colours depend on it). */
export function recolor(g, colorFn = hex => new THREE.Color(hex)) {
  const a = g.attributes.color; if (!a) return;
  for (const r of g.userData.ranges || []) {
    const c = colorFn(r.color);
    for (let i = r.start; i < r.start + r.count; i++) a.setXYZ(i, c.r, c.g, c.b);
  }
  a.needsUpdate = true;
}

/** Make a MeshStandard/Physical material read metalness + roughness from the `pbr` vertex attribute. */
export function usePbrAttribute(mat) {
  mat.vertexColors = true;
  mat.color?.setRGB(1, 1, 1);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 pbr;\nvarying vec2 vPbr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = pbr;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPbr;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPbr.y;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.x;');
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|buildery-pbr-v1';
  mat.needsUpdate = true;
  return mat;
}

/** Render-mode material for a library part. */
export function subpartRenderMaterial() {
  return usePbrAttribute(new THREE.MeshPhysicalMaterial({ color: 0xffffff, side: THREE.DoubleSide, envMapIntensity: 1.0,
    clearcoat: 0.12, clearcoatRoughness: 0.4 }));
}
