// askmock: a question-card option's quick mock-up, drawn over the real model while the option is hovered (desktop) or
// tapped (phone). Same look as the instant sketch (translucent primitives that keep morphing, so it never reads as the
// real thing), but it sits on top of the model instead of replacing it, and swaps in fast (~350 ms).
//   v.askMock.show(sk)   sk = { parts: [{ shape, size|r|h|axis, at, color }] } in CAD mm (server/askmock.js)
//   v.askMock.clear()
// The outlines draw through the model (no depth test) so a mock-up inside or behind it still shows.
import * as THREE from 'three';

export function installAskPreview(v) {
  let cur = null; // { g, list, sk }
  const ease = (t) => t * t * (3 - 2 * t);
  const accent = 0xe8590c;

  function build(sk) {
    const g = new THREE.Group(), list = [];
    sk.parts.forEach((p, i) => {
      let geo;
      if (p.shape === 'box') geo = new THREE.BoxGeometry(...p.size);
      else if (p.shape === 'sphere') geo = new THREE.SphereGeometry(p.r, 24, 16);
      else {
        geo = new THREE.CylinderGeometry(p.r, p.r, p.h, 32);
        if (p.axis === 'z') geo.rotateX(Math.PI / 2); else if (p.axis === 'x') geo.rotateZ(Math.PI / 2);
      }
      const mat = new THREE.MeshStandardMaterial({ color: p.color || '#e8590c', emissive: 0xe8590c, emissiveIntensity: 0.18, roughness: 0.7, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0, depthTest: false }));
      edges.renderOrder = 10; mesh.renderOrder = 9;
      mesh.add(edges);
      mesh.position.set(...p.at); mesh.scale.setScalar(0.6);
      g.add(mesh);
      const item = { mesh, mat, edges, ph: i * 1.7, t0: null };
      list.push(item);
      v.animate(380, (k) => {
        const e = ease(k);
        edges.material.opacity = 0.9 * e; mat.opacity = 0.55 * e;
        mesh.scale.setScalar(0.6 + 0.4 * e);
      }, () => { item.t0 = performance.now(); }, i * 60);
    });
    v.world.add(g);
    return { g, list, sk };
  }
  function drop(c, ms = 220) {
    if (!c) return;
    const dispose = () => { v.world.remove(c.g); for (const x of c.list) { x.mesh.geometry.dispose(); x.mat.dispose(); x.edges.geometry.dispose(); x.edges.material.dispose(); } };
    for (const x of c.list) { x.dead = true; const o = x.mat.opacity, e = x.edges.material.opacity; v.animate(ms, (k) => { x.mat.opacity = o * (1 - k); x.edges.material.opacity = e * (1 - k); }); }
    v.animate(ms + 20, () => {}, dispose);
  }

  v.askMock = {
    get current() { return cur?.sk || null; },
    show(sk) {
      if (cur?.sk === sk) return;
      drop(cur); cur = null;
      if (sk?.parts?.length) cur = build(sk);
    },
    clear() { drop(cur); cur = null; },
    /** Same morph as the instant sketch, a little calmer: it reads as a rough idea, not the real part. */
    tick() {
      if (!cur) return;
      const t = performance.now();
      for (const x of cur.list) {
        if (x.t0 == null || x.dead) continue;
        const a = 0.08 * Math.min(1, (t - x.t0) / 700), s = t / 1000;
        x.mesh.scale.set(1 + a * Math.sin(s * 1.9 + x.ph), 1 + a * Math.sin(s * 1.5 + x.ph + 2.1), 1 + a * Math.sin(s * 1.7 + x.ph + 4.2));
      }
    },
  };
}
