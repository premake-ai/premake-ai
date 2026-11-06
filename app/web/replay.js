// replay: plays a real recorded design run back, sped up, for a new design the server started from a replay example
// (server.js startReplay, examples/<slug>/replay/ made by scripts/make-replay.py). Everything shown is from the run:
// the real sketch, step labels, the agent's own in-between messages and the model as it really was at each build.
// The events go through the same live-run code a real run uses (onEvent), so it looks exactly like one. At the end the
// saved reply (which says it was a replay, and how long the real work took) replaces the live turn, the parts fly
// together, the Scale view comes on, and the design is the user's to change with the live agent.
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Paced in stages like a real run: each build (a new version of the model) ends a stage of 16 to 42 s, longer when the real
// stage was longer. A stage shows at most 4 of its tool steps and the agent's own messages, spread across it with
// uneven gaps, so the model changes in clear steps instead of something new every second. About 4 to 5 minutes for the SCARA.
const readFor = (text) => Math.min(6000, 1600 + String(text).length * 20);
const BUILD_MS = 4000; // "Building model": the step shows, then the model lands
const jitter = (ms) => ms * (0.6 + Math.random() * 0.8);
/** The events split into stages, each ending at a model build (the last may end with only messages). */
function stages(events) {
  const out = []; let cur = [];
  for (const e of events) { cur.push(e); if (e.type === 'model') { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}
/** At most n of a stage's steps, spread out, always keeping the last (usually "Building model"). */
function pickSteps(steps, n) {
  if (steps.length <= n) return new Set(steps);
  const keep = new Set([steps[steps.length - 1]]);
  for (let i = 0; keep.size < n; i++) keep.add(steps[Math.round(i * (steps.length - 2) / (n - 1))]);
  return keep;
}

/** h: { id, base, alive(), onEvent(d), prep(), showModel(manifest, base), showFinal(), finish() } */
export async function playReplay(h) {
  let R;
  try { R = await fetch(h.base + 'replay/replay.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)); } catch {}
  if (!R?.events?.length) { await h.finish(); return; }
  await h.prep();
  await sleep(2500); // reading the request
  if (!h.alive()) return;
  if (R.sketch) { h.onEvent({ type: 'sketch', sketch: R.sketch }); await sleep(3500); }
  for (const stage of stages(R.events)) {
    if (!h.alive()) return;
    const real = stage[stage.length - 1].t - stage[0].t;
    const target = Math.min(42000, Math.max(16000, 12000 + 6000 * Math.log2(1 + real / 20)));
    const steps = stage.filter(e => e.type === 'step'), keep = pickSteps(steps, 4);
    const fixed = stage.reduce((a, e) => a + (e.type === 'text' ? readFor(e.text) + 1200 : e.type === 'round' ? 5000 : e.type === 'model' ? BUILD_MS : 0), 0);
    const per = Math.max(2500, (target - fixed) / Math.max(1, keep.size));
    for (const e of stage) {
      if (!h.alive()) return;
      if (e.type === 'step') { if (!keep.has(e)) continue; await sleep(jitter(per)); if (h.alive()) h.onEvent({ type: 'step', text: e.text }); }
      else if (e.type === 'round') { await sleep(2000); h.onEvent({ type: 'assistant', text: `Feedback round ${e.n} of ${R.rounds_total}.` }); await sleep(3000); }
      else if (e.type === 'text') { await sleep(1200); h.onEvent({ type: 'assistant', text: e.text }); await sleep(readFor(e.text)); }
      else if (e.type === 'model') {
        await sleep(BUILD_MS);
        if (!h.alive()) return;
        if (e.model === 'final') await h.showFinal();
        else {
          const base = `${h.base}replay/${e.model}/`;
          const m = await fetch(base + 'manifest.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
          if (m && h.alive()) await h.showModel(m, base);
        }
      }
    }
  }
  await sleep(1200);
  if (h.alive()) await h.finish();
}
