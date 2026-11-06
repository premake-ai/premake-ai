// Product home page (gateway/home): wires the studio's prompt boxes. Images via the studio's /attach.js, the sign-in
// modal and prompt carry-over via /guest.js (both from the Mac). If those can't load (Mac offline), Start building
// still keeps the text and goes to Google sign-in.
const KEY = 'forma.draft';
const NEXT = '/#/?resume=1';
const forms = [...document.querySelectorAll('form.prompt-box')];
const boxes = forms.map((form) => ({ form, ta: form.querySelector('textarea'), att: null }));

let guest = null;
const ready = Promise.all([import('/attach.js'), import('/guest.js')]).then(([a, g]) => {
  guest = g;
  for (const b of boxes) {
    b.att = a.attachImages({ box: b.form, textarea: b.ta, strip: { before: b.ta }, button: { into: b.form.querySelector('.prompt-row') }, label: 'Add image',
      tip: b.form.nextElementSibling?.matches('.fine') ? b.form.nextElementSibling : null }); // phones: camera button + scale tip
  }
  // back without signing in: the box still has what they typed
  const d = g.readDraft();
  if (d && !boxes[0].ta.value) boxes[0].ta.value = d.text;
  if (d?.idb && boxes[0].att && !boxes[0].att.count()) g.takeImages('forma.draft', true).then((f) => boxes[0].att.add(f)).catch(() => {}); // and the photos
}).catch(() => {});

for (const b of boxes) {
  b.form.querySelectorAll('[data-fill]').forEach((c) => c.addEventListener('click', () => { b.ta.value = c.dataset.fill; b.ta.focus(); }));
  b.ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); b.form.requestSubmit(); }
  });
  b.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = b.ta.value.trim();
    const blobs = b.att?.blobs ? b.att.blobs() : [];
    await Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]);
    if (!text && !blobs.length) { // empty box: sign in anyway, landing on the studio's empty new-design screen
      try { guest?.clearDraft(); localStorage.removeItem(KEY); } catch {}
      if (guest) { guest.signInModal({ next: '/' }); return; }
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
      location.href = (local ? '/auth/login' : '/auth/signin') + '?next=' + encodeURIComponent('/');
      return;
    }
    if (guest) { guest.guestStart(text, blobs); return; }
    try { localStorage.setItem(KEY, JSON.stringify({ text, t: Date.now() })); } catch {}
    location.href = '/auth/login?next=' + encodeURIComponent(NEXT);
  });
}

// Hero backdrop: on desktop, after first paint and once the page is idle, /home/cad.js upgrades the CSS grid to three.js.
// Phones (< 860 px) keep the CSS grid.
const cad = document.getElementById('cad');
if (cad && matchMedia('(min-width: 860px)').matches) {
  const go = () => import(cad.dataset.src).catch(() => {});
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(go, { timeout: 1500 }) : setTimeout(go, 200));
  if (document.readyState === 'complete') idle(); else addEventListener('load', idle, { once: true });
}

// Phones: once both prompt boxes are off screen, a glass "Start building" bar sits at the bottom, within thumb reach.
// Tapping it scrolls back to the hero box and focuses it.
const cta = document.getElementById('mCta');
if (cta && 'IntersectionObserver' in window) {
  const seen = new Map();
  const hero = document.querySelector('.hero');
  const io = new IntersectionObserver((list) => {
    for (const e of list) seen.set(e.target, e.isIntersecting);
    cta.hidden = [...seen.values()].some(Boolean);
  });
  for (const el of [hero, ...forms]) if (el) { seen.set(el, true); io.observe(el); }
  cta.querySelector('button').addEventListener('click', () => {
    scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => boxes[0]?.ta.focus({ preventScroll: true }), 350);
  });
}
