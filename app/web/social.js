// social: the community layer around public designs (server/social.js).
//   socialHtml(e)              "♥ 214  ↻ 31  💬 18" line on studio gallery cards (counts come with /api/examples)
//   mountTicker(el)            a strip of designs really finished lately, inserted before el (the studio's examples grid), once
//   mountSocial(root, g, opt)  build page /build/<slug>: the like / remix / built bar ([data-social-bar]) and the
//                              comments section ([data-social-talk]) inside root. opt: { signIn(title, text, what), toast(msg) }
// Real activity only: no made-up orders, comments or counts. Loads its own stylesheet (/social.css).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kfmt = n => n >= 10000 ? Math.round(n / 1000) + 'k' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
const plural = (n, one, many = one + 's') => `${kfmt(n)} ${n === 1 ? one : many}`;

(function css() {
  if (document.querySelector('link[data-social-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = '/social.css'; l.dataset.socialCss = '';
  document.head.append(l);
})();

const IC = {
  heart: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M8 13.5S2 10 2 6.2A3.2 3.2 0 018 4.6a3.2 3.2 0 016 1.6C14 10 8 13.5 8 13.5z"/></svg>',
  remix: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 2.5v6a3 3 0 003 3h5M9.5 9l2.5 2.5L9.5 14M4 2.5L2 4.5M4 2.5l2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  talk: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  built: '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3zM2.5 5.5L8 8.5l5.5-3M8 8.5v5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
};

export function ago(iso) {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60e3);
  if (!Number.isFinite(m)) return '';
  if (m < 1.5) return 'just now';
  if (m < 60) return `${Math.round(m)} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 60 * 1440) return `${Math.round(m / 1440)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- gallery cards
export function socialHtml(e) {
  if (!e || !(e.likes > 0 || e.comments > 0)) return '';
  return `<div class="so-card">${e.likes > 0 ? `<span title="${e.likes} likes">${IC.heart}${kfmt(e.likes)}</span>` : ''}${e.remixes > 0 ? `<span title="${e.remixes} remixes">${IC.remix}${kfmt(e.remixes)}</span>` : ''}${e.comments > 0 ? `<span title="${e.comments} comments">${IC.talk}${kfmt(e.comments)}</span>` : ''}</div>`;
}

// ---------------------------------------------------------------- recently designed strip
// Real designs only (server/social.js recent()): "Phone-Face Desk Robot · designed 8 min ago · $136".
export const priceShort = n => !(n > 0) ? '' : n >= 100 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + n.toFixed(2);
let feedP = null;
export function mountTicker(before) {
  if (!before || before.previousElementSibling?.classList.contains('so-orders')) return;
  const box = document.createElement('div');
  box.className = 'so-orders'; box.hidden = true; box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Recently designed');
  before.before(box);
  feedP = feedP || fetch('/api/social/feed', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  feedP.then(({ recent = [] }) => {
    if (recent.length < 3) { box.remove(); return; }
    const items = recent.slice(0, 16).map(o => `<li><a href="/examples/${encodeURIComponent(o.slug)}"><img class="so-th" src="${esc(o.thumb)}" alt="" width="30" height="30" loading="lazy" decoding="async">`
      + `<span><b>${esc(o.title)}</b> designed <time datetime="${esc(o.at)}">${esc(ago(o.at))}</time></span>${o.price_each ? `<span class="so-pr">${esc(priceShort(o.price_each))}</span>` : ''}</a></li>`).join('');
    box.innerHTML = `<span class="so-orders-note">Just designed</span><div class="so-orders-view"><div class="so-orders-track" style="animation-duration:${Math.max(40, Math.min(16, recent.length) * 5)}s">`
      + `<ul>${items}</ul><ul aria-hidden="true">${items.replace(/<a /g, '<a tabindex="-1" ')}</ul></div></div>`;
    box.hidden = false;
  });
}

// ---------------------------------------------------------------- build page: like bar + comments
const cache = new Map(); // slug -> payload
const mounts = new Map(); // slug -> draw() of the newest mount (the build page re-renders its panel, e.g. when the guide finishes)
const states = new Map(); // slug -> { all, open, busy, drafts }: kept across re-renders so a half-written comment survives
const SHOW = 6;

export function mountSocial(root, g, opt = {}) {
  const bar = root.querySelector('[data-social-bar]'), talk = root.querySelector('[data-social-talk]');
  if (!bar && !talk) return;
  const st = states.get(g.slug) || { all: false, open: null, busy: false, drafts: {} };
  states.set(g.slug, st);
  const draw = () => {
    const d = cache.get(g.slug);
    if (!d) return;
    if (bar) bar.innerHTML = barHtml(d);
    if (talk) talk.innerHTML = talkHtml(d, st);
    wire();
  };
  mounts.set(g.slug, draw);
  const redraw = () => (mounts.get(g.slug) || draw)();
  const load = () => fetch(`/build/${encodeURIComponent(g.slug)}/comments.json`, { cache: 'no-store' })
    .then(r => r.ok ? r.json() : null).then(d => { if (d) { cache.set(g.slug, d); redraw(); } }).catch(() => {});
  const toast = m => (opt.toast ? opt.toast(m) : console.warn(m));
  const signIn = (title, text) => (opt.signIn ? opt.signIn(title, text, 'comment') : (location.href = '/auth/signin'));
  async function call(url, method, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(j?.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }

  function wire() {
    const d = cache.get(g.slug);
    const like = bar?.querySelector('[data-like]');
    if (like) like.onclick = async () => {
      if (!d.can_post) return signIn('Sign in to like this', 'Likes help good designs reach more people.');
      const on = !d.liked;
      d.liked = on; d.likes += on ? 1 : -1; draw(); // optimistic
      try { const r = await call('/api/social/like', 'POST', { slug: g.slug, on }); d.liked = r.liked; d.likes = r.likes; draw(); }
      catch (e) { d.liked = !on; d.likes += on ? -1 : 1; draw(); toast(e.message); }
    };
    bar?.querySelector('[data-jump]')?.addEventListener('click', ev => { ev.preventDefault(); talk?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    if (!talk) return;
    talk.querySelector('[data-signin]')?.addEventListener('click', () => signIn('Sign in to comment', 'Ask the creator a question or share how your build went.'));
    talk.querySelector('[data-more]')?.addEventListener('click', () => { st.all = true; draw(); });
    talk.querySelectorAll('[data-reply]').forEach(b => b.onclick = () => {
      if (!d.can_post) return signIn('Sign in to reply', 'Join the conversation about this design.');
      st.open = st.open === b.dataset.reply ? null : b.dataset.reply; draw();
      talk.querySelector(`form[data-parent="${CSS.escape(b.dataset.reply)}"] textarea`)?.focus();
    });
    talk.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await confirmDelete(b)) return;
      b.disabled = true;
      try { const r = await call(`/api/social/comments/${encodeURIComponent(b.dataset.del)}`, 'DELETE'); d.count = r.count; await load(); }
      catch (e) { b.disabled = false; toast(e.message); }
    });
    talk.querySelectorAll('form.so-form').forEach(f => {
      const ta = f.querySelector('textarea'), btn = f.querySelector('button[type=submit]');
      const key = f.dataset.parent || '';
      if (st.drafts[key] && !ta.value) ta.value = st.drafts[key];
      const sync = () => { btn.disabled = !ta.value.trim() || st.busy; ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight + 2) + 'px'; ta.style.overflowY = ta.scrollHeight > 200 ? 'auto' : 'hidden'; };
      ta.oninput = () => { st.drafts[key] = ta.value; sync(); }; sync();
      ta.onkeydown = e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); f.requestSubmit(); } };
      f.onsubmit = async e => {
        e.preventDefault();
        const text = ta.value.trim(); if (!text || st.busy) return;
        st.busy = true; sync();
        try {
          await call('/api/social/comments', 'POST', { slug: g.slug, text, ...(f.dataset.parent ? { reply_to: f.dataset.parent } : {}) });
          st.open = null; st.busy = false; ta.value = ''; delete st.drafts[key];
          await load();
        } catch (err) { st.busy = false; sync(); toast(err.status === 401 ? 'Sign in to comment.' : err.message); }
      };
    });
  }

  if (cache.has(g.slug)) draw(); else load();
}

// Delete confirmation: an iOS action sheet on phones, a two-tap "Delete?" in place on desktop.
function confirmDelete(btn) {
  if (!matchMedia('(max-width: 640px)').matches) {
    if (btn.dataset.armed) return Promise.resolve(true);
    btn.dataset.armed = '1'; btn.textContent = 'Delete? Tap again'; btn.classList.add('so-danger');
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = 'Delete'; btn.classList.remove('so-danger'); } }, 3500);
    return Promise.resolve(false);
  }
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'so-as';
    wrap.innerHTML = `<div class="so-as-dim"></div><div class="so-as-box" role="dialog" aria-label="Delete comment">
      <div class="so-as-group"><p>This comment and its replies will be removed for everyone.</p><button type="button" class="so-as-del" data-ok>Delete comment</button></div>
      <div class="so-as-group"><button type="button" class="so-as-cancel" data-no>Cancel</button></div></div>`;
    const done = v => { wrap.classList.remove('in'); setTimeout(() => wrap.remove(), 220); resolve(v); };
    wrap.querySelector('[data-ok]').onclick = () => done(true);
    wrap.querySelector('[data-no]').onclick = () => done(false);
    wrap.querySelector('.so-as-dim').onclick = () => done(false);
    document.body.append(wrap);
    void wrap.offsetHeight; // start the slide-up from the off-screen position
    wrap.classList.add('in');
    wrap.querySelector('[data-no]').focus({ preventScroll: true });
  });
}

function barHtml(d) {
  return `<button type="button" class="so-like ${d.liked ? 'on' : ''}" data-like aria-pressed="${d.liked}" title="${d.liked ? 'Unlike' : 'Like'}">${IC.heart}<span>${kfmt(d.likes)}</span></button>`
    + (d.remixes ? `<span class="so-stat">${IC.remix}${plural(d.remixes, 'remix', 'remixes')}</span>` : '')
    + (d.builds ? `<span class="so-stat">${IC.built}${kfmt(d.builds)} built it</span>` : '')
    + `<a class="so-stat so-link" href="#comments" data-jump>${IC.talk}${d.count ? plural(d.count, 'comment') : 'Comment'}</a>`;
}

const avatar = (c, cls = 'so-av') => `<span class="${cls}" style="background:${esc(c.color)}" aria-hidden="true">${esc(c.initials)}</span>`;
function commentHtml(c, d, st, reply = false) {
  return `<div class="so-c ${reply ? 'so-reply' : ''}" id="c-${esc(c.id)}">${avatar(c)}<div class="so-cb">
    <div class="so-ch"><b>${esc(c.name)}</b>${c.handle ? `<span class="so-h">${esc(c.handle)}</span>` : ''}${c.creator ? '<span class="so-badge">Creator</span>' : ''}${c.team ? '<span class="so-badge team">Team</span>' : ''}<time datetime="${esc(c.at)}">${esc(ago(c.at))}</time></div>
    <p>${esc(c.text)}</p>
    <div class="so-acts">${c.likes ? `<span class="so-helpful">${IC.heart}${c.likes}</span>` : ''}${reply ? '' : `<button type="button" data-reply="${esc(c.id)}">Reply</button>`}${c.can_delete ? `<button type="button" data-del="${esc(c.id)}">Delete</button>` : ''}</div>
    ${reply ? '' : `${(c.replies || []).map(r => commentHtml(r, d, st, true)).join('')}${st.open === c.id ? formHtml(d, c.id) : ''}`}
  </div></div>`;
}
function formHtml(d, parent = '') {
  return `<form class="so-form ${parent ? 'so-form-reply' : ''}" ${parent ? `data-parent="${esc(parent)}"` : ''}>${d.me ? avatar(d.me) : ''}
    <div class="so-fbox"><textarea rows="1" maxlength="1000" placeholder="${parent ? 'Write a reply' : 'Ask the creator a question, or share how your build went'}" aria-label="${parent ? 'Reply' : 'Add a comment'}"></textarea>
    <button type="submit" class="btn sm primary" disabled>${parent ? 'Reply' : 'Post'}</button></div></form>`;
}
function talkHtml(d, st) {
  const list = d.comments || [];
  const shown = st.all ? list : list.slice(0, SHOW);
  return `<h2>Comments${d.count ? ` <span class="so-count">${d.count}</span>` : ''}</h2>
    ${d.can_post ? formHtml(d) : '<button type="button" class="btn so-signin" data-signin>Sign in to comment</button>'}
    ${list.length ? `<div class="so-list">${shown.map(c => commentHtml(c, d, st)).join('')}</div>` : '<p class="so-empty">No comments yet. Be the first to ask a question.</p>'}
    ${list.length > shown.length ? `<button type="button" class="btn sm so-more" data-more>Show all ${list.length} conversations</button>` : ''}
`;
}
