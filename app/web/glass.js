// Liquid glass segmented toggles (web/glass.css): one glass pill per toggle that slides to the selected option.
// Nothing here owns state: the pages keep toggling .on on their buttons as before, and a MutationObserver moves the pill
// (one sync per animation frame). Toggles that are re-rendered get a new pill. Without this file the selected option
// is filled with glass by CSS alone. Loaded by the studio (index.html) and the build page (buildpage.js).

const narrow = () => matchMedia('(max-width: 640px)').matches;
// [container selector, function(container) -> the selected option or null]
const SEGS = [
  ['.mode-switch', c => c.querySelector(':scope > .on')],
  ['.work > .tabbar .ctabs', c => c.querySelector(':scope > .tab.on')],
  // phones: the Model tab is "selected" while the split view shows (body without .m-panel); see styles.css
  ['.right > .tabbar', c => {
    const m = c.querySelector(':scope > #mModelTab');
    if (m && narrow() && m.offsetParent && !document.body.classList.contains('m-panel')) return m;
    return c.querySelector(':scope > [data-rtab].on');
  }],
  ['.bp-right > .tabbar', c => c.querySelector(':scope > .tab.on')],
  ['.mode-toggle', c => c.querySelector(':scope > button.on')],
  ['.cm-seg', c => c.querySelector(':scope > button.on')],
];

// classList.add/remove only when it changes something: an unchanged write still notifies the observer (a loop)
const cls = (el, name, on) => { if (el.classList.contains(name) !== on) el.classList.toggle(name, on); };
let queued = false;
const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
const watched = new WeakSet();

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; sync(); });
}

function sync() {
  for (const [sel, pick] of SEGS) {
    for (const c of document.querySelectorAll(sel)) {
      let pill = c.querySelector(':scope > .gl-pill');
      if (!pill) {
        pill = document.createElement('span');
        pill.className = 'gl-pill gl-instant';
        pill.setAttribute('aria-hidden', 'true');
        c.prepend(pill);
      }
      cls(c, 'gl-seg', true);
      if (ro && !watched.has(c)) { watched.add(c); ro.observe(c); }
      const act = pick(c);
      for (const el of c.querySelectorAll(':scope > .gl-act')) if (el !== act) cls(el, 'gl-act', false);
      if (!act || !act.offsetParent || !act.offsetWidth) { if (pill.style.opacity !== '0') pill.style.opacity = '0'; cls(c, 'gl-ready', false); continue; }
      cls(act, 'gl-act', true);
      const t = `translate(${act.offsetLeft}px, ${act.offsetTop}px)`;
      const w = act.offsetWidth + 'px', h = act.offsetHeight + 'px';
      const first = pill.style.opacity !== '1';
      if (first) cls(pill, 'gl-instant', true); // appear in place, slide from then on
      if (pill.style.transform !== t) pill.style.transform = t;
      if (pill.style.width !== w) pill.style.width = w;
      if (pill.style.height !== h) pill.style.height = h;
      if (first) pill.style.opacity = '1';
      cls(c, 'gl-ready', true);
      if (first) requestAnimationFrame(() => cls(pill, 'gl-instant', false));
    }
  }
}

new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
addEventListener('resize', schedule);
document.fonts?.ready?.then(schedule);
schedule();
