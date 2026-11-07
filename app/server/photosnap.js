// photosnap: "Use your phone" on a photo request card (the design agent's "photo": true question, web/photocard.js).
// The studio makes a code for one design; the phone opens <phone link>/snap/<code> (server/phonelink.js: the tunnel
// straight to this computer), takes a photo with its camera and uploads it into that design's uploads/. The studio
// polls the code and sends the photo to the agent when it lands. The code does nothing else: it can't read the design,
// sign the phone in or reach any other route.
//   - code: 16 random bytes (base64url, 22 chars); only its SHA-256 is kept, in memory; 10 minutes; at most 4 photos
'use strict';
const crypto = require('node:crypto');

const TTL_MS = 10 * 60e3;
const MAX_FILES = 4;
const MAX_LIVE = 200;
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const hash = (t) => crypto.createHash('sha256').update('premake-snap\0' + t).digest('hex');

function createStore({ now = Date.now } = {}) {
  const live = new Map(); // hash -> { project, exp, files: [{ id, url }] }
  const sweep = () => { const t = now(); for (const [k, v] of live) if (v.exp <= t) live.delete(k); };
  return {
    issue(project) {
      sweep();
      if (live.size >= MAX_LIVE) throw Object.assign(new Error('Too many photo codes right now. Try again in a few minutes.'), { code: 503 });
      const token = crypto.randomBytes(16).toString('base64url');
      live.set(hash(token), { project: String(project), exp: now() + TTL_MS, files: [] });
      return { token, ttl_s: Math.round(TTL_MS / 1000) };
    },
    /** The live entry for a code, or null. */
    get(token) {
      if (!TOKEN_RE.test(String(token || ''))) return null;
      const e = live.get(hash(token));
      return e && e.exp > now() ? e : null;
    },
    full: (e) => e.files.length >= MAX_FILES,
  };
}

/** The phone's page: one big "Take photo" button (the camera opens straight away on most phones), downscale, upload. */
function page(token, title) {
  const nonce = crypto.randomBytes(12).toString('base64');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>Take a photo · Premake</title><style>*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:16px;background:#fafaf9;color:#1c1917;font:16px/1.5 Inter,system-ui,-apple-system,sans-serif}
main{width:100%;max-width:380px;background:#fff;border:1px solid #e7e5e4;border-radius:16px;padding:28px 22px}h1{font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:650}
p{margin:0 0 20px;color:#6b6560;font-size:15px}label{display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;font-weight:600;border-radius:12px;background:#e8590c;color:#fff;cursor:pointer}
input{position:absolute;width:1px;height:1px;opacity:0}img{display:block;width:100%;border-radius:10px;margin:0 0 16px}#st{margin:14px 0 0;font-size:14px;text-align:center}</style></head>
<body><main><h1>Take a photo</h1><p>${esc(title)}</p><img id="pv" alt="" hidden><label id="lb">Take photo<input id="f" type="file" accept="image/*" capture="environment"></label><p id="st" aria-live="polite"></p></main>
<script nonce="${nonce}">
const f=document.getElementById('f'),st=document.getElementById('st'),lb=document.getElementById('lb'),pv=document.getElementById('pv');
async function shrink(file){let src;try{src=await createImageBitmap(file,{imageOrientation:'from-image'})}catch{src=await createImageBitmap(file)}
const k=Math.min(1,1600/Math.max(src.width,src.height)),c=document.createElement('canvas');c.width=Math.round(src.width*k);c.height=Math.round(src.height*k);
c.getContext('2d').drawImage(src,0,0,c.width,c.height);return new Promise(r=>c.toBlob(r,'image/jpeg',0.85))}
f.onchange=async()=>{const file=f.files[0];if(!file)return;st.textContent='Sending…';lb.hidden=true;
try{const b=await shrink(file);pv.src=URL.createObjectURL(b);pv.hidden=false;
const r=await fetch(location.pathname,{method:'POST',headers:{'Content-Type':'image/jpeg'},body:b});const j=await r.json().catch(()=>({}));
if(!r.ok)throw new Error(j.error||'Upload failed');st.textContent='Sent. It’s on your computer now.';lb.firstChild.textContent='Take another';lb.hidden=false}
catch(e){st.textContent=(e.message||'That didn’t work')+'. Try again.';lb.hidden=false}f.value=''};
</script></body></html>`;
  return { html, csp: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'` };
}

module.exports = { createStore, page, TOKEN_RE, MAX_FILES };
