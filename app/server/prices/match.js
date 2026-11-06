// What a bought-parts line is, and where its real price comes from.
//
//   route "list"         metric fasteners: parsed into components (kind, M size, length) priced from list_prices.json
//   route "distributor"  boards, steppers, LEDs, converters, switches, fans...: a DigiKey / Mouser lookup (MPN or keyword +
//                        a "must" regex the matched product has to satisfy, so a keyword search can't price the wrong thing)
//   route "estimate"     everything else (rails, hotends, beds, belts...): the parts list's own unit_cost_usd
//
// Library parts (cadlib/parts/catalog.py) have fixed display names, so their mappings are exact; free-text BOM lines
// written by the design agent go through the same regexes.
'use strict';

const s = (v) => String(v ?? '');

// ---------------------------------------------------------------- fasteners
const KINDS = [
  ['tnut', /\bt-?nuts?\b|\bhammer nuts?\b|\bdrop-?in\b/i],
  ['insert', /\b(heat-?set|threaded) inserts?\b|\binserts?\b/i],
  ['standoff', /\bstandoffs?\b|\bspacers?\b/i],
  ['nylock', /\bnylock\b|\bnylon(-insert)? lock\b|\block ?nuts?\b/i],
  ['wing_nut', /\bwing ?nuts?\b/i],
  ['washer', /\bwashers?\b/i],
  ['hex_bolt', /\bhex (head )?(bolt|cap screw)s?\b/i],
  ['bhcs', /\bbutton[- ]head\b|\bbhcs\b|\bbutton\b/i],
  ['csk', /\bcountersunk\b|\bflat[- ]head\b|\bcsk\b/i],
  ['shcs', /\bsocket[- ]head\b|\bsocket cap\b|\bshcs\b|\bcap screws?\b|\bsocket\b/i],
  ['nut', /\bnuts?\b/i],
  ['shcs', /\bscrews?\b|\bbolts?\b/i], // plain "screw": socket head is what we stock
];

/** "M5x10 button head screw + drop-in T-nut" -> [{kind:"bhcs", d:5, length:10}, {kind:"tnut", d:5}]. Null when any
 * component isn't a metric fastener (so a mixed line never gets a half-real price). */
function parseFasteners(name) {
  const n = s(name);
  if (!/\bM\d(\.5)?\b|\bM\d(\.5)?\s*[x×]/i.test(n)) return null;
  if (/\bassort(ed|ment)? kit\b|\bkit\b/i.test(n) && !/\+/.test(n)) return null;
  const parts = n.split(/\s*\+\s*|\s+and\s+|\s+with\s+/i).filter(Boolean);
  let lastD = null;
  const out = [];
  for (const raw of parts) {
    const p = raw.replace(/\([^)]*\)/g, (m) => (/(\d+)\s*-\s*(\d+)\s*mm/.test(m) ? m : ' '));
    const dm = /\bM(\d(?:\.5)?)\b(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/i.exec(p) || /\bM(\d(?:\.5)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i.exec(p);
    const d = dm ? Number(dm[1]) : lastD;
    if (!d || d < 2 || d > 8) return null;
    lastD = d;
    const kind = (KINDS.find(([, re]) => re.test(p)) || [])[0];
    if (!kind) return null;
    let length = dm && dm[2] ? Number(dm[2]) : null;
    const range = /(\d+)\s*-\s*(\d+)\s*mm/.exec(p);
    if (!length && range) length = Math.round((Number(range[1]) + Number(range[2])) / 2);
    if (!length) { const lm = /\b(\d+(?:\.\d+)?)\s*mm\b/.exec(p); if (lm && ['shcs', 'bhcs', 'csk', 'hex_bolt', 'standoff'].includes(kind)) length = Number(lm[1]); }
    if (['shcs', 'bhcs', 'csk', 'hex_bolt'].includes(kind) && !length) length = d * 2 + 6; // unspecified length: a typical one
    out.push({ kind, d, ...(length ? { length } : {}) });
  }
  return out.length ? out : null;
}

// ---------------------------------------------------------------- distributor wants (exact library names first)
const D = (o) => ({ route: 'distributor', want: o });
const LIB = [
  [/^ESP32 DevKitC \(WROOM-32, 38 pin\)$/i, D({ mpn: 'ESP32-DEVKITC-32E', keyword: 'ESP32-DEVKITC-32E', must: 'ESP32' })],
  [/^ESP32 DevKit V1/i, D({ mpn: 'ESP32-DEVKITC-32E', keyword: 'ESP32-DEVKITC-32E', must: 'ESP32', note: 'official Espressif equivalent' })],
  [/^ESP32-S3-DevKitC-1/i, D({ mpn: 'ESP32-S3-DEVKITC-1-N8R8', keyword: 'ESP32-S3-DEVKITC-1', must: 'ESP32-S3' })],
  [/^ESP32-C3 SuperMini/i, D({ mpn: 'ESP32-C3-DEVKITM-1', keyword: 'ESP32-C3-DEVKITM-1', must: 'ESP32-C3', note: 'official Espressif equivalent' })],
  [/^Seeed XIAO ESP32S3/i, D({ mpn: '113991114', keyword: 'XIAO ESP32S3', must: 'XIAO|ESP32-?S3' })],
  [/^Arduino Nano/i, D({ mpn: 'A000005', keyword: 'Arduino Nano A000005', must: 'Nano' })],
  [/^Raspberry Pi Pico/i, D({ mpn: 'SC0915', keyword: 'Raspberry Pi Pico SC0915', must: 'Pico|RP2040' })],
  [/^6×6 mm tactile button/i, D({ mpn: 'B3F-1000', keyword: 'B3F-1000', must: 'B3F|tactile' })],
  [/^12×12 mm tactile button/i, D({ mpn: 'B3F-4055', keyword: 'B3F-4055', must: 'B3F|tactile' })],
  [/^5 mm LED \(red\)/i, D({ mpn: 'WP7113ID', keyword: 'WP7113ID', must: 'LED' })],
  [/^5 mm LED \(green\)/i, D({ mpn: 'WP7113GD', keyword: 'WP7113GD', must: 'LED' })],
  [/^5 mm LED \(yellow\)/i, D({ mpn: 'WP7113YD', keyword: 'WP7113YD', must: 'LED' })],
];

/** Free-text rules (library names that vary by parameter, and the design agent's own lines). */
function rule(name) {
  const n = s(name);
  const volt = /\b(5|12|24)\s*V\b/i.exec(n)?.[1];
  if (/\bnema ?17\b|\bstepper motor\b/i.test(n)) {
    const len = /\b(34|40|48|60)\s*mm\b/.exec(n)?.[1];
    return D({ keyword: `NEMA 17 stepper motor${len ? ' ' + len + 'mm' : ''}`, must: 'NEMA ?-?17|17HS|42 ?mm|NEMA', not: 'driver|controller|bracket|mount|kit|cable', max_usd: 80 });
  }
  if (/\besp32\b/i.test(n)) return D({ mpn: 'ESP32-DEVKITC-32E', keyword: 'ESP32-DEVKITC-32E', must: 'ESP32', note: 'official Espressif board' });
  if (/\b(ws2812b?|neopixel)\b|\bled strip\b/i.test(n)) {
    const leds = Number(/\b(\d+)\s*LEDs?\b/i.exec(n)?.[1]) || null;
    return D({ keyword: 'NeoPixel LED strip 60 LED/m 1m', must: 'NeoPixel|WS2812|addressable', not: 'controller|connector', per_led: leds ? 60 : null, leds, max_usd: 60 });
  }
  if (/\b(lm2596|mp1584|buck|step-?down|dc-?dc|boost|step-?up)\b|\b(5|12)\s*V\b.*\b(converter|regulator)\b/i.test(n)) {
    const up = /\bboost|step-?up\b/i.test(n);
    return D({ keyword: up ? 'DC DC boost converter module' : 'step-down voltage regulator module 5V', must: up ? 'boost|step-?up' : 'buck|step-?down',
      not: 'eval|evaluation|IC REG|controller IC', max_usd: 30 });
  }
  if (/\bbulbs?\b|\blamp\b.*\b(e26|e27|e12|gu10|g4)\b/i.test(n)) return D({ keyword: n.replace(/\([^)]*\)/g, '').slice(0, 60), must: 'bulb|lamp|LED', max_usd: 40 });
  if (/\b(\d\s*mm|through[- ]hole|thru) LEDs?\b|\bLEDs?\b.*\b(5|3)\s*mm\b|^\s*LEDs?\b/i.test(n)) return D({ mpn: 'WP7113ID', keyword: 'WP7113ID', must: 'LED' });
  if (/\b(endstop|limit switch|micro ?switch|snap action)\b/i.test(n)) return D({ keyword: 'SS-5GL2', must: 'switch', max_usd: 10 });
  if (/\btactile\b|\bpush ?button\b/i.test(n)) return D({ mpn: /12\s*[x×]\s*12/.test(n) ? 'B3F-4055' : 'B3F-1000', keyword: 'B3F-1000', must: 'B3F|tactile' });
  if (/\boled\b/i.test(n)) return D({ keyword: 'OLED display 128x64 SSD1306 I2C', must: 'OLED', not: 'kit', max_usd: 30 });
  if (/\brelay module\b|\b5\s*V relay\b/i.test(n)) return D({ keyword: '5V relay module board', must: 'relay', not: 'socket', max_usd: 20 });
  if (/\bfan\b/i.test(n)) {
    const size = /\b(25|30|40|50|60|80)\s*[x×]\s*\1\b/.exec(n)?.[1] || /\b(25|30|40|50|60|80)10\b/.exec(n)?.[1] || /\b(25|30|40|50|60|80)\s*mm\b/.exec(n)?.[1];
    if (!size) return null;
    const blower = /\bblower\b/i.test(n);
    return D({ keyword: `${blower ? 'blower' : 'fan'} ${size}mm ${volt || 5}VDC`, must: `${size}\\s*(mm|x)|${size}\\.0`, not: 'guard|filter|finger', max_usd: 30 });
  }
  if (/\bservo\b/i.test(n)) return D({ keyword: 'micro servo SG90', must: 'servo', max_usd: 25 });
  return null;
}

/** -> { route: "list", items } | { route: "distributor", want } | { route: "estimate", why } */
function classify(line) {
  const name = s(line?.name);
  for (const [re, r] of LIB) if (re.test(name)) return r;
  if (/\b(rubber|bumper|silicone)\b.*\bfeet\b|\bbumpers?\b/i.test(name)) return { route: 'list', items: [{ kind: 'feet', d: null }] };
  const fast = parseFasteners(name);
  if (fast) return { route: 'list', items: fast };
  const r = rule(name);
  if (r) return r;
  return { route: 'estimate', why: 'Parts-list price; no distributor or catalog source for this item' };
}

module.exports = { classify, parseFasteners, rule };
