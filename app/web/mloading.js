// mloading: phone loading states (<= 860 px). Instead of a spinner, a card cycles every 2.5 s: something people asked
// for, in quotes, with a thumbnail of what Premake made. Nothing shows at all if loading finishes within 300 ms.
// The prompts are the examples' first prompts, tidied into short phrases. Leave out anything that could read as a
// weapon (the grip trainer looks like a gun; knives).
const ITEMS = [
  ['arc-desk-lamp', 'An arc LED desk lamp'],
  ['dog-bowl-stand', 'A raised stand for my dog’s bowl'],
  ['drop-night-light', 'A glowing night light'],
  ['bike-hook', 'A wall hook for my bike'],
  ['twist-planter', 'A twisty planter with a saucer'],
  ['spin-turntable', 'A motorised photo turntable'],
  ['headphone-hook', 'A headphone hook under my desk'],
  ['laptop-stand', 'A stand to lift my laptop'],
  ['cable-dock', 'A dock for my charging cables'],
  ['fin-glow-lamp', 'An edge-lit desk lamp'],
  ['key-shelf', 'A key shelf for the hallway'],
  ['lattice-planter', 'A lattice planter'],
  ['bottle-cage', 'A bottle cage for my bike'],
  ['monitor-riser', 'A monitor riser'],
  ['spice-riser', 'A tiered spice rack'],
  ['phone-stand', 'An adjustable phone stand'],
];
const thumb = slug => `/files/examples/${slug}/thumb.png`;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let start = Math.floor(Math.random() * ITEMS.length);

function css() {
  if (document.getElementById('ml-css')) return;
  const s = document.createElement('style');
  s.id = 'ml-css';
  s.textContent = `
.ml-host { display: grid; place-items: center; width: 100%; }
.ml-card { position: relative; display: flex; align-items: center; gap: 14px; width: min(300px, calc(100vw - 72px)); min-height: 84px; padding: 10px 16px 10px 10px;
  border-radius: 22px; background: rgba(255, 255, 255, .72); -webkit-backdrop-filter: blur(18px) saturate(170%); backdrop-filter: blur(18px) saturate(170%);
  border: 1px solid rgba(255, 255, 255, .9); box-shadow: 0 10px 30px -12px rgba(27, 26, 23, .22), 0 0 0 .5px rgba(27, 26, 23, .06); opacity: 0;
  transition: opacity .45s ease; text-align: left; }
.ml-card.on { opacity: 1; }
.ml-img { flex: none; width: 64px; height: 64px; border-radius: 15px; background: radial-gradient(120% 90% at 50% 35%, #f6f5f3, #e4e3df) center / cover no-repeat;
  box-shadow: inset 0 0 0 .5px rgba(27, 26, 23, .08); }
.ml-txt { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.ml-q { font: 500 15.5px/1.3 var(--ui, system-ui); letter-spacing: normal; color: #1b1a17; transition: opacity .35s ease, transform .35s ease; }
.ml-s { display: flex; align-items: center; gap: 7px; font: 400 13px/1.2 var(--ui, system-ui); color: #8a857d; }
.ml-dot { width: 6px; height: 6px; border-radius: 50%; background: #e8590c; animation: ml-p 1.2s ease-in-out infinite; }
.ml-card.swap .ml-q, .ml-card.swap .ml-img { opacity: 0; transform: translateY(4px); }
.ml-img { transition: opacity .35s ease, transform .35s ease; }
@keyframes ml-p { 50% { opacity: .3; transform: scale(.8); } }
@media (prefers-reduced-motion: reduce) { .ml-card, .ml-q, .ml-img { transition: none; } .ml-dot { animation: none; } }`;
  document.head.append(s);
}

/** Show cycling cards in host after 300 ms. Stops by itself when host leaves the page. Returns stop(). */
export function loadingCards(host, opts = {}) {
  if (!host) return () => {};
  css();
  const label = opts.label || 'Loading your design';
  let i = start++ % ITEMS.length, t1 = 0, t2 = 0, card = null, stopped = false;
  ITEMS.forEach(([slug]) => { const im = new Image(); im.src = thumb(slug); }); // warm the thumbnails
  const fill = () => {
    const [slug, q] = ITEMS[i % ITEMS.length];
    card.querySelector('.ml-img').style.backgroundImage = `url('${thumb(slug)}')`;
    card.querySelector('.ml-q').textContent = `“${q}”`;
  };
  const tick = () => {
    if (stopped || !host.isConnected) return stop();
    if (still()) { i++; fill(); t2 = setTimeout(tick, 2500); return; }
    card.classList.add('swap');
    t2 = setTimeout(() => { if (!host.isConnected) return stop(); i++; fill(); card.classList.remove('swap'); t2 = setTimeout(tick, 2150); }, 350);
  };
  t1 = setTimeout(() => {
    if (stopped || !host.isConnected) return;
    card = document.createElement('div');
    card.className = 'ml-card'; card.setAttribute('role', 'status');
    card.innerHTML = `<span class="ml-img" aria-hidden="true"></span><span class="ml-txt"><span class="ml-q"></span><span class="ml-s"><span class="ml-dot"></span>${label}…</span></span>`;
    fill(); host.append(card); void card.offsetWidth; card.classList.add('on');
    t2 = setTimeout(tick, 2500);
  }, opts.delay ?? 300);
  function stop() { stopped = true; clearTimeout(t1); clearTimeout(t2); card?.remove(); }
  return stop;
}
