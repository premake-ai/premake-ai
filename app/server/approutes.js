// urls: the studio's clean URLs (web/nav.js). These paths are the studio's own pages: they get index.html, like /.
// The gateway (gateway/server.js) keeps a copy of GUEST_PAGE for signed-out visitors; approutes.test.js checks they match.
'use strict';
const SUB = '(?:/(?:website|ads|launch|guide|app))?'; // app-preview: an example's App tab (its app, demo data)
const DSUB = '(?:/(?:website|ads|launch|guide|app|assemble))?'; // apps: a design's App tab (/designs/<x>/app); assemble: /designs/<x>/assemble
const EX = '[A-Za-z0-9][A-Za-z0-9_-]{0,63}';
// every studio page (signed in)
const APP_PAGE = new RegExp(`^/(?:new|store|website|ads|launch|stats|support(?:/[A-Za-z0-9_-]{1,64})?|orders(?:/(?:all|success))?|examples(?:/${EX}${SUB})?|designs/[A-Za-z0-9][A-Za-z0-9_-]{0,140}${DSUB})/?$`);
// the pages a signed-out visitor can open in the guest studio (examples, the store, the home box); the rest ask to sign in
const GUEST_PAGE = new RegExp(`^/(?:new|store|website|ads|examples(?:/${EX}${SUB})?)/?$`);
/** A browser page load (not a fetch for JSON or a file). */
const wantsHtml = (req) => { const a = String(req.headers.accept || ''); return !a || /text\/html|\*\/\*/.test(a); };
module.exports = { APP_PAGE, GUEST_PAGE, wantsHtml };

/** "SCARA Arm 3D Printer!" -> "scara-arm-3d-printer" (same as web/nav.js slugify). */
function slugify(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
/** /designs/<slug>-<id> (the id is what the studio looks up). */
function designPath(id, title) {
  const s = slugify(title);
  return `/designs/${s && !/^untitled(-design)?$/.test(s) ? s + '-' : ''}${encodeURIComponent(id)}`;
}
module.exports.slugify = slugify;
module.exports.designPath = designPath;
