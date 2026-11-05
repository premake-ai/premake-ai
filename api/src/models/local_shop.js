'use strict';
// The "local shop" price model (v0): a fair price a US job shop would charge, from the part's size, volume and area.
// Process guess from the material and shape. Not the cheapest overseas offer; no shop has quoted it.
const MATS = {
  aluminum_6061: { label: 'Aluminum 6061', density: 2.70, usd_kg: 9, metal: true },
  steel: { label: 'Mild steel', density: 7.85, usd_kg: 4, metal: true },
  stainless_304: { label: 'Stainless 304', density: 8.0, usd_kg: 11, metal: true },
  petg_print: { label: 'PETG (3D printed)', density: 1.27, usd_kg: 25, print: true },
  acrylic_laser: { label: 'Acrylic (laser cut)', density: 1.19, usd_kg: 12, laser: true },
};
function guessMaterial(m) {
  const s = String(m || '').toLowerCase();
  if (/stainless/.test(s)) return 'stainless_304';
  if (/steel|iron/.test(s)) return 'steel';
  if (/acryl|pmma|plexi/.test(s)) return 'acrylic_laser';
  if (/pla|petg|abs|nylon|plastic|resin|print/.test(s)) return 'petg_print';
  return 'aluminum_6061';
}
function estimatePart(p) {
  const bb = (p.bbox_mm || []).map(Number).filter((x) => x > 0).sort((a, b) => a - b);
  if (bb.length !== 3) return { error: 'missing size' };
  const vol = Math.max(1, Number(p.volume_mm3) || bb[0] * bb[1] * bb[2] * 0.4) / 1000; // cm3
  const box = (bb[0] * bb[1] * bb[2]) / 1000; // cm3
  const qty = Math.max(1, Math.min(10000, Math.round(Number(p.qty) || 1)));
  const key = MATS[p.material] ? p.material : guessMaterial(p.material);
  const M = MATS[key];
  const wall = Number(p.area_mm2) > 0 ? (2 * vol * 1000) / Number(p.area_mm2) : null; // mm: average wall thickness (sheet / tube test)
  let process, unit, setup, lead, why;
  if (M.print) {
    const g = vol * M.density, h = 0.25 + g / 12;
    process = 'print'; unit = g * 0.025 + h * 0.40 + 1.5; setup = 0; lead = 3; why = `${g.toFixed(0)} g, about ${h.toFixed(1)} h on our printers`;
  } else if (M.metal && wall && wall <= 3.5 && Math.abs(bb[1] - bb[0]) / bb[1] < 0.03 && bb[2] > bb[1] * 1.2) {
    // thin-walled, square cross-section, long: tube, laser cut to length (holes and slots priced roughly by length)
    const kg = vol * M.density / 1000;
    process = 'tube'; unit = kg * M.usd_kg * 2.2 + 6 + bb[2] * 0.02; setup = 25; lead = 6;
    why = `${bb[0].toFixed(1)} mm tube, ${bb[2].toFixed(0)} mm long, ${wall.toFixed(1)} mm wall`;
  } else if (M.laser || (M.metal && wall && wall <= 6.5)) {
    // thin plate: laser cut, bent when the part has depth beyond its own thickness
    const bent = !M.laser && bb[0] > wall * 3;
    const flat = (Number(p.area_mm2) || 2 * bb[1] * bb[2]) / 2 / 100; // cm2, one side
    process = M.laser ? 'laser' : bent ? 'sheet_bent' : 'sheet';
    unit = 4 + flat * 0.06 * (M.metal ? 1 : 0.5) + (bent ? 6 : 0); setup = M.laser ? 10 : 30; lead = bent ? 7 : 5;
    why = `${flat.toFixed(0)} cm² of ${(wall || bb[0]).toFixed(1)} mm ${M.label.toLowerCase()}${bent ? ', bent' : ''}`;
  } else {
    // CNC from bar or block: stock + machining time; setup spread over the batch
    const stockKg = box * 1.15 * M.density / 1000, removed = Math.max(0, box - vol);
    const minutes = 12 + removed * 0.16 + Math.sqrt(Number(p.area_mm2) || 0) * 0.04;
    process = 'cnc'; unit = stockKg * M.usd_kg + (minutes / 60) * 85; setup = 90; lead = 8;
    why = `${(stockKg * 1000).toFixed(0)} g of stock, about ${minutes.toFixed(0)} min machining`;
  }
  const disc = qty >= 100 ? 0.55 : qty >= 25 ? 0.7 : qty >= 10 ? 0.8 : qty >= 5 ? 0.9 : 1;
  const each = Math.round((unit * disc + setup / qty) * 100) / 100;
  return { process, material: key, material_label: M.label, qty, each_usd: each, total_usd: Math.round(each * qty * 100) / 100, lead_days: lead, why, model: 'v0' };
}
module.exports = { estimatePart, guessMaterial, MATS };
