// changefx: what a live model update looks like. viewer.load(..., { animate: true }) calls changeFX(viewer) when it is
// replacing a model that was already on screen (not on first load, not after the sketch, not when switching designs):
//   changed part  -> old crossfades out, new scale-pulses in, then an orange rim glow pulses once and fades (~1.8 s)
//   new part      -> pops in from 0.85 with a slight overshoot, an orange ring + sparks burst at its centre, same glow
//   removed part  -> shrinks and fades while a puff of soft smoke rises from its centre (~0.8 s)
//   moved part    -> (same mesh and size, new place) tweens from the old place to the new one, then glows
// plus a small glass chip over the viewport, "+2 added · 1 changed · 1 removed"; tapping it glows those parts again.
// prefers-reduced-motion: plain fades, a soft glow, no particles, no scaling or tweens.
// Render mode: the viewer's own fades (glow shells and particles would bake into the path tracer); the chip still shows.
// Everything it adds (glow shells, particles, rings, the smoke texture) is removed and disposed when its effect ends.
// The glow is a child mesh sharing the part's CAD geometry, so it follows explode / Move / visibility, is never hit by
// picking (hover and the part menu raycast items non-recursively) and never touches the part's own material.
import * as THREE from 'three';

const ORANGE = new THREE.Color('#e8590c'); // Premake orange
const MAX_PARTICLES = 300;
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const easeOutBack = (k, s = 2.2) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);
const easeInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const now = () => performance.now();

let liveParticles = 0, liveEmitters = 0, smokeTex = null;
/** Soft round puff, drawn once on a canvas (no assets), disposed when the last emitter ends. */
function puffTexture() {
  if (smokeTex) return smokeTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,.7)');
  grd.addColorStop(0.7, 'rgba(255,255,255,.18)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
  return smokeTex;
}

const glowVert = `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`;
const glowFrag = `uniform vec3 uColor; uniform float uI; varying vec3 vN; varying vec3 vV;
void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.2);
  float a = uI * (0.22 + 0.78 * f);
  gl_FragColor = vec4(uColor * a, a * 0.6); // half additive: dark parts light up orange, light parts tint orange
  #include <colorspace_fragment>
}`;
const ptVert = `attribute float aSize; attribute float aAlpha; attribute float aShade; uniform float uScale;
varying float vA; varying float vS;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vA = aAlpha; vS = aShade;
  gl_PointSize = aSize * uScale / max(1.0, -mv.z); gl_Position = projectionMatrix * mv; }`;
const ptFrag = `uniform sampler2D map; uniform vec3 uColor; varying float vA; varying float vS;
void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.004) discard; gl_FragColor = vec4(uColor * vS, a);
  #include <colorspace_fragment>
}`;

/** Diff session for one viewer.load. leave/enter return true when they handled the part (else the viewer's own fade runs). */
export function changeFX(v) {
  const mode = v.studio?.on ? 'render' : reduced() ? 'reduced' : 'full';
  v.editGlow?.handoff(); // editglow: the live "editing" shimmer stops; this takes over
  const pending = new Set(); // old items paired with a new part (changed or moved), awaiting enter()
  const stats = { added: [], changed: [], moved: [], removed: [] };
  let addN = 0, settling = 0;

  const geoOf = it => it.cgeo || it.mesh.geometry;
  const boxOf = it => { const g = geoOf(it); if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox; };
  const disposeOld = it => { it.mesh.parent?.remove(it.mesh); geoOf(it).dispose(); it.rgeo?.dispose(); it.mat.dispose(); it.rmat?.dispose(); it.edges?.geometry.dispose(); it.edges?.material.dispose(); };
  const exOffset = (it, out) => { const e = it.p.explode || [0, 0, 0], ex = v.ui.explode * v.radius * 0.6; return out.set(e[0] * ex, e[1] * ex, e[2] * ex); };
  const tracked = it => !!(v.moving && it.track); // the Move player owns this part's pose
  const _p = new THREE.Vector3(), _c = new THREE.Vector3();
  /** Pose a live item at scale s around its bounding-box centre, shifted by off (CAD mm). */
  function pose(it, s, off) {
    if (tracked(it)) return;
    boxOf(it).getCenter(_c);
    exOffset(it, _p).addScaledVector(_c, 1 - s);
    if (off) _p.add(off);
    it.mesh.position.copy(_p); it.mesh.scale.setScalar(s);
  }
  function settle(it) {
    it.anim = false; it.mesh.scale.setScalar(1);
    if (!tracked(it)) exOffset(it, it.mesh.position);
    v.setMat(it, v.matBase(it));
    if (--settling === 0) v.partmenu?.apply(); // see-through edge opacity etc.
  }
  /** World-space centre, burst radius, puff size and half-extents (world axes) of an item's mesh as it is now. */
  function worldCentre(it) {
    v.world.updateMatrixWorld(true);
    const wb = boxOf(it).clone().applyMatrix4(it.mesh.matrixWorld), c = wb.getCenter(new THREE.Vector3()), s = wb.getSize(new THREE.Vector3());
    const d = [s.x, s.y, s.z].sort((a, b) => a - b), cap = v.radius * 0.45;
    return { c, r: Math.min(Math.max(d[2], 6) * 0.55, cap), puff: THREE.MathUtils.clamp(d[1] * 0.7, 5, Math.min(cap, 40)), half: s.multiplyScalar(0.4) };
  }

  // ---------------------------------------------------------------- glow
  function glow(it, delay = 0, ms = 1800) {
    if (mode === 'render' || !it.mesh.parent) return;
    const old = it.mesh.children.find(c => c.userData.fxGlow);
    if (old) { old.userData.kill?.(); }
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ORANGE.clone() }, uI: { value: 0 } }, vertexShader: glowVert, fragmentShader: glowFrag,
      transparent: true, depthWrite: false, side: THREE.FrontSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const g = new THREE.Mesh(geoOf(it), mat); // shares the part's geometry: nothing to dispose but the material
    g.userData.fxGlow = true; g.renderOrder = 5; g.raycast = () => {};
    it.mesh.add(g);
    const soft = mode === 'reduced';
    let dead = false;
    const a = v.animate(ms, () => {
      const k = Math.min(1, (now() - a.t0) / ms);
      // in fast, a second smaller pulse, then a long fade (reduced motion: one soft rise and fall)
      const up = Math.min(1, k / 0.12), fade = 1 - THREE.MathUtils.smoothstep(k, 0.4, 1);
      const pulse = soft ? 1 : 0.78 + 0.22 * Math.cos(Math.min(1, k / 0.45) * Math.PI * 2);
      mat.uniforms.uI.value = 0.95 * up * fade * pulse;
    }, () => kill(), delay);
    function kill() { if (dead) return; dead = true; v.anims.delete(a); g.parent?.remove(g); mat.dispose(); }
    g.userData.kill = kill;
  }

  // ---------------------------------------------------------------- particles
  function emitter(n, setup, step, ms) {
    n = Math.min(n, MAX_PARTICLES - liveParticles);
    if (n < 4 || mode !== 'full') return;
    liveParticles += n; liveEmitters++;
    const pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), shade = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
    const h = v.renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture() }, uColor: { value: new THREE.Color(1, 1, 1) }, uScale: { value: h / (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov) / 2)) } },
      vertexShader: ptVert, fragmentShader: ptFrag, transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false; pts.renderOrder = 6; pts.raycast = () => {}; pts.userData.fx = true; // chattools: left out of screenshots
    const P = Array.from({ length: n }, (_, i) => setup(i, n));
    v.scene.add(pts);
    const t0 = now();
    v.animate(ms, () => {
      const t = (now() - t0) / 1000;
      for (let i = 0; i < n; i++) {
        const o = step(P[i], t, mat);
        pos[i * 3] = o.x; pos[i * 3 + 1] = o.y; pos[i * 3 + 2] = o.z; size[i] = o.size; alpha[i] = o.alpha; shade[i] = o.shade ?? 1;
      }
      geo.attributes.position.needsUpdate = geo.attributes.aSize.needsUpdate = geo.attributes.aAlpha.needsUpdate = geo.attributes.aShade.needsUpdate = true;
    }, () => {
      v.scene.remove(pts); geo.dispose(); mat.dispose();
      liveParticles -= n;
      if (--liveEmitters === 0 && smokeTex) { smokeTex.dispose(); smokeTex = null; }
    });
    return mat;
  }
  const rnd = (a, b) => a + Math.random() * (b - a);
  function smoke({ c, puff: r, half }, n) { // puffs spawn through the part's volume (a long pin smokes along its length)
    const light = v.backdrop !== 'dark';
    const mat = emitter(n, () => {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).normalize();
      const o = c.clone().add(new THREE.Vector3(rnd(-1, 1) * half.x, rnd(-1, 1) * half.y, rnd(-1, 1) * half.z));
      return { o, d, sp: r * rnd(0.5, 1.2), up: r * rnd(0.6, 1.3),
        s0: r * rnd(0.7, 1.1), life: rnd(0.7, 1.0), wait: rnd(0, 0.08), shade: rnd(0.9, 1) };
    }, (q, t) => {
      const u = Math.max(0, Math.min(1, (t - q.wait) / q.life)), out = 1 - Math.pow(1 - u, 2.4); // fast out, slows (drag)
      return { x: q.o.x + q.d.x * q.sp * out, y: q.o.y + q.d.y * q.sp * out * 0.6 + q.up * u * u * 0.9 + q.up * u * 0.4, z: q.o.z + q.d.z * q.sp * out,
        size: q.s0 * (0.6 + 1.2 * out), alpha: (t < q.wait ? 0 : Math.min(1, u / 0.12) * Math.pow(1 - u, 1.6)) * (light ? 0.75 : 0.45), shade: q.shade };
    }, 1000);
    if (mat) mat.uniforms.uColor.value.set(light ? '#a49e97' : '#ececef'); // grey-white that still reads on the light backdrop
  }
  function sparks(c, r, n) {
    const mat = emitter(n, () => {
      const d = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize();
      return { d, sp: r * rnd(1.1, 1.9), s0: r * rnd(0.09, 0.16), life: rnd(0.4, 0.6) };
    }, (q, t) => {
      const u = Math.min(1, t / q.life), out = 1 - Math.pow(1 - u, 3);
      return { x: c.x + q.d.x * q.sp * out, y: c.y + q.d.y * q.sp * out, z: c.z + q.d.z * q.sp * out,
        size: q.s0 * (1 - 0.6 * u), alpha: Math.min(1, u / 0.08) * (1 - u) * 0.95, shade: 1 };
    }, 650);
    if (mat) mat.uniforms.uColor.value.set('#ff8a3d');
  }
  function ring(c, r, delay) {
    if (mode !== 'full') return;
    const geo = new THREE.RingGeometry(0.86, 1, 64), mat = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat); m.position.copy(c); m.renderOrder = 6; m.raycast = () => {}; m.visible = false; m.userData.fx = true;
    v.scene.add(m);
    v.animate(560, k => { m.visible = true; m.quaternion.copy(v.camera.quaternion); m.scale.setScalar(r * (0.35 + 1.25 * k)); mat.opacity = 0.75 * (1 - k); },
      () => { v.scene.remove(m); geo.dispose(); mat.dispose(); }, delay);
  }

  // ---------------------------------------------------------------- old parts going away
  function vanish(it) { // removed: shrink + fade, with smoke
    const m = it.mesh, mat = m.material, e = it.edges;
    mat.transparent = true; mat.depthWrite = false; mat.needsUpdate = true;
    const o0 = mat.opacity, e0 = e ? e.material.opacity : 0, full = mode === 'full';
    const at = full && m.visible ? worldCentre(it) : null;
    const p0 = m.position.clone(), lc = boxOf(it).getCenter(new THREE.Vector3()).applyQuaternion(m.quaternion);
    v.animate(full ? 420 : 320, k => {
      mat.opacity = o0 * (1 - k); if (e) e.material.opacity = e0 * (1 - k);
      if (full) { const s = 1 - 0.35 * k; m.scale.setScalar(s); m.position.copy(p0).addScaledVector(lc, 1 - s); }
    }, () => disposeOld(it));
    if (at) smoke(at, Math.max(14, Math.min(60, Math.floor(MAX_PARTICLES / Math.max(1, stats.removed.length + 1)))));
  }
  function crossOut(it) { // changed: the old shape dissolves under the new one
    const m = it.mesh, mat = m.material, e = it.edges, o0 = mat.opacity, e0 = e ? e.material.opacity : 0;
    mat.transparent = true; mat.depthWrite = false; mat.needsUpdate = true;
    v.animate(340, k => { mat.opacity = o0 * (1 - k); if (e) e.material.opacity = e0 * (1 - k); }, () => disposeOld(it));
  }

  return {
    mode,
    /** Glow a part again (the chip's tap). */
    glowOnly(it) { glow(it); },
    /** An old item that is not unchanged. stays: it is paired with a new part (changed or moved), which enter() gets. */
    leave(it, stays) {
      if (stays) { pending.add(it); return true; }
      stats.removed.push(it.p.name);
      if (mode === 'render') return false;
      vanish(it);
      return true;
    },
    /** A new item that is new or changed (old: the old item paired with it, or null). */
    enter(it, old) {
      const prev = old && pending.has(old) ? old : null;
      if (prev) pending.delete(prev);
      let moved = null;
      if (prev) { // same mesh and size, somewhere else: a move
        const a = boxOf(prev), b = boxOf(it), sa = a.getSize(new THREE.Vector3()), sb = b.getSize(new THREE.Vector3());
        const sameMesh = geoOf(prev).attributes.position.count === geoOf(it).attributes.position.count && sa.distanceTo(sb) < 0.05;
        if (sameMesh) moved = a.min.clone().sub(b.min);
      }
      (moved ? stats.moved : prev ? stats.changed : stats.added).push(it.p.name);
      if (mode === 'render') { if (prev) disposeOld(prev); return false; }
      const base = v.matBase(it), mat = it.mat, e = it.edges, E = 0.35;
      it.anim = true; settling++;
      mat.transparent = true; mat.needsUpdate = true;
      if (mode === 'reduced') {
        if (prev) crossOut(prev);
        mat.opacity = moved ? base.opacity : 0; if (e && !moved) e.material.opacity = 0;
        if (!moved) v.animate(320, k => { mat.opacity = base.opacity * k; if (e) e.material.opacity = E * k; }, () => settle(it));
        else settle(it);
        glow(it, 0, 1600);
        return true;
      }
      if (moved) { // slide from the old place; the old copy goes at once (the new one starts exactly where it was)
        disposeOld(prev);
        mat.opacity = base.opacity;
        pose(it, 1, moved);
        const off = new THREE.Vector3();
        const t0 = now();
        v.animate(720, () => { const k = Math.min(1, (now() - t0) / 720); pose(it, 1, off.copy(moved).multiplyScalar(1 - easeInOut(k))); }, () => settle(it));
        glow(it, 380);
        return true;
      }
      if (prev) { // changed: crossfade with a small scale pulse, then glow
        crossOut(prev);
        mat.opacity = 0; if (e) e.material.opacity = 0;
        pose(it, 0.97);
        v.animate(460, k => {
          mat.opacity = base.opacity * Math.min(1, k * 1.4); if (e) e.material.opacity = E * k;
          pose(it, 0.97 + 0.03 * k + 0.035 * Math.sin(k * Math.PI));
        }, () => settle(it));
        glow(it, 120);
        return true;
      }
      // new: pop in with an overshoot, ring + sparks at its centre
      const delay = 140 + Math.min(addN++, 8) * 70;
      mat.opacity = 0; if (e) e.material.opacity = 0;
      pose(it, 0.85);
      const t0 = now() + delay;
      v.animate(560, () => {
        const k = Math.min(1, Math.max(0, (now() - t0) / 560));
        mat.opacity = base.opacity * Math.min(1, k / 0.45); if (e) e.material.opacity = E * Math.min(1, k / 0.6);
        pose(it, 0.85 + 0.15 * easeOutBack(k));
      }, () => settle(it), delay);
      if (!v.hidden.has(it.p.name) && (it.p.group !== 'component' || v.ui.showComp)) { // apply() sets visibility later
        const { c, r } = worldCentre(it);
        ring(c, r, delay + 60);
        setTimeout(() => sparks(c, r, Math.max(10, Math.min(28, Math.floor(MAX_PARTICLES / 10)))), delay + 40);
      }
      glow(it, delay + 220);
      return true;
    },
    /** After the viewer has placed every new item: fade any leftovers and show the summary chip. */
    finish() {
      for (const it of pending) { stats.removed.push(it.p.name); mode === 'render' ? disposeOld(it) : vanish(it); }
      pending.clear();
      v.lastChange = { ...stats, at: Date.now() };
      showChip(v, stats);
    },
  };
}

// ---------------------------------------------------------------- "What changed" chip
let chipCss = false;
function css() {
  if (chipCss) return; chipCss = true;
  const s = document.createElement('style');
  s.textContent = `
.fx-chip { position: absolute; bottom: 14px; left: 50%; z-index: 3; transform: translate(-50%, 6px); opacity: 0; pointer-events: none;
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px 6px 10px; border-radius: 999px; max-width: calc(100% - 24px);
  font: 500 12px/1.2 Inter, system-ui, sans-serif; color: var(--text, #1c1917); white-space: nowrap; cursor: pointer;
  background: var(--gl-fill, rgba(255,255,255,.85)); border: 1px solid var(--gl-rim, rgba(255,255,255,.85)); background-clip: padding-box;
  box-shadow: var(--gl-hl, none), var(--gl-hair, 0 0 0 .5px rgba(28,25,23,.16)), var(--gl-shadow, 0 4px 14px -3px rgba(28,25,23,.1));
  -webkit-backdrop-filter: var(--gl-blur, blur(14px)); backdrop-filter: var(--gl-blur, blur(14px));
  transition: opacity .25s, transform .3s var(--gl-ease, ease); }
.fx-chip.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
.fx-chip:hover { background: var(--gl-fill-hover, #fff); }
.fx-chip:active { transform: translate(-50%, 0) scale(.97); }
.fx-chip .fx-dot { width: 7px; height: 7px; border-radius: 50%; background: #e8590c; box-shadow: 0 0 0 3px rgba(232,89,12,.16); flex-shrink: 0; }
.fx-chip b { font-weight: 600; }
.fx-chip .fx-sep { color: var(--muted, #8a847d); }
@media (prefers-reduced-motion: reduce) { .fx-chip { transition: opacity .2s; transform: translate(-50%, 0); } }`;
  document.head.appendChild(s);
}
function showChip(v, st) {
  const bits = [
    st.added.length && `<b>+${st.added.length}</b> added`, st.changed.length && `<b>${st.changed.length}</b> changed`,
    st.moved.length && `<b>${st.moved.length}</b> moved`, st.removed.length && `<b>${st.removed.length}</b> removed`,
  ].filter(Boolean);
  if (!bits.length) { v.lastChange = null; return; }
  css();
  let el = v.container.querySelector('.fx-chip');
  if (!el) {
    el = document.createElement('button'); el.type = 'button'; el.className = 'fx-chip';
    el.setAttribute('aria-live', 'polite');
    v.container.appendChild(el);
    el.addEventListener('pointerdown', e => e.stopPropagation()); // not a viewport drag / pick
    el.addEventListener('click', () => {
      const names = new Set([...(v.lastChange?.added || []), ...(v.lastChange?.changed || []), ...(v.lastChange?.moved || [])]);
      const fx = changeFX(v);
      for (const it of v.items) if (names.has(it.p.name)) fx.glowOnly(it);
      hold(el, 4000);
    });
  }
  el.innerHTML = `<span class="fx-dot"></span><span>${bits.join('<span class="fx-sep"> · </span>')}</span>`;
  el.title = st.removed.length || (st.added.length + st.changed.length + st.moved.length) ? 'Highlight what changed' : '';
  const rb = document.getElementById('renderBar'); // render mode: sit above its colour bar (it can wrap to two rows)
  el.style.bottom = rb && !rb.hidden && rb.offsetHeight ? `${rb.offsetHeight + 24}px` : '';
  requestAnimationFrame(() => el.classList.add('on'));
  hold(el, 5200);
}
function hold(el, ms) { clearTimeout(el._t); el.classList.add('on'); el._t = setTimeout(() => el.classList.remove('on'), ms); }

// ---------------------------------------------------------------- editglow: what the agent is changing, live
// While a design run edits design.py, the server names the parts each edit touches ('editing_parts' events). Those parts
// get a soft orange shimmer (the glow shell above, pulsing at ~1.2 s; a steady glow with prefers-reduced-motion) and the
// rest of the model dims to ~70 % (colour, not opacity, so see-through / ghost / picking are untouched). When the new model
// lands, changeFX takes over (handoff); a run that ends without one fades out (stop). focus(names) is the same look for a
// moment, from the part chips in the chat. The shells are userData.fx (left out of capture / snapshots) and never picked.
const DIM = 0.7, PERIOD = 1200;
let focusViewer = null;
export function editGlow(v) {
  if (v.editGlow) return v.editGlow;
  let names = new Set(), focus = null, focusT = 0, loop = null, last = 0;
  const recs = new Map(); // item -> { g, x, mat, xmat, i, d, c0, e0, cw }
  const lit = it => names.has(it.p.name) || !!focus?.has(it.p.name);
  function rec(it) {
    let r = recs.get(it);
    if (!r) { r = { g: null, x: null, mat: null, xmat: null, i: 0, d: 1, c0: null, e0: 0, cw: null }; recs.set(it, r); }
    return r;
  }
  function unshell(r) { if (!r.g) return; r.g.parent?.remove(r.g); r.x.parent?.remove(r.x); r.mat.dispose(); r.xmat.dispose(); r.g = r.x = null; }
  function drop(it, r) {
    unshell(r);
    if (r.c0 && it.mat) { it.mat.color.copy(r.c0); it.mat.envMapIntensity = r.e0; }
    recs.delete(it);
  }
  function shell(it, r) {
    if (r.g) return;
    r.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: ORANGE.clone() }, uI: { value: 0 } }, vertexShader: glowVert, fragmentShader: glowFrag,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    r.g = new THREE.Mesh(it.cgeo || it.mesh.geometry, r.mat);
    r.g.userData.fx = true; r.g.renderOrder = 5; r.g.raycast = () => {};
    // a faint x-ray copy, so a part hidden behind others still shows where it is
    r.xmat = r.mat.clone(); r.xmat.depthTest = false; r.xmat.uniforms.uColor.value = ORANGE.clone();
    r.x = new THREE.Mesh(r.g.geometry, r.xmat);
    r.x.userData.fx = true; r.x.renderOrder = 4; r.x.raycast = () => {};
    it.mesh.add(r.g, r.x);
  }
  function frame() {
    const t = performance.now(), dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    if (focus && t > focusT) focus = null;
    const off = !!v.studio?.on; // render mode: its own materials; shells would bake into the path tracer
    const any = !off && v.items.some(lit);
    const soft = reduced(), a = 1 - Math.exp(-dt / 0.16);
    const wave = soft ? 0.7 : 0.4 + 0.55 * (0.5 + 0.5 * Math.sin((t / PERIOD) * Math.PI * 2));
    const live = new Set(v.items);
    for (const [it, r] of recs) if (!live.has(it)) drop(it, r); // the model was replaced
    let busy = false;
    for (const it of v.items) {
      const on = any && lit(it);
      const ti = on ? (focus?.has(it.p.name) ? 1 : wave) : 0, td = any && !on ? DIM : 1;
      const r = recs.get(it);
      if (!r && !ti && td === 1) continue;
      const R = r || rec(it);
      R.i += (ti - R.i) * (on ? Math.min(1, a * 3) : a); R.d += (td - R.d) * a;
      if (Math.abs(R.i - ti) < 0.004) R.i = ti;
      if (Math.abs(R.d - td) < 0.004) R.d = td;
      if (R.i > 0.003) { shell(it, R); R.mat.uniforms.uI.value = R.i; R.xmat.uniforms.uI.value = R.i * 0.3; }
      else unshell(R);
      if (it.mat) {
        if (R.cw && !it.mat.color.equals(R.cw)) R.c0 = null; // recoloured meanwhile (backdrop, swatch): that is the new base
        if (R.d < 1) {
          if (!R.c0) { R.c0 = it.mat.color.clone(); R.e0 = it.mat.envMapIntensity; }
          it.mat.color.copy(R.c0).multiplyScalar(R.d); it.mat.envMapIntensity = R.e0 * R.d; R.cw = it.mat.color.clone();
        } else if (R.c0) { it.mat.color.copy(R.c0); it.mat.envMapIntensity = R.e0; R.c0 = R.cw = null; }
      }
      if (!R.g && !R.c0 && R.d === 1) recs.delete(it); else busy = true;
    }
    if (!busy && !any && !names.size && !focus) { v.anims.delete(loop); loop = null; last = 0; }
  }
  function run() { if (!loop) { last = 0; loop = v.animate(1e12, frame); } }
  const api = {
    /** Shimmer these parts (replaces the previous set). */
    set(list) { names = new Set(list || []); run(); },
    /** Chat chip hover / tap: light these parts for ms (null: let go). */
    focus(list, ms = 60000) { focus = list?.length ? new Set(list) : null; focusT = performance.now() + ms; run(); },
    /** The run ended without a new model (or was stopped): fade out. */
    stop() { names = new Set(); run(); },
    /** A new model landed (changeFX takes over): no fade, back to normal at once. */
    handoff() { names = new Set(); for (const [it, r] of recs) drop(it, r); },
    /** capture(): the plain model for one frame. Returns resume(). */
    pause() {
      if (!recs.size) return () => {};
      const saved = [];
      for (const [it, r] of recs) { if (r.c0 && it.mat) { saved.push([it, it.mat.color.clone(), it.mat.envMapIntensity]); it.mat.color.copy(r.c0); it.mat.envMapIntensity = r.e0; } }
      return () => { for (const [it, c, e] of saved) { it.mat.color.copy(c); it.mat.envMapIntensity = e; } };
    },
    get names() { return [...names]; },
  };
  v.editGlow = api;
  focusViewer = v;
  return api;
}
// Part chips in the chat (web/chatui.js) say which parts to light: { names, on, ms }.
if (typeof addEventListener === 'function') addEventListener('buildery:partfocus', e => {
  const v = focusViewer, d = e.detail || {};
  if (!v?.editGlow) return;
  v.editGlow.focus(d.on ? d.names : null, d.ms || 60000);
  xray(v, d.on ? d.names : null, d.ms || 60000);
});
// xray: a focused part shows through the case. An orange copy drawn on top of everything (no depth test), parented to
// the part's own mesh so it follows explode / motion, removed when the focus ends.
let xr = null;
function xray(v, names, ms) {
  if (xr) { clearTimeout(xr.t); for (const o of xr.objs) { o.parent?.remove(o); o.material.dispose(); o.geometry !== o.userData.shared && o.geometry.dispose(); } xr = null; }
  if (!names?.length) return;
  const want = new Set(names), objs = [];
  for (const it of v.items || []) {
    if (!want.has(it.p?.name) || !it.mesh) continue;
    const geo = it.cgeo || it.mesh.geometry;
    const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.95, depthTest: false }));
    fill.userData.shared = geo;
    for (const o of [fill, edges]) { o.renderOrder = 999; it.mesh.add(o); objs.push(o); }
  }
  if (!objs.length) return;
  xr = { objs, t: setTimeout(() => xray(v, null), ms) };
  v.render?.(); v.requestRender?.();
}
// Part names of the model on screen, asked synchronously by the chat (so chatui.js needn't import three).
if (typeof addEventListener === 'function') addEventListener('buildery:partnames', e => {
  if (focusViewer && e.detail) e.detail.names = [...new Set(focusViewer.items.map(it => it.p.name))];
});
