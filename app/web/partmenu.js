// Part context menu for the 3D viewer: right-click (or long-press) a part to hide it (see-through), hide it completely,
// isolate it, find it in the parts tree, ask the agent to change it, read its info, or download its STEP / STL / DXF
// (only the files that exist, from GET /api/make/<id>, server/makefiles.js) and copy its name. Left-click selects (outline).
// Keys: H hides the hovered / selected part, Alt+H or Shift+H shows all, Escape closes the menu.
//
// State is kept by part NAME so it survives live model reloads. "Hide completely" uses the viewer's own `hidden`
// set (the parts tree's eye buttons), so the two never disagree. Hooks in viewer.js (marked `// partmenu:`) call
// base() from matBase() and apply() from Viewer.apply() / setRender().
import * as THREE from 'three';

const SEE = { transparent: true, opacity: 0.12, depthWrite: false };
const EDGE_SEE = 0.06, EDGE_BASE = 0.35;
const PROCESS = { print: '3D printed', extrusion: 'Aluminium extrusion', sheet: 'Sheet metal', laser: 'Laser cut', bought: 'Bought part' };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EYE_SEE = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 1.4"/><circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

export function attachPartMenu(v, ctx = {}) {
  if (v.partmenu) return v.partmenu;
  const S = ctx.state || {};
  const canvas = v.renderer.domElement;
  const pane = v.container.closest('.model-pane') || v.container.parentElement;
  const see = new Set();     // names shown see-through
  let isolated = null;       // name kept solid by Isolate (new parts arriving while isolated go see-through too)
  let known = new Set();     // names present at the last apply()
  let sel = null;            // left-click selection (light outline)
  let target = null;         // part the menu is open for (accent outline)
  let bypass = false;
  let lastSelPart = S.selPart ?? null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const pointer = { x: 0, y: 0, inside: false };

  // ---------- state ----------
  const names = () => new Set(v.items.map(it => it.p.name));
  const itemOf = name => v.items.find(it => it.p.name === name) || null;
  const isSee = name => see.has(name) && !v.hidden.has(name);
  const hiddenCount = () => { const n = names(); let c = 0; for (const x of n) if (see.has(x) || v.hidden.has(x)) c++; return c; };

  /** Rest material state for an item, as the viewer computes it without us. */
  function rawBase(it) { bypass = true; try { return v.matBase(it); } finally { bypass = false; } }

  function setMatState(m, s) {
    if (!m) return;
    if (m.transparent !== s.transparent) m.needsUpdate = true;
    m.transparent = s.transparent; m.opacity = s.opacity; m.depthWrite = s.depthWrite;
  }
  /** Render-mode material: stash its own look the first time we make it see-through, put it back after. */
  function setRmat(m, on) {
    if (!m) return;
    if (on) {
      if (!m.userData.pmOrig) m.userData.pmOrig = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      setMatState(m, SEE);
    } else if (m.userData.pmOrig) { setMatState(m, m.userData.pmOrig); delete m.userData.pmOrig; }
  }

  /** viewer.matBase hook: see-through parts rest at SEE (fade-ins land there too). */
  function base(it) {
    if (bypass || !isSee(it.p.name)) return null;
    if (!it.anim && it.edges) it.edges.material.opacity = EDGE_SEE;
    return { ...SEE };
  }

  /** viewer.apply hook: runs after the viewer has set visibility / ghost on every item. */
  function apply() {
    const n = names();
    if (v.items.length) {
      for (const x of n) if (!known.has(x) && isolated && x !== isolated) see.add(x); // new part while isolated
      for (const x of [...see]) if (!n.has(x)) see.delete(x);
      for (const x of [...v.hidden]) if (!n.has(x)) v.hidden.delete(x);
      if (isolated && !n.has(isolated)) isolated = null;
      if (sel && !n.has(sel)) sel = null;
      if (target && !n.has(target)) closeMenu();
      known = n;
    }
    for (const it of v.items) {
      const on = isSee(it.p.name);
      if (!it.anim) {
        setMatState(it.mat, on ? SEE : rawBase(it));
        if (it.edges) it.edges.material.opacity = on ? EDGE_SEE : EDGE_BASE;
      }
      setRmat(it.rmat, on);
      if (v.studio?.on) it.mesh.castShadow = !on;
    }
    outlines();
    chip();
  }

  // ---------- outlines ----------
  const selMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false });
  const tgtMat = new THREE.LineBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.95, depthTest: false });
  const lines = [];
  function outlines() {
    for (const l of lines.splice(0)) l.parent?.remove(l);
    const add = (name, mat) => {
      const it = name && itemOf(name);
      if (!it || !it.edges || !it.mesh.visible) return;
      const l = new THREE.LineSegments(it.edges.geometry, mat); // shares the CAD edge geometry; nothing to dispose
      l.renderOrder = 10; l.raycast = () => {};
      it.mesh.add(l); lines.push(l);
    };
    if (target) add(target, tgtMat);
    if (sel && sel !== target) { selMat.color.setHex(v.backdrop === 'dark' || v.studio?.on ? 0xffffff : 0x1c1917); add(sel, selMat); } // look: readable on the light backdrop
  }

  // ---------- picking ----------
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    v.world.updateMatrixWorld(true); v.camera.updateMatrixWorld();
    ray.setFromCamera(ndc, v.camera);
    const meshes = v.items.filter(it => it.mesh.visible).map(it => it.mesh);
    const hits = ray.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const byMesh = m => v.items.find(it => it.mesh === m);
    // prefer the first solid part, so a see-through shell lets you click what's inside
    const solid = hits.find(h => !isSee(byMesh(h.object)?.p.name));
    return byMesh((solid || hits[0]).object)?.p.name || null;
  }

  // ---------- actions ----------
  function refresh() { v.apply(); ctx.renderTree?.(); }
  function hide(name) { if (!name) return; v.hidden.delete(name); see.add(name); refresh(); }
  function unhide(name) { see.delete(name); v.hidden.delete(name); if (isolated && see.size === 0) isolated = null; refresh(); }
  function hideCompletely(name) { see.delete(name); v.hidden.add(name); if (sel === name) sel = null; refresh(); }
  function isolate(name) {
    see.clear(); isolated = name; v.hidden.delete(name);
    for (const n of names()) if (n !== name && !v.hidden.has(n)) see.add(n);
    refresh();
  }
  function showAll() { see.clear(); isolated = null; v.hidden.clear(); refresh(); }
  function select(name, { tree = false } = {}) {
    sel = name; outlines();
    const it = name && itemOf(name);
    if (it && it.p.group !== 'component' && 'selPart' in S && S.selPart !== name) { // printed part: also the render colour target
      S.selPart = name; lastSelPart = name; ctx.renderTree?.(); ctx.renderRenderBar?.();
    } else if (!name && S.selPart) { S.selPart = null; lastSelPart = null; ctx.renderTree?.(); ctx.renderRenderBar?.(); }
    if (tree && name) {
      const t = document.getElementById('tree');
      if (t) { t.classList.remove('collapsed'); if (matchMedia('(max-width: 640px)').matches) t.classList.add('open-m'); }
      const row = rowOf(name);
      if (row) { row.scrollIntoView({ block: 'nearest' }); row.classList.remove('pm-flash'); void row.offsetWidth; row.classList.add('pm-flash'); }
    }
    decorate();
    ctx.onSelect?.(name || null); // chattools: "Ask about <part>" chip above the composer
  }
  function changePart(name) {
    if (S.chatMode === 'human') document.querySelector('[data-cmode="ai"]')?.click();
    ctx.setRtab?.('chat');
    const ta = document.getElementById('chatInput');
    if (!ta || document.getElementById('composer')?.hidden) { ctx.toast?.('Open your project to ask for a change'); return; }
    ta.value = `Change the ${name}: `;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  // ---------- parts tree sync ----------
  const rowOf = name => [...document.querySelectorAll('#treeBody .titem')].find(r => r.dataset.sel === name) || null;
  function decorate() {
    for (const r of document.querySelectorAll('#treeBody .titem')) {
      const n = r.dataset.sel, s = isSee(n);
      r.classList.toggle('pm-see', s);
      r.classList.toggle('pm-sel', n === sel);
      const eye = r.querySelector('.eye');
      if (s) {
        r.classList.add('off');
        if (eye && !eye.dataset.pm) { eye.dataset.pm = '1'; eye.innerHTML = EYE_SEE; eye.setAttribute('aria-label', `Show ${n}`); eye.title = 'See-through. Click to show.'; }
      }
    }
  }
  const treeBody = document.getElementById('treeBody');
  if (treeBody) {
    new MutationObserver(() => {
      if ((S.selPart ?? null) !== lastSelPart) { lastSelPart = S.selPart ?? null; sel = lastSelPart; outlines(); } // tree click selected a part
      decorate();
    }).observe(treeBody, { childList: true });
    // A see-through part's eye restores it (the tree's own handler would hide it completely instead)
    treeBody.addEventListener('click', e => {
      const b = e.target.closest?.('.eye'); if (!b) return;
      if (isSee(b.dataset.part)) { e.stopPropagation(); e.preventDefault(); unhide(b.dataset.part); }
    }, true);
  }

  // ---------- "Show all (N hidden)" chip ----------
  const chipEl = document.createElement('button');
  chipEl.className = 'pm-chip'; chipEl.hidden = true; chipEl.title = 'Show every part again (Alt+H)';
  chipEl.onclick = () => showAll();
  pane.appendChild(chipEl);
  function chip() {
    const n = v.items.length ? hiddenCount() : 0;
    chipEl.hidden = !n;
    if (n) chipEl.innerHTML = `<span>Show all</span><span class="pm-n">${isolated ? 'isolated' : `${n} hidden`}</span>`;
  }

  // ---------- part files (GET /api/make/<id>: which parts have STL / STEP / DXF) ----------
  const files = { id: null, at: 0, parts: null, loading: false };
  const designId = () => S.cur?.id || null;
  function loadFiles() {
    const id = designId();
    if (!id || files.loading || (files.id === id && Date.now() - files.at < 30e3)) return;
    files.loading = true;
    fetch(`/api/make/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(j => {
        files.loading = false; files.id = id; files.at = Date.now(); files.parts = Array.isArray(j?.parts) ? j.parts : [];
        if (!menu.hidden && target && designId() === id) { draw(); place(at.x, at.y); }
      });
  }
  /** The part's downloadable files: [{ label, href }] (none for bought parts without their own model). */
  function downloads(name) {
    const id = designId();
    if (!id || files.id !== id || !files.parts) return [];
    const it = itemOf(name), base = String(it?.p.file || '').split('/').pop().replace(/\.[^.]+$/, '');
    const mp = files.parts.find(x => x.name === name) || (base && files.parts.find(x => x.file === base));
    if (!mp?.file) return [];
    const href = ext => `/api/make/${encodeURIComponent(id)}/part/${encodeURIComponent(mp.file)}.${ext}`;
    return [mp.step && { label: 'Download STEP', href: href('step') }, mp.stl && { label: 'Download STL', href: href('stl') },
      mp.dxf && { label: 'Download DXF', href: href('dxf') }].filter(Boolean);
  }
  function download(href) {
    const a = document.createElement('a'); a.href = href; a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- menu ----------
  const menu = document.createElement('div');
  menu.className = 'pm-menu'; menu.hidden = true; menu.setAttribute('role', 'menu');
  document.body.appendChild(menu);
  let infoOpen = false;
  function closeMenu() {
    if (menu.hidden && !target) return;
    menu.hidden = true; target = null; infoOpen = false; outlines();
  }
  function info(name) {
    const it = itemOf(name); if (!it) return '';
    const p = it.p, d = S.cur?.data || {};
    const mp = (d.manifest?.parts || []).find(x => x.name === name) || {};
    const proc = p.process || mp.process || (p.group === 'component' ? 'bought' : 'print');
    const pr = (d.bom?.printed || []).find(x => x.name === name || (x.file && x.file === p.file)) || {};
    const grams = pr.grams ?? p.grams ?? mp.grams, hours = pr.print_hours ?? p.print_hours ?? mp.print_hours;
    const size = (p.size || []).map(n => (Math.round(n * 10) / 10).toString()).join(' × ');
    const rows = [['Size', size ? `${size} mm` : '—'], ['Made by', PROCESS[proc] || proc]];
    if (grams != null) rows.push(['Weight', `${Math.round(grams)} g`]);
    if (hours != null) rows.push(['Print time', `${(+hours).toFixed(1)} h`]);
    return `<div class="pm-info">${rows.map(([k, x]) => `<div><span>${esc(k)}</span><b>${esc(x)}</b></div>`).join('')}</div>`;
  }
  function draw() {
    const name = target, it = itemOf(name); if (!it) return closeMenu();
    const s = isSee(name), example = !!S.cur?.readOnly, any = hiddenCount() > 0;
    const item = (act, label, key = '', dis = false) =>
      `<button role="menuitem" data-act="${act}" ${dis ? 'disabled' : ''}><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    menu.innerHTML = `<div class="pm-head"><span class="pm-sw" style="background:${esc(it.p.color)}"></span><span class="pm-name" title="${esc(name)}">${esc(name)}</span></div>`
      + (s ? item('show', 'Show') : item('hide', 'Hide', 'H'))
      + item('hideAll', 'Hide completely')
      + (isolated === name ? item('showAll', 'Exit isolate') : item('isolate', 'Isolate'))
      + item('showAll', any ? `Show all <span class="pm-dim">(${hiddenCount()} hidden)</span>` : 'Show all', '⌥H', !any)
      + '<div class="pm-sep"></div>'
      + item('tree', 'Select in parts list')
      + (example ? item('remix', 'Remix to edit') : item('change', 'Change this part…'))
      + item('info', infoOpen ? 'Hide part info' : 'Part info')
      + (infoOpen ? info(name) : '')
      + '<div class="pm-sep"></div>'
      + downloads(name).map(d => `<button role="menuitem" data-act="dl" data-href="${esc(d.href)}"><span>${esc(d.label)}</span></button>`).join('')
      + item('copy', 'Copy part name');
  }
  function place(x, y) {
    menu.style.left = '0px'; menu.style.top = '0px';
    const w = menu.offsetWidth, h = menu.offsetHeight, m = 8;
    menu.style.left = `${Math.max(m, Math.min(x, innerWidth - w - m))}px`;
    menu.style.top = `${Math.max(m, y + h > innerHeight - m ? y - h : y)}px`;
  }
  let at = { x: 0, y: 0 };
  function openMenu(name, x, y) {
    if (!name) return closeMenu();
    target = name; infoOpen = false; at = { x, y };
    loadFiles();
    menu.hidden = false; draw(); place(x, y); outlines();
    menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
  }
  menu.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b || b.disabled) return;
    const name = target, act = b.dataset.act;
    if (act === 'info') { infoOpen = !infoOpen; draw(); place(at.x, at.y); return; }
    closeMenu();
    if (act === 'hide') hide(name);
    else if (act === 'show') unhide(name);
    else if (act === 'hideAll') hideCompletely(name);
    else if (act === 'isolate') isolate(name);
    else if (act === 'showAll') showAll();
    else if (act === 'tree') select(name, { tree: true });
    else if (act === 'change') changePart(name);
    else if (act === 'remix') document.getElementById('remixBtn')?.click();
    else if (act === 'dl') download(b.dataset.href);
    else if (act === 'copy') navigator.clipboard?.writeText(name).then(() => ctx.toast?.('Part name copied'), () => ctx.toast?.('Could not copy'));
  });
  menu.addEventListener('keydown', e => {
    const bs = [...menu.querySelectorAll('button:not([disabled])')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]?.focus(); }
  });
  addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  addEventListener('resize', () => closeMenu());
  canvas.addEventListener('wheel', () => closeMenu(), { passive: true });

  // ---------- pointer: right-click / ctrl-click menu, left-click select, long-press on touch ----------
  let down = null, press = null, suppressTap = false;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointermove', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.t); press = null; }
  });
  canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
  canvas.addEventListener('pointerdown', e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.inside = true;
    down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button, ctrl: e.ctrlKey, type: e.pointerType, id: e.pointerId };
    clearTimeout(press?.t); press = null;
    if (e.pointerType === 'touch' && e.isPrimary) {
      press = { x: e.clientX, y: e.clientY, t: setTimeout(() => {
        press = null; suppressTap = true; down = null;
        const n = pick(pointer.x, pointer.y);
        if (n && v.present && window.__mPartSheet) { window.__mPartSheet(n); return; } // phonekit: phones get the part's sheet (web/phonestudio.js)
        openMenu(n, pointer.x, pointer.y);
      }, 550) };
    } else if (e.pointerType === 'touch') { press = null; down = null; } // second finger: pinch / pan
  });
  canvas.addEventListener('pointerup', e => {
    clearTimeout(press?.t); press = null;
    const d = down; down = null;
    if (suppressTap) { suppressTap = false; return; }
    if (!d || d.id !== e.pointerId) return;
    const still = Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5;
    if (!still) return; // a drag (rotate / pan), not a click
    if (d.b === 2 || (d.b === 0 && d.ctrl)) return openMenu(pick(e.clientX, e.clientY), e.clientX, e.clientY);
    if (d.b === 0 && performance.now() - d.t < 500) select(pick(e.clientX, e.clientY));
  });
  canvas.addEventListener('pointercancel', () => { clearTimeout(press?.t); press = null; down = null; });

  // ---------- keyboard ----------
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !menu.hidden) { e.stopPropagation(); closeMenu(); canvas.focus?.(); return; }
    if (e.code !== 'KeyH' || e.metaKey || e.ctrlKey || e.repeat) return;
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
    if (!v.container.offsetParent || !v.items.length) return; // viewer not on screen
    e.preventDefault();
    if (e.altKey || e.shiftKey) { closeMenu(); showAll(); return; }
    const name = (!menu.hidden && target) || (pointer.inside && pick(pointer.x, pointer.y)) || sel;
    if (!name) return;
    closeMenu();
    isSee(name) ? unhide(name) : hide(name);
  }, true);

  const api = { base, apply, hide, unhide, hideCompletely, isolate, showAll, select, openMenu, closeMenu, pick,
    get state() { return { see: [...see], hidden: [...v.hidden], isolated, sel, target }; } };
  v.partmenu = api;
  apply(); decorate();
  return api;
}
