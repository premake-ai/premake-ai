// Render mode for the viewer: PBR materials, studio lighting (RoomEnvironment), a seamless backdrop with a soft
// contact shadow, optional ambient occlusion, filament colours, printed layer lines, turntable, hi-res stills and an
// optional progressive path tracer. Everything here is additive: exit() puts the CAD look back exactly as it was.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { subpartRenderMaterial } from './finish.js';
import { lookStudio } from './materials.js'; // materials: real materials (acrylic, metals, wood, PCB, rubber)

export const FILAMENTS = [
  { id: 'black', label: 'Matte black', hex: '#1f2023' },
  { id: 'white', label: 'White', hex: '#e9e7e1' },
  { id: 'grey', label: 'Grey', hex: '#8b8f95' },
  { id: 'orange', label: 'Orange', hex: '#f26a1b' },
  { id: 'blue', label: 'Blue', hex: '#2c63d6' },
  { id: 'green', label: 'Green', hex: '#2f9a5a' },
  { id: 'red', label: 'Red', hex: '#cf3a30' },
];

export const BACKDROPS = {
  light: { bg: '#d3d5d9', floor: '#efeff0', shadow: 0.75 },
  dark: { bg: '#141518', floor: '#24262b', shadow: 0.85 },
};

const LAYER_H = 0.2; // mm, real layer height
const ENV = 0.55;     // environment (RoomEnvironment) strength on product materials; the key light does the shaping

// ---------- materials ----------

/** Matte / satin printed plastic with optional procedural layer lines (world CAD Z, view-dependent fade). */
export function plasticMaterial(hex) {
  const m = new THREE.MeshPhysicalMaterial({
    color: hex, roughness: 0.6, metalness: 0, clearcoat: 0.06, clearcoatRoughness: 0.45,
    sheen: 0.35, sheenRoughness: 0.8, sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.4),
    specularIntensity: 0.6, side: THREE.DoubleSide, envMapIntensity: ENV,
  });
  const uLayer = { value: 0 }, uLayerH = { value: LAYER_H }, uLayerFade = { value: new THREE.Vector2(2.6, 3.6) };
  m.userData.layer = uLayer; m.userData.layerFade = uLayerFade; // photoreal.js fades them out sooner (no coarse fake lines)
  m.onBeforeCompile = sh => {
    sh.uniforms.uLayer = uLayer; sh.uniforms.uLayerH = uLayerH; sh.uniforms.uLayerFade = uLayerFade;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vCadZ;\nvarying vec3 vLayerAxis;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCadZ = transformed.z;\nvLayerAxis = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vCadZ;\nvarying vec3 vLayerAxis;\nuniform float uLayer;\nuniform float uLayerH;\nuniform vec2 uLayerFade;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uLayer > 0.5) {
          // Layer lines at the real 0.2 mm when there are enough pixels; when zoomed out, the period doubles
          // (blended) so lines stay visible instead of aliasing into moire, and fade away entirely when far.
          float w0 = fwidth(vCadZ / uLayerH);
          float lv = max(0.0, log2(max(w0, 1e-5) / 0.16));
          float k = floor(lv), tb = fract(lv);
          float p1 = uLayerH * exp2(k), p2 = p1 * 2.0;
          float s1 = fract(vCadZ / p1) * 2.0 - 1.0, s2 = fract(vCadZ / p2) * 2.0 - 1.0;
          float b1 = s1 / sqrt(max(1.0 - 0.92 * s1 * s1, 0.04)), b2 = s2 / sqrt(max(1.0 - 0.92 * s2 * s2, 0.04));
          float slope = mix(b1, b2, smoothstep(0.0, 1.0, tb));
          float fade = (1.0 - smoothstep(uLayerFade.x, uLayerFade.y, lv)) * mix(0.34, 0.2, clamp(lv, 0.0, 1.0));
          vec3 ax = normalize(vLayerAxis);
          vec3 t = ax - normal * dot(normal, ax);
          float tl = length(t);
          if (fade > 0.0 && tl > 0.05) normal = normalize(normal + (t / tl) * slope * fade * tl);
          roughnessFactor = min(1.0, roughnessFactor + 0.06);
        }`);
  };
  m.customProgramCacheKey = () => 'forma-plastic-v2';
  return m;
}

const RX = {
  led: /\bleds?\b|light strip|lamp|bulb/i,
  glass: /glass|acrylic|lens\b/i,
  rubber: /rubber|grip|feet|foot\b|bumper|silicone|neoprene|o-?ring|tire|tyre|gasket|anti-?slip/i,
  felt: /felt|fabric|cloth|foam|cork/i,
  wood: /wood\b|oak|pine|dowel|plywood|bamboo|walnut|maple|board\b/i,
  stainless: /stainless|alumin|chrome|steel bowl|channel/i,
  spring: /spring/i,
  metal: /bolt|screw|nut\b|nuts\b|nylock|washer|rivet|pin\b|rod\b|magnet|carabiner|hinge|bearing|insert|steel|zinc|brass|hook|nail|anchor/i,
  cable: /cable|wire|tubing|hose|cord/i,
  electronics: /pcb|relay|thermostat|module|arduino|esp32|sensor|switch|fuse|dimmer|inlet|battery|motor|pump|fan|tec\d|peltier/i,
};

/** Realistic preset for a bought-part dummy, by name. */
export function componentMaterial(name, hex) {
  const own = new THREE.Color(hex || '#888888');
  const grey = new THREE.Color('#7f838a');
  const P = o => new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, envMapIntensity: o.metalness ? 1 : ENV, ...o });
  if (RX.led.test(name)) return { kind: 'LED', mat: P({ color: '#f4f1e8', roughness: 0.35, emissive: '#fff1d0', emissiveIntensity: 2.2 }) };
  if (RX.glass.test(name)) return { kind: 'Glass', mat: P({ color: '#ffffff', roughness: 0.04, transmission: 0.95, thickness: 2, ior: 1.5, metalness: 0 }) };
  if (RX.rubber.test(name)) return { kind: 'Rubber', mat: P({ color: '#1e1f21', roughness: 0.92, sheen: 0.4, sheenRoughness: 0.9, sheenColor: new THREE.Color('#3a3c40') }) };
  if (RX.felt.test(name)) return { kind: 'Fabric', mat: P({ color: own.clone().lerp(grey, 0.2), roughness: 1, sheen: 1, sheenRoughness: 0.6, sheenColor: own.clone().lerp(new THREE.Color('#ffffff'), 0.4) }) };
  if (RX.stainless.test(name)) return { kind: 'Brushed metal', mat: P({ color: '#cfd3d8', metalness: 1, roughness: 0.28 }) };
  if (RX.spring.test(name)) return { kind: 'Spring steel', mat: P({ color: '#b9bec4', metalness: 1, roughness: 0.32 }) };
  if (RX.metal.test(name)) {
    const dark = own.getHSL({}).l < 0.25;
    return { kind: dark ? 'Black oxide' : 'Zinc', mat: P({ color: dark ? '#3b3e43' : '#c3c7cc', metalness: 1, roughness: dark ? 0.45 : 0.36 }) };
  }
  if (RX.wood.test(name)) return { kind: 'Wood', mat: P({ color: own, roughness: 0.72, clearcoat: 0.15, clearcoatRoughness: 0.6 }) };
  if (RX.cable.test(name)) return { kind: 'Cable', mat: P({ color: own, roughness: 0.45, clearcoat: 0.3 }) };
  if (RX.electronics.test(name)) return { kind: 'Plastic', mat: P({ color: own.clone().lerp(grey, 0.35), roughness: 0.5 }) };
  return { kind: 'Plastic', mat: P({ color: own.clone().lerp(grey, 0.5), roughness: 0.55 }) };
}

// ---------- backdrop ----------

function makeGround() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { cFloor: { value: new THREE.Color() }, cBg: { value: new THREE.Color() } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 cFloor; uniform vec3 cBg; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; float k = smoothstep(0.02, 0.62, r);
        gl_FragColor = vec4(mix(cFloor, cBg, k), 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false, depthWrite: true,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.rotation.x = -Math.PI / 2; m.renderOrder = -2;
  return m;
}

/** Contact shadow: depth rendered from below into a target, blurred twice (three.js webgl_shadow_contact technique). */
export class ContactShadow {
  constructor() {
    this.size = 512;
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size); this.rt.texture.generateMipmaps = false;
    this.rtBlur = new THREE.WebGLRenderTarget(this.size, this.size); this.rtBlur.texture.generateMipmaps = false;
    this.group = new THREE.Group();
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.rt.texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 1 }));
    this.plane.renderOrder = -1; this.plane.scale.y = -1;
    this.group.add(this.plane);
    this.blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)); this.blurPlane.visible = false;
    this.group.add(this.blurPlane);
    this.cam = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1); this.cam.rotation.x = Math.PI / 2;
    this.group.add(this.cam);
    this.depthMat = new THREE.MeshDepthMaterial(); this.depthMat.side = THREE.DoubleSide;
    this.darkness = { value: 2.2 };
    this.depthMat.onBeforeCompile = sh => {
      sh.uniforms.darkness = this.darkness;
      sh.fragmentShader = 'uniform float darkness;\n' + sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
        'gl_FragColor = vec4( vec3( 0.0 ), min( 1.0, pow( 1.0 - fragCoordZ, 1.8 ) * darkness ) );');
    };
    this.depthMat.depthTest = false; this.depthMat.depthWrite = false;
    this.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader); this.hBlur.depthTest = false;
    this.vBlur = new THREE.ShaderMaterial(VerticalBlurShader); this.vBlur.depthTest = false;
  }
  fit(box, reach = 0.6) { // box: world-space bounds of visible product; reach: how high (x the size) parts still cast
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const w = Math.max(s.x, s.z) * 1.7 + s.y * 0.35, h = Math.max(Math.min(s.y, Math.max(s.x, s.z)), 1) * reach;
    this.group.position.set(c.x, box.min.y + 0.05, c.z);
    this.plane.scale.set(w, -1, w); this.blurPlane.scale.set(w, 1, w);
    Object.assign(this.cam, { left: -w / 2, right: w / 2, top: w / 2, bottom: -w / 2, near: 0, far: h });
    this.cam.updateProjectionMatrix();
    this.w = w;
  }
  blur(renderer, amount) {
    const bp = this.blurPlane; bp.visible = true;
    bp.material = this.hBlur; this.hBlur.uniforms.tDiffuse.value = this.rt.texture; this.hBlur.uniforms.h.value = amount / 256;
    renderer.setRenderTarget(this.rtBlur); renderer.render(bp, this.cam);
    bp.material = this.vBlur; this.vBlur.uniforms.tDiffuse.value = this.rtBlur.texture; this.vBlur.uniforms.v.value = amount / 256;
    renderer.setRenderTarget(this.rt); renderer.render(bp, this.cam);
    bp.visible = false;
  }
  render(renderer, scene, hide, opacity, blurs = [1.1, 0.45]) { // photoreal.js: wider blurs
    this.plane.material.opacity = opacity;
    const bg = scene.background, ov = scene.overrideMaterial, prevTarget = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha();
    for (const o of hide) o.visible = false;
    this.plane.visible = false;
    scene.background = null; scene.overrideMaterial = this.depthMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt); renderer.clear(); renderer.render(scene, this.cam);
    scene.overrideMaterial = null;
    for (const b of blurs) this.blur(renderer, b);
    renderer.setRenderTarget(prevTarget);
    scene.overrideMaterial = ov; scene.background = bg;
    renderer.setClearColor(clear, ca);
    for (const o of hide) o.visible = true;
    this.plane.visible = true;
  }
}

// ---------- studio ----------

export class Studio {
  constructor(viewer) {
    this.v = viewer;
    this.on = false;
    this.opts = { finish: 'printed', backdrop: 'light', ao: true, colors: { all: null, parts: {} } };
    this.turntable = false;
    this.dirtyShadow = true;
    this.pt = null; this.ptState = 'off'; // off | loading | running | done | error
    this.onPt = null; // callback(state, samples)
    this.PT_TARGET = 200;
    viewer.controls.addEventListener('start', () => { if (this.ptState === 'running' || this.ptState === 'done') this.stopPt(); });
  }

  _init() {
    if (this.root) return;
    const r = this.v.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    this.envScene = new RoomEnvironment(r);
    this.env = pmrem.fromScene(this.envScene, 0.04).texture;
    pmrem.dispose();
    this.root = new THREE.Group(); this.root.visible = false;
    this.ground = makeGround(); this.root.add(this.ground);
    this.shadow = new ContactShadow(); this.root.add(this.shadow.group);
    this.key = new THREE.DirectionalLight(0xffffff, 2.6);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 10; this.key.shadow.blurSamples = 20; this.key.shadow.bias = -0.0004;
    this.root.add(this.key); this.root.add(this.key.target);
    this.catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.22, depthWrite: false }));
    this.catcher.receiveShadow = true; this.catcher.renderOrder = -1;
    this.root.add(this.catcher);
    this.v.scene.add(this.root);
    // AO via composer (optional; turned off automatically if the GPU is slow)
    try {
      const comp = new EffectComposer(r, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
      this.renderPass = new RenderPass(this.v.scene, this.v.camera);
      this.gtao = new GTAOPass(this.v.scene, this.v.camera, 1, 1);
      this.gtao.blendIntensity = 0.85;
      // AO only on the product: the backdrop in the G-buffer gives dark smears at the screen edges
      const ov = this.gtao.overrideVisibility.bind(this.gtao);
      this.gtao.overrideVisibility = () => { ov(); this.root.visible = false; };
      comp.addPass(this.renderPass); comp.addPass(this.gtao); comp.addPass(new OutputPass());
      this.composer = comp;
    } catch (e) { console.warn('AO unavailable', e); this.composer = null; }
  }

  /** Apply the saved look options without touching state outside render mode. */
  setOpts(o) {
    Object.assign(this.opts, o);
    if (this.on) {
      this.resetPt(); // look changes end a photoreal pass (it restarts from the button)
      this._applyLook();
    }
  }

  enter() {
    if (this.on) return;
    this._init();
    const v = this.v, r = v.renderer;
    this.saved = {
      bg: v.scene.background, env: v.scene.environment, tm: r.toneMapping, exp: r.toneMappingExposure,
      maxPolar: v.controls.maxPolarAngle, gridVis: v.grid.visible, lights: v.lights.map(l => l.visible),
      shadows: r.shadowMap.enabled, shadowType: r.shadowMap.type,
    };
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.VSMShadowMap;
    this.on = true;
    v.grid.visible = false; v.lights.forEach(l => (l.visible = false));
    v.scene.environment = this.env;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    v.controls.maxPolarAngle = Math.PI * 0.485;
    this.root.visible = true;
    this.syncItems();
    this._applyLook();
    this.resize();
    v.controls.autoRotate = this.turntable; v.controls.autoRotateSpeed = 1.5;
  }

  exit() {
    if (!this.on) return;
    this.stopPt();
    const v = this.v, r = v.renderer, s = this.saved;
    this.on = false;
    v.scene.background = s.bg; v.scene.environment = s.env;
    r.toneMapping = s.tm; r.toneMappingExposure = s.exp;
    r.shadowMap.enabled = s.shadows; r.shadowMap.type = s.shadowType;
    for (const it of v.items) it.mesh.castShadow = false;
    v.controls.maxPolarAngle = s.maxPolar; v.controls.autoRotate = false;
    v.grid.visible = s.gridVis; v.lights.forEach((l, i) => (l.visible = s.lights[i]));
    this.root.visible = false;
    lookStudio(this, false);
    for (const it of v.items) { it.mesh.material = it.mat; if (it.cgeo) it.mesh.geometry = it.cgeo; if (it.edges) it.edges.visible = !it.vc; }
  }

  /** Give every item a render material (created once per loaded mesh) and hide CAD edges. */
  syncItems() {
    for (const it of this.v.items) {
      if (!it.rmat && it.look) it.rmat = it.look.renderMat(this); // materials: preset render material
      if (!it.rmat) {
        if (it.vc) { it.rmat = subpartRenderMaterial(); it.p.finish = 'Detailed'; } // library part: finishes per vertex
        else if (it.p.group === 'component') { const c = componentMaterial(it.p.name, it.p.color); it.rmat = c.mat; it.p.finish = c.kind; }
        else it.rmat = plasticMaterial(it.p.color);
      }
      if (!it.rgeo) { // smooth shading across curved faces, hard edges kept (STL normals are per facet)
        try { it.rgeo = toCreasedNormals(it.mesh.geometry, Math.PI / 6); it.cgeo = it.mesh.geometry; } catch { it.rgeo = it.mesh.geometry; it.cgeo = it.mesh.geometry; }
      }
      if (this.on) { it.mesh.material = it.rmat; it.mesh.geometry = it.rgeo; it.mesh.castShadow = true; if (it.edges) it.edges.visible = false; }
    }
    this.dirtyShadow = true;
  }

  caseColor(it) {
    const c = this.opts.colors;
    return c.parts?.[it.p.name] || c.all || it.p.color;
  }

  _applyLook() {
    const v = this.v, b = BACKDROPS[this.opts.backdrop] || BACKDROPS.light;
    v.scene.background = new THREE.Color(b.bg);
    this.ground.material.uniforms.cBg.value.set(b.bg);
    this.ground.material.uniforms.cFloor.value.set(b.floor);
    this.shadowOpacity = b.shadow;
    for (const it of v.items) {
      if (it.look && it.rmat) { it.look.applyRender(this); continue; } // materials: presets ignore the filament colour
      if (it.p.group === 'component' || !it.rmat || it.vc) continue;
      const hex = this.caseColor(it);
      it.rmat.color.set(hex);
      it.rmat.sheenColor.set(hex).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(0.4);
      const printed = this.opts.finish === 'printed';
      it.rmat.userData.layer.value = printed ? 1 : 0;
      it.rmat.roughness = printed ? 0.66 : 0.56;
      it.rmat.clearcoat = printed ? 0.03 : 0.08;
    }
    lookStudio(this, true); // materials: opaque clear colour for real transmission
    this.dirtyShadow = true;
  }

  /** Product bounds in three.js world space (visible meshes only, explode applied). */
  bounds() {
    const box = new THREE.Box3();
    this.v.world.updateMatrixWorld(true);
    for (const it of this.v.items) if (it.mesh.visible) box.expandByObject(it.mesh);
    return box;
  }

  /** Hero/kit framing: the product itself, without a part that sticks far out of it (a 0.5 m USB extension lead, a
   * long cable): a part is left out when, without it, the rest is under 2/3 of the size. Up to 3 such parts. */
  coreBounds() {
    this.v.world.updateMatrixWorld(true);
    let boxes = this.v.items.filter(it => it.mesh.visible).map(it => new THREE.Box3().setFromObject(it.mesh)).filter(b => !b.isEmpty());
    const union = list => list.reduce((a, b) => a.union(b), new THREE.Box3());
    const dim = b => { const s = b.getSize(new THREE.Vector3()); return Math.max(s.x, s.y, s.z); };
    for (let k = 0; k < 3 && boxes.length > 2; k++) {
      const all = dim(union(boxes));
      let worst = -1, best = all;
      boxes.forEach((_, i) => { const d = dim(union(boxes.filter((__, j) => j !== i))); if (d < best) { best = d; worst = i; } });
      if (worst < 0 || best * 1.5 > all) break;
      boxes = boxes.filter((_, j) => j !== worst);
    }
    return union(boxes);
  }

  _layout() {
    const box = this.bounds();
    if (box.isEmpty()) return;
    const s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const R = Math.max(s.x, s.y, s.z, 10);
    this.ground.scale.set(R * 60, R * 60, 1);
    this.ground.position.set(c.x, box.min.y, c.z);
    this.shadow.fit(box);
    this.key.position.set(c.x - R * 1.2, c.y + R * 3.2, c.z + R * 1.6); this.key.target.position.copy(c);
    const sc = this.key.shadow.camera, e = R * 1.6;
    Object.assign(sc, { left: -e, right: e, top: e, bottom: -e, near: R * 0.5, far: R * 8 }); sc.updateProjectionMatrix();
    this.key.shadow.needsUpdate = true;
    this.catcher.scale.set(R * 8, 1, R * 8); this.catcher.position.set(c.x, box.min.y + 0.02, c.z);
    if (this.gtao) {
      this.gtao.updateGtaoMaterial({ radius: R * 0.12, thickness: R * 0.08, distanceExponent: 1.5, scale: 1.1, samples: 16 });
      this.gtao.updatePdMaterial({ radius: 8, lumaPhi: 10, depthPhi: 2, normalPhi: 3 });
    }
    this.R = R;
  }

  _shadowPass() {
    if (!this.dirtyShadow) return;
    this.dirtyShadow = false;
    this._layout();
    this.shadow.render(this.v.renderer, this.v.scene, [this.ground, this.catcher, ...(this.v.props?.hide || [])], this.shadowOpacity ?? 0.7); // scene.js props: not in the contact shadow
  }

  resize() {
    if (!this.composer) return;
    const r = this.v.renderer, sz = r.getSize(new THREE.Vector2());
    this.composer.setPixelRatio(r.getPixelRatio());
    this.composer.setSize(sz.x, sz.y);
  }

  /** One frame of render mode (called from the viewer's loop). */
  frame() {
    const v = this.v;
    if (this.ptState === 'running' || this.ptState === 'done') return this._ptFrame();
    this._shadowPass();
    if (this.opts.ao && this.composer) {
      const t0 = performance.now();
      this.renderPass.camera = v.camera; this.gtao.camera = v.camera;
      this.composer.render();
      this._perf(performance.now() - t0);
    } else v.renderer.render(v.scene, v.camera);
  }

  _perf(ms) { // turn AO off if the last 30 frames averaged more than 40 ms of CPU-side submit time
    this._pf = (this._pf || []); this._pf.push(ms);
    if (this._pf.length > 30) { const avg = this._pf.reduce((a, b) => a + b) / this._pf.length; this._pf = []; if (avg > 40) { this.opts.ao = false; console.info('Render mode: AO off (slow GPU)'); } }
  }

  /**
   * Render a still. w/h in device pixels. Works from CAD mode too (enters render mode for one frame).
   * camera: 'current' keeps the user's view, 'hero' frames the product at a 3/4 angle.
   */
  snapshot({ width, height, transparent = false, camera = 'current' } = {}) {
    const v = this.v, r = v.renderer;
    if (!v.items.length) return null;
    const wasOn = this.on;
    if (!wasOn) this.enter();
    this.stopPt();
    const pr = r.getPixelRatio(), sz = r.getSize(new THREE.Vector2());
    const cam = v.camera.clone();
    cam.aspect = width / height;
    if (camera === 'hero') {
      const box = this.coreBounds(), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      const R = Math.max(s.x, s.y, s.z);
      const fit = Math.max(R / Math.min(1, cam.aspect), R) * 1.95;
      cam.position.set(c.x - fit * 0.8, c.y + fit * 0.78, c.z + fit * 1.0);
      cam.near = fit / 100; cam.far = fit * 100; cam.lookAt(c.x, c.y - s.y * 0.02, c.z);
    }
    cam.updateProjectionMatrix();
    r.setPixelRatio(1); r.setSize(width, height, false);
    this.dirtyShadow = true; this._shadowPass();
    let url;
    const fxOff = []; // changefx / editglow shells and particles: not part of the product
    v.scene.traverse(o => { if ((o.userData.fx || o.userData.fxGlow) && o.visible) { o.visible = false; fxOff.push(o); } });
    try {
      if (transparent) {
        const bg = v.scene.background; v.scene.background = null; this.ground.visible = false;
        const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
        r.setClearColor(0x000000, 0);
        r.render(v.scene, cam);
        url = r.domElement.toDataURL('image/png');
        r.setClearColor(cc, ca); v.scene.background = bg; this.ground.visible = true;
      } else if (this.opts.ao && this.composer) {
        this.composer.setPixelRatio(1); this.composer.setSize(width, height);
        this.renderPass.camera = cam; this.gtao.camera = cam;
        this.composer.render();
        url = r.domElement.toDataURL('image/png');
        this.renderPass.camera = v.camera; this.gtao.camera = v.camera;
      } else { r.render(v.scene, cam); url = r.domElement.toDataURL('image/png'); }
    } finally {
      for (const o of fxOff) o.visible = true;
      r.setPixelRatio(pr); r.setSize(sz.x, sz.y, false);
      this.resize();
      if (!wasOn) this.exit();
      v.renderNow();
    }
    return url;
  }

  setTurntable(on) {
    this.turntable = on;
    if (this.on) this.v.controls.autoRotate = on;
    if (on) this.stopPt();
  }

  // ---------- photoreal (three-gpu-pathtracer, loaded on demand) ----------
  async startPt() {
    if (!this.on || this.ptState === 'loading') return;
    this.setTurntable(false);
    this.ptState = 'loading'; this.onPt?.('loading', 0);
    try {
      if (!this.ptLib) {
        // three-gpu-pathtracer 0.0.23 reads Scene.environmentRotation / backgroundRotation (three >= 0.162); 0.160 lacks them
        for (const k of ['environmentRotation', 'backgroundRotation']) {
          if (!(k in THREE.Scene.prototype)) Object.defineProperty(THREE.Scene.prototype, k, { value: new THREE.Euler(), writable: true, configurable: true });
        }
        this.ptLib = await import('three-gpu-pathtracer');
      }
      if (!this.on || this.ptState !== 'loading') return;
      const v = this.v, r = v.renderer;
      if (!this.pt) {
        this.pt = new this.ptLib.WebGLPathTracer(r);
        this.pt.tiles.set(2, 2);
        this.pt.minSamples = 1; this.pt.renderDelay = 0; this.pt.fadeDuration = 300;
        this.pt.filterGlossyFactor = 0.5; this.pt.bounces = 6;
        // cube env for the path tracer (it can't read a PMREM texture)
        const crt = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
        new THREE.CubeCamera(0.1, 100, crt).update(r, this.envScene);
        this.ptEnv = crt.texture;
        this.ptFloor = new THREE.Mesh(new THREE.CircleGeometry(0.5, 96).rotateX(-Math.PI / 2),
          new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }));
      }
      this._ptScene(true);
      this.pt.setScene(v.scene, v.camera);
      this.ptState = 'running'; this.onPt?.('running', 0);
    } catch (e) {
      console.warn('Photoreal unavailable', e);
      this._ptScene(false);
      this.ptState = 'error'; this.onPt?.('error', 0);
    }
  }

  _ptScene(on) {
    const v = this.v, b = BACKDROPS[this.opts.backdrop] || BACKDROPS.light;
    if (on) {
      this._layout();
      this.ground.visible = false; this.shadow.group.visible = false; this.key.visible = false; this.catcher.visible = false;
      this.ptFloor.material.color.set(b.floor).lerp(new THREE.Color(b.bg), 0.35);
      this.ptFloor.scale.setScalar(this.R * 120); this.ptFloor.position.copy(this.ground.position);
      if (!v.props?.active) v.scene.add(this.ptFloor); // scene.js: the scene has its own floor / desk
      v.scene.environment = this.ptEnv;
      // the path tracer renders thin clearcoat + reduced specular as black on these plastics: use plain values while it runs
      this._ptSaved = v.items.filter(it => it.p.group !== 'component' && it.rmat).map(it => [it.rmat, it.rmat.clearcoat, it.rmat.specularIntensity]);
      for (const [m] of this._ptSaved) { m.clearcoat = 0; m.specularIntensity = 1; }
    } else {
      this.ground.visible = true; this.shadow.group.visible = true; this.key.visible = true; this.catcher.visible = true;
      if (this.ptFloor) v.scene.remove(this.ptFloor);
      for (const [m, cc, si] of this._ptSaved || []) { m.clearcoat = cc; m.specularIntensity = si; }
      this._ptSaved = null;
      if (this.on) v.scene.environment = this.env;
    }
  }

  _ptFrame() {
    const pt = this.pt;
    if (this.ptState === 'running') {
      this.v.camera.updateMatrixWorld();
      pt.renderSample();
      const n = Math.floor(pt.samples);
      this.onPt?.('running', n);
      if (n >= this.PT_TARGET) { this.ptState = 'done'; pt.pausePathTracing = true; this.onPt?.('done', n); }
    } else pt.renderSample(); // 'done': paused, just presents the converged image
  }

  resetPt() { if (this.ptState === 'running' || this.ptState === 'done' || this.ptState === 'loading') this.stopPt(); }

  stopPt() {
    if (this.ptState === 'off' || this.ptState === 'error') return;
    const was = this.ptState;
    this.ptState = 'off';
    if (this.pt) this.pt.pausePathTracing = false;
    if (was !== 'loading') this._ptScene(false);
    this.onPt?.('off', 0);
  }
}
