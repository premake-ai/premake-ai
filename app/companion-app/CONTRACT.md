# Buildery companion apps: shared contract (v1)

Products with electronics get a **companion web app**: live readings, history, alerts and photo checks, generated per product by an AI "app agent".

Three builders work against this contract:
- **Platform**: devices, ingest, readings, alerts, push, photo AI, gateway
- **Shell**: the app shell, the SDK, the sandbox, the studio App tab, the app agent
- **Plant**: the first app (the SmartyPlants clone, project `4fe69f4d9c`) plus firmware

Don't change a contract shape without updating this file and telling the others.

This file now lives in the repo (`companion-app/CONTRACT.md`); the copy in the old session folder is out of date.

## 1. Data on disk (Mac server, under `FORMA_DATA_DIR`)
```
devices/<deviceId>.json        { id, project, owner, name, profile, created, key_hash, last: { t, r } | null, fw }
devices/<deviceId>/readings.jsonl   one line per reading: {"t":"<iso>","r":{"moisture":41.2,...}}
devices/<deviceId>/photos/<photoId>.jpg + <photoId>.json   (analysis result)
push/<owner-hash>.json         [ { endpoint, keys:{p256dh,auth}, app, created } ]
projects/<projectId>/app/      generated app files (see 4)
```
- Platform additions (internal, nobody else reads them): `devices/<deviceId>/state.json` (alert state per rule: active, since, last sent), `devices/photo_usage.json` (today's photo-check counts). A PNG photo is kept as `<photoId>.png`; HEIC is converted and kept as `.jpg`.
- `readings.jsonl` is time-ordered. Past ~20,000 lines it is compacted: nothing older than 366 days, the last 2 days at full resolution, older readings averaged into 30-minute (then coarser) buckets.
- `deviceId` = `dv_` + 10 hex.
- The device **key** is 32 random bytes, base64url. Only `sha256(key)` is stored; compare in constant time. The key is shown to the owner ONCE, on creation or rotation.

## 2. Device ingest (public, used by firmware)
```
POST /api/d/ingest
Authorization: Device <key>
Content-Type: application/json
{"r":{"moisture":41.2,"light":830,"temp":21.4,"humidity":48,"battery":3.92},"fw":"1.0.0"}
-> 200 {"ok":true,"interval":1800}
-> 401 bad key | 413 too big | 422 bad body | 429 too soon
```
Validation:
- body ≤ 2 KB
- `r` has 1–16 fields
- field names match `^[a-z][a-z0-9_]{0,23}$`
- values are finite numbers with |v| < 1e7
- `fw` is ≤ 16 chars from `[0-9A-Za-z._-]`
- rate limit: 1 per 20 s per device, plus a global cap
- nothing else is accepted
- Platform notes: every request with a valid key counts toward the 20 s, a 422 too. A 429 carries `Retry-After` (seconds). The global cap is 600 accepted readings a minute; bad keys have their own cap (300 a minute), so they can't use up the real one. `fw: ""` clears the stored version. The reading's time is the server's receive time.

The gateway lets **only** `POST /api/d/ingest` and `GET /api/d/commands` (2b) through without a login, the same way it already passes the Stripe webhook.

## 2b. Device commands (controls: app -> server -> device)
Products with actuators (a servo, motor, relay, LEDs, a buzzer) are driven from the companion app. The server keeps one
**desired state** per device, `{ seq, set: { control: value } }`; every accepted command merges into `set` and bumps `seq`.
The firmware long-polls it with the same device key as ingest:
```
GET /api/d/commands?since=<seq>&wait=<0-25>
Authorization: Device <key>
-> 200 {"seq":7,"set":{"angle":90,"lamp":true,"color":"#ff8800","mode":"wave","wave":3}}
-> 401 bad key | 405 not GET | 429 too soon (Retry-After)
```
- The reply is always the WHOLE state. It comes at once when `seq` differs from `since` (or `since` is missing, or `wait=0`), otherwise when a command arrives or after `wait` seconds (at most 25), whichever is first.
- Firmware: start with `since=0` (a reboot gets the current state back), apply `set` only when `seq` changed, remember `seq`, poll again straight away; on errors wait 5 s (429: `Retry-After`). Clamp every value to what the hardware can safely do.
- A `button` control arrives as a press counter (0, 1, 2, ...): act when it changes, not on the first value after boot.
- Limits: one poll start per device every 2 s (a long poll counts once), one open poll per device (a newer one answers the older at once), 3000 authenticated polls a minute in total; bad keys share ingest's bad-key cap (300 a minute). Only `since` and `wait` (digits) pass the gateway.
- Each answered poll marks the latest `seq` as delivered; the time of the last poll is kept (in memory, saved with the next command).

## 3. Owner API (signed-in, owner only, 404 for anyone else)
```
GET    /api/apps/<projectId>/devices            -> [{ id, name, profile, created, last:{t,r}|null, status:"ok"|"watch"|"alert"|"offline", battery }]
POST   /api/apps/<projectId>/devices {name}     -> { device, key }     (key shown once)
PATCH  /api/devices/<id> {name?, profile?}      -> device
DELETE /api/devices/<id>                        -> { ok }
POST   /api/devices/<id>/rotate-key             -> { key }
GET    /api/devices/<id>/readings?from=<iso>&to=<iso>&bucket=<sec>
       -> { fields:["moisture",...], points:[[ "<iso>", {"moisture":41.2,...} ], ...] }   (averaged per bucket, max 2000 points)
POST   /api/devices/<id>/photo {image:"data:image/jpeg;base64,..."}  (≤ 6 MB, jpeg/png/heic magic-checked)
       -> { id, t, health:"good"|"watch"|"bad", summary, issues:[...], advice:[...], growth?: "..." }
GET    /api/devices/<id>/photos                 -> [ { id, t, health, summary, url } ]
GET    /api/push/key                            -> { publicKey }        (VAPID)
POST   /api/push/subscribe {subscription, app}  -> { ok }
DELETE /api/push/subscribe {endpoint}           -> { ok }
```
**Platform additions** (all optional; nothing above changed):
- Device objects also carry `fw` and `alerts: [{ id, severity, message, since }]`: the rules firing now, message already filled in (so the app can say why it's `watch` or `alert`).
- `GET /api/devices/<id>` -> device. `POST /api/apps/<projectId>/devices` also takes an optional `profile`, and its reply adds `ingest` (the URL the firmware posts to).
- Readings: `range=day|week|month|year` works instead of `from`. The reply adds `bucket` (seconds, 0 = raw readings), `from` and `to`. A bucketed point's time is the bucket's start (UTC-aligned). A bucket too small for the range is raised so the reply stays at 2000 points or fewer.
- Photos: `url` is `/api/devices/<id>/photos/<photoId>/image` (owner only, same-origin fetch). `GET /api/devices/<id>/photos/<photoId>` -> the full analysis. `POST .../photo` errors: 422 not a data URL, 413 over 6 MB, 415 not JPEG/PNG/HEIC, 429 daily cap or busy (5 at a time), 502/504 the check failed (the photo isn't kept). A check counts toward the daily caps when it starts.
- **Controls** (2b): `POST /api/devices/<id>/command {"set":{control: value}}` -> device (owner only, 404 for anyone else). 1 to 8 controls, each declared in app.json `controls` (section 4) and of its type; anything else is 422 with a message fit to show. Limits: 40 commands per 10 s per device, 600 a minute per owner (429, `Retry-After: 2`). Device objects then carry `control: { set, seq, delivered, polled }` (`delivered`: the device fetched the latest `seq`; `polled`: ISO time of its last poll or null). `control` is absent until a command was sent or the device polled.
- **Phone preview links** (studio): `GET|POST|DELETE /api/apps/<projectId>/link` (owner or admin only, 404 otherwise). GET -> `{ link: { token, url, created, expires } | null }`; POST makes a new link (the old one stops working; 409 when the app isn't built; 30 an hour per user); DELETE turns it off -> `{ link: null }`. See section 5.
- `DELETE /api/push/subscribe` takes an optional `app`: only that app's subscription on that endpoint (one service worker serves every app on the origin).
- Push message (the JSON the service worker gets in its `push` event):
  `{ "title": "Plant Sensor", "body": "Kitchen fern needs a drink", "tag": "dv_..:thirsty", "url": "/apps/<projectId>", "app": "<projectId>", "device": "dv_..", "rule": "thirsty", "severity": "high"|"low", "t": "<iso>" }`
  `title` is app.json `name`. Use `tag` as the notification tag (a newer alert for the same rule and device replaces the old one) and open `url` on click. Sent with Urgency `high` for high severity, TTL 12 h.
- **Status:**
  - `offline` if there's no reading for 3× the interval (a new device is `offline` until its first reading).
  - Otherwise use the worst alert rule that is currently firing: `alert` (severity high) or `watch` (low).
  - If no rule is firing, `ok`.
- **Photo AI:**
  - Runs the Claude CLI on Josh's Claude subscription, never the API (strip `ANTHROPIC_API_KEY`), model `claude-opus-5-5`.
  - No tools except Read on that one image, in a temp cwd, with the same clean env as other agents.
  - The prompt includes the plant's profile and its recent readings.
  - Caps: 10 per user per day and 200 per day in total, both configurable by env.

## 4. Generated app files (`projects/<projectId>/app/`)
- `index.html`, `app.js`, `style.css`, plus optional assets. These are written by the app agent and run inside the **sandbox** (see 5).
- `app.json`: `{ "name": "Plant Sensor", "short_name": "Plants", "theme": "#2f7d4f", "icon": "icon.svg", "fields": { "moisture": {"label":"Soil moisture","unit":"%"}, "light": {"label":"Light","unit":"lux"}, ... } }`
- `profiles.json`: `{ "monstera": { "name":"Monstera", "moisture_min":30, "moisture_max":60, "light_min":2500, "light_max":20000, "temp_min":18, "temp_max":30, "humidity_min":40, "humidity_max":80, "notes":"..." }, ... }`
- `alerts.json` (data only, evaluated by the platform on every ingest):
```
{ "rules": [
  { "id":"thirsty", "field":"moisture", "below":"profile.moisture_min", "severity":"high", "message":"{name} needs a drink", "cooldown_h":12 },
  { "id":"soggy",   "field":"moisture", "above":"profile.moisture_max", "severity":"low",  "message":"{name} is overwatered", "cooldown_h":24 },
  { "id":"dark",    "field":"light",    "below":"profile.light_min", "sustain_h":6, "severity":"low", "message":"{name} wants more light", "cooldown_h":24 },
  { "id":"battery", "field":"battery",  "below":3.45, "severity":"low", "message":"{name}'s sensor needs charging", "cooldown_h":48 },
  { "id":"offline", "stale_h":3, "severity":"low", "message":"{name}'s sensor is offline", "cooldown_h":24 }
] }
```
- `app.json` may declare **`controls`** (2b): what the app can set on its devices, at most 12, keys follow the field-name rule:
  `"controls": { "angle": {"type":"range","label":"Flag angle","min":0,"max":180,"step":1,"unit":"°"}, "lamp": {"type":"toggle","label":"Lamp"}, "color": {"type":"color","label":"LED colour"}, "mode": {"type":"choice","label":"Mode","options":["wave","still"]}, "wave": {"type":"button","label":"Wave now"} }`
  - `range`: a number from `min` to `max` (default 0-100), snapped to `step`; `toggle`: true/false; `color`: `"#rrggbb"` (stored lower case); `choice`: one of `options` (1-12 strings of letters, digits, space, `_ . -`, up to 24); `button`: sent as `true`, stored as a press counter.
  - Malformed controls are dropped. The rules live in `web/apps/bridge.js` (`cleanControls`, `checkCommand`), used by the shell, the demo and the server alike.
- A threshold is either a number or `profile.<key>`. A rule is skipped if the device has no profile and the threshold refers to one.
- Message placeholders are `{name}`, `{value}`, `{unit}`.
- Malformed rules are ignored, never executed.
- Platform notes (how the engine reads these):
  - A rule may have both `below` and `above`: it fires outside that range.
  - `sustain_h`: the condition must hold on every reading for that many hours before the rule fires.
  - `cooldown_h`: hours between notifications for one rule on one device (default 24, at least 1). While a rule keeps firing, a reminder goes out every `cooldown_h`.
  - `stale_h` rules are checked every 10 minutes, only for devices that have reported at least once. Their `{value}` is the hours since the last reading and `{unit}` is `h`.
  - `{value}` is the reading, rounded (2 decimals under 10, 1 under 100, else whole). `{unit}` comes from app.json `fields.<field>.unit`. Messages are plain text, up to 200 characters.
  - `severity` defaults to `low`; any value other than `high` or `low` makes the rule malformed. At most 32 rules; each file at most 64 KB. Ignored rules are logged on the Mac with the reason.

## 5. App shell and sandbox (served by the Mac on the buildery.ai origin)
```
GET /apps/<projectId>                    trusted shell page (owner only for v1; ?preview=1 = demo data, allowed for the owner in the studio)
GET /apps/<projectId>/manifest.webmanifest  PWA manifest from app.json
GET /apps/sw.js                          service worker (scope /apps/), handles push + notificationclick
GET /apps/<projectId>/ui/<file>          generated files, sent with
      Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'
      X-Content-Type-Options: nosniff
GET /apps/sdk.js                         the bridge SDK the generated app includes
```
- The shell embeds `<iframe sandbox="allow-scripts allow-forms" src="/apps/<id>/ui/index.html">`.
- The app therefore has an **opaque origin**: no cookies, no API access, no `fetch`. All data comes through the bridge.
- The shell owns everything privileged: the title bar, "Add sensor" (pairing: name, then the key plus setup steps), "Alerts" on/off (a user gesture → Notification permission → push subscribe), and photo capture.
- **Shell additions** (`server/apps.js`):
  - `GET /apps/<projectId>/icon-<180|192|512>.png`: a flat icon in app.json `theme` (a leaf for plant apps, a signal glyph otherwise), drawn by the server. The manifest and notifications use it; the shell inlines the 180 px one as its `apple-touch-icon`.
  - `GET /apps/{shell.js,shell.css,bridge.js,demo.js,qr.js}`: the shell's own code (`web/apps/`). `sw.js` is sent with `Service-Worker-Allowed: /apps/`.
  - `/ui/` files: owner only (404 otherwise), realpath-contained in `projects/<id>/app/`, no dot files, no symlinks anywhere, types html, js, css, svg (only as an image: refused when `Sec-Fetch-Dest` says document/iframe), png, jpg, webp, json, woff2. **No `X-Frame-Options`** on them: browsers refuse a page with `SAMEORIGIN` inside `<iframe sandbox>` (its origin is opaque).
  - `index.html` is served with `/apps/sdk.js`, the app's own `.js`/`.css` and small images put **inline** (deferred scripts move to the end of `<body>`). The sandboxed page's own requests come from an opaque origin and may carry no session cookie, so through the gateway they would land on sign-in. The SDK is added if a page forgot it. Keep an app to one `index.html`, `app.js`, `style.css`.
  - The shell's own CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`, plus `X-Frame-Options: SAMEORIGIN`.

- **Public previews (demo data only, no sign-in)** (`server/apps.js`):
  - `GET /apps/t/<token>[/ui/<file>|/manifest.webmanifest|/icon-<n>.png]`: a phone preview link (the QR in the studio's App tab). `<token>` is 22 random base62 characters (~131 bits), stored server-side in `<DATA>/app_links.json` (0600) with `{ project, owner, created, expires }`. Valid for 24 h, one per design, and it stops working at once when the owner turns it off or makes a new one, when the design's owner changes or the design or its app is gone. Unknown tokens 404 (and more than 300 a minute are refused).
  - `GET /apps/ex/<slug>[/...]`: an example's app (the showcase copies `app/` into the example: only html, js, css, json, svg, png, jpg, webp, woff2, no dot files, no links). `GET /api/examples/<slug>` adds `app: { exists, name, url } | null`.
  - Both serve exactly the owner's preview shell: `?preview=1` is forced, the shell calls no API (demo devices from `demo.js`), sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, and its config has no studio link. The generated files are served under the token/slug with the same UI CSP, containment and inlining rules as `/apps/<id>/ui/`. Nothing else of the project (chat, devices, readings, photos, account) is reachable through them.
  - The gateway passes these GETs, plus `/apps/{shell.js,shell.css,bridge.js,demo.js,qr.js,sdk.js}`, without a session (no user, no cookies).
  - The shell config adds `at` (the app's URL root: `/apps/<id>`, `/apps/t/<token>` or `/apps/ex/<slug>`), `kind` (`owner` | `link` | `example`) and `controls` (cleaned).

**Bridge (postMessage).** The shell checks `event.source === iframe.contentWindow` and validates every parameter. Only this project's own devices are reachable.
```
// app -> shell
{ "bx":1, "id":7, "method":"devices" }                                   -> result: devices list (as in 3)
{ "bx":1, "id":8, "method":"readings", "params":{ "device":"dv_..", "range":"day"|"week"|"month" } }
{ "bx":1, "id":9, "method":"rename",   "params":{ "device":"dv_..", "name":"Kitchen fern" } }
{ "bx":1, "id":10,"method":"setProfile","params":{ "device":"dv_..", "profile":"monstera" } }
{ "bx":1, "id":11,"method":"addDevice" }                                  (shell shows its pairing sheet; result: device)
{ "bx":1, "id":12,"method":"photo",    "params":{ "device":"dv_.." } }    (shell opens camera/upload; result: analysis)
{ "bx":1, "id":13,"method":"photos",   "params":{ "device":"dv_.." } }
{ "bx":1, "id":14,"method":"alerts" }                                     (shell shows its alerts sheet; result: { on: bool })
{ "bx":1, "id":15,"method":"profiles" }                                   (shell addition: profiles.json as written)
{ "bx":1, "id":16,"method":"app" }                                        (shell addition: app.json as written, plus "preview": bool)
{ "bx":1, "id":17,"method":"command", "params":{ "device":"dv_..", "set":{ "angle":90 } } }   (controls: -> device; checked against app.json "controls")
// shell -> app
{ "bx":1, "id":7, "result":... } | { "bx":1, "id":7, "error":"..." }
{ "bx":1, "event":"reading", "device":"dv_..", "t":"<iso>", "r":{...} }   (shell polls every 60 s while visible)
{ "bx":1, "event":"theme", "dark":false, "safe_bottom":34 }               (shell addition: safe_bottom = px of home-indicator inset)
{ "bx":1, "event":"devices" }                                             (shell addition: the list changed: added, renamed, profile set)
```
- **Bridge rules** (`web/apps/bridge.js`, unit-tested): the shell also requires `event.origin === "null"`; `id` a non-negative integer; unknown methods (prototype names too) and unknown or mistyped params are refused; `device` must match `^dv_[0-9a-f]{10}$` and be one of this project's devices; a profile must be a key of profiles.json; names are 1-40 characters with control and bidi characters removed. 30 requests burst, 10 a second. One sheet at a time. If the app navigates its frame away, the shell puts the app back.
- **What crosses the bridge**: devices exactly as in §3 plus the platform's `fw` and `alerts` (never a key or hash); readings `{ fields, points }`; `photo` -> the analysis plus `image` (a small JPEG `data:` URL of the photo); `photos` -> `[{ id, t, health, summary, image? }]` (the shell fetches each `url`, at most 12, and shrinks it). Closing a sheet rejects with `"Cancelled"`. The pairing key never reaches the app.
- **Push** (`/apps/sw.js`): shows the platform's push message with `title`, `body`, `tag`, the app's icon, and opens `url` on click (only same-origin `/apps/...` URLs; otherwise `/apps/<app>`). Turning alerts off sends `DELETE /api/push/subscribe {endpoint, app}`; the browser subscription is dropped only when no other app on that device has alerts on.
- **SDK** (`/apps/sdk.js`): `buildery.devices()`, `buildery.readings(device, range)`, `buildery.rename(d, n)`, `buildery.setProfile(d, p)`, `buildery.addDevice()`, `buildery.photo(d)`, `buildery.photos(d)`, `buildery.alerts()`, `buildery.on('reading', cb)`, `buildery.profiles()` (the shell passes profiles.json in), `buildery.app()` (app.json), `buildery.command(device, set)` (controls: one request per device in flight, later calls merge, latest value wins). All return Promises.
- **Preview** (`?preview=1`): the shell answers with 3 demo devices and realistic synthetic history, so the studio App tab looks alive before any hardware exists.
  - `web/apps/demo.js`: seeded by the project id (no randomness), named after profiles.json ("Monstera in the kitchen"), one `ok`, one `watch`, one `alert`, 30 days of day/night light, watering saw-tooth moisture, temperature/humidity drift and a slowly falling battery; a fresh reading every minute; demo pairing (a fake key), demo photo checks; no API calls and no alerts.

## 6. Studio
- An **App** tab next to Website / Ads, shown when the design has electronics or an `app/` folder.
  - It previews `/apps/<id>?preview=1`.
  - It has its own chat target "app", run by an app agent (prompt `server/app_agent_prompt.md`).
  - The app agent's tools are `Read/Write/Edit(./app/**)` only: no Bash, no WebFetch. Same spawn and env rules as the site agent.
- On phones it's reachable from the ≡ menu.
- An "Open app" link gives `/apps/<id>`, installable to the home screen.
- **Studio additions** (`web/appview.js`, `server/apps.js`):
  - URL `/designs/<slug>-<id>/app`. The project payload adds `app_running` and `app: { show, exists, electronics, name }` (`show`: a microcontroller or sensor in the bom, a `firmware/` folder, or an `app/` folder). The projects list and `/run` add `app_running` (`/run` also `app_partial`, `app_thinking`).
  - Chat API: `GET /api/projects/<id>/app/messages` -> `{ messages, running, history, info }`, `POST` `{ text }` (text only: the agent can't read uploads), `POST /api/projects/<id>/app/stop`. Undo/rewind/versions take `kind: "app"` (the whole `app/` folder). Events: `app_run_started`, `app_step`, `app_assistant`, `app_partial`, `app_run_finished`, and `app_updated` when any file in `app/` changes.
  - The chat lives in `<project>/.app_messages.json` and the session in `.app_agent.json`, outside `app/`, so the agent can't edit its own history.
  - The agent runs with `--tools Read,Write,Edit`, `--allowedTools Read(./app/**),Write(./app/**),Edit(./app/**)`, the usual deny list plus CLAUDE.md, AGENTS.md, .mcp.json and .claude/ anywhere under `app/` (the server also deletes them after each turn and restores invalid app.json / profiles.json / alerts.json), `--model claude-opus-5-5`, the clean agent env (no API key: the subscription). It counts toward the concurrent-agent cap. Its context (design title and description, the first design-chat message, bought parts, wiring.md, field names found in `firmware/`, the current app files) is appended to its system prompt.
  - Phone: the ≡ menu's "App" row opens the App sheet: Open app (`/apps/<id>`, the real shell, full screen; the shell shows a back button to the studio), Try with demo data, and how to add it to the Home Screen; or Build the app when there is none. Examples: "Try the app" (`/apps/ex/<slug>`).
  - Desktop App tab: Phone | Web segmented control (remembered in localStorage `premake.appView`): an iPhone frame (393 x 852, Dynamic Island, status bar, home indicator; the app starts below the 54 px status bar) or a browser window at 1100 x 720. Beside it "Open on your phone": the QR code for the preview link, the link with Copy, expiry, New link / Turn off, and one line on Add to Home Screen. The link is only made when the owner clicks "Show QR code".
  - Examples with an app show a "Try the app" tab: the same frames on `/apps/ex/<slug>`, its QR opens that public page.
  - When a design with electronics finishes a run, a small pill over the model says "Your app is ready · See it" or "This has electronics · Build its phone app" (once per design and state, × hides it).

## 7. Firmware contract (plant sensor and future ESP32 products)
- **New firmware (Nov 2026, server/firmware.js):** Premake compiles Arduino sketches with arduino-cli and the owner flashes them from the studio ("Flash to my ESP32", ESP Web Tools). Wi-Fi comes from `premake_wifi.h` (server/fwlib, copied into the sketch at compile time): Improv Wi-Fi over USB right after flashing, saved in Preferences namespace `premake`. The device key is set over USB with the serial line `PREMAKE KEY <key>` (`PremakeWiFi.deviceKey()`). The captive-portal setup below stays valid for the plant sensor.
- **First boot / no Wi-Fi:** a captive-portal access point named `Formery-<product>-<4hex>` (plant: `Formery-Plant-XXXX`). Its form takes Wi-Fi SSID, password and device key, saved to NVS.
- **Each wake:** read the sensors, then `POST https://formery.ai/api/d/ingest` (TLS, verified against the ISRG roots; buildery.ai 308-redirects and firmware must not rely on following it) with `Authorization: Device <key>`. Use the server's `interval` reply for the deep-sleep length.
- **Controls:** products with actuators long-poll `GET https://premake.ai/api/d/commands?since=<seq>&wait=25` (2b) in their own task, and list their controls in a `// controls: angle (range 0-180), lamp (toggle)` comment, which the app agent reads.
- Keep optional Home Assistant MQTT.
- Hold BOOT for 5 s to reset the setup (press RESET first: the sensor is asleep between readings). A short BOOT press after RESET reopens the setup page with settings kept.
- Plant firmware (`projects/4fe69f4d9c/firmware/plant_sensor`, v2.0.0): fields that fail to read (module not plugged in, no battery divider) are left out of `r`; failed reports back off 1, 2, 4, 8, 16 min; 429 sleeps for `Retry-After`; three 401s in a row reopen the setup page for a new key; OTA by uploading a .bin on the setup page (two app slots), and an optional `"ota":"https://formery.ai/..."` field in the ingest reply is reserved for server-pushed updates.
