// Fixture data for ?mock=1 (UI testing without the server). Serve the session root over HTTP
// and open /app/web/index.html?mock=1 so ../../grip/* resolves to the real grip trainer STLs.
const ROOT = new URL('../../', location.href).href;
const wait = ms => new Promise(r => setTimeout(r, ms));
const thumbs = ['assembly_iso_front', 'assembly_iso_back', 'assembly_front', 'assembly_side', 'case_top_L_iso',
  'case_back_door_iso', 'case_bottom_R_iso', 'case_clamp_L_iso', 'case_drip_tray_iso', 'case_elec_tray_iso',
  'case_top_R_iso', 'case_back_upper_iso'].map(n => `${ROOT}previews/${n}.png`);

const EXAMPLES = [
  ['grip-trainer', 'Adjustable grip trainer', 'Maya Chen', ['fitness', 'mechanism']],
  ['desk-hub', 'Desk cable hub', 'Leo Park', ['desk', 'organizer']],
  ['speaker-box', 'Bookshelf speaker enclosure', 'Ana Ruiz', ['audio', 'electronics']],
  ['plant-pot', 'Self-watering planter', 'Sam Okafor', ['home', 'garden']],
  ['phone-stand', 'Folding phone stand', 'Jun Ito', ['desk', 'mobile']],
  ['spice-rack', 'Drawer spice rack', 'Priya Nair', ['kitchen', 'organizer']],
  ['bike-mount', 'Bike light mount', 'Tom Weber', ['outdoor', 'bike']],
  ['lamp', 'Desk lamp with hinge', 'Ines Costa', ['desk', 'lighting', 'electronics']],
  ['camera-rig', 'Camera cage', 'Ravi Shah', ['photo', 'mechanism']],
  ['dog-feeder', 'Raised dog bowl stand', 'Kate Moss', ['home', 'pets']],
  ['coffee-scale', 'Pour-over scale case', 'Owen Lee', ['kitchen', 'electronics']],
  ['toy-car', 'Rubber-band racer', 'Nina Berg', ['toys', 'mechanism']],
].map(([slug, title, creator, tags], i) => ({
  slug, title, creator, tags, demo: true, thumb: thumbs[i % thumbs.length],
  description: `${title}, printed in PETG with off-the-shelf hardware.`,
}));

const BOM = {
  parts: [
    { name: 'Hillman #53 compression spring', qty_per_unit: 1, unit_cost_usd: 3.48, supplier: 'Home Depot', url: 'https://www.homedepot.com/', notes: '' },
    { name: 'Ace 5062936 spring', qty_per_unit: 4, unit_cost_usd: 1.29, supplier: 'Ace Hardware', url: 'https://www.acehardware.com/', notes: '' },
    { name: '5/16-18 x 3" hex bolt', qty_per_unit: 1, unit_cost_usd: 0.92, supplier: 'McMaster-Carr', url: 'https://www.mcmaster.com/', notes: '' },
    { name: '5/16-18 hex nut', qty_per_unit: 1, unit_cost_usd: 0.12, supplier: 'McMaster-Carr', url: 'https://www.mcmaster.com/', notes: '' },
    { name: '1/4-20 bolt + nylock + washers', qty_per_unit: 1, unit_cost_usd: 1.1, supplier: 'Amazon', url: 'https://www.amazon.com/', notes: '' },
    { name: '#4 x 1/2" screws', qty_per_unit: 6, unit_cost_usd: 0.08, supplier: 'Amazon', url: '', notes: '' },
  ],
  assembly_minutes: 12, kit_ok: true,
  printed: [
    ['Body left', 92, 4.6], ['Body right', 92, 4.6], ['Palm lever', 41, 2.05], ['Spring pusher', 6, 0.3],
    ['Preload seat', 4, 0.25], ['Adjust knob', 7, 0.35], ['Plunger back plate', 11, 0.55], ['Plunger x4', 12, 0.6],
  ].map(([name, grams, print_hours]) => ({ name, grams, print_hours, file: '', bbox: [0, 0, 0] })),
};

let code = null;
async function getCode() {
  if (code == null) {
    try { code = await (await fetch(`${ROOT}grip/grip_trainer.py`)).text(); }
    catch { code = 'import cadquery as cq\n\ndef parts():\n    return []\n'; }
  }
  return code;
}
async function getManifest() {
  return (await fetch(`${ROOT}grip/manifest.json`, { cache: 'no-store' })).json();
}

const projects = [
  { id: 'p-grip', title: 'Grip trainer', updated: new Date(Date.now() - 36e5).toISOString(), thumb: thumbs[0],
    messages: [
      { role: 'user', text: 'A hand grip trainer with adjustable resistance and four individual finger plungers.', t: Date.now() / 1000 - 4000 },
      { role: 'assistant', text: 'Built a two-shell grip body with a palm lever on a 1/4-20 pivot. A knob on the back turns a 5/16 bolt to preload the main spring (about 10 to 40 kg). Four finger plungers ride on small springs. Total print is about 13 hours in PETG; all hardware is from Home Depot / Ace.', t: Date.now() / 1000 - 3800 },
    ] },
  { id: 'p-empty', title: 'Untitled design', updated: new Date(Date.now() - 864e5).toISOString(), thumb: '', messages: [], empty: true },
];

const listeners = new Map(); // id -> Set(fake event sources)
function emit(id, ev) { for (const es of listeners.get(id) || []) es.onmessage?.({ data: JSON.stringify(ev) }); }
let runs = {};

function quote(mode) {
  const kit = mode === 'kit';
  const grams = BOM.printed.reduce((a, p) => a + p.grams, 0), hours = BOM.printed.reduce((a, p) => a + p.print_hours, 0);
  const partsBase = BOM.parts.reduce((a, p) => a + p.qty_per_unit * p.unit_cost_usd, 0);
  const r = n => Math.round(n * 100) / 100;
  const tiers = [[1, 1, 9], [10, 0.9, 25], [100, 0.75, 120], [500, 0.6, 450]].map(([qty, bulk, ship]) => {
    const unit = { parts: r(partsBase * bulk), material: r(grams * 0.025), printing: r(hours * 0.4),
      assembly: kit ? 1 : r(BOM.assembly_minutes * 0.5), packaging: kit ? 1.5 : 2 };
    const cost = Object.values(unit).reduce((a, b) => a + b, 0);
    unit.margin = r(cost * 0.35);
    const unit_price = r(cost + unit.margin + (qty === 1 ? 15 : 0));
    const subtotal = r(unit_price * qty);
    return { qty, unit, unit_price, subtotal, shipping: ship, total: r(subtotal + ship),
      lead_time_days: 2 + Math.ceil(qty * hours / 1000) + (!kit && qty >= 100 ? 1 : 0) };
  });
  return { mode, print: { grams, hours, parts: BOM.printed.length },
    bom: BOM.parts.map(({ notes, ...p }) => p), tiers,
    notes: ['Mock quote computed in the browser.', 'Prices are estimates from the BOM; final price confirmed before shipping.'] };
}

export const mockApi = {
  async partColor(id, part, color) { return { ok: true, part, color }; }, // colours: demo mode keeps the pick in the page only
  async examples() { await wait(150); return EXAMPLES; },
  async example(slug) {
    const e = EXAMPLES.find(x => x.slug === slug);
    if (!e) throw Object.assign(new Error('Example not found'), { status: 404 });
    return { slug, meta: { ...e }, manifest: { ...(await getManifest()), title: e.title }, bom: BOM, base: ROOT, code: await getCode() };
  },
  async projects() { await wait(100); return projects.map(({ id, title, updated, thumb }) => ({ id, title, updated, thumb })); },
  async project(id) {
    const p = projects.find(x => x.id === id);
    if (!p) throw Object.assign(new Error('Project not found'), { status: 404 });
    return { id, meta: { title: p.title }, manifest: p.empty ? null : await getManifest(), bom: p.empty ? null : BOM,
      base: ROOT, code: p.empty ? '' : await getCode(), messages: p.messages.map(m => ({ ...m })), running: !!runs[id] };
  },
  async createProject(body) {
    const id = 'p-' + Math.random().toString(36).slice(2, 8);
    const ex = body.fromExample && EXAMPLES.find(e => e.slug === body.fromExample);
    projects.unshift({ id, title: ex ? `${ex.title} (remix)` : (body.prompt || 'Untitled design').slice(0, 40),
      updated: new Date().toISOString(), thumb: ex?.thumb || '', messages: [], empty: !ex });
    if (body.prompt) setTimeout(() => mockApi.send(id, body.prompt), 300);
    return { id };
  },
  async send(id, text) {
    if (runs[id]) throw Object.assign(new Error('A run is already active'), { status: 409 });
    const p = projects.find(x => x.id === id);
    p.messages.push({ role: 'user', text, t: Date.now() / 1000 });
    runs[id] = true;
    (async () => {
      emit(id, { type: 'run_started' });
      for (const s of ['Reading design.py', 'Editing design.py', 'Running ./build.sh', 'Editing bom.json', 'Running ./build.sh']) {
        await wait(900); if (!runs[id]) return;
        emit(id, { type: 'step', text: s });
        if (s.startsWith('Running')) { p.empty = false; emit(id, { type: 'model_updated', t: Date.now() / 1000 }); emit(id, { type: 'code_updated' }); }
        if (s.includes('bom')) emit(id, { type: 'bom_updated' });
      }
      const reply = 'Done. The model is rebuilt with your change, and the parts list is updated. Total print time is about 13 hours.';
      p.messages.push({ role: 'assistant', text: reply, t: Date.now() / 1000 });
      emit(id, { type: 'assistant', text: reply });
      runs[id] = false;
      emit(id, { type: 'run_finished', ok: true });
    })();
    return { ok: true };
  },
  async stop(id) { runs[id] = false; emit(id, { type: 'run_finished', ok: false, error: 'Stopped by user' }); return { ok: true }; },
  async quote(src, mode) { await wait(120); return quote(mode); },
  async order(body) {
    await wait(500);
    const t = quote(body.mode).tiers.find(x => x.qty === body.qty);
    return { id: 'ord_' + Math.random().toString(36).slice(2, 8), status: 'demo_received', total: t.total, eta_days: t.lead_time_days + 4 };
  },
  events(id) {
    const es = { onmessage: null, onerror: null, onopen: null, close() { listeners.get(id)?.delete(es); } };
    if (!listeners.has(id)) listeners.set(id, new Set());
    listeners.get(id).add(es);
    setTimeout(() => es.onopen?.(), 50);
    return es;
  },
  async manifest() { return getManifest(); },
};
