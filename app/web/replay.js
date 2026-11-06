// replay: plays a real recorded design run back, sped up, for a new design the server started from a replay example
// (server.js startReplay, examples/<slug>/replay/ made by scripts/make-replay.py). Everything shown is from the run:
// the real sketch, step labels, the agent's own in-between messages and the model as it really was at each build.
// The events go through the same live-run code a real run uses (onEvent), so it looks exactly like one. At the end the
// saved reply (which says it was a replay, and how long the real work took) replaces the live turn, the parts fly
// together, the Scale view comes on, and the design is the user's to change with the live agent.
// Real gaps are compressed (a 100 s think becomes ~2.4 s); a long message stays up long enough to read.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const gapFor = (sec) => Math.max(450, Math.min(2400, 300 + 260 * Math.sqrt(Math.max(0, sec))));
const readFor = (text) => Math.min(2600, 700 + String(text).length * 10);

/** h: { id, base, alive(), onEvent(d), prep(), showModel(manifest, base), showFinal(), finish() } */
export async function playReplay(h) {
  let R;
  try { R = await fetch(h.base + 'replay/replay.json', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)); } catch {}
  if (!R?.events?.length) { await h.finish(); return; }
  await h.prep();
  await sleep(900);
  if (!h.alive()) return;
  if (R.sketch) { h.onEvent({ type: 'sketch', sketch: R.sketch }); await sleep(1400); }
  let prevT = 0;
  for (const e of R.events) {
    if (!h.alive()) return;
    await sleep(e.type === 'round' ? 1600 : gapFor(e.t - prevT));
    prevT = e.t;
    if (!h.alive()) return;
    if (e.type === 'step') h.onEvent({ type: 'step', text: e.text });
    else if (e.type === 'round') { h.onEvent({ type: 'assistant', text: `Feedback round ${e.n} of ${R.rounds_total}.` }); await sleep(900); }
    else if (e.type === 'text') { h.onEvent({ type: 'assistant', text: e.text }); await sleep(readFor(e.text)); }
    else if (e.type === 'model') {
      if (e.model === 'final') await h.showFinal();
      else {
        const base = `${h.base}replay/${e.model}/`;
        const m = await fetch(base + 'manifest.json', { cache: 'no-store' }).then(r => r.json()).catch(() => null);
        if (m && h.alive()) await h.showModel(m, base);
      }
    }
  }
  await sleep(1200);
  if (h.alive()) await h.finish();
}
