// Image attachments for the agent chats: upload, validate, store under <project>/uploads/, and hand them to the agent.
//
//   POST   /api/projects/<id>/uploads          raw image body (Content-Type image/png|jpeg|webp|gif) -> { id, url }
//   DELETE /api/projects/<id>/uploads/<file>   remove an upload that was never sent
//
// The browser re-encodes every image (max 1600 px, JPEG ~0.85) before upload, so EXIF never arrives. The server trusts
// nothing: owner-only (checked by server.js before calling api()), rate-limited, size-capped, and the bytes must start
// with a PNG / JPEG / WebP / GIF signature. Files are served by the existing owner-only /files/projects/<id>/uploads/ route.
// Messages carry { attachments: [ids] }; the message endpoints call withImages() to append the file list to the prompt,
// then tag() to record the attachments on the saved chat message (so the history can show thumbnails).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 5 * 1024 * 1024; // per image, after the browser's downscale
const MAX_PER_MESSAGE = 4;
const MAX_PER_PROJECT = 200;
const UPLOADS_PER_HOUR = 60;
const ID_RE = /^\d{13}-[a-f0-9]{8}\.(png|jpg|webp|gif)$/;
const DEFAULT_TEXT = 'Design a product based on this image.';

let deps = null; // { send, allow }
function init(d) { deps = d; return module.exports; }

/** Image type from the first bytes, or null. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  return null;
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) { req.resume(); return reject(Object.assign(new Error('That image is over 5 MB. Try a smaller one.'), { code: 413 })); }
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('That image is over 5 MB. Try a smaller one.'), { code: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const uploadsDir = (dir) => path.join(dir, 'uploads');
const urlFor = (id, file) => `/files/projects/${id}/uploads/${file}`;

/** Handles /api/projects/<id>/uploads[/<file>]. The caller has already checked the project exists and acc may edit it. */
async function api(req, res, { id, dir, acc, d, m }) {
  const { send, allow } = deps;
  if (m === 'POST' && !d) {
    if (!allow('uploads:' + (acc.user || acc.sid), UPLOADS_PER_HOUR, 3600e3)) return send(res, 429, { error: 'That is a lot of images this hour. Try again later.' });
    const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(png|jpeg|webp|gif)$/.test(ct)) { req.resume(); return send(res, 415, { error: 'Only PNG, JPEG, WebP or GIF images can be attached.' }); }
    const buf = await readRaw(req, MAX_BYTES);
    const ext = sniff(buf);
    if (!ext) return send(res, 415, { error: 'That file is not a PNG, JPEG, WebP or GIF image.' });
    const up = uploadsDir(dir);
    fs.mkdirSync(up, { recursive: true });
    if (fs.readdirSync(up).filter((f) => ID_RE.test(f)).length >= MAX_PER_PROJECT) return send(res, 409, { error: 'This project has too many images. Start a new project to attach more.' });
    const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(up, file), buf, { flag: 'wx' });
    return send(res, 200, { id: file, url: urlFor(id, file), bytes: buf.length });
  }
  if (m === 'DELETE' && d) {
    if (!ID_RE.test(d)) return send(res, 404, { error: 'not found' });
    try { fs.unlinkSync(path.join(uploadsDir(dir), d)); } catch {}
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'no such endpoint' });
}

/** photocard: save an image buffer (the phone photo page) into <dir>/uploads/; returns { id, url } or throws { code }. */
function save(dir, projectId, buf) {
  const ext = sniff(buf);
  if (!ext) throw Object.assign(new Error('That file is not a PNG, JPEG, WebP or GIF image.'), { code: 415 });
  if (buf.length > MAX_BYTES) throw Object.assign(new Error('That image is over 5 MB.'), { code: 413 });
  const up = uploadsDir(dir);
  fs.mkdirSync(up, { recursive: true });
  if (fs.readdirSync(up).filter((f) => ID_RE.test(f)).length >= MAX_PER_PROJECT) throw Object.assign(new Error('This project has too many images.'), { code: 409 });
  const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(up, file), buf, { flag: 'wx' });
  return { id: file, url: urlFor(projectId, file) };
}

/** Validated attachment ids for this project (existing files only, deduped, at most 4). Throws 400 on a bad list. */
function pick(dir, list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw Object.assign(new Error('attachments must be a list'), { code: 400 });
  const ids = [...new Set(list.map((x) => (typeof x === 'string' ? x : x?.id)).filter(Boolean))];
  if (ids.length > MAX_PER_MESSAGE) throw Object.assign(new Error(`Attach at most ${MAX_PER_MESSAGE} images per message.`), { code: 400 });
  for (const f of ids) {
    if (!ID_RE.test(f) || !fs.existsSync(path.join(uploadsDir(dir), f))) throw Object.assign(new Error('An attached image is missing. Remove it and attach it again.'), { code: 400 });
  }
  return ids;
}

/** The prompt the agent gets: the user's text (or a default for an image-only message) plus the image file list.
 * dir (design chat only): name an untitled project from the user's own words now, so the title never includes the file note. */
function withImages(text, ids, dir) {
  if (!ids.length) return text;
  if (dir) {
    try {
      const f = path.join(dir, 'meta.json');
      const meta = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!meta.title || meta.title === 'Untitled') {
        const w = String(text || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '');
        meta.title = w ? w[0].toUpperCase() + w.slice(1) : 'Design from an image';
        const tmp = f + '.' + process.pid + '.tmp'; // B2: temp + rename replaces a symlink instead of writing through it
        fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
        fs.renameSync(tmp, f);
      }
    } catch {}
  }
  const base = text || (ids.length > 1 ? 'Design a product based on these images.' : DEFAULT_TEXT);
  return `${base}\n\n[Attached images: ${ids.map((f) => './uploads/' + f).join(', ')} — Read each image file with the Read tool before designing. `
    + 'Use them as visual reference for shape, style and proportions; estimate dimensions from known objects or ask once if scale is unclear.]';
}

/** Record the attachments on the saved user message (the run writes it; retried briefly in case that happens async). */
function tag(file, text, ids, projectId, tries = 0) {
  if (!ids.length) return;
  let msgs;
  try { msgs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { msgs = null; }
  const i = Array.isArray(msgs) ? msgs.map((x, k) => [x, k]).reverse().find(([x]) => x.role === 'user' && x.text === text && !x.attachments)?.[1] : undefined;
  if (i === undefined) { if (tries < 20) setTimeout(() => tag(file, text, ids, projectId, tries + 1), 250).unref(); return; }
  msgs[i].attachments = ids.map((f) => ({ id: f, url: urlFor(projectId, f) }));
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(msgs, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = { save, readRaw, init, api, pick, withImages, tag, sniff, MAX_BYTES, MAX_PER_MESSAGE };
