// Forma's own marketing page, rendered inside the app at #/forma (the logo links here).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => n == null ? '–' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let quoteCache = null, quoteSlug = null, quoteLoading = false;

export function renderSite(el, { examples, quote }) {
  const ex = (examples || []).filter(e => e.slug !== 'grip-trainer'); // never on marketing surfaces (looks weapon-like)
  const hero = ex.find(e => e.slug === 'drop-night-light') || ex[0];
  const keep = el.scrollTop;
  if (hero && quoteSlug !== hero.slug && !quoteLoading) {
    quoteLoading = true;
    Promise.all([quote({ example: hero.slug }, 'assembled'), quote({ example: hero.slug }, 'kit')])
      .then(([a, k]) => { quoteCache = { a, k }; quoteSlug = hero.slug; })
      .catch(() => { quoteCache = null; quoteSlug = hero.slug; })
      .finally(() => { quoteLoading = false; if (!el.hidden) renderSite(el, { examples, quote }); });
  }
  const q = quoteSlug === hero?.slug ? quoteCache : null;
  const kitsOnly = q?.a?.sell_assembled === false; // prices: SELL_ASSEMBLED off = kits only
  const row = (t, k) => `<tr><td>${t.qty === 1 ? '1 unit' : t.qty.toLocaleString() + ' units'}</td><td class="u">${money(t.unit_price)}</td>
    ${kitsOnly ? '' : `<td>${k ? money(k.unit_price) : '–'}</td>`}<td>${money(t.shipping)}</td><td>${t.lead_time_days} d</td></tr>`;

  el.innerHTML = `
  <div class="wrap">
    <div class="s-nav">
      <a class="brand" href="#/forma"><span class="brand-mark" aria-hidden="true"></span>Premake</a>
      <nav><a href="#" data-jump="how">How it works</a><a href="#" data-jump="pricing">Pricing</a><a href="#" data-jump="made">Gallery</a></nav>
      <a class="open" href="#/">Start building</a>
    </div>

    <section class="s-hero">
      <div>
        <h1>Say what you want, hold it next week</h1>
        <p class="lede">Premake turns a plain description into a real product: printable CAD, a list of parts you can actually buy, and a price for one unit or five hundred.</p>
        <div class="ctas"><a class="cta" href="#/">Start building
          <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" fill="none"/></svg></a>
          <a class="ghost" href="#/examples">Browse examples</a></div>
      </div>
      <div class="s-plate">
        <div class="ask">“${hero && hero.slug !== 'drop-night-light' ? esc(hero.title) : 'A night light that glows warm, with a button to change modes'}.”</div>
        <div class="img"><i style="${hero ? `background-image:url('${esc(hero.thumb)}')` : ''}"></i></div>
        <div class="cap"><span><b>${esc(hero?.title || 'Drop night light')}</b></span><span>${q ? `${Math.round(q.a.print.grams)} g PETG · ${(+q.a.print.hours).toFixed(1)} h` : 'PETG · fits a 256 mm bed'}</span></div>
      </div>
    </section>
  </div>

  <section class="s-sec" id="s-how"><div class="wrap">
    <h2>From a sentence to a box on your doorstep</h2>
    <p class="intro">You talk, an agent does the CAD. Every change rebuilds the model in front of you, and the price updates with it.</p>
    <div class="s-steps">
      <div class="s-step"><div class="n">1</div><h3>Describe it</h3>
        <p>Say what it is, roughly how big, and what it needs to hold or do. No CAD skills, no sketches.</p>
        <div class="vign"><div class="bubble">A wall mount for two controllers, with a slot for the charging cable<span class="caret"></span></div></div></div>
      <div class="s-step"><div class="n">2</div><h3>Watch it build</h3>
        <p>The agent writes parametric CadQuery, exports print-ready parts and picks off-the-shelf hardware. Ask for changes like you would a colleague.</p>
        <div class="vign"><ul><li><b>✓</b>Editing design.py</li><li><b>✓</b>Exported 3 printed parts</li><li><b>✓</b>Added 4 × M3 screws to the parts list</li><li><b>›</b>Widening the cable slot to 9 mm</li></ul></div></div>
      <div class="s-step"><div class="n">3</div><h3>Order 1 to 500</h3>
        <p>Print the parts yourself or have a shop make them, then add the hardware. One for your desk or a run for your shop.</p>
        <div class="vign"><div class="qtys">${(q?.a.tiers || [{ qty: 1 }, { qty: 10 }, { qty: 100 }, { qty: 500 }]).map(t =>
          `<div><b>${t.qty}</b><span>${t.unit_price ? money(t.unit_price) : 'units'}</span></div>`).join('')}</div></div></div>
    </div>
  </div></section>

  <section class="s-sec" id="s-pricing"><div class="wrap s-price">
    <div>
      <h2 class="big">Honest pricing, per unit</h2>
      <p class="intro">Every quote is built from the design itself: the hardware on its parts list, the grams of filament, the printer hours, and assembly time.</p>
      <div class="points">
        <div><h3>Per unit, plus shipping</h3><p>Hardware gets cheaper in bulk and printing scales across the farm, so the unit price drops as quantity goes up. Shipping is one flat line per order.</p></div>
        ${kitsOnly ? '<div><h3>Sold as kits</h3><p>Kit: parts ship to you, with step-by-step instructions. Each supplier ships directly, so the lead time is the slowest one’s.</p></div>'
          : '<div><h3>Kit or assembled</h3><p>Kits ship as printed parts plus a bagged set of hardware, for a lower price. Assembled units arrive ready to use.</p></div>'}
        <div><h3>Lead time you can plan on</h3><p>Small orders ship in days. Large runs show the real time the printers need, before you order.</p></div>
      </div>
      <div class="soon"><span class="pill">Coming soon</span><p>Crowdfunding and pre-orders: share a design, collect orders, and we start printing when the run is funded.</p></div>
    </div>
    <div class="s-table">
      <div class="th"><b>${esc(hero?.title || 'Example quote')}</b><span>Live quote</span></div>
      ${q ? `<table><thead><tr><th>Quantity</th>${kitsOnly ? '<th>Kit</th>' : '<th>Assembled</th><th>Kit</th>'}<th>Shipping</th><th>Ships in</th></tr></thead>
        <tbody>${q.a.tiers.map((t, i) => row(t, q.k?.tiers?.[i])).join('')}</tbody></table>
        <div class="foot">Prices are at cost: exactly what the suppliers charge for the parts and their shipping, plus the card fee. No markup.</div>`
      : `<div class="foot" style="border-top:0">${quoteLoading ? 'Loading a live quote…' : 'Live quotes are unavailable right now. Try again in a minute.'}</div>`}
    </div>
  </div></section>

  <section class="s-sec" id="s-made"><div class="wrap">
    <div class="s-strip-head"><h2 class="big">Made with Premake</h2><a class="ghost" href="#/examples">See the full gallery</a></div>
    <div class="s-strip">${ex.slice(0, 10).map(e => `<a class="s-card" href="#/examples/${encodeURIComponent(e.slug)}">
      <div class="img" style="background-image:url('${esc(e.thumb)}')"></div><div class="t">${esc(e.title)}</div><div class="by">by ${esc(e.creator || 'Unknown')}</div></a>`).join('')
      || '<p class="intro">Examples are loading.</p>'}</div>
  </div></section>

  <section class="s-end"><div class="wrap">
    <h2>What will you make first?</h2>
    <a class="cta" href="#/">Start building
      <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 8h9M8 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" fill="none"/></svg></a>
  </div></section>
  <div class="wrap"><div class="s-foot"><span>Premake</span><span>Premake: describe it, watch it take shape, hold it next week.</span><span>Made to order</span></div></div>`;
  el.scrollTop = keep;
  el.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => {
    e.preventDefault(); el.querySelector('#s-' + a.dataset.jump)?.scrollIntoView({ behavior: 'smooth' });
  });
}
