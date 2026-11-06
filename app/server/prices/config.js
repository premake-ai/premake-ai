// Price-source settings (server/prices). Edit here, then restart the server.
'use strict';

/** Who prints the plastic parts by default: "slant" (live Slant 3D quote, the default) or "inhouse" (our cost model, admin override).
 * Env PRINT_SOURCE; an admin can override it per design from the Order tab (stored in <DATA>/.sourcing/print_source.json). */
const PRINT_SOURCE = /^inhouse$/i.test(String(process.env.PRINT_SOURCE || '').trim()) ? 'inhouse' : 'slant';

/** The only shops we order from (the owner's call, 2026-10-30): Amazon for every bought part we don't stock (see STOCK below) and pre-cut extrusion,
 * SendCutSend for sheet / laser / CNC-routed parts, Slant 3D for printed parts (or in-house, per PRINT_SOURCE).
 * Comma-separated env ALLOWED_SUPPLIERS widens it later (e.g. "Amazon,SendCutSend,Slant 3D,DigiKey,Albany County Fasteners"):
 * list prices, distributor prices and sourcing links from a shop on this list come back automatically.
 * Normalisation lives in server/prices/suppliers.js. */
const ALLOWED_SUPPLIERS = String(process.env.ALLOWED_SUPPLIERS || 'Amazon,SendCutSend,Slant 3D,RMFG,AFN,MATERIAM').split(',').map((s) => s.trim()).filter(Boolean);

/** Premake stock (the owner's call, 2026-11-03): "any parts that I can buy big ones of, assume that I'll do that and ship it
 * with the parts. Only Amazon to them if it's not something I'd order myself, like aluminium extrusion because it's big."
 * So small parts (all electronics, all small hardware) are bought in bulk, kept in NYC, and go in the same Premake box as
 * the printed parts, priced per piece at the bulk cost (server/prices/stock.js). Big or bulky things, and specialty
 * one-offs, still ship straight from the shop (Amazon / SendCutSend).
 *
 * How a bought line is classified (server/prices/stock.js classify), first hit wins:
 *   1. the line's own override: bom part "stock": true (we stock it) or false / "ship_direct": true (straight from the shop)
 *   2. a manual-order line (agentbrain: the agent's own shop) is never stocked
 *   3. deny: any `deny` regex matches the name (+ category / kind) -> straight from the shop, with its reason
 *   4. allow: an `allow` regex matches -> stocked, in that category, unless one piece costs more than max_unit_usd
 *      (a pricey specialty part we'd order per kit) or weighs more than max_piece_g (estimated, `grams` below)
 *   5. anything else -> straight from the shop (not a small part we keep)
 * Env STOCK_SMALL_PARTS=0 switches stocking off (every bought line back to Amazon). */
const STOCK = {
  enabled: !/^(0|false|no|off)$/i.test(String(process.env.STOCK_SMALL_PARTS || '').trim()),
  label: 'Premake stock, NYC',
  max_unit_usd: 30,     // dearer per piece than this (parts-list price): a specialty part, ordered per kit
  max_piece_g: 600,     // heavier per piece than this (estimated): ships straight from the shop
  bulk_qty: 500,        // the catalog quantity break we buy at (list_prices.json breaks up to this many pieces)
  /** Single-unit retail estimate -> bulk per-piece cost, when we know no pack size for the line. ESTIMATES: replace them
   * with real numbers from Josh's bulk invoices (AliExpress / LCSC / Amazon bulk packs) once he has them. */
  bulk_factor: { electronics: 0.6, hardware: 0.5 },
  allow: [
    { cat: 'electronics', re: /\b(esp32|esp8266|arduino|raspberry pi pico|rp2040|xiao|attiny|stm32|microcontroller|dev ?kit|devkitc?|supermini|mainboard|controller board|driver board|breakout|module|sensor|thermistor|hall|pir|ultrasonic|hc-?sr04|ldr|photoresistor|encoder|potentiometer|pot\b|joystick|display|oled|lcd|tft|e-?ink|e-?paper|7-?segment|servo|stepper|nema ?(8|11|14|17)|28byj|uln2003|tmc ?22\d\d|a4988|drv8825|motor driver|gear ?motor|dc motor|n20|vibration motor|leds?|neopixel|ws2812b?|sk6812|led strip|resistors?|capacitors?|electrolytic|ceramic cap|diodes?|transistors?|mosfets?|regulator|buck|boost|step-?down|step-?up|converter|lm2596|mp1584|tp4056|charger module|relay|fuse|connectors?|jst|dupont|jumpers?|headers?|terminal|barrel jack|dc jack|pigtail|usb[- ]?c?\b|usb cable|cables?|wires?|wiring|heat ?shrink|switch(es)?|buttons?(?![- ]?head)|tactile|buzzer|piezo|speaker|microphone|mic\b|amplifier|ir receiver|infrared|rfid|nfc|breadboard|perfboard|protoboard|pcb|battery holder|cell holder|(18650|aa|aaa) holder|coin cell|cr2032|aaa?\b|aa batter|fans?\b|blower|pump|solenoid|power adapter|wall adapter|plug-in adapter|usb charger|power supply|psu|thermostat|probe|ds18b20|peltier|tec1)\b/i },
    { cat: 'hardware', re: /\b(screws?|bolts?|shcs|bhcs|fhcs|nuts?|nylocks?|washers?|inserts?|standoffs?|spacers?|t-?nuts?|hammer nuts?|clinch|magnets?|bearings?|625zz|608zz|springs?|feet|foot|bumpers?|bump ?ons?|grommets?|zip ?ties?|cable ties?|velcro|adhesive|foam tape|tape|pads?|glue|epoxy|thread ?lock|loctite|grease|o-?rings?|tubing|ptfe|silicone tube|pins?|dowels?|rivets?|hinges?|clips?|hooks?|suction cups?|gt2|belt|pulley|idler|v-?slot wheel|wheels?|shaft coupler|coupler|collar|anchor|eccentric|brackets?|end caps?|hose clamps?|clamps?|fittings?|hose barbs?|eye bolts?|straps?|hook-and-loop)\b/i },
  ],
  deny: [
    { why: 'Aluminium extrusion: long and heavy, ships from the shop', re: /\b(extrusion|v-?slot (rail|profile|extrusion)|t-?slot|aluminium profile|aluminum profile|[24]0[248]0 (rail|profile|bar))\b/i },
    { why: 'Sheet, panel or board stock: ships from the shop', re: /\b(plywood|mdf|hardboard|plank|lumber|glass|mirror|(acrylic|polycarbonate|foam|wood|wooden|metal|steel|aluminium|aluminum|hdpe|pvc|abs|plastic) (sheets?|panels?|plates?|boards?))\b/i },
    { why: 'Long rigid stock: ships from the shop', re: /\b(linear rails?|linear rods?|smooth rods?|threaded rods?|lead ?screws?|linear shafts?|carbon (fib(er|re) )?(arms?|tubes?|rods?))\b|\b(rods?|rails?|shafts?|bars?|pipes?|dowels?)\b[^,]*?\b([3-9]\d\d|\d{4})\s*mm\b|\b(rods?|rails?|shafts?|bars?|pipes?|dowels?)\b[^,]*?\b(1[2-9]|[2-9]\d)\s*(in|"|inch)\b|\b(1[2-9]|[2-9]\d)\s*(in|"|inch)\b[^,]*?\b(rods?|dowels?|pipes?)\b/i },
    { why: 'Printer specialty part: ordered per kit', re: /\b(hotend|hot end|extruder|nozzle|heated bed|heat bed|build plate|build sheet|pei)\b/i },
    { why: 'Lithium cells ship as hazmat: ordered per kit', re: /\b(18650|21700|li-?ion|lipo|li-?po|lithium (cell|battery|pack))\b(?!.*\b(holders?|contacts?|clips?|plates?)\b)/i },
    { why: 'Big power supply: heavy, ships from the shop', re: /(?<![\d.])([5-9]|\d{2,})\s*A\b.*\b(power|adapter|supply|psu)\b|\b(power|adapter|supply|psu)\b.*(?<![\d.])([5-9]|\d{2,})\s*A\b/i },
    { why: 'Furniture-size or an appliance: ships from the shop', re: /\b(furniture(?! (pads?|feet|glides?))|table|chair|cabinet|mattress|appliance|ball head|tripod|bucket|tank|crate|rebar|ground (stakes?|spike))\b/i },
    { why: 'Mains wiring: ordered per kit', re: /\b(gfci|outlet|mains|extension cord|12\/3|14\/3)\b/i },
  ],
  /** Estimated grams per piece, for the Premake box weight and max_piece_g (first hit wins; default 15 g). */
  grams: [
    [/\bnema ?23\b/i, 1000], [/\bnema ?17\b|\bstepper motor\b/i, 300], [/\bpower (adapter|supply)|wall adapter|usb charger|adapter\b/i, 150],
    [/\bdisplay|lcd|tft|e-?ink|e-?paper\b/i, 40], [/\bservo\b/i, 15], [/\bmotor\b/i, 40], [/\bfan|blower|pump\b/i, 40], [/\bbelt|cable|wire|tubing|ptfe\b/i, 30],
    [/\bbearing|pulley|idler|wheel\b/i, 15], [/\bscrew|bolt|nut|washer|insert|standoff|spacer|t-?nut\b/i, 2],
  ],
  default_g: 15,
};

/** Lead-time assumptions in calendar days (shown in the quote as Estimate when no supplier gives one). */
const LEAD = {
  distributor_in_stock: 4,      // DigiKey / Mouser: ship same day, UPS ground to NYC
  distributor_no_stock: 30,     // used when a distributor has too few and gives no lead time
  list_price: 5,                // Bolt Depot / OpenBuilds / Misumi: ship in 1 business day + ground
  estimate: 5,                  // parts-list guesses (Amazon-type listings)
  amazon: 5,                    // Amazon line with only a search link: we pick a Prime listing when ordering, but the item is unknown
  amazon_prime: 3,              // Amazon line with a real product link (agent picks Prime): 1-2 day Prime delivery + 1 day to place the order
  in_stock: 0,                  // Premake stock (STOCK): already on the shelf in NYC, goes in the print box
  fab_outsourced: 8,            // SendCutSend / Ponoko production + ground (pricing_fab.leadDays overrides)
  slant_transit: 3,             // Slant 3D's lead time is production; ground shipping on top
};

/** Assembly capacity: people on the bench and productive minutes each per day. */
const ASSEMBLY_STAFF = Number(process.env.ASSEMBLY_STAFF) > 0 ? Number(process.env.ASSEMBLY_STAFF) : 4;
const ASSEMBLY_MIN_PER_DAY = 450;

/** Shipping each supplier charges for its box to one US address (estimates; at cost, nothing added).
 * base + per_lb x the box's weight in pounds. Amazon: Prime, free. SendCutSend: free standard shipping in the US.
 * Premake: our own NYC box, USPS Ground Advantage plus the box itself. Slant 3D: their ground rate. */
const SHIP = {
  Amazon: { base: 0, per_lb: 0, why: 'Free with Prime' },
  SendCutSend: { base: 0, per_lb: 0, why: 'Free standard shipping' },
  Premake: { base: 6.5, per_lb: 1.6, why: 'USPS Ground Advantage from NYC, box included' },
  'Slant 3D': { base: 7.5, per_lb: 1.6, why: 'Slant 3D ground shipping' },
  other: { base: 7, per_lb: 1.6, why: 'Shop’s ground shipping' },
};
/** What Stripe keeps per card payment (US cards). The Order tab adds exactly this as the Card fee line, so the payout covers
 * the suppliers to the cent: fee = (cost + fixed) / (1 - rate) - cost. */
const CARD_FEE = { rate: 0.029, fixed_usd: 0.30 };
/** Order tab add-on for designs that need soldering (bom.json needs_soldering, or a parts line that mentions solder):
 * one cordless USB soldering iron kit per order, from Amazon (Prime), at cost. NEIKO 40421A: USB rechargeable pen,
 * stand, tips and 10 g of solder in the box; about $21 on Amazon (Oct 2026). The link is a Prime search for the model. */
const SOLDER_KIT = {
  name: 'Cordless USB soldering iron kit, with solder (NEIKO 40421A)',
  usd: 21.25,
  url: 'https://www.amazon.com/s?k=NEIKO+40421A+cordless+soldering+iron+kit&rh=p_85%3A2470955011',
  why: 'Amazon price seen Oct 2026, Prime',
};
/** Above this many kits the Order tab asks people to get in touch for a quote. */
const MAX_QTY = 500;

module.exports = { SOLDER_KIT, SHIP, CARD_FEE, MAX_QTY, ALLOWED_SUPPLIERS, PRINT_SOURCE, STOCK, LEAD, ASSEMBLY_STAFF, ASSEMBLY_MIN_PER_DAY };
