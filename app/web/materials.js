// Real materials, visible engravings and decorative cables for the viewer (CAD look) and render mode (render.js).
//
// Manifest fields (all optional; CONTRACT: cadlib/build.py writes them, older designs fall back to name heuristics):
//   part.material  'acrylic_clear' | 'acrylic_frosted' | 'glass' | 'aluminium' | 'steel' | 'brass' | 'rubber' |
//                  'silicone' | 'pcb' | 'wood' | 'plywood' | 'pla' | 'petg'   (pla / petg = printed: the "As printed" look)
//   part.engrave   { text, face: '>Y', depth_mm, mode: 'engrave' | 'emboss' | 'cut', style: 'frosted' | 'lit' | 'burnt' | 'ink' }
//   part.cable / manifest.cables[]   { type: 'usb-c' | 'dc-barrel' | 'jst', at: [x,y,z], dir: [x,y,z], length_mm, color }
// Cables are decoration: not parts, not priced, not pickable. A design with none declared gets one when a USB-C board or
// a DC jack sits close enough to the outside of the case to plug into.
//
// Everything here is procedural (shader patterns in part-local CAD mm: grain, plies, brushed streaks, solder-mask traces):
// no textures, no UVs, no extra downloads. Acrylic / glass use real transmission (IOR 1.49) only in render mode on a
// desktop; the CAD view and phones use a cheap see-through material with a Fresnel edge tint.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PRESETS = {
  acrylic_clear: { label: 'Clear acrylic', clear: true },
  acrylic_frosted: { label: 'Frosted acrylic', clear: true },
  glass: { label: 'Glass', clear: true },
  aluminium: { label: 'Brushed aluminium' },
  steel: { label: 'Steel' },
  brass: { label: 'Brass' },
  rubber: { label: 'Rubber' },
  silicone: { label: 'Silicone' },
  pcb: { label: 'PCB' },
  wood: { label: 'Wood' },
  plywood: { label: 'Plywood' },
};
const ALIAS = { acrylic: 'acrylic_clear', clear_acrylic: 'acrylic_clear', frosted_acrylic: 'acrylic_frosted', perspex: 'acrylic_clear',
  aluminum: 'aluminium', alu: 'aluminium', stainless: 'steel', stainless_steel: 'steel', ply: 'plywood', mdf: 'wood', timber: 'wood' };
const PRINTED = new Set(['pla', 'petg', 'abs', 'asa', 'tpu', 'printed', 'plastic']);

/** Phones (and touch tablets) never get transmission: it re-renders the scene into an extra target every frame. */
export const isPhone = () => { try { return matchMedia('(max-width: 760px), (pointer: coarse)').matches; } catch { return false; } };

const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
function woody(hex) { // tan / brown / honey colours
  const hsl = new THREE.Color(hex || '#888').getHSL({});
  return hsl.h > 0.04 && hsl.h < 0.13 && hsl.s > 0.25 && hsl.l > 0.25 && hsl.l < 0.85;
}

/** Preset id for a part, or null (printed parts and library parts keep their own looks). */
export function inferMaterial(p, vc = false) {
  if (vc) return null; // library part: real per-vertex finishes already
  const raw = String(p.material || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (raw) {
    if (PRESETS[raw]) return raw;
    if (ALIAS[raw]) return ALIAS[raw];
    if (PRINTED.has(raw)) return null;
  }
  const n = String(p.name || '').toLowerCase(), comp = p.group === 'component';
  const proc = p.process || (comp ? 'bought' : 'print');
  if (proc === 'print') return null; // printed parts stay printed colour ("As printed" / "Smoothed")
  const c = new THREE.Color(p.color || '#888888');
  if (/plywood|\bply\b|birch/.test(n)) return 'plywood';
  if (/\bwood|oak|walnut|maple|bamboo|pine\b|\bmdf\b|dowel/.test(n)) return 'wood';
  if (/frosted|diffuser|opal/.test(n)) return 'acrylic_frosted'; // the name wins over the colour ("Opal acrylic fin" is cream)
  if (/acrylic|perspex|plexi|\bclear\b|\blens\b|window/.test(n)) return 'acrylic_clear';
  if (proc === 'laser' && woody(p.color)) return 'plywood'; // laser-cut, wood-coloured: sheet goods (a "Front rail" here is ply)
  if (/glass/.test(n)) return 'glass';
  if (/brass|heat.?set insert|\binsert\b/.test(n)) return 'brass';
  if (!comp && proc !== 'laser' && /extrusion|\brails?\b|alumin|\b(2020|2040|3030|4040)\b|v-?slot/.test(n)) return 'aluminium';
  if (comp && /alumin/.test(n)) return 'aluminium';
  if (/silicone/.test(n)) return 'silicone';
  if (/bumper|\bfeet\b|\bfoot\b|rubber|grommet|o-?ring/.test(n)) return 'rubber';
  if (comp && /esp32|arduino|\bpcb\b|supermini|\bboard\b|breakout|devkit|\bpico\b|wemos/.test(n)) return 'pcb';
  if (comp && /screw|bolt|\bnuts?\b|washer|standoff|threaded rod|stainless|steel/.test(n)) return 'steel';
  if (proc === 'extrusion') return 'aluminium';
  if (proc === 'sheet') return lum(c) < 0.08 ? 'steel' : 'aluminium';
  if (proc === 'laser') return woody(p.color) ? 'plywood' : 'acrylic_clear';
  return null;
}

// ---------------------------------------------------------------- procedural shading
const KIND = { wood: 1, plywood: 2, aluminium: 3, steel: 4, brass: 4, rubber: 5, silicone: 5, pcb: 6 };

const GLSL_NOISE = `
varying vec3 vMP; varying vec3 vMN;
uniform vec3 uAx; uniform vec3 uMid; uniform vec3 uTh; uniform float uPly; uniform float uSeed; uniform vec3 uTint;
float bmH(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float bmN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bmH(i), bmH(i + vec3(1,0,0)), f.x), mix(bmH(i + vec3(0,1,0)), bmH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bmH(i + vec3(0,0,1)), bmH(i + vec3(1,0,1)), f.x), mix(bmH(i + vec3(0,1,1)), bmH(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;
const FRAG_COLOR = {
  // wood: flat-sawn grain running along the part's long axis, fine fibres, darker latewood bands
  1: `{ float al = dot(vMP, uAx), ac = dot(vMP, uMid) + dot(vMP, uTh) * 0.35;
        float g = ac / 6.5 + 2.6 * bmN(vec3(al / 140.0, ac / 34.0, uSeed)) + 0.5 * bmN(vec3(al / 18.0, ac / 7.0, uSeed + 3.0));
        float r = fract(g); float band = smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.55, r);
        float fib = bmN(vec3(al / 2.5, ac * 1.4, uSeed + 7.0));
        diffuseColor.rgb *= mix(0.74, 1.05, band) * (0.93 + 0.1 * fib); }`,
  // plywood: wood faces + alternating plies on the cut edges
  2: `{ float al = dot(vMP, uAx), ac = dot(vMP, uMid);
        float face = smoothstep(0.55, 0.8, abs(dot(normalize(vMN), uTh)));
        float g = ac / 6.5 + 2.6 * bmN(vec3(al / 140.0, ac / 34.0, uSeed)) + 0.5 * bmN(vec3(al / 18.0, ac / 7.0, uSeed + 3.0));
        float r = fract(g); float band = smoothstep(0.0, 0.25, r) * smoothstep(1.0, 0.55, r);
        float fib = bmN(vec3(al / 2.5, ac * 1.4, uSeed + 7.0));
        vec3 faceC = diffuseColor.rgb * mix(0.8, 1.04, band) * (0.94 + 0.08 * fib);
        float pz = dot(vMP, uTh) / uPly; float ply = fract(pz);
        float alt = mod(floor(pz), 2.0);
        float glue = 1.0 - smoothstep(0.0, 0.07, ply) * smoothstep(1.0, 0.93, ply);
        vec3 edgeC = diffuseColor.rgb * mix(0.86, 1.0, alt) * (1.0 - 0.35 * glue) * (0.95 + 0.08 * bmN(vec3(al / 2.0, pz * 3.0, 5.0)));
        diffuseColor.rgb = mix(edgeC, faceC, face); }`,
  // brushed metal: fine streaks along the long axis
  3: `{ float al = dot(vMP, uAx); vec2 ac = vec2(dot(vMP, uMid), dot(vMP, uTh));
        float s = bmN(vec3(al / 40.0, ac * 9.0)) * 0.6 + bmN(vec3(al / 160.0, ac * 2.5 + 11.0)) * 0.4;
        diffuseColor.rgb *= 0.93 + 0.1 * s; }`,
  4: `{ float s = bmN(vMP * 1.7); diffuseColor.rgb *= 0.95 + 0.07 * s; }`,
  5: `{ float s = bmN(vMP * 2.2 + uSeed); diffuseColor.rgb *= 0.94 + 0.1 * s; }`,
  // PCB: solder-mask with copper traces under it and the odd gold via (on the board faces only)
  6: `{ float face = smoothstep(0.75, 0.95, abs(dot(normalize(vMN), uTh)));
        vec2 g = vec2(dot(vMP, uAx), dot(vMP, uMid)) / 1.27; vec2 ci = floor(g), cf = fract(g);
        float h = bmH(vec3(ci, 3.0)), tr = 0.0;
        if (h > 0.58) tr = 1.0 - smoothstep(0.07, 0.14, abs(cf.y - 0.5));
        else if (h > 0.3) tr = 1.0 - smoothstep(0.07, 0.14, abs(cf.x - 0.5));
        float via = (1.0 - smoothstep(0.12, 0.2, length(cf - 0.5))) * step(0.94, bmH(vec3(ci, 9.0)));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.45 + vec3(0.015), tr * 0.55 * face);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.62, 0.28), via * face); }`,
};
const FRAG_ROUGH = {
  1: 'roughnessFactor = clamp(roughnessFactor + 0.08 * (bmN(vMP * 0.9) - 0.5), 0.0, 1.0);',
  2: 'roughnessFactor = clamp(roughnessFactor + 0.08 * (bmN(vMP * 0.9) - 0.5), 0.0, 1.0);',
  3: '{ float al = dot(vMP, uAx); vec2 ac = vec2(dot(vMP, uMid), dot(vMP, uTh)); roughnessFactor = clamp(roughnessFactor * (0.72 + 0.6 * bmN(vec3(al / 30.0, ac * 11.0))), 0.04, 1.0); }',
  4: 'roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * bmN(vMP * 3.1)), 0.04, 1.0);',
  5: 'roughnessFactor = clamp(roughnessFactor + 0.1 * (bmN(vMP * 4.0) - 0.5), 0.0, 1.0);',
};
// cheap see-through acrylic / glass: more opaque and edge-tinted at grazing angles (the lit edge of a real panel)
const FRAG_FRESNEL = `
  { float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 2.4);
    gl_FragColor.a = clamp(gl_FragColor.a + fr * 0.6, 0.0, 1.0);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, uTint, fr * 0.4); }`;

/** Patch a MeshStandard/Physical material with the procedural pattern `kind` (KIND) and/or the Fresnel see-through. */
function procedural(mat, kind, axes, { fresnel = false, tint = '#cfe8ff', seed = 0 } = {}) {
  const u = {
    uAx: { value: axes.ax }, uMid: { value: axes.mid }, uTh: { value: axes.th },
    uPly: { value: axes.ply || 1.2 }, uSeed: { value: seed }, uTint: { value: new THREE.Color(tint) },
  };
  mat.userData.bm = u;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMP; varying vec3 vMN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMP = transformed; vMN = objectNormal;');
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_NOISE);
    if (FRAG_COLOR[kind]) f = f.replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR[kind]);
    if (FRAG_ROUGH[kind]) f = f.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAG_ROUGH[kind]);
    if (fresnel) f = f.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + FRAG_FRESNEL);
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `buildery-mat-${kind}-${fresnel ? 1 : 0}`;
  return mat;
}

/** Long / middle / thin axes of a geometry's bbox (unit vectors in part-local CAD mm) and its thickness. */
function axesOf(geo) {
  if (!geo.boundingBox) geo.computeBoundingBox();
  const s = new THREE.Vector3(); geo.boundingBox.getSize(s);
  const o = [0, 1, 2].sort((a, b) => s.getComponent(b) - s.getComponent(a));
  const unit = i => new THREE.Vector3().setComponent(i, 1);
  return { ax: unit(o[0]), mid: unit(o[1]), th: unit(o[2]), thIdx: o[2], t: s.getComponent(o[2]), ply: plyOf(s.getComponent(o[2])) };
}
function plyOf(t) { const n = Math.max(3, Math.round(t / 1.3)) | 1; return t / n; } // odd ply count, ~1.3 mm plies

const P = o => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, ...o });

/**
 * Material for preset `id`. mode: 'cad' (CAD viewport) | 'render' (studio). color: the part's colour (hex).
 * Returns { mat, base } where base is the resting { transparent, opacity, depthWrite } or null for an opaque material.
 */
function makeMaterial(id, color, axes, mode, seed) {
  const own = new THREE.Color(color || '#888888'), L = lum(own), render = mode === 'render', phone = isPhone();
  const env = render ? 1 : 0.9;
  if (id === 'acrylic_clear' || id === 'acrylic_frosted' || id === 'glass') {
    const frosted = id === 'acrylic_frosted', glass = id === 'glass';
    if (L < 0.06 && !glass) { // black / very dark acrylic: opaque, glossy
      return { mat: P({ color: own.clone().lerp(new THREE.Color('#2a2c30'), 0.4), roughness: frosted ? 0.4 : 0.08, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: env }), base: null };
    }
    const tint = own.clone().lerp(new THREE.Color('#ffffff'), glass ? 0.7 : 0.45);
    const edge = own.clone().lerp(new THREE.Color(glass ? '#bfe7d6' : '#9fd8ff'), 0.5);
    if (render && !phone) { // real refraction (render.js sets an opaque clear colour so the transmission buffer has the backdrop)
      const mat = procedural(P({
        // opal / frosted: a milky diffuser (mostly scattered, a little see-through), not a blurred window
        color: frosted ? tint.clone().lerp(new THREE.Color('#ffffff'), 0.5) : 0xffffff, metalness: 0, roughness: frosted ? 0.6 : 0.04,
        transmission: frosted ? 0.45 : 1, ior: glass ? 1.52 : 1.49,
        thickness: Math.max(1, axes.t), attenuationColor: tint, attenuationDistance: frosted ? 18 : 30, specularIntensity: 1,
        clearcoat: frosted ? 0 : 0.6, clearcoatRoughness: 0.03, envMapIntensity: 1.6, side: THREE.FrontSide,
      }), 0, axes, { fresnel: true, tint: edge });
      return { mat, base: null, transmissive: true };
    }
    const op = frosted ? 0.62 : glass ? 0.2 : 0.26;
    const mat = procedural(P({
      color: frosted ? tint.clone().lerp(new THREE.Color('#ffffff'), 0.4) : tint, roughness: frosted ? 0.55 : 0.05, metalness: 0,
      clearcoat: frosted ? 0 : 1, clearcoatRoughness: 0.04, specularIntensity: 1, envMapIntensity: 1.1,
      transparent: true, opacity: op, depthWrite: false,
    }), 0, axes, { fresnel: true, tint: edge });
    return { mat, base: { transparent: true, opacity: op, depthWrite: false } };
  }
  const k = KIND[id];
  if (id === 'aluminium') return { mat: procedural(P({ color: '#c9ced4', metalness: 1, roughness: 0.34, envMapIntensity: env * 1.1 }), k, axes, { seed }), base: null };
  if (id === 'steel') return { mat: procedural(P({ color: L < 0.1 ? '#3b3e43' : '#b9bec4', metalness: 1, roughness: L < 0.1 ? 0.42 : 0.3, envMapIntensity: env }), k, axes, { seed }), base: null };
  if (id === 'brass') return { mat: procedural(P({ color: '#c9a24b', metalness: 1, roughness: 0.3, envMapIntensity: env }), k, axes, { seed }), base: null };
  if (id === 'rubber') return { mat: procedural(P({ color: L > 0.2 ? own.clone().multiplyScalar(0.35) : '#1d1e20', roughness: 0.9, metalness: 0, sheen: 0.4, sheenRoughness: 0.9, sheenColor: new THREE.Color('#3a3c40'), envMapIntensity: 0.4 }), k, axes, { seed }), base: null };
  if (id === 'silicone') return { mat: procedural(P({ color: own, roughness: 0.55, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: own.clone().lerp(new THREE.Color('#ffffff'), 0.5), clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.6 }), k, axes, { seed }), base: null };
  if (id === 'pcb') {
    const hsl = own.getHSL({}), mask = hsl.l < 0.12 ? new THREE.Color('#15171a') : (hsl.h > 0.2 && hsl.h < 0.5) || hsl.s < 0.15 ? new THREE.Color('#1f5a34') : own;
    return { mat: procedural(P({ color: mask, roughness: 0.42, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.3, envMapIntensity: env * 0.8 }), k, axes, { seed }), base: null };
  }
  if (id === 'wood' || id === 'plywood') {
    const c = woody(color) ? own : new THREE.Color('#d2a679');
    return { mat: procedural(P({ color: c, roughness: 0.72, metalness: 0, clearcoat: render ? 0.12 : 0, clearcoatRoughness: 0.6, sheen: 0.2, sheenRoughness: 0.8, sheenColor: c.clone().multiplyScalar(0.4), envMapIntensity: render ? 0.55 : 0.35 }), k, axes, { seed }), base: null };
  }
  return null;
}

// ---------------------------------------------------------------- engravings
/**
 * Triangles of an engraving / embossing / sealed inner marking. Thin plates (no face given): the two biggest flat levels
 * along the thin axis are the skins; a triangle is marked when it is not on one skin and does not run skin to skin
 * (outline walls and through holes do). With engrave.face ('>Y', '<Z' ...): triangles within depth of that face.
 * Returns a Uint32Array of triangle indices (may be empty).
 */
function engraveAxis(geo, eng) {
  const face = typeof eng.face === 'string' ? eng.face.match(/^([<>])\s*([XYZ])$/i) : null;
  return face ? 'XYZ'.indexOf(face[2].toUpperCase()) : axesOf(geo).thIdx;
}
export function engravedTriangles(geo, eng = {}) {
  const pos = geo.attributes.position, n = pos.count / 3 | 0;
  if (!n || n > 600000) return new Uint32Array(0);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, face = typeof eng.face === 'string' ? eng.face.match(/^([<>])\s*([XYZ])$/i) : null;
  const axis = engraveAxis(geo, eng);
  const get = (i, a) => a === 0 ? pos.getX(i) : a === 1 ? pos.getY(i) : pos.getZ(i);
  const tol = 0.03, out = [];
  const nrm = (t) => { // |normal . axis| of triangle t
    const a = new THREE.Vector3().fromBufferAttribute(pos, t * 3), b = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
    const nn = b.sub(a).cross(c.sub(a)); const l = nn.length(); return l > 1e-12 ? Math.abs(nn.getComponent(axis)) / l : 0;
  };
  const shapeOk = t => { const k = nrm(t); return k > 0.995 || k < 0.12; }; // floors parallel to the face, walls square to it
  if (face) {
    const sgn = face[1] === '>' ? 1 : -1, F = sgn > 0 ? bb.max.getComponent(axis) : bb.min.getComponent(axis);
    const d = Math.max(0.2, Number(eng.depth_mm) || 1) + 0.06, emboss = eng.mode === 'emboss';
    for (let t = 0; t < n; t++) {
      let inBand = true, allTop = true, allBase = true;
      for (let k = 0; k < 3; k++) {
        const dz = (F - get(t * 3 + k, axis)) * sgn; // depth below the face
        if (dz < -tol || dz > d) inBand = false;
        if (Math.abs(dz) > tol) allTop = false;
        if (Math.abs(dz - (d - 0.06)) > tol) allBase = false;
      }
      if (!inBand || !shapeOk(t)) continue;
      if (emboss ? allBase : allTop) continue; // the face itself (engrave) / the surface the text stands on (emboss)
      out.push(t);
    }
    return new Uint32Array(out);
  }
  // thin plate: skins = the two flat levels with the most area along the thin axis
  const area = new Map(), q = v => Math.round(v / 0.02);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    A.fromBufferAttribute(pos, t * 3); B.fromBufferAttribute(pos, t * 3 + 1); C.fromBufferAttribute(pos, t * 3 + 2);
    const za = A.getComponent(axis), zb = B.getComponent(axis), zc = C.getComponent(axis);
    if (Math.abs(za - zb) > tol || Math.abs(za - zc) > tol) continue;
    const ar = B.clone().sub(A).cross(C.clone().sub(A)).length() / 2, key = q(za);
    area.set(key, (area.get(key) || 0) + ar);
  }
  const lv = [...area.entries()].sort((a, b) => b[1] - a[1]);
  if (lv.length < 2) return new Uint32Array(0);
  const s0 = Math.min(lv[0][0], lv[1][0]) * 0.02, s1 = Math.max(lv[0][0], lv[1][0]) * 0.02;
  if (s1 - s0 < 0.5) return new Uint32Array(0);
  for (let t = 0; t < n; t++) {
    let on0 = 0, on1 = 0;
    for (let k = 0; k < 3; k++) { const z = get(t * 3 + k, axis); if (Math.abs(z - s0) < tol) on0++; if (Math.abs(z - s1) < tol) on1++; }
    if (on0 === 3 || on1 === 3 || (on0 && on1)) continue;
    if (!shapeOk(t)) continue;
    out.push(t);
  }
  return new Uint32Array(out);
}

/** [floor material, wall material] for an engraving: the walls a shade darker so the letters keep a crisp outline. */
function engraveMaterials(style, color) {
  const off = { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const lit = style === 'lit';
  if (style === 'frosted' || lit) {
    const glow = new THREE.Color(color || '#8fd0ff');
    return [
      new THREE.MeshStandardMaterial({ color: '#eef7ff', roughness: 0.92, metalness: 0, emissive: glow, emissiveIntensity: lit ? 0.85 : 0.22, ...off }),
      new THREE.MeshStandardMaterial({ color: '#a9bfd0', roughness: 0.6, metalness: 0, emissive: glow, emissiveIntensity: lit ? 0.35 : 0.05, ...off }),
    ];
  }
  const c = style === 'burnt' ? new THREE.Color('#3a2414') : style === 'etched' ? new THREE.Color('#8d939a') : new THREE.Color(color || '#1b1b1d');
  const mk = k => new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(k), roughness: style === 'etched' ? 0.7 : 0.9, metalness: style === 'etched' ? 0.6 : 0, ...off });
  return [mk(1), mk(0.7)];
}

function addEngraving(v, it, id) {
  const eng = it.p.engrave && typeof it.p.engrave === 'object' ? it.p.engrave : it.p.engrave ? {} : null;
  const clear = id && PRESETS[id]?.clear;
  if (!eng && !(clear && it.p.process === 'laser' && lum(new THREE.Color(it.p.color || '#fff')) >= 0.06)) return; // auto: light laser-cut clear panels only
  if (eng?.mode === 'cut') return; // through-cut text shows as holes already
  const geo = it.mesh.geometry, tris = engravedTriangles(geo, eng || {});
  if (!tris.length) return;
  const src = geo.attributes.position, nsrc = geo.attributes.normal, axis = engraveAxis(geo, eng || {});
  const floor = t => { // triangle parallel to the face (letter floor / emboss top) rather than a wall
    const a = new THREE.Vector3().fromBufferAttribute(src, t * 3), b = new THREE.Vector3().fromBufferAttribute(src, t * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(src, t * 3 + 2);
    const nn = b.sub(a).cross(c.sub(a)); return Math.abs(nn.getComponent(axis)) > 0.9 * nn.length();
  };
  const order = [...tris].sort((x, y) => floor(y) - floor(x)), nFloor = order.filter(floor).length;
  const pos = new Float32Array(order.length * 9), nor = new Float32Array(order.length * 9);
  order.forEach((t, j) => { for (let k = 0; k < 9; k++) { pos[j * 9 + k] = src.array[t * 9 + k]; if (nsrc) nor[j * 9 + k] = nsrc.array[t * 9 + k]; } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nsrc) g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); else g.computeVertexNormals();
  g.addGroup(0, nFloor * 3, 0); g.addGroup(nFloor * 3, (order.length - nFloor) * 3, 1);
  const style = eng?.style && eng.style !== 'auto' ? eng.style
    : clear ? 'frosted' : id === 'wood' || id === 'plywood' ? 'burnt'
    : id === 'aluminium' || id === 'steel' || id === 'brass' ? 'etched' : 'ink';
  const mats = engraveMaterials(style, eng?.color);
  const m = new THREE.Mesh(g, mats);
  m.userData.engraving = true; m.raycast = () => {}; m.renderOrder = 1;
  m.userData.autoClear = clear && style === 'frosted' && !(eng?.style && eng.style !== 'auto'); // dressScene: lit when the design has LEDs
  m.onBeforeRender = () => { // follow the part's fades, ghost and see-through (relative to its resting opacity)
    const pm = it.mesh.material; if (!pm) return;
    const rest = pm === it.mat ? (it.look?.cadBase?.opacity ?? 1) : (it.look?.renderBase?.opacity ?? 1);
    const want = pm.transparent ? Math.min(1, (pm.opacity ?? 1) / rest) : 1;
    for (const mat of mats) if (Math.abs(mat.opacity - want) > 1e-3) { mat.opacity = want; const tr = want < 0.999; if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; } }
  };
  it.mesh.add(m);
  it.engraving = m;
  it.p.engraved = style;
}

// ---------------------------------------------------------------- viewer hooks
/** viewer.load hook (per part, after the CAD mesh exists): swap in the preset material and add any engraving. */
export function dressItem(v, it) {
  try {
    const id = inferMaterial(it.p, it.vc);
    if (id) {
      const geo = it.mesh.geometry, axes = axesOf(geo), seed = (hashStr(it.p.name) % 97) / 9.7;
      const m = makeMaterial(id, it.p.color, axes, 'cad', seed);
      if (m) {
        it.mat.dispose();
        it.mat = m.mat; it.mesh.material = m.mat;
        const look = it.look = {
          id, label: PRESETS[id].label, axes, seed, cadBase: m.base,
          base: ghost => m.base ? (ghost ? { transparent: true, opacity: Math.min(0.18, m.base.opacity), depthWrite: false } : { ...m.base }) : null,
          tint: backdrop => tintLook(v, it, backdrop),
          renderMat: studio => renderLook(studio, it),
          applyRender: studio => applyRenderLook(studio, it),
        };
        it.p.finish = look.label; it.p.material_shown = id;
        tintLook(v, it, v.backdrop);
        if (m.base) { it.mat.transparent = m.base.transparent; it.mat.opacity = m.base.opacity; it.mat.depthWrite = m.base.depthWrite; }
      }
    }
    if (!it.vc) addEngraving(v, it, id);
    it.mesh.addEventListener('removed', () => {
      if (it.mesh.parent) return;
      for (const c of [...it.mesh.children]) if (c.userData.engraving || c.userData.cable) { it.mesh.remove(c); disposeTree(c); }
    });
  } catch (e) { console.warn('materials: could not dress', it.p?.name, e); }
}

function tintLook(v, it, backdrop) {
  const L = it.look, m = it.mat;
  if (L.id === 'wood' || L.id === 'plywood' || L.id === 'silicone' || (PRESETS[L.id].clear && m.transparent)) {
    const c = L.id === 'wood' || L.id === 'plywood' ? (woody(it.p.color) ? new THREE.Color(it.p.color) : new THREE.Color('#d2a679'))
      : PRESETS[L.id].clear ? new THREE.Color(it.p.color).lerp(new THREE.Color('#ffffff'), L.id === 'glass' ? 0.7 : 0.45) : new THREE.Color(it.p.color);
    m.color.copy(c);
  }
  const shown = m.color.clone();
  if (it.edges) {
    const clear = PRESETS[L.id].clear && m.transparent;
    it.edges.material.color.copy(clear ? (backdrop === 'light' ? new THREE.Color('#7f9fb5') : new THREE.Color('#cfe8ff')) : shown.clone().multiplyScalar(backdrop === 'light' ? 0.35 : 0.5));
  }
  return shown;
}

/** viewer.apply hook: clear parts keep their see-through resting state (apply() puts case parts back to opaque). */
export function lookApply(v) {
  for (const it of v.items) {
    if (!it.look?.cadBase || it.anim || it.p.group === 'component') continue;
    const b = it.look.base(v.ui.ghost);
    it.mat.transparent = b.transparent; it.mat.opacity = b.opacity; it.mat.depthWrite = b.depthWrite; it.mat.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- render mode hooks (render.js)
function renderLook(studio, it) {
  const L = it.look, m = makeMaterial(L.id, colorFor(studio, it), L.axes, 'render', L.seed);
  if (!m) return null;
  L.renderBase = m.base; L.transmissive = !!m.transmissive;
  if (m.base) Object.assign(m.mat, m.base);
  return m.mat;
}
function colorFor(studio, it) { return studio.opts.colors?.parts?.[it.p.name] || it.p.color; } // filament "all" is for printed parts
function applyRenderLook(studio, it) {
  const L = it.look, m = it.rmat; if (!m) return;
  const hex = colorFor(studio, it);
  if (L.id === 'wood' || L.id === 'plywood') { if (woody(hex)) m.color.set(hex); }
  else if (PRESETS[L.id].clear) {
    const tint = new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), L.id === 'glass' ? 0.7 : 0.45);
    if (m.transmission) m.attenuationColor.copy(tint); else if (m.transparent) m.color.copy(tint);
  } else if (L.id === 'silicone') m.color.set(hex);
}

/** Render mode on / look change: transmission samples a buffer cleared to the renderer's clear colour (three r160 uses a
 * half-transparent white when the canvas is transparent), so give it the backdrop colour while render mode is on. */
export function lookStudio(studio, on) {
  const r = studio.v.renderer;
  if (on && studio.v.items.some(it => it.look?.transmissive)) {
    const bg = studio.v.scene.background;
    if (bg?.isColor) { r.setClearColor(bg, 1); studio._lookClear = true; }
  } else if (studio._lookClear) { r.setClearColor(0x000000, 0); studio._lookClear = false; }
}

// ---------------------------------------------------------------- cables
const CABLE = {
  'usb-c': { r: 1.9, color: '#1c1d20' },
  'dc-barrel': { r: 2.3, color: '#18191b' },
  jst: { r: 0.55, color: '#c8312a' },
};
const cableMat = (hex, rough = 0.5) => new THREE.MeshPhysicalMaterial({ color: hex, roughness: rough, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4, envMapIntensity: 0.6 });
const metalMat = () => new THREE.MeshPhysicalMaterial({ color: '#c9ccd1', metalness: 1, roughness: 0.28, envMapIntensity: 1 });

/** Part-local frame for a plug: y = out of the port (dir), x = the socket's long side (`wide`, from the board's own
 * placement: a board on edge or upside down rolls the plug with it; else horizontal across), z = the thin side. */
function plugBasis(d, wide) {
  let x = null;
  if (wide) { x = new THREE.Vector3(...wide); x.addScaledVector(d, -x.dot(d)); if (x.lengthSq() < 1e-4) x = null; }
  if (!x) x = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1));
  if (x.lengthSq() < 1e-4) x.set(1, 0, 0); x.normalize();
  const z = new THREE.Vector3().crossVectors(x, d).normalize();
  return new THREE.Matrix4().makeBasis(x, d, z);
}

/** One cable: plug in the port at `at` (CAD mm), pointing out along `dir`, out of the case, then a soft run on the desk.
 * env (optional): { box: the case's Box3, hit(origin, dir, far) -> distance to case geometry or null } routes the wire
 * through the opening in front of the port (or straight out of that face) before it drops to the desk. */
export function buildCable(spec, floorZ, centre, env = null) {
  const type = CABLE[spec.type] ? spec.type : 'usb-c', C = CABLE[type];
  const at = new THREE.Vector3(...spec.at), d = new THREE.Vector3(...(spec.dir || [1, 0, 0])).normalize();
  const g = new THREE.Group(); g.userData.cable = true;
  const basis = plugBasis(d, vec3(spec.wide) ? spec.wide : null), col = spec.color || C.color;
  const place = (geo, mat, along) => { const m = new THREE.Mesh(geo, mat); m.applyMatrix4(basis); m.position.add(at).addScaledVector(d, along); g.add(m); return m; };
  let tail; // distance from `at` to where the wire leaves the plug
  if (type === 'usb-c') {
    place(new RoundedBoxGeometry(8.2, 6.5, 2.5, 2, 1.1), metalMat(), -3.0);         // metal shell, in the port
    place(new RoundedBoxGeometry(11.5, 20, 6.2, 3, 2.4), cableMat(col, 0.42), 10.2); // overmold
    place(new THREE.CylinderGeometry(C.r * 1.25, 3.0, 7, 20), cableMat(col, 0.5), 23.5); // strain relief
    tail = 27;
  } else if (type === 'dc-barrel') {
    place(new THREE.CylinderGeometry(2.75, 2.75, 9.5, 24), metalMat(), -4.5);
    place(new THREE.CylinderGeometry(4.6, 4.6, 18, 28), cableMat(col, 0.45), 9);
    place(new THREE.CylinderGeometry(C.r * 1.3, 3.6, 8, 20), cableMat(col, 0.5), 22);
    tail = 26;
  } else { // JST-PH style housing with two thin wires
    place(new THREE.BoxGeometry(6, 6, 4.5), new THREE.MeshPhysicalMaterial({ color: '#efe9da', roughness: 0.55, envMapIntensity: 0.5 }), 3);
    tail = 6;
  }
  const r = C.r, floor = floorZ + r;
  const s = at.clone().addScaledVector(d, tail);
  const route = routeOut(at, d, s, tail, centre, env);
  const pts = [s.clone(), ...route.pts];
  const hd = route.hd, o = pts[pts.length - 1]; // o: just outside the case; hd: horizontal, away from it
  const side = new THREE.Vector3(-hd.y, hd.x, 0), h = Math.max(0, o.z - floor);
  if (pts.length === 1) pts.push(s.clone().addScaledVector(d, Math.min(18, 6 + h * 0.15)));
  const len = Math.min(2000, Math.max(80, Number(spec.length_mm) || 450));
  const q = pts[pts.length - 1];
  const drop = q.clone().addScaledVector(hd, 16 + h * 0.4); drop.z = floor + h * 0.32; pts.push(drop);
  const land = q.clone().addScaledVector(hd, 28 + h * 0.7); land.z = floor; pts.push(land);
  let used = 0; for (let i = 1; i < pts.length; i++) used += pts[i].distanceTo(pts[i - 1]);
  const run = Math.max(30, len - used);
  const sway = (k, a) => land.clone().addScaledVector(hd, run * k).addScaledVector(side, a);
  pts.push(sway(0.45, run * 0.16), sway(1.0, -run * 0.05));
  for (const p of pts) p.z = Math.max(p.z, floor); // never under the desk
  for (let i = pts.length - 1; i > 0; i--) if (pts[i].distanceTo(pts[i - 1]) < 1) pts.splice(i, 1); // no repeated points
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const segs = isPhone() ? 90 : 160, radial = isPhone() ? 8 : 12;
  if (type === 'jst') {
    for (const [off, hex] of [[-0.65, '#c8312a'], [0.65, '#1b1b1d']]) {
      const c2 = new THREE.CatmullRomCurve3(pts.map((p, i) => { const q = p.clone(); const sd = i === 0 ? new THREE.Vector3().setFromMatrixColumn(basis, 0) : side; return q.addScaledVector(sd, off); }), false, 'centripetal', 0.5);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(c2, segs, r, radial, false), cableMat(hex, 0.45)));
    }
  } else {
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, radial, false), cableMat(col, 0.5)));
  }
  g.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = true; o.userData.cable = true; } });
  g.userData.route = route.how; // 'free' | 'opening' | 'offset-opening' | 'through-wall' | 'over-top' | 'down' (tests)
  return g;
}

/** Path from the plug's tail `s` to just outside the case, and the horizontal heading away from it. */
function routeOut(at, d, s, tail, centre, env) {
  const flat = v => { const q = new THREE.Vector3(v.x, v.y, 0); return q.lengthSq() < 1e-6 ? null : q.normalize(); };
  const box = env?.box && !env.box.isEmpty() ? env.box : null;
  const nearestSide = p => { // horizontal way out of the case box from p: its nearest side
    if (!box) return flat(new THREE.Vector3(p.x - centre.x, p.y - centre.y, 0)) || new THREE.Vector3(1, 0, 0);
    const c = [[box.max.x - p.x, 1, 0], [p.x - box.min.x, -1, 0], [box.max.y - p.y, 0, 1], [p.y - box.min.y, 0, -1]].sort((a, b) => a[0] - b[0])[0];
    return new THREE.Vector3(c[1], c[2], 0);
  };
  const exitDist = (p, u, margin) => { // distance along unit u from p out of the case box (+ margin); 0 when already out
    if (!box || !box.containsPoint(p)) return 0;
    let t = Infinity;
    for (const k of ['x', 'y', 'z']) { if (Math.abs(u[k]) < 1e-6) continue; t = Math.min(t, ((u[k] > 0 ? box.max[k] : box.min[k]) - p[k]) / u[k]); }
    return Number.isFinite(t) ? Math.max(0, t) + margin : 0;
  };
  if (d.z > 0.7) { // pointing up: out of the top, over the nearest side, then down
    const hd = nearestSide(s), top = s.clone(); top.z = Math.max(s.z + 6, box ? box.max.z + 10 : 0);
    const over = top.clone().addScaledVector(hd, 14);
    if (box) over.addScaledVector(hd, exitDist(new THREE.Vector3(over.x, over.y, box.max.z - 0.01), hd, 10));
    return { pts: [top, over], hd, how: 'over-top' };
  }
  let hd = flat(d);
  if (!hd || d.z < -0.7) { // pointing down: along the desk to the nearest side
    hd = nearestSide(s);
    const k = exitDist(s, hd, 10);
    return { pts: k ? [s.clone().addScaledVector(hd, k)] : [], hd, how: 'down' };
  }
  const k = exitDist(s, d, 9);
  const out = (o = s) => k ? [o.clone().addScaledVector(d, Math.min(8, k * 0.5)), o.clone().addScaledVector(d, k)] : [];
  if (!box || !env.hit) return { pts: out(), hd, how: 'free' };
  const far = tail + k + 4, o0 = at.clone().addScaledVector(d, 0.6);
  if (env.hit(o0, d, far) == null) return { pts: out(), hd, how: k ? 'opening' : 'free' };
  // the port faces a wall: the nearest opening in front of it (a slot a little off the connector's axis)
  const e1 = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 0, 1)).normalize(), e2 = new THREE.Vector3().crossVectors(e1, d).normalize();
  const offs = [];
  for (let a = -18; a <= 18; a += 3) for (let b = -18; b <= 18; b += 3) if (a || b) offs.push([a, b]);
  offs.sort((p, q) => (p[0] ** 2 + p[1] ** 2) - (q[0] ** 2 + q[1] ** 2));
  for (const [a, b] of offs) {
    const o = o0.clone().addScaledVector(e1, a).addScaledVector(e2, b);
    if (!box.containsPoint(o) || env.hit(o, d, far) != null) continue;
    const w = s.clone().addScaledVector(e1, a).addScaledVector(e2, b);
    return { pts: [s.clone().addScaledVector(d, 4).addScaledVector(e1, a * 0.6).addScaledVector(e2, b * 0.6), w.addScaledVector(d, k)], hd, how: 'offset-opening' };
  }
  return { pts: out(), hd, how: 'through-wall' }; // no opening: straight out of that face
}

const RX_JACK = /dc.*jack|barrel|power jack|dc.?in\b|5\.5\s*[x×]\s*2\.1/i;
const RX_USB = /usb.?c\b|type.?c|supermini|esp32|arduino|\bpico\b|devkit|wemos|d1 mini|xiao/i;
const RX_USB_PANEL = /(usb|type.?c).*(panel|extension|bulkhead|socket|receptacle)|(panel|bulkhead).*(usb|type.?c)/i;

/** Guess a cable from part names + boxes: a DC jack or a USB board whose port end is near the outside of the case. */
export function inferCable(v) {
  const geoBox = it => { const g = it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox; };
  const cases = v.items.filter(it => it.p.group !== 'component');
  if (!cases.length) return null;
  const A = new THREE.Box3(); for (const it of cases) A.union(geoBox(it));
  const pick = (rx) => v.items.filter(it => rx.test(it.p.name));
  for (const it of pick(RX_JACK)) {
    const b = geoBox(it), c = b.getCenter(new THREE.Vector3());
    let best = null;
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
      const dist = sgn > 0 ? A.max.getComponent(ax) - b.max.getComponent(ax) : b.min.getComponent(ax) - A.min.getComponent(ax);
      if (!best || dist < best.dist) best = { ax, sgn, dist };
    }
    if (best.dist > 30) continue;
    const at = c.clone(); at.setComponent(best.ax, best.sgn > 0 ? A.max.getComponent(best.ax) : A.min.getComponent(best.ax));
    const dir = [0, 0, 0]; dir[best.ax] = best.sgn;
    return { type: 'dc-barrel', at: at.toArray(), dir, length_mm: 520, part: it.p.name, auto: true };
  }
  // a panel-mount USB socket / extension in the case wall is where the cable goes (the board inside connects to it)
  for (const it of v.items.filter(it => RX_USB_PANEL.test(it.p.name || ''))) {
    const port = boardPort(it);
    if (port) return { type: 'usb-c', at: port.at, dir: port.dir, wide: port.wide, length_mm: 480, part: it.p.name, item: it, auto: true };
    const b = geoBox(it), c = b.getCenter(new THREE.Vector3());
    let near = null;
    for (const [ax, sgn] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
      const dist = sgn > 0 ? A.max.getComponent(ax) - b.max.getComponent(ax) : b.min.getComponent(ax) - A.min.getComponent(ax);
      if (!near || dist < near.dist) near = { ax, sgn, dist };
    }
    if (near.dist > 15) continue;
    const at = c.clone(); at.setComponent(near.ax, near.sgn > 0 ? b.max.getComponent(near.ax) : b.min.getComponent(near.ax));
    const dir = [0, 0, 0]; dir[near.ax] = near.sgn;
    return { type: 'usb-c', at: at.toArray(), dir, length_mm: 480, part: it.p.name, item: it, auto: true };
  }
  // a board's real connector (build port or its metal shell), the one nearest the outside of the case
  let best = null;
  for (const it of v.items) {
    const port = boardPort(it); if (!port) continue;
    const p = new THREE.Vector3(...port.at), inside = A.containsPoint(p);
    const dist = inside ? Math.min(p.x - A.min.x, A.max.x - p.x, p.y - A.min.y, A.max.y - p.y, p.z - A.min.z, A.max.z - p.z) : 0;
    if (!best || dist < best.dist) best = { dist, spec: { type: port.type || 'usb-c', at: port.at, dir: port.dir, wide: port.wide, length_mm: 480, part: it.p.name, item: it, auto: true } };
  }
  if (best) return best.spec;
  for (const it of pick(RX_USB)) { // no connector geometry: the end of the board nearer the case wall
    const b = geoBox(it), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    const la = s.x >= s.y ? 0 : 1;
    const dPlus = A.max.getComponent(la) - b.max.getComponent(la), dMinus = b.min.getComponent(la) - A.min.getComponent(la);
    const sgn = dPlus <= dMinus ? 1 : -1, dist = Math.min(dPlus, dMinus);
    if (dist > 15) continue;
    const at = c.clone(); at.setComponent(la, sgn > 0 ? b.max.getComponent(la) : b.min.getComponent(la));
    at.z = Math.min(b.min.z + 3.2, c.z);
    const dir = [0, 0, 0]; dir[la] = sgn;
    return { type: 'usb-c', at: at.toArray(), dir, length_mm: 480, part: it.p.name, item: it, auto: true };
  }
  return null;
}

const RX_PORTED = /usb|type.?c|supermini|esp32|esp8266|arduino|\bpico\b|devkit|wemos|d1 mini|xiao|nano\b|breakout/i;
const vec3 = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);

/** Where a cable plugs into this part, {type, at, dir} in CAD mm, or null. The build's port (cadlib.parts.part():
 * the connector's mouth, placed and rotated with the part) wins; older builds: the board's own metal USB shell, found
 * as the metal that overhangs the PCB edge, so a moved, flipped or on-edge board still gets it right. */
export function boardPort(it) {
  const P = it.p.port;
  if (P && vec3(P.at) && vec3(P.dir)) return { type: P.type, at: P.at, dir: P.dir, wide: vec3(P.wide) ? P.wide : null };
  if (!RX_PORTED.test(it.p.name || '') && !RX_PORTED.test(it.p.lib?.key || '')) return null;
  const geo = it.mesh.geometry, rs = geo.userData?.ranges, pos = geo.attributes?.position;
  if (!rs || !pos) return null;
  const metal = rs.filter(r => r.finish === 'metal'), pcb = rs.filter(r => r.finish === 'pcb');
  if (!metal.length || !pcb.length) return null;
  const v3 = new THREE.Vector3(), boxOf = list => { const b = new THREE.Box3(); for (const r of list) for (let i = r.start; i < r.start + r.count; i++) b.expandByPoint(v3.fromBufferAttribute(pos, i)); return b; };
  const mb = boxOf(metal), pb = boxOf(pcb), ps = pb.getSize(new THREE.Vector3());
  const axes = [0, 1, 2].sort((a, b) => ps.getComponent(b) - ps.getComponent(a)).slice(0, 2); // the PCB's own plane
  let end = null;
  for (const ax of axes) for (const sgn of [1, -1]) {
    const over = sgn > 0 ? mb.max.getComponent(ax) - pb.max.getComponent(ax) : pb.min.getComponent(ax) - mb.min.getComponent(ax);
    if (over > 0.3 && over < 12 && (!end || over > end.over)) end = { ax, sgn, over };
  }
  if (!end) return null;
  const ext = end.sgn > 0 ? mb.max.getComponent(end.ax) : mb.min.getComponent(end.ax);
  const mouth = new THREE.Box3();
  for (const r of metal) for (let i = r.start; i < r.start + r.count; i++) {
    v3.fromBufferAttribute(pos, i);
    if (Math.abs(v3.getComponent(end.ax) - ext) < 0.4) mouth.expandByPoint(v3);
  }
  if (mouth.isEmpty()) return null;
  const at = mouth.getCenter(new THREE.Vector3()), dir = [0, 0, 0]; dir[end.ax] = end.sgn;
  const ms = mouth.getSize(new THREE.Vector3()), across = [0, 1, 2].filter(a => a !== end.ax);
  const wide = [0, 0, 0]; wide[ms.getComponent(across[0]) >= ms.getComponent(across[1]) ? across[0] : across[1]] = 1; // socket's long side
  return { type: 'usb-c', at: at.toArray(), dir, wide };
}

function validCable(c) {
  return c && Array.isArray(c.at) && c.at.length === 3 && c.at.every(Number.isFinite) && (!c.dir || (Array.isArray(c.dir) && c.dir.length === 3 && c.dir.every(Number.isFinite)));
}

/** Is every part where the build put it (not exploded, mid-assembly, mid-change or moving)? Cables only show then. */
function atRest(v) {
  if (v.ui?.explode > 0 || v.moving || v.assembly?.playing || v.assembly?.steps?.open) return false;
  const spun = new Set((v.fx?.list || []).filter(e => e.whole).map(e => e.it)); // power: spinning parts are fine
  for (const it of v.items) {
    if (spun.has(it)) continue;
    const m = it.mesh;
    if (m.position.lengthSq() > 1e-4 || Math.abs(m.quaternion.w) < 0.99999 || Math.abs(m.scale.x - 1) > 1e-3) return false;
  }
  return true;
}

/** Per frame (viewer loop): show the cables only while the model is assembled, and only with their board visible. */
export function cableTick(v) {
  const cs = v._cables; if (!cs?.length) return;
  const rest = atRest(v);
  for (const g of cs) { const it = g.userData.host; g.visible = rest && (!it || it.mesh.visible !== false); }
}

/** viewer.load hook (after every part is placed): cables from the manifest, the parts, or the heuristic. */
export function dressScene(v, manifest) {
  try {
    for (const g of v._cables || []) { g.parent?.remove(g); disposeTree(g); }
    v._cables = [];
    if (!v.items.length) return;
    if (v.items.some(x => /\bleds?\b|ws2812|neopixel|light strip|led strip/i.test(x.p.name))) { // edge-lit: auto-frosted lettering glows
      for (const it of v.items) {
        const e = it.engraving; if (!e?.userData.autoClear) continue;
        e.material[0].emissiveIntensity = 0.85; e.material[1].emissiveIntensity = 0.35; it.p.engraved = 'lit'; e.userData.autoClear = false;
      }
    }
    const specs = [];
    for (const c of Array.isArray(manifest?.cables) ? manifest.cables : []) if (validCable(c)) specs.push({ ...c });
    for (const it of v.items) {
      const cs = Array.isArray(it.p.cable) ? it.p.cable : it.p.cable ? [it.p.cable] : [];
      const port = cs.length ? boardPort(it) : null;
      cs.forEach((c, i) => {
        if (!validCable(c)) return;
        // a declared cable on a board plugs into the board's real connector: its hand-written `at` goes stale as soon
        // as a later run moves or turns the board
        const fix = port && i === 0 ? { at: port.at, dir: port.dir, wide: port.wide, declaredAt: c.at } : null;
        specs.push({ ...c, ...fix, part: it.p.name, item: it });
      });
    }
    if (!specs.length && manifest?.cables !== false) { const g = inferCable(v); if (g) specs.push(g); }
    if (!specs.length) return;
    const all = new THREE.Box3(), caseBox = new THREE.Box3(), walls = [];
    const side = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    for (const it of v.items) {
      const g = it.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); all.union(g.boundingBox);
      if (it.p.group !== 'component') { caseBox.union(g.boundingBox); walls.push(new THREE.Mesh(g, side)); } // CAD frame, at rest
    }
    const centre = all.getCenter(new THREE.Vector3());
    const ray = new THREE.Raycaster();
    const hit = (o, d, far) => { ray.set(o, d); ray.near = 0; ray.far = far; return ray.intersectObjects(walls, false)[0]?.distance ?? null; };
    const env = walls.length ? { box: caseBox, hit } : null;
    for (const s of specs.slice(0, 4)) {
      const g = buildCable(s, all.min.z, centre, env);
      g.userData.host = s.item || null;
      v.world.add(g); // not a child of the board: the desk run must not fly off with it (cableTick hides it meanwhile)
      v._cables.push(g);
    }
    side.dispose();
    v.cables = specs.map(({ item, ...s }, i) => ({ ...s, route: v._cables[i]?.userData.route })); // tests / hover card: decoration only
    cableTick(v);
  } catch (e) { console.warn('materials: cable failed', e); }
}

function disposeTree(o) { o.traverse(x => { if (x.isMesh) { x.geometry?.dispose(); for (const m of [].concat(x.material || [])) m.dispose?.(); } }); }
function hashStr(s) { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
