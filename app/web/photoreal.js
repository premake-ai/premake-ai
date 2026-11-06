// Photoreal default look for the viewer (web/viewer.js). On by default; ?look=cad (or localStorage formery.look = 'cad')
// keeps the old CAD look. Everything else in the viewer (effects, X-ray, explode, assembly, hover, colour picks, render
// mode) runs on top of it unchanged.
//
//  - Light: image-based, from web/env/studio-1k.hdr (a procedural photo studio, our own, CC0: cadlib/make_studio_hdr.py)
//    prefiltered with PMREM. The CAD lights stay, much dimmer, so night mode (web/effects.js) still has something.
//  - Materials: printed parts are matte PLA / satin PETG with a procedural 0.2 mm layer-line normal and a faint sheen;
//    bought parts get metal / rubber / PCB / plastic by name (render.js componentMaterial); presets from materials.js
//    (aluminium, steel, acrylic, PCB ...) keep theirs. Curved faces are smooth-shaded (STL normals are per facet).
//  - ACES tone mapping, a soft contact shadow and ground-truth AO (GTAO; half resolution on phones). Bloom stays where it
//    was: web/effects.js, only for LEDs and screens when the design is turned on.
//  - Phones stay smooth: a frame-time governor steps AO to half res, then off, then lowers the pixel ratio.
//  - Photo mode: on desktop, after 1.5 s without input the view is path traced (three-gpu-pathtracer, loaded on demand)
//    and converges in a few seconds; any input goes straight back to raster. Phones only via viewer.photoMode(true).
//    The canvas stays transparent (CSS backdrop), the contact shadow is drawn under the traced product.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { ContactShadow, plasticMaterial, componentMaterial } from './render.js';
import { isPhone } from './materials.js';

const HDR_URL = new URL('./env/studio-1k.hdr', import.meta.url).href;
const LIGHTS = [0.12, 0.55, 0, 0.3];  // hemi, key, fill, rim x their CAD intensity: the HDR does the lighting
const EXPOSURE = 0.92;
const ENV = 1.0;                        // envMapIntensity on photoreal materials
const IDLE_MS = 1500;                   // photo mode starts after this long without input (desktop)
const PT_SAMPLES = 120, PT_MAX_MS = 4500; // converged enough; stops in 2-5 s on a laptop GPU
const UNDER_LAYER = 5;                  // the contact shadow and grid are also drawn alone under the path-traced image
const RX_LED = /\bleds?\b|ws28\d\d|neopixel|light strip|lamp|bulb/i;

export function photorealWanted() {
  try { if (/[?&]look=cad\b/.test(location.search)) return false; if (localStorage.getItem('formery.look') === 'cad') return false; } catch {}
  return true;
}

/** GTAO at a fraction of the composer's resolution (phones: 0.5). */
class ScaledGTAOPass extends GTAOPass {
  constructor(scene, camera, scale) { super(scene, camera, 1, 1); this.aoScale = scale; }
  setSize(w, h) { super.setSize(Math.max(1, Math.round(w * this.aoScale)), Math.max(1, Math.round(h * this.aoScale))); }
}

export class Photoreal {
  constructor(v) {
    this.v = v;
    this.on = true;
    try { (window.__formeryViewers ||= []).push(v); } catch {} // debugging / QA: viewer.photo.stats
    this.phone = isPhone();
    const r = v.renderer;
    this.webgl2 = !!r.capabilities.isWebGL2;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = EXPOSURE; // ACES: AgX looked grey on saturated filament colours
    this.cadLights = v.lights.map(l => l.intensity);
    v.lights.forEach((l, i) => { l.intensity = this.cadLights[i] * LIGHTS[i]; });
    v.grid.material.uniforms.uAlpha.value = 0.6;
    // level: 0 AO full res, 1 AO half res, 2 AO off, 3 pixel ratio 1.5, 4 pixel ratio 1.25
    this.level = this.phone ? 1 : 0;
    this.stats = { level: this.level, fps: 0, hdr: 'loading', pt: 'off', samples: 0 };
    this.frames = []; this.settleAt = performance.now() + 2500;
    this.dirtyShadow = true;
    this.root = new THREE.Group(); this.root.name = 'photoreal';
    this.shadow = new ContactShadow();
    this.shadow.darkness.value = 3.2; this.shadow.plane.renderOrder = 0.5; // over the grid: it darkens the lines too
    this.shadow.plane.layers.enable(UNDER_LAYER); v.grid.layers.enable(UNDER_LAYER);
    this.root.add(this.shadow.group);
    v.scene.add(this.root);
    this._composer();
    this._loadHdr();
    // photo mode bookkeeping
    this.pt = null; this.ptState = 'off'; this.ptForced = false; this.ptGeoDirty = true;
    this.idleAt = performance.now() + IDLE_MS;
    const poke = () => this.poke();
    const el = r.domElement;
    for (const ev of ['pointerdown', 'pointermove', 'wheel', 'touchstart']) el.addEventListener(ev, poke, { passive: true });
    addEventListener('keydown', poke);
    v.controls.addEventListener('start', poke);
    v.controls.addEventListener('change', () => { if (this.ptState !== 'off') this.stopPt(); this.idleAt = performance.now() + IDLE_MS; });
  }

  // ------------------------------------------------------------------------------------------------ environment
  _loadHdr() {
    const v = this.v, r = v.renderer;
    new RGBELoader().loadAsync(HDR_URL).then(tex => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      this.hdr = tex; // equirect: the path tracer samples this directly
      const pm = new THREE.PMREMGenerator(r);
      this.env = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      const prev = v.cadEnv;
      v.cadEnv = this.env; // effects.js puts this back after night
      if (v.scene.environment === prev || v.scene.environment == null && !(v.fx?.k > 0.02)) {
        if (!v.studio?.on) v.scene.environment = this.env;
        else if (v.studio.saved) v.studio.saved.env = this.env;
      }
      this.stats.hdr = 'ok';
      this.ptGeoDirty = true;
    }).catch(e => { console.warn('photoreal: studio HDR unavailable, keeping the room environment', e); this.stats.hdr = 'failed'; });
  }

  // ------------------------------------------------------------------------------------------------ materials
  /** viewer.load hook, per part (after materials.js dressItem): photoreal material + smooth shading. */
  dress(it) {
    const v = this.v, geo = it.mesh.geometry;
    if (!geo.index && geo.attributes.position.count < 1.5e6) { try { toCreasedNormals(geo, Math.PI / 6); } catch {} } // in place for non-indexed STLs
    if (it.vc) { it.mat.envMapIntensity = ENV; return; } // library part: per-vertex finishes already
    if (it.look) { // materials.js preset: a touch more environment than the CAD view gave it
      it.mat.envMapIntensity = Math.max(it.mat.envMapIntensity ?? 1, ENV);
      return;
    }
    let mat, kind;
    if (it.p.group === 'component') {
      if (RX_LED.test(it.p.name)) { // LEDs are milky diodes when off; effects.js makes them glow when turned on
        kind = 'LED';
        mat = new THREE.MeshPhysicalMaterial({ color: '#efece4', roughness: 0.35, metalness: 0, clearcoat: this.phone ? 0 : 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, envMapIntensity: ENV });
      } else {
        const c = componentMaterial(it.p.name, it.p.color);
        mat = c.mat; kind = c.kind;
        if (mat.emissiveIntensity) { mat.emissive.setHex(0); mat.emissiveIntensity = 1; }
        mat.envMapIntensity = ENV;
        if (this.phone) { mat.sheen = 0; mat.clearcoat = 0; }
      }
    } else {
      const petg = /petg|abs|asa/i.test(String(it.p.material || ''));
      mat = plasticMaterial(it.p.color);
      mat.userData.layer.value = 1; mat.userData.layerFade.value.set(0.7, 1.7); // real 0.2 mm lines when close, none when far
      mat.roughness = petg ? 0.44 : 0.62;
      mat.clearcoat = this.phone ? 0 : petg ? 0.12 : 0.04;
      mat.sheen = this.phone ? 0 : 0.3;
      mat.envMapIntensity = ENV;
      kind = petg ? 'PETG' : 'Matte PLA';
    }
    it.mat.dispose();
    it.mat = mat; it.mesh.material = mat;
    it.photo = { kind };
    this.tint(it);
    const b = v.matBase(it); mat.transparent = b.transparent; mat.opacity = b.opacity; mat.depthWrite = b.depthWrite;
  }

  /** viewer.tintItem hook: the shown colour of a photoreal part. Printed parts show their real colour, very dark ones
   * lifted a little so their shape still reads. */
  tint(it) {
    const m = it.mat;
    if (it.p.group !== 'component') {
      const c = new THREE.Color(it.p.color || '#cccccc'), L = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      if (L < 0.02) { const k = 0.02 + L * 0.5; if (L < 1e-4) c.setScalar(k); else c.multiplyScalar(k / L); }
      m.color.copy(c);
      if (m.sheenColor) m.sheenColor.copy(c).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.4);
    }
    if (it.edges) it.edges.material.color.copy(m.color).multiplyScalar(0.35);
    this.dirtyPt();
    return m.color.clone();
  }

  /** viewer.apply hook: edges only in X-ray; the shadow and the traced image follow the new pose. */
  apply() {
    const v = this.v, ghost = !!v.ui.ghost;
    for (const it of v.items) if (it.edges && !it.vc) it.edges.visible = ghost;
    this.dirtyShadow = true;
    this.invalidate();
  }

  // ------------------------------------------------------------------------------------------------ raster frame
  _composer() {
    const v = this.v, r = v.renderer;
    if (!this.webgl2) { this.composer = null; return; }
    try {
      const comp = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      this.renderPass = new RenderPass(v.scene, v.camera);
      this.gtao = new ScaledGTAOPass(v.scene, v.camera, this.level >= 1 ? 0.5 : 1);
      this.gtao.blendIntensity = 0.8;
      const ov = this.gtao.overrideVisibility.bind(this.gtao);
      this.gtao.overrideVisibility = () => { // AO from the product only: no shadow plane, halos, phone blob, props floor
        ov();
        const c = this.gtao._visibilityCache;
        v.scene.traverse(o => { if (o.isSprite || (o.isMesh && (o.material?.transparent && o.material.opacity < 0.5 || (o.renderOrder < 0 || o === this.shadow.plane)))) { if (!c.has(o)) c.set(o, o.visible); o.visible = false; } });
        this.root.visible = false;
      };
      const rv = this.gtao.restoreVisibility.bind(this.gtao);
      this.gtao.restoreVisibility = () => { rv(); this.root.visible = true; };
      // the canvas is transparent (CSS backdrop): tone map straight colour, not premultiplied (AgX lifts black, which
      // would turn every see-through pixel white)
      const out = new OutputPass();
      out.material.fragmentShader = out.material.fragmentShader
        .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv ); float pa = gl_FragColor.a; gl_FragColor.rgb /= max( pa, 1e-4 );')
        .replace(/}\s*$/, '\tgl_FragColor = vec4( gl_FragColor.rgb * pa, pa );\n}');
      comp.addPass(this.renderPass); comp.addPass(this.gtao); comp.addPass(out);
      this.composer = comp; this.csz = '';
    } catch (e) { console.warn('photoreal: AO unavailable', e); this.composer = null; }
  }

  _layoutGTAO(R) {
    if (!this.gtao || this._gtaoR === R) return;
    this._gtaoR = R;
    this.gtao.updateGtaoMaterial({ radius: R * 0.1, thickness: R * 0.06, distanceExponent: 1.5, scale: 1.0, samples: this.phone ? 8 : 16 });
    this.gtao.updatePdMaterial({ radius: this.phone ? 4 : 8, lumaPhi: 10, depthPhi: 2, normalPhi: 3, samples: this.phone ? 8 : 16 });
  }

  bounds() {
    const box = new THREE.Box3();
    this.v.world.updateMatrixWorld(true);
    for (const it of this.v.items) if (it.mesh.visible) box.expandByObject(it.mesh);
    return box;
  }

  _shadowPass() {
    const v = this.v;
    if (v.anims.size || v.moving || v.fx?.list?.some(e => e.whole && e.speed > 0)) { // moving parts: refresh ~8x a second
      const n = performance.now(); if (!(n - (this._shT || 0) < 120)) { this._shT = n; this.dirtyShadow = true; }
    }
    const show = !!v.items.length && !v.emptyOn && !v.sketch;
    this.shadow.group.visible = show;
    if (!this.dirtyShadow || !show) return;
    this.dirtyShadow = false;
    const box = this.bounds(); if (box.isEmpty()) { this.shadow.group.visible = false; return; }
    this.shadow.fit(box, 1.1);
    const s = box.getSize(new THREE.Vector3());
    this._layoutGTAO(Math.max(s.x, s.y, s.z, 10));
    const hide = [v.grid, v.vol, v.axes, v.present?.shadow, ...(v.props?.hide || [])].filter(Boolean);
    v.scene.traverse(o => { if (o.visible && (o.isLine || o.isSprite || o.isPoints || o.userData.fx || o.userData.fxGlow)) hide.push(o); });
    const op = v.backdrop === 'dark' ? 0.95 : 0.8;
    this.shadow.render(v.renderer, v.scene, [...new Set(hide)].filter(o => o.visible && o !== this.shadow.plane), op, [7, 4.5, 2.5, 1.2, 0.5]);
  }

  /** viewer.renderNow hook: true when this drew the frame. */
  render() {
    if (!this.on) return false;
    const v = this.v;
    this._shadowPass();
    this._govern();
    if (this.ptState === 'running' || this.ptState === 'done') { this._ptFrame(); return true; }
    this._autoPt();
    return this._raster();
  }

  _raster(camera = this.v.camera) {
    const v = this.v, r = v.renderer;
    if (!this.composer || this.level >= 2 || v.ui.ghost) { r.render(v.scene, camera); return true; }
    const sz = r.getSize(new THREE.Vector2()), pr = r.getPixelRatio(), key = `${sz.x}x${sz.y}@${pr}`;
    if (key !== this.csz) { this.csz = key; this.composer.setPixelRatio(pr); this.composer.setSize(sz.x, sz.y); }
    this.renderPass.camera = camera; this.gtao.camera = camera;
    this.composer.render();
    return true;
  }

  /** Frame-time governor: when the median frame is slower than ~48 fps for 1.5 s, drop one quality level. */
  _govern() {
    const now = performance.now(), f = this.frames;
    if (document.hidden || this.ptState !== 'off' || now < this.settleAt) { f.length = 0; this.lastT = now; return; }
    if (this.lastT) f.push(now - this.lastT);
    this.lastT = now;
    if (f.length < 90) return;
    const med = [...f].sort((a, b) => a - b)[f.length >> 1];
    f.length = 0;
    this.stats.fps = Math.round(1000 / med);
    if (med > 1000 / 48 && this.level < 4) this.setLevel(this.level + 1);
  }

  setLevel(n) {
    const v = this.v, r = v.renderer;
    this.level = n; this.stats.level = n;
    if (this.gtao) { this.gtao.aoScale = n >= 1 ? 0.5 : 1; this.csz = ''; }
    const cap = n >= 4 ? 1.25 : n >= 3 ? 1.5 : 2;
    if (r.getPixelRatio() > cap) { r.setPixelRatio(Math.min(devicePixelRatio, cap)); v.resize(); }
    this.settleAt = performance.now() + 1500;
    console.info('photoreal: quality level', n);
  }

  // ------------------------------------------------------------------------------------------------ photo mode
  /** Input happened: back to raster, photo mode may start again after IDLE_MS. */
  poke() {
    this.idleAt = performance.now() + IDLE_MS;
    this.ptForced = false; // photoMode(true) is one still: input ends it (call it again for another)
    if (this.ptState !== 'off') this.stopPt();
  }
  /** The scene changed (pose, parts, visibility): the traced image is stale and the BVH must be rebuilt. */
  invalidate() { this.ptGeoDirty = true; if (this.ptState !== 'off') this.stopPt(); this.idleAt = Math.max(this.idleAt, performance.now() + IDLE_MS); }
  /** A material changed (colour pick, hover): the traced image is stale. */
  dirtyPt() { this.ptMatDirty = true; if (this.ptState === 'running' || this.ptState === 'done') this.stopPt(); }

  quiet() {
    const v = this.v;
    return v.items.length > 0 && !v.anims.size && !v.moving && !v.sketch && !v.emptyOn && !(v.fx && (v.fx.on || v.fx.k > 0))
      && !v.assembly?.playing && !v.ui.ghost && !v.controls.autoRotate && !v.studio?.on && !document.hidden && !!this.hdr
      && !!v.container.offsetParent;
  }

  _autoPt() { // off by default (Josh, 4 Nov): path tracing only starts from the Photoreal button (photoMode)
    if (!this.ptForced) return;
    if (this.ptState !== 'off' || performance.now() < this.idleAt) return;
    if (!this.quiet()) return;
    if (this.ptOk !== false && this.webgl2 && (this.ptForced || !this.phone)) this.startPt();
  }

  /** viewer.photoMode(on): phones (and desktop) start a path-traced still now; false returns to raster. */
  photoMode(on) {
    if (!on) { this.ptForced = false; this.stopPt(); return false; }
    if (!this.webgl2 || this.ptOk === false) return false;
    this.ptForced = true; this.idleAt = 0;
    const pr = this.v.present; // phone card: hold its slow auto-rotate while the still renders (resumes 8 s after input)
    if (pr && !pr.pip) { pr.idleAt = Infinity; this.v.controls.autoRotate = false; }
    if (this.quiet()) this.startPt();
    return true;
  }

  _emit(state, samples = 0) {
    this.stats.pt = state; this.stats.samples = samples;
    this.v.container.dispatchEvent(new CustomEvent('viewer:photomode', { bubbles: true, detail: { viewer: this.v, state, samples: Math.floor(samples) } }));
  }

  async startPt() {
    if (this.ptState !== 'off') return;
    const v = this.v, r = v.renderer;
    this.ptState = 'loading'; this._emit('loading');
    try {
      if (!this.ptLib) {
        // three-gpu-pathtracer 0.0.23 reads Scene.environmentRotation / backgroundRotation (three >= 0.162); 0.160 lacks them
        for (const k of ['environmentRotation', 'backgroundRotation']) {
          if (!(k in THREE.Scene.prototype)) Object.defineProperty(THREE.Scene.prototype, k, { value: new THREE.Euler(), writable: true, configurable: true });
        }
        this.ptLib = await import('three-gpu-pathtracer');
      }
      if (this.ptState !== 'loading' || !this.quiet()) { if (this.ptState === 'loading') this.ptState = 'off'; this._emit('off'); return; }
      if (!this.pt) {
        const pt = this.pt = new this.ptLib.WebGLPathTracer(r);
        pt.tiles.set(this.phone ? 3 : 2, this.phone ? 3 : 2);
        pt.minSamples = 8; pt.renderDelay = 0; pt.fadeDuration = 450;
        pt.filterGlossyFactor = 0.5; pt.bounces = this.phone ? 3 : 5;
        pt.rasterizeSceneCallback = () => this._raster();
        // edge-aware denoise (the library's smart denoiser) while samples are few; premultiplied output over the canvas
        this.dn = new this.ptLib.DenoiseMaterial({ blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
          blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: false, transparent: true });
        this.dnQuad = new FullScreenQuad(this.dn);
        pt.renderToCanvasCallback = (target, rr, quad) => {
          const ac = rr.autoClear; rr.autoClear = false;
          if (quad.material.opacity >= 1) { // the traced product (transparent background) over the contact shadow and grid
            rr.setRenderTarget(null); rr.clear();
            const m = v.camera.layers.mask; v.camera.layers.set(UNDER_LAYER);
            rr.render(v.scene, v.camera);
            v.camera.layers.mask = m;
            if (pt.renderScale === 1) {
              const n = pt.samples;
              this.dn.map = target.texture;
              this.dn.sigma = Math.max(1.2, 4.5 * (1 - n / 140)); this.dn.threshold = 0.035; this.dn.kSigma = 1;
              this.dnQuad.render(rr);
              rr.autoClear = ac;
              return;
            }
            quad.material.blending = THREE.NormalBlending;
          }
          quad.render(rr);
          rr.autoClear = ac;
        };
      }
      const pt = this.pt;
      // about 2 MP at most: converges in a few seconds on a laptop GPU
      const px = r.getDrawingBufferSize(new THREE.Vector2());
      pt.renderScale = Math.min(1, Math.sqrt((this.phone ? 0.9e6 : 2.2e6) / Math.max(1, px.x * px.y)));
      this._ptScene();
      this.ptT0 = performance.now();
      this.ptState = 'running'; this._emit('running', 0);
    } catch (e) {
      console.warn('photoreal: photo mode unavailable', e);
      this.ptOk = false; this.ptState = 'off'; this._emit('error');
    }
  }

  /** Hand the scene to the path tracer (geometry only when it changed; materials and camera every time). */
  /** The path tracer's own scene: a proxy per visible product mesh (shared material, baked world matrix). Library parts
   * carry RGB vertex colours; the tracer pads missing colours to RGBA and fails to merge a mix, so those get an RGBA
   * copy here (cached per geometry). Shadow plane, grid, halos and fx overlays are left out. */
  _ptProxy() {
    const v = this.v, scene = new THREE.Scene(), skip = new Set([this.root, v.vol, v.axes, v.present?.shadow].filter(Boolean));
    const cache = this.ptGeo || (this.ptGeo = new Map()), used = new Set();
    const walk = o => {
      if (!o.visible || skip.has(o) || o.isSprite || o.userData.fx || o.userData.fxGlow) return;
      if (o.isMesh && o.geometry?.attributes?.position && !(o.material?.transparent && o.material.opacity < 0.05)) {
        let g = o.geometry; const col = g.attributes.color;
        if (col && col.itemSize === 3) {
          const k = g.uuid + ':' + col.version;
          let c = cache.get(k);
          if (!c) {
            c = new THREE.BufferGeometry();
            for (const n of ['position', 'normal', 'uv']) if (g.attributes[n]) c.setAttribute(n, g.attributes[n]);
            const a = new Float32Array(col.count * 4);
            for (let i = 0; i < col.count; i++) { a[i * 4] = col.getX(i); a[i * 4 + 1] = col.getY(i); a[i * 4 + 2] = col.getZ(i); a[i * 4 + 3] = 1; }
            c.setAttribute('color', new THREE.BufferAttribute(a, 4));
            if (g.index) c.setIndex(g.index);
            for (const gr of g.groups) c.addGroup(gr.start, gr.count, gr.materialIndex);
            cache.set(k, c);
          }
          used.add(k); g = c;
        }
        const m = new THREE.Mesh(g, o.material);
        m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrixWorld.copy(o.matrixWorld);
        scene.add(m);
      }
      for (const c of o.children) walk(c);
    };
    v.scene.updateMatrixWorld(true);
    for (const c of v.scene.children) walk(c);
    for (const [k, g] of cache) if (!used.has(k)) { g.dispose(); cache.delete(k); }
    scene.environment = this.hdr; scene.background = null;
    return scene;
  }

  /** Hand the scene to the path tracer (geometry only when it changed; materials and camera every time). */
  _ptScene() {
    const v = this.v, pt = this.pt;
    // the path tracer renders thin clearcoat + reduced specular too dark on these plastics: plain values while it reads them
    const mats = [];
    v.scene.traverse(o => { const m = o.isMesh && o.material; if (m?.isMeshPhysicalMaterial && !mats.some(x => x[0] === m)) { mats.push([m, m.clearcoat, m.specularIntensity]); m.clearcoat = 0; m.specularIntensity = 1; } });
    try {
      if (this.ptGeoDirty || !this.ptBuilt) { this.ptSceneObj = this._ptProxy(); pt.setScene(this.ptSceneObj, v.camera); this.ptBuilt = true; this.ptGeoDirty = false; }
      else { pt.updateMaterials(); pt.setCamera(v.camera); }
      this.ptMatDirty = false;
    } finally {
      for (const [m, cc, si] of mats) { m.clearcoat = cc; m.specularIntensity = si; }
    }
    pt.pausePathTracing = false;
    pt.reset();
  }

  _ptFrame() {
    const pt = this.pt, v = this.v;
    if (this.ptState === 'running') {
      v.camera.updateMatrixWorld();
      pt.renderSample();
      const n = pt.samples;
      this._emit('running', n);
      if (n >= PT_SAMPLES || performance.now() - this.ptT0 > PT_MAX_MS * (this.phone ? 2 : 1) && n >= 24) {
        this.ptState = 'done'; pt.pausePathTracing = true; this._emit('done', n);
        this.ptDoneMs = Math.round(performance.now() - this.ptT0); this.stats.ptMs = this.ptDoneMs;
      }
    } else pt.renderSample(); // paused: presents the converged image
  }

  stopPt() {
    const pr = this.v.present;
    if (pr && pr.idleAt === Infinity && !this.v.controls.autoRotate && !this.ptForced) pr.idleAt = performance.now() + 8000;
    if (this.ptState === 'off') return;
    this.ptState = 'off';
    if (this.pt) this.pt.pausePathTracing = true;
    this._emit('off');
  }
}
