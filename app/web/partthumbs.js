// Part thumbnails: a small render of one part of the open design, for lists outside the 3D view (the Order tab's
// "parts in this box"). One shared offscreen renderer, cached per part + colour. Parts that aren't in the model
// (glue, wire) get null and the caller shows a plain placeholder.
import * as THREE from 'three';

const SIZE = 96;
let R = null, scene, cam;
const cache = new Map();

function setup() {
  if (R) return true;
  try {
    R = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch { R = null; return false; }
  R.setPixelRatio(1); R.setSize(SIZE * 2, SIZE * 2, false);
  R.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9b4ac, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.8); d.position.set(2, 3, 4); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xffffff, .6); d2.position.set(-3, -1, 2); scene.add(d2);
  cam = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
  return true;
}

const norm = s => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
/** The model part a BOM line refers to: same name, one name inside the other, or most words shared. */
export function findPart(viewer, lineName) {
  const items = viewer?.items || [];
  const n = norm(lineName); if (!n) return null;
  let best = null, bestScore = 0;
  const lw = new Set(n.split(' ').filter(w => w.length > 1));
  for (const it of items) {
    const m = norm(it.p?.name);
    if (!m) continue;
    if (m === n) return it;
    let score = (m.includes(n) || n.includes(m)) ? 0.9 : 0;
    if (!score) {
      const mw = m.split(' ').filter(w => w.length > 1);
      const hit = mw.filter(w => lw.has(w)).length;
      score = hit / Math.max(1, Math.min(mw.length, lw.size));
    }
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 0.6 ? best : null;
}

/** data: URL of a small render of the part (or null). */
export function partThumb(viewer, lineName) {
  const it = findPart(viewer, lineName);
  if (!it?.mesh?.geometry) return null;
  const col = it.mat?.color?.getHexString?.() || '';
  const key = it.p.name + '|' + col;
  if (cache.has(key)) return cache.get(key);
  if (!setup()) return null;
  let url = null;
  try {
    const mat = new THREE.MeshStandardMaterial({ color: it.mat?.color || 0x9a9a9a, roughness: .55, metalness: it.mat?.metalness || 0 });
    const mesh = new THREE.Mesh(it.mesh.geometry, mat);
    const box = new THREE.Box3().setFromObject(mesh), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    mesh.position.sub(c);
    scene.add(mesh);
    const r = Math.max(sz.x, sz.y, sz.z) || 1;
    const dir = new THREE.Vector3(1, -1.25, 0.95).normalize(); // the studio's iso, Z up
    cam.up.set(0, 0, 1);
    cam.position.copy(dir.multiplyScalar(r * 2.05)); cam.near = r / 100; cam.far = r * 20; cam.updateProjectionMatrix();
    cam.lookAt(0, 0, 0);
    R.setClearColor(0x000000, 0); R.clear();
    R.render(scene, cam);
    url = R.domElement.toDataURL('image/png');
    scene.remove(mesh); mat.dispose();
  } catch (e) { console.warn('part thumb', e); url = null; }
  cache.set(key, url);
  return url;
}
