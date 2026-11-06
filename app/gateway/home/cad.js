// Hero backdrop (gateway/home), desktop only, loaded by home.js after first paint. A three.js CAD floor grid (the studio
// viewer's light grid colours) receding to a soft horizon, and real example products (STLs from /files/examples/<slug>/,
// the anonymous allowlist the sign-in demo uses) floating left and right of the text column. Each model turns slowly as
// thin orange edge lines, explodes and reassembles, solidifies into shaded parts, then goes back to lines.
// Pauses when the tab is hidden or the hero is off screen; prefers-reduced-motion gets one static frame. Any failure
// (no WebGL, CDN or STL load error) leaves the CSS perspective grid (.cad-floor) in place.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js'; // as gateway/signin
const root = document.getElementById('cad');
const hero = root && root.closest('.hero');
const column = hero && hero.querySelector('.hero-in');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const slugs = String(root?.dataset.models || '').split(',').filter((s) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(s)).slice(0, 3);

const GRID_MINOR = [0.80, 0.79, 0.78], GRID_MAJOR = [0.66, 0.65, 0.63]; // web/viewer.js BACKDROPS.light
const ACCENT = 0xe8590c;
const PERIOD = 24; // s per model cycle
const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (s, a, b) => clamp((s - a) / (b - a));
const eio = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

function parseSTL(THREE, buf) {
  const dv = new DataView(buf), n = dv.getUint32(80, true);
  if (84 + n * 50 !== buf.byteLength || n > 80000) throw new Error('not a binary STL');
  const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let j = 0; j < 9; j++) pos[i * 9 + j] = dv.getFloat32(o + j * 4, true); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

async function loadModel(THREE, slug) {
  const base = `/files/examples/${slug}/`;
  const r = await fetch(base + 'manifest.json', { credentials: 'same-origin' });
  if (!r.ok) throw new Error('manifest');
  const parts = ((await r.json()).parts || []).filter((p) => p.file).slice(0, 24);
  const geos = await Promise.all(parts.map((p) => fetch(base + p.file, { credentials: 'same-origin' })
    .then((x) => { if (!x.ok) throw new Error(p.file); return x.arrayBuffer(); }).then((b) => parseSTL(THREE, b))));
  if (!parts.length || geos.reduce((s, g) => s + g.attributes.position.count / 3, 0) > 120000) throw new Error('empty or too heavy');
  return { parts, geos };
}

/** Floor grid: lines on y = 0 that fade with distance (soft horizon) and towards the sides. */
function makeGrid(THREE) {
  const half = 6000, step = 60, pos = [], major = [];
  for (let i = -half / step; i <= half / step; i++) {
    const x = i * step + step / 2, m = ((i - 2) % 5 + 5) % 5 === 0 ? 1 : 0; // no line dead centre, under the text
    pos.push(x, 0, -half, x, 0, half, -half, 0, x, half, 0, x); major.push(m, m, m, m);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('major', new THREE.Float32BufferAttribute(major, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { cMinor: { value: new THREE.Vector3(...GRID_MINOR) }, cMajor: { value: new THREE.Vector3(...GRID_MAJOR) } },
    vertexShader: 'attribute float major; varying vec2 vP; varying float vM; void main(){ vP = position.xz; vM = major; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 cMinor; uniform vec3 cMajor; varying vec2 vP; varying float vM; void main(){'
      + ' float depth = 1.0 - smoothstep(200.0, 3400.0, 900.0 - vP.y);' // fades out towards the horizon
      + ' float side = 1.0 - smoothstep(900.0, 2600.0, abs(vP.x));'
      + ' float a = depth * side * mix(0.42, 0.7, vM);'
      + ' gl_FragColor = vec4(mix(cMinor, cMajor, vM), a); }',
  });
  return new THREE.LineSegments(g, mat);
}

function buildModel(THREE, data, side, phase) {
  const tilt = new THREE.Group(), spin = new THREE.Group(), world = new THREE.Group();
  world.rotation.x = -Math.PI / 2; // CAD is Z-up
  spin.add(world); tilt.add(spin);
  const items = data.parts.map((p, i) => {
    const geo = data.geos[i];
    const col = new THREE.Color(p.color || '#c9ccd2').lerp(new THREE.Color(0xf7f4ef), 0.62);
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0, transparent: true, opacity: 0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const mesh = new THREE.Mesh(geo, mat); mesh.visible = false;
    const lmat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lmat);
    const part = new THREE.Group(); part.add(mesh, edges); world.add(part);
    return { p, part, mat, lmat, e: new THREE.Vector3() };
  });
  // centre on the bounding box, normalise to a max dimension of 1
  const bb = new THREE.Box3().setFromObject(world), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3());
  const R = Math.max(s.x, s.y, s.z) || 1;
  world.position.set(-c.x, -c.y, -c.z).divideScalar(R); world.scale.setScalar(1 / R);
  // world.position is applied after the rotation, so recentre in rotated space
  world.updateMatrix(); const bb2 = new THREE.Box3().setFromObject(world), c2 = bb2.getCenter(new THREE.Vector3());
  world.position.sub(c2);
  for (const it of items) { const e = it.p.explode || [0, 0, 0]; it.e.set(e[0], e[1], e[2]).multiplyScalar(R * 0.16); }
  tilt.rotation.x = 0.5; tilt.rotation.z = -side * 0.06;
  return { obj: tilt, spin, items, side, phase, start: null };
}

function run(THREE, models) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  root.insertBefore(renderer.domElement, root.firstChild);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(32, 1, 10, 12000);
  scene.add(makeGrid(THREE));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c6, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-400, 900, 700); scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff1e6, 0.6); fill.position.set(600, 200, 300); scene.add(fill);
  for (const m of models) scene.add(m.obj);

  const look = new THREE.Vector3(0, 70, 0), CAM_D = 1000, CAM_H = 170;
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  const size = { w: 0, h: 0 };
  const v = new THREE.Vector3(), dir = new THREE.Vector3();
  function placeCamera() {
    const yaw = par.x * 0.04, pitch = par.y * 0.025; // at most ~2.3 and ~1.4 degrees
    cam.position.set(Math.sin(yaw) * CAM_D, CAM_H + pitch * CAM_D, Math.cos(yaw) * CAM_D);
    cam.lookAt(look);
  }
  function layout() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return false;
    if (w === size.w && h === size.h) return true;
    size.w = w; size.h = h; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    par.x = par.y = 0; placeCamera(); cam.updateMatrixWorld();
    // each model sits in the middle of its side gutter, never behind the text column
    const hr = root.getBoundingClientRect(), cr = column ? column.getBoundingClientRect() : { left: w * 0.3, right: w * 0.7, top: h * 0.3, bottom: h * 0.7 };
    const colL = cr.left - hr.left, colR = cr.right - hr.left, gut = Math.min(colL, w - colR);
    const px = Math.min(gut * 0.62, h * 0.3, 300);
    for (const m of models) m.obj.visible = px >= 110; // too little room beside the text: grid only
    const rows = [0.42, 0.5, 0.3];
    models.forEach((m, i) => {
      const cx = m.side < 0 ? colL * 0.47 : w - (w - colR) * 0.47;
      const cy = (cr.top - hr.top) + (cr.bottom - cr.top) * rows[i % rows.length];
      v.set((cx / w) * 2 - 1, -(cy / h) * 2 + 1, 0.5).unproject(cam);
      dir.copy(v).sub(cam.position).normalize();
      const t = -cam.position.z / dir.z; // onto the z = 0 plane
      m.obj.position.copy(cam.position).addScaledVector(dir, t);
      m.base = m.obj.position.y;
      const dist = cam.position.distanceTo(m.obj.position);
      m.obj.scale.setScalar(px * (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / h);
    });
    return true;
  }

  const ev = new THREE.Vector3();
  function frame(time) {
    if (innerWidth < 860 || !layout()) return; // narrow window: the CSS grid shows instead (home.css)
    par.x += (par.tx - par.x) * 0.04; par.y += (par.ty - par.y) * 0.04; placeCamera();
    for (const m of models) {
      if (m.start == null) m.start = time;
      const intro = reduce ? 1 : eio(seg(time - m.start, 0, 2.2));
      const s = (((time / PERIOD + m.phase) % 1) + 1) % 1 * PERIOD;
      // 0-5 lines | 5-8.5 explode | 8.5-10 hold | 10-13.5 assemble | 13.5-16 solidify | 16-21 solid | 21-24 back to lines
      const ex = eio(seg(s, 5, 8.5)) * (1 - eio(seg(s, 10, 13.5)));
      const solid = eio(seg(s, 13.5, 16)) * (1 - eio(seg(s, 21, 24)));
      for (const it of m.items) {
        it.part.position.copy(ev.copy(it.e).multiplyScalar(ex));
        const op = solid * 0.9 * intro;
        it.mat.opacity = op; it.mat.depthWrite = op > 0.5; it.part.children[0].visible = op > 0.003;
        it.lmat.opacity = (0.8 - 0.45 * solid) * intro;
      }
      m.spin.rotation.y = m.side * 0.6 + time * 0.11 * (m.side < 0 ? 1 : -1);
      m.obj.position.y = m.base + Math.sin(time * 0.45 + m.phase * 6) * 6;
    }
    renderer.render(scene, cam);
  }

  // static frame: assembled, solid, turned to a good angle
  if (reduce) {
    const still = () => { size.w = 0; for (const m of models) m.start = 0; frame(PERIOD * 0.75); };
    still(); root.classList.add('gl');
    new ResizeObserver(still).observe(root);
    return;
  }

  let raf = 0, last = 0, t = 0, visible = true;
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60; last = now;
    t += dt; frame(t);
  };
  const sync = () => {
    const on = visible && !document.hidden;
    if (on && !raf) { last = 0; raf = requestAnimationFrame(tick); } else if (!on && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
  new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; sync(); }).observe(hero);
  document.addEventListener('visibilitychange', sync);
  addEventListener('pointermove', (e) => {
    if (!visible) return;
    par.tx = (e.clientX / innerWidth) * 2 - 1; par.ty = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });
  frame(0); root.classList.add('gl'); sync();
}

if (root && hero && webgl() && slugs.length) {
  import(THREE_URL).then(async (THREE) => {
    const loaded = await Promise.all(slugs.map((s) => loadModel(THREE, s).catch(() => null)));
    const models = loaded.map((d, i) => (d ? buildModel(THREE, d, i % 2 ? 1 : -1, i * 0.45) : null)).filter(Boolean);
    if (!models.length) return; // keep the CSS grid
    run(THREE, models);
  }).catch(() => {}); // CSS grid stays
}
