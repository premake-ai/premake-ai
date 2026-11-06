// Wi-Fi Plant Sensor - ESP32-C3 SuperMini, firmware 2.0.0
//
// Each wake: read soil / light / temp / humidity / battery with the radio off, join Wi-Fi, POST the reading over
// HTTPS to https://formery.ai/api/d/ingest (Authorization: Device <key>), sleep for the interval the server
// replies with (30 min today). Home Assistant MQTT is still there if you fill it in on the setup page.
//
// Setup (first boot, or no Wi-Fi saved): the sensor opens its own Wi-Fi, Formery-Plant-XXXX. Join it on your phone,
// the setup page opens by itself (or go to http://192.168.4.1), pick your Wi-Fi, type its password and paste the
// sensor key from "Add sensor" in the Plant Sensor app. The sensor checks both before saving them.
//
// Buttons (the sensor sleeps between readings, so start with a reset: press RESET, or take the battery out and put
// it back, then within 3 seconds):
//   press BOOT briefly    -> setup page again, settings kept (change the key, update the firmware)
//   hold BOOT for 5 s     -> forget Wi-Fi and key, then the setup page (the blue LED flashes when it's done)
// Don't hold BOOT while pressing RESET: that starts the USB flasher instead.
//
// Firmware updates: the setup page has "Update firmware" (upload the .bin from Arduino IDE's Sketch > Export
// Compiled Binary). The default partition scheme keeps two app slots, so a failed upload leaves the old firmware
// running. otaPull() is ready for server-pushed updates; nothing calls it until the server offers one.
//
// Solderless build: every sensor is a plug-in module on female-female jumper leads (buy the SuperMini, BH1750 and BME280
// with headers already soldered). Any module that isn't plugged in is simply left out of the reading, and a USB-powered
// build without the battery divider just doesn't report battery.
//
// Board: "ESP32C3 Dev Module" (Arduino-ESP32 core 3.x), USB CDC On Boot: Enabled, Partition Scheme: Default 4MB.
// Libraries: PubSubClient, Adafruit BME280 (+ Adafruit Unified Sensor). Everything else ships with the core.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <Update.h>
#include <Wire.h>
#include <PubSubClient.h>
#include <Adafruit_BME280.h>
#include "esp_sleep.h"
#include "esp_ota_ops.h"
#include "certs.h"
#include "portal_page.h"

#define FW_VERSION "2.0.0"
static const char INGEST_URL[] = "https://formery.ai/api/d/ingest";
static const char OTA_PREFIX[] = "https://formery.ai/";  // otaPull() only fetches from here
static const char PRODUCT[] = "Plant";                    // the setup Wi-Fi is Formery-<PRODUCT>-XXXX

// ---- pin map (wiring.md) ----
const int PIN_SOIL_PWR = 10;
const int PIN_SOIL_ADC = 3;
const int PIN_BATT_ADC = 4;
const int PIN_SDA = 6;
const int PIN_SCL = 7;
const int PIN_BOOT = 9;  // the SuperMini's BOOT button (to GND)
const int PIN_LED = 8;   // the SuperMini's blue LED, on when LOW

// ---- calibration ----
const int SOIL_DRY = 2600;  // raw reading in dry air
const int SOIL_WET = 1150;  // raw reading in a glass of water
const int SOIL_MISSING_LOW = 300;    // a v1.2 probe reads ~1100-2700; outside this, nothing is plugged in
const int SOIL_MISSING_HIGH = 3900;
const uint8_t BH1750_ADDR = 0x23;

// ---- timing ----
const uint32_t DEFAULT_INTERVAL_S = 1800;   // until the server says otherwise
const uint32_t MIN_INTERVAL_S = 60;
const uint32_t MAX_INTERVAL_S = 86400;
const uint32_t RETRY_FIRST_S = 60;          // after a failed report: 1, 2, 4, 8, 16 min, then the interval
const uint32_t LOW_BATTERY_SLEEP_S = 6 * 3600;
const float CRITICAL_BATTERY_V = 3.20f;     // below this, report rarely to protect the cell
const uint32_t WIFI_TIMEOUT_MS = 15000;
const uint32_t PORTAL_IDLE_MS = 10UL * 60 * 1000;  // close the setup page after 10 min without a visit
const uint32_t PORTAL_RETRY_S = 3600;              // not set up yet: sleep 1 h, then open it again
const uint32_t BOOT_WINDOW_MS = 3000;
const uint32_t BOOT_RESET_MS = 5000;
const uint8_t BAD_KEY_PORTAL_AFTER = 3;            // this many 401s in a row opens the setup page for a new key

// ---- kept across deep sleep (lost when the battery comes out) ----
RTC_DATA_ATTR uint32_t rtcInterval = 0;
RTC_DATA_ATTR uint8_t rtcFails = 0;
RTC_DATA_ATTR uint8_t rtcBadKey = 0;

// ---- saved settings (NVS) ----
struct Settings {
  String ssid, pass, key;
  String mqttHost, mqttUser, mqttPass;
  uint16_t mqttPort = 1883;
};
Settings cfg;
Preferences prefs;

struct Reading {
  float moisture = NAN, light = NAN, temp = NAN, humidity = NAN, battery = NAN;
};

enum PostResult { POST_OK, POST_TOO_SOON, POST_BAD_KEY, POST_REJECTED, POST_NET_ERROR };
struct PostReply {
  PostResult result;
  uint32_t waitS;  // interval (200) or Retry-After (429)
  int code;
  String ota;      // reserved: a firmware URL, if the server ever sends one
};

// Types live up here: the Arduino IDE adds a prototype for every function above the first one.
enum CheckState { CHECK_IDLE, CHECK_START, CHECK_JOINING, CHECK_OK, CHECK_SAVED_OFFLINE, CHECK_BAD_WIFI, CHECK_BAD_KEY };
enum BootAction { BOOT_NORMAL, BOOT_PORTAL, BOOT_RESET };

Adafruit_BME280 bme;
bool bmeOk = false;

// ------------------------------------------------------------------ settings
void loadSettings() {
  prefs.begin("plant", false);
  cfg.ssid = prefs.getString("ssid", "");
  cfg.pass = prefs.getString("pass", "");
  cfg.key = prefs.getString("key", "");
  cfg.mqttHost = prefs.getString("mqtt_host", "");
  cfg.mqttUser = prefs.getString("mqtt_user", "");
  cfg.mqttPass = prefs.getString("mqtt_pass", "");
  cfg.mqttPort = prefs.getUShort("mqtt_port", 1883);
  prefs.end();
}

void saveSettings(const Settings& s) {
  prefs.begin("plant", false);
  prefs.putString("ssid", s.ssid);
  prefs.putString("pass", s.pass);
  prefs.putString("key", s.key);
  prefs.putString("mqtt_host", s.mqttHost);
  prefs.putString("mqtt_user", s.mqttUser);
  prefs.putString("mqtt_pass", s.mqttPass);
  prefs.putUShort("mqtt_port", s.mqttPort);
  prefs.end();
}

void clearSettings() {
  prefs.begin("plant", false);
  prefs.clear();
  prefs.end();
  cfg = Settings();
  rtcInterval = 0;
  rtcFails = 0;
  rtcBadKey = 0;
}

bool configured() { return cfg.ssid.length() > 0 && cfg.key.length() > 0; }

uint32_t intervalS() {
  uint32_t s = rtcInterval ? rtcInterval : DEFAULT_INTERVAL_S;
  return constrain(s, MIN_INTERVAL_S, MAX_INTERVAL_S);
}

// The key from the app: 32 random bytes, base64url, 43 characters. Pasting often adds spaces or line breaks.
String cleanKey(const String& in) {
  String k;
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (isalnum((unsigned char)c) || c == '-' || c == '_') k += c;
    else if (c != ' ' && c != '\t' && c != '\r' && c != '\n') return String();  // not a key
  }
  return k.length() == 43 ? k : String();
}

// ------------------------------------------------------------------ LED, sleep
void led(bool on) { digitalWrite(PIN_LED, on ? LOW : HIGH); }

void flash(int times) {
  for (int i = 0; i < times; i++) { led(true); delay(80); led(false); delay(120); }
}

void sleepFor(uint32_t seconds) {
  digitalWrite(PIN_SOIL_PWR, LOW);
  led(false);
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  Serial.printf("sleeping %lu s\n", (unsigned long)seconds);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)seconds * 1000000ULL);
  esp_deep_sleep_start();
  while (true) {}
}

// ------------------------------------------------------------------ sensors
float readLux() {
  Wire.beginTransmission(BH1750_ADDR); Wire.write(0x01); if (Wire.endTransmission() != 0) return NAN;  // power on
  Wire.beginTransmission(BH1750_ADDR); Wire.write(0x20); Wire.endTransmission();                       // one-shot high-res
  delay(180);
  if (Wire.requestFrom(BH1750_ADDR, (uint8_t)2) != 2) return NAN;
  uint16_t raw = (Wire.read() << 8) | Wire.read();
  return raw / 1.2f * 1.25f;  // x1.25 compensates the 1.2 mm cap window (calibrate)
}

float readSoilPct() {
  digitalWrite(PIN_SOIL_PWR, HIGH);
  delay(300);
  long sum = 0;
  for (int i = 0; i < 16; i++) { sum += analogRead(PIN_SOIL_ADC); delay(5); }
  digitalWrite(PIN_SOIL_PWR, LOW);
  float raw = sum / 16.0f;
  if (raw < SOIL_MISSING_LOW || raw > SOIL_MISSING_HIGH) return NAN;  // no probe plugged in: leave it out
  float pct = (SOIL_DRY - raw) * 100.0f / (SOIL_DRY - SOIL_WET);
  return constrain(pct, 0.0f, 100.0f);
}

float readBattery() {
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_BATT_ADC);
  float v = mv / 8.0f * 2.0f / 1000.0f;   // 100k/100k divider reads half the cell
  return (v >= 2.5f && v <= 4.5f) ? v : NAN;  // no divider (USB-powered build): leave it out
}

Reading readSensors() {
  Reading r;
  r.moisture = readSoilPct();
  r.light = readLux();
  if (bmeOk) {
    bme.takeForcedMeasurement();
    r.temp = bme.readTemperature();
    r.humidity = bme.readHumidity();
  }
  r.battery = readBattery();
  return r;
}

// {"r":{"moisture":41.2,"light":830,"temp":21.4,"humidity":48,"battery":3.92},"fw":"2.0.0"} - fields that failed are left out
String readingJson(const Reading& r) {
  String s = "{\"r\":{";
  bool first = true;
  auto add = [&](const char* name, float v, unsigned int decimals) {
    if (isnan(v) || isinf(v)) return;
    if (!first) s += ',';
    first = false;
    s += '"'; s += name; s += "\":"; s += String(v, decimals);
  };
  add("moisture", r.moisture, 1);
  add("light", r.light, 0);
  add("temp", r.temp, 1);
  add("humidity", r.humidity, 1);
  add("battery", r.battery, 2);
  s += "},\"fw\":\"" FW_VERSION "\"}";
  return s;
}

// ------------------------------------------------------------------ Wi-Fi + HTTPS
bool joinWifi(const String& ssid, const String& pass, uint32_t timeoutMs) {
  WiFi.begin(ssid.c_str(), pass.c_str());
  // Many SuperMini boards have a weak antenna match and fail to join at full power.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - t0 > timeoutMs) return false;
    delay(50);
  }
  return true;
}

// The number after "key": in a small JSON reply, or -1.
long jsonNumber(const String& body, const char* key) {
  String k = String("\"") + key + "\":";
  int i = body.indexOf(k);
  if (i < 0) return -1;
  return body.substring(i + k.length()).toInt();
}

String jsonString(const String& body, const char* key) {
  String k = String("\"") + key + "\":\"";
  int i = body.indexOf(k);
  if (i < 0) return String();
  int a = i + k.length(), b = body.indexOf('"', a);
  return b > a ? body.substring(a, b) : String();
}

PostReply postReading(const String& key, const String& json) {
  PostReply out{POST_NET_ERROR, 0, -1, String()};
  WiFiClientSecure tls;
  tls.setCACert(ROOT_CAS);  // verified TLS: only the ISRG roots in certs.h
  tls.setHandshakeTimeout(15);
  HTTPClient http;
  http.setConnectTimeout(10000);
  http.setTimeout(10000);
  http.setReuse(false);
  if (!http.begin(tls, INGEST_URL)) return out;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Device ") + key);
  const char* keep[] = {"Retry-After"};
  http.collectHeaders(keep, 1);
  int code = http.POST(json);
  out.code = code;
  if (code > 0) {
    String body = http.getString();
    if (code == 200) {
      long iv = jsonNumber(body, "interval");
      out.result = POST_OK;
      out.waitS = iv > 0 ? (uint32_t)iv : DEFAULT_INTERVAL_S;
      out.ota = jsonString(body, "ota");
    } else if (code == 429) {
      long ra = http.header("Retry-After").toInt();
      out.result = POST_TOO_SOON;
      out.waitS = ra > 0 ? (uint32_t)ra : 60;
    } else if (code == 401) {
      out.result = POST_BAD_KEY;
    } else if (code == 413 || code == 422) {
      out.result = POST_REJECTED;  // our body was refused: a firmware bug, not worth retrying fast
      Serial.printf("ingest refused (%d): %s\n", code, body.c_str());
    }
  } else {
    Serial.printf("ingest failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
  return out;
}

// Server-pushed update (not offered by the server yet). Only https://formery.ai/... URLs, same TLS roots.
// On success the sensor restarts into the new firmware; the old one stays in the other slot.
void otaPull(const String& url) {
  if (!url.startsWith(OTA_PREFIX)) return;
  WiFiClientSecure tls;
  tls.setCACert(ROOT_CAS);
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return r = httpUpdate.update(tls, url);
  if (r == HTTP_UPDATE_FAILED) Serial.printf("update failed: %s\n", httpUpdate.getLastErrorString().c_str());
}

// ------------------------------------------------------------------ Home Assistant (optional)
String haId() {
  uint64_t mac = ESP.getEfuseMac();
  char b[24];
  snprintf(b, sizeof b, "plant_%02x%02x%02x", (unsigned)((mac >> 24) & 0xff), (unsigned)((mac >> 32) & 0xff), (unsigned)((mac >> 40) & 0xff));
  return String(b);
}

void announce(PubSubClient& mqtt, const String& id, const char* key, const char* name, const char* unit, const char* cls) {
  char topic[96], payload[420];
  snprintf(topic, sizeof topic, "homeassistant/sensor/%s/%s/config", id.c_str(), key);
  snprintf(payload, sizeof payload,
    "{\"name\":\"%s\",\"state_topic\":\"plants/%s/state\",\"unit_of_measurement\":\"%s\","
    "%s%s%s\"value_template\":\"{{ value_json.%s }}\",\"unique_id\":\"%s_%s\","
    "\"device\":{\"identifiers\":[\"%s\"],\"name\":\"Plant sensor\",\"sw_version\":\"" FW_VERSION "\"}}",
    name, id.c_str(), unit, cls[0] ? "\"device_class\":\"" : "", cls, cls[0] ? "\"," : "",
    key, id.c_str(), key, id.c_str());
  mqtt.publish(topic, payload, true);
}

void publishMqtt(const Reading& r) {
  if (!cfg.mqttHost.length()) return;
  WiFiClient net;
  PubSubClient mqtt(net);
  mqtt.setServer(cfg.mqttHost.c_str(), cfg.mqttPort);
  mqtt.setBufferSize(512);
  String id = haId();
  bool ok = cfg.mqttUser.length() ? mqtt.connect(id.c_str(), cfg.mqttUser.c_str(), cfg.mqttPass.c_str())
                                  : mqtt.connect(id.c_str());
  if (!ok) { Serial.println("mqtt: no connection"); return; }
  announce(mqtt, id, "moisture", "Soil moisture", "%", "moisture");
  announce(mqtt, id, "light", "Light", "lx", "illuminance");
  announce(mqtt, id, "temp", "Temperature", "\xC2\xB0" "C", "temperature");
  announce(mqtt, id, "humidity", "Humidity", "%", "humidity");
  announce(mqtt, id, "battery", "Battery", "V", "voltage");
  String state = readingJson(r);  // {"r":{...},"fw":"..."}: Home Assistant gets just the inner {...}
  int a = state.indexOf('{', 1), b = state.indexOf('}');
  String inner = (a > 0 && b > a) ? state.substring(a, b + 1) : String("{}");
  String topic = "plants/" + id + "/state";
  mqtt.publish(topic.c_str(), inner.c_str(), true);
  mqtt.loop();
  delay(200);
  mqtt.disconnect();
}

// ------------------------------------------------------------------ setup page (captive portal)
WebServer web(80);
DNSServer dns;
const IPAddress AP_IP(192, 168, 4, 1);

CheckState check = CHECK_IDLE;
Settings pending;
uint32_t checkStarted = 0, okAt = 0, lastVisit = 0;
String notice;          // shown above the form (an error from the last try)
String networks[20];
int networkCount = 0;
bool updateOk = false;

String apName() {
  uint64_t mac = ESP.getEfuseMac();
  char b[32];
  snprintf(b, sizeof b, "Formery-%s-%02X%02X", PRODUCT, (unsigned)((mac >> 32) & 0xff), (unsigned)((mac >> 40) & 0xff));
  return String(b);
}

String esc(const String& in) {
  String o;
  o.reserve(in.length() + 8);
  for (size_t i = 0; i < in.length(); i++) {
    char c = in[i];
    if (c == '&') o += "&amp;";
    else if (c == '<') o += "&lt;";
    else if (c == '>') o += "&gt;";
    else if (c == '"') o += "&quot;";
    else if (c == '\'') o += "&#39;";
    else o += c;
  }
  return o;
}

void scanNetworks() {
  networkCount = 0;
  int n = WiFi.scanNetworks();
  // strongest first, no duplicates or hidden networks
  for (int pass = 0; pass < n && networkCount < 20; pass++) {
    int best = -1;
    for (int i = 0; i < n; i++) {
      String s = WiFi.SSID(i);
      if (!s.length()) continue;
      bool seen = false;
      for (int j = 0; j < networkCount; j++) if (networks[j] == s) { seen = true; break; }
      if (seen) continue;
      if (best < 0 || WiFi.RSSI(i) > WiFi.RSSI(best)) best = i;
    }
    if (best < 0) break;
    networks[networkCount++] = WiFi.SSID(best);
  }
  WiFi.scanDelete();
}

void sendPageEx(const String& body, int code, const char* refresh) {
  web.sendHeader("Cache-Control", "no-store");
  if (refresh) web.sendHeader("Refresh", refresh);  // the status page reloads itself while the check runs
  String page;
  page.reserve(strlen(PAGE_TOP) + body.length() + 120);
  page += PAGE_TOP;
  page += body;
  page += PAGE_BOTTOM;
  web.send(code, "text/html; charset=utf-8", page);
}

void sendPage(const String& body) { sendPageEx(body, 200, nullptr); }

void sendForm() {
  String ssid = pending.ssid.length() ? pending.ssid : cfg.ssid;
  bool listed = false;
  for (int i = 0; i < networkCount; i++) if (networks[i] == ssid) listed = true;
  String b;
  b.reserve(3000);
  b += "<h1>Set up your plant sensor</h1><p>Connect it to your home Wi-Fi and your Formery account.</p>";
  if (notice.length()) { b += "<div class=\"err\">"; b += esc(notice); b += "</div>"; }
  b += "<form method=\"post\" action=\"/save\"><div class=\"card\">";
  b += "<label for=\"pick\">Wi-Fi network</label><select id=\"pick\" name=\"ssid\">";
  for (int i = 0; i < networkCount; i++) {
    b += "<option"; if (networks[i] == ssid) b += " selected"; b += " value=\""; b += esc(networks[i]); b += "\">";
    b += esc(networks[i]); b += "</option>";
  }
  b += "<option value=\"\""; if (!listed) b += " selected"; b += ">Other network\xE2\x80\xA6</option></select>";
  b += "<div id=\"other\"><label for=\"ssid_other\">Network name</label>";
  b += "<input id=\"ssid_other\" name=\"ssid_other\" maxlength=\"32\" autocomplete=\"off\" autocapitalize=\"none\" autocorrect=\"off\" spellcheck=\"false\" value=\"";
  if (!listed) b += esc(ssid);
  b += "\"></div>";
  b += "<label for=\"pass\">Wi-Fi password</label><input id=\"pass\" name=\"pass\" type=\"password\" maxlength=\"63\" autocomplete=\"off\"";
  if (cfg.pass.length()) b += " placeholder=\"Leave empty to keep the saved one\"";
  b += ">";
  b += "<label for=\"key\">Sensor key</label><div class=\"hint\">In the Plant Sensor app, tap Add sensor, then copy the key it shows.</div>";
  b += "<input id=\"key\" name=\"key\" autocomplete=\"off\" autocapitalize=\"none\" autocorrect=\"off\" spellcheck=\"false\"";
  if (cfg.key.length()) b += " placeholder=\"Leave empty to keep the saved one\"";
  else b += " required";
  b += "></div>";
  b += "<details class=\"card\"><summary>Home Assistant (optional)</summary><p class=\"small\">Also publish readings to your MQTT broker.</p>";
  b += "<label for=\"mh\">MQTT host</label><input id=\"mh\" name=\"mqtt_host\" maxlength=\"64\" autocapitalize=\"none\" autocorrect=\"off\" spellcheck=\"false\" placeholder=\"homeassistant.local\" value=\"";
  b += esc(cfg.mqttHost); b += "\">";
  b += "<label for=\"mp\">Port</label><input id=\"mp\" name=\"mqtt_port\" inputmode=\"numeric\" maxlength=\"5\" value=\"";
  b += String(cfg.mqttPort); b += "\">";
  b += "<label for=\"mu\">User</label><input id=\"mu\" name=\"mqtt_user\" maxlength=\"64\" autocapitalize=\"none\" autocorrect=\"off\" value=\"";
  b += esc(cfg.mqttUser); b += "\">";
  b += "<label for=\"mq\">Password</label><input id=\"mq\" name=\"mqtt_pass\" type=\"password\" maxlength=\"64\" autocomplete=\"off\"";
  if (cfg.mqttPass.length()) b += " placeholder=\"Leave empty to keep the saved one\"";
  b += "></details>";
  b += "<button type=\"submit\">Connect</button></form>";
  b += "<p class=\"small\" style=\"margin-top:20px\">Firmware " FW_VERSION " &middot; <a href=\"/update\">Update firmware</a></p>";
  b += "<script>var p=document.getElementById('pick'),o=document.getElementById('other');"
       "function t(){o.hidden=p.value!=='';}p.onchange=t;t();</script>";
  sendPage(b);
}

void handleRoot() {
  lastVisit = millis();
  if (check == CHECK_JOINING || check == CHECK_START) { web.sendHeader("Location", "/status"); web.send(302); return; }
  sendForm();
}

void handleSave() {
  lastVisit = millis();
  Settings s = cfg;
  String ssid = web.arg("ssid");
  if (!ssid.length()) ssid = web.arg("ssid_other");
  ssid.trim();
  s.ssid = ssid;
  String pass = web.arg("pass");
  if (pass.length() || ssid != cfg.ssid) s.pass = pass;
  String rawKey = web.arg("key");
  rawKey.trim();
  if (rawKey.length()) s.key = cleanKey(rawKey);
  s.mqttHost = web.arg("mqtt_host"); s.mqttHost.trim();
  s.mqttUser = web.arg("mqtt_user"); s.mqttUser.trim();
  if (web.arg("mqtt_pass").length()) s.mqttPass = web.arg("mqtt_pass");
  long port = web.arg("mqtt_port").toInt();
  s.mqttPort = (port > 0 && port < 65536) ? (uint16_t)port : 1883;
  pending = s;
  if (!s.ssid.length() || s.ssid.length() > 32) notice = "Pick your Wi-Fi network.";
  else if (s.pass.length() > 63) notice = "That Wi-Fi password is too long.";
  else if (!s.key.length()) notice = rawKey.length() ? "That doesn't look like a sensor key. Copy it again from the app: it's 43 letters, numbers, - and _."
                                                     : "Paste the sensor key from the app.";
  else notice = "";
  if (notice.length()) { sendForm(); return; }
  check = CHECK_START;
  web.sendHeader("Location", "/status");
  web.send(303);
}

void handleStatus() {
  lastVisit = millis();
  String b;
  switch (check) {
    case CHECK_START:
    case CHECK_JOINING:
      b = "<h1>Connecting\xE2\x80\xA6</h1><div class=\"spin\"></div><p>Joining <b>" + esc(pending.ssid) +
          "</b> and sending a first reading. This takes up to 30 seconds.</p>"
          "<p class=\"small\">If your phone drops off this network now, that's normal: the sensor has joined yours. "
          "Check the app in a minute.</p>";
      sendPageEx(b, 200, "2");
      return;
    case CHECK_OK:
      b = "<h1>All set</h1><div class=\"ok\">The sensor is on your Wi-Fi and its first reading is in the app.</div>"
          "<p>It now checks your plant every " + String(intervalS() / 60) + " minutes and sleeps in between. "
          "You can close this page and rejoin your home Wi-Fi.</p>";
      sendPage(b);
      return;
    case CHECK_SAVED_OFFLINE:
      b = "<h1>Saved</h1><div class=\"err\">The sensor joined your Wi-Fi but couldn't reach formery.ai. "
          "It will keep trying every few minutes.</div><p>If readings don't show up in the app within an hour, check that this "
          "network reaches the internet, then set the sensor up again.</p>";
      sendPage(b);
      return;
    default:
      web.sendHeader("Location", "/");
      web.send(302);
  }
}

void handleUpdatePage() {
  lastVisit = millis();
  sendPage("<h1>Update firmware</h1><p>Choose the sensor's <b>.bin</b> file. Keep this page open until it says it's done "
           "(about a minute).</p><form method=\"post\" action=\"/update\" enctype=\"multipart/form-data\" class=\"card\">"
           "<input type=\"file\" name=\"fw\" accept=\".bin,application/octet-stream\" required>"
           "<button type=\"submit\">Upload and install</button></form>"
           "<p class=\"small\">Running " FW_VERSION ". <a href=\"/\">Back to setup</a></p>");
}

void handleUpdateUpload() {
  lastVisit = millis();
  HTTPUpload& up = web.upload();
  if (up.status == UPLOAD_FILE_START) {
    updateOk = false;
    Serial.printf("update: %s\n", up.filename.c_str());
    if (!Update.begin(UPDATE_SIZE_UNKNOWN)) Update.printError(Serial);
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (Update.isRunning() && Update.write(up.buf, up.currentSize) != up.currentSize) Update.printError(Serial);
  } else if (up.status == UPLOAD_FILE_END) {
    updateOk = Update.isRunning() && Update.end(true);
    if (!updateOk) Update.printError(Serial);
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    Update.abort();
  }
}

void handleUpdateDone() {
  if (updateOk) {
    sendPage("<h1>Updated</h1><div class=\"ok\">The new firmware is installed. The sensor is restarting.</div>");
    delay(1500);
    ESP.restart();
  }
  sendPageEx("<h1>Update failed</h1><div class=\"err\">That file isn't firmware for this sensor, or the upload broke off. "
           "The old firmware is still running.</div><p><a href=\"/update\">Try again</a></p>", 400, nullptr);
}

void captiveRedirect() {
  web.sendHeader("Location", "http://192.168.4.1/");
  web.send(302, "text/plain", "");
}

void startPortal() {
  WiFi.mode(WIFI_AP_STA);
  scanNetworks();
  String name = apName();
  WiFi.softAPConfig(AP_IP, AP_IP, IPAddress(255, 255, 255, 0));
  WiFi.softAP(name.c_str());
  dns.setErrorReplyCode(DNSReplyCode::NoError);
  dns.start(53, "*", AP_IP);
  web.on("/", HTTP_GET, handleRoot);
  web.on("/save", HTTP_POST, handleSave);
  web.on("/status", HTTP_GET, handleStatus);
  web.on("/update", HTTP_GET, handleUpdatePage);
  web.on("/update", HTTP_POST, handleUpdateDone, handleUpdateUpload);
  // phones probe these to detect a sign-in page: answer with a redirect so the setup page pops up
  const char* probes[] = {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                          "/connecttest.txt", "/ncsi.txt", "/redirect", "/canonical.html", "/success.txt"};
  for (const char* p : probes) web.on(p, captiveRedirect);
  web.onNotFound(captiveRedirect);
  web.begin();
  lastVisit = millis();
  led(true);
  Serial.printf("setup page on Wi-Fi %s, http://192.168.4.1/\n", name.c_str());
}

// The connection check runs here, outside the request handlers, so the status page keeps loading meanwhile.
void runCheck() {
  if (check == CHECK_START) {
    WiFi.disconnect(false);
    WiFi.begin(pending.ssid.c_str(), pending.pass.c_str());
    WiFi.setTxPower(WIFI_POWER_8_5dBm);
    checkStarted = millis();
    check = CHECK_JOINING;
    return;
  }
  if (check != CHECK_JOINING) return;
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - checkStarted > 20000) {
      WiFi.disconnect(false);
      notice = "Couldn't join \"" + pending.ssid + "\". Check the password, and that it's a 2.4 GHz network.";
      check = CHECK_BAD_WIFI;
    }
    return;
  }
  PostReply rep = postReading(pending.key, readingJson(readSensors()));
  if (rep.result == POST_BAD_KEY) {
    notice = "Your Wi-Fi works, but formery.ai didn't accept that sensor key. Copy it again from the app "
             "(or make a new one with Add sensor).";
    pending.key = cfg.key;
    WiFi.disconnect(false);
    check = CHECK_BAD_KEY;
    return;
  }
  saveSettings(pending);
  cfg = pending;
  rtcBadKey = 0;
  rtcFails = 0;
  if (rep.result == POST_OK) rtcInterval = rep.waitS;
  // 422 means the key was accepted but no sensor gave a value: the connection itself works
  check = (rep.result == POST_OK || rep.result == POST_TOO_SOON || rep.result == POST_REJECTED) ? CHECK_OK : CHECK_SAVED_OFFLINE;
  okAt = millis();
  if (check == CHECK_OK) esp_ota_mark_app_valid_cancel_rollback();
}

void runPortal(uint32_t idleLimitMs) {
  startPortal();
  while (true) {
    dns.processNextRequest();
    web.handleClient();
    runCheck();
    if (check == CHECK_BAD_WIFI || check == CHECK_BAD_KEY) check = CHECK_IDLE;  // the form shows the notice
    if ((check == CHECK_OK || check == CHECK_SAVED_OFFLINE) && millis() - okAt > 20000) {
      sleepFor(check == CHECK_OK ? intervalS() : RETRY_FIRST_S);
    }
    if (check == CHECK_IDLE && millis() - lastVisit > idleLimitMs) {
      Serial.println("setup page idle, sleeping");
      sleepFor(configured() ? intervalS() : PORTAL_RETRY_S);
    }
    delay(2);
  }
}

// ------------------------------------------------------------------ BOOT button

BootAction readBootButton() {
  bool timerWake = esp_sleep_get_wakeup_cause() == ESP_SLEEP_WAKEUP_TIMER;
  if (digitalRead(PIN_BOOT) == HIGH) {
    if (timerWake) return BOOT_NORMAL;  // don't spend battery waiting on every wake
    uint32_t t0 = millis();
    while (digitalRead(PIN_BOOT) == HIGH) {
      if (millis() - t0 > BOOT_WINDOW_MS) return BOOT_NORMAL;
      delay(10);
    }
  }
  uint32_t t0 = millis();
  while (digitalRead(PIN_BOOT) == LOW) {
    if (millis() - t0 >= BOOT_RESET_MS) return BOOT_RESET;
    led(((millis() - t0) / 250) % 2 == 0);
    delay(10);
  }
  led(false);
  return millis() - t0 >= 50 ? BOOT_PORTAL : BOOT_NORMAL;
}

// ------------------------------------------------------------------ main
void setup() {
  Serial.begin(115200);
  pinMode(PIN_SOIL_PWR, OUTPUT);
  digitalWrite(PIN_SOIL_PWR, LOW);
  pinMode(PIN_LED, OUTPUT);
  led(false);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  analogSetAttenuation(ADC_11db);
  Wire.begin(PIN_SDA, PIN_SCL);
  bmeOk = bme.begin(0x76) || bme.begin(0x77);
  if (bmeOk) bme.setSampling(Adafruit_BME280::MODE_FORCED);
  loadSettings();
  Serial.printf("plant sensor " FW_VERSION ", %s\n", configured() ? "set up" : "not set up");

  BootAction act = readBootButton();
  if (act == BOOT_RESET) {
    clearSettings();
    flash(5);
    Serial.println("settings cleared");
    runPortal(PORTAL_IDLE_MS);
  }
  if (act == BOOT_PORTAL || !configured()) runPortal(PORTAL_IDLE_MS);

  Reading r = readSensors();  // radio still off: quieter ADC
  if (!isnan(r.battery) && r.battery < CRITICAL_BATTERY_V) Serial.println("battery critical");

  WiFi.mode(WIFI_STA);
  if (!joinWifi(cfg.ssid, cfg.pass, WIFI_TIMEOUT_MS)) {
    if (rtcFails < 250) rtcFails++;
    Serial.println("wifi: no connection");
    sleepFor(min(RETRY_FIRST_S << min<uint8_t>(rtcFails - 1, 5), intervalS()));
  }

  PostReply rep = postReading(cfg.key, readingJson(r));
  publishMqtt(r);
  uint32_t next;
  switch (rep.result) {
    case POST_OK:
      rtcFails = 0;
      rtcBadKey = 0;
      rtcInterval = constrain(rep.waitS, MIN_INTERVAL_S, MAX_INTERVAL_S);
      esp_ota_mark_app_valid_cancel_rollback();
      if (rep.ota.length()) otaPull(rep.ota);
      next = intervalS();
      break;
    case POST_TOO_SOON:
      next = constrain(rep.waitS, (uint32_t)20, MAX_INTERVAL_S);
      break;
    case POST_BAD_KEY:
      // the key was rotated or the sensor deleted in the app: after a few tries, ask for a new key
      if (++rtcBadKey >= BAD_KEY_PORTAL_AFTER) {
        rtcBadKey = 0;
        notice = "formery.ai no longer accepts this sensor's key. Paste a new one from the app.";
        runPortal(PORTAL_IDLE_MS);
      }
      next = intervalS();
      break;
    case POST_REJECTED:
      next = intervalS();
      break;
    default:
      if (rtcFails < 250) rtcFails++;
      next = min(RETRY_FIRST_S << min<uint8_t>(rtcFails - 1, 5), intervalS());
  }
  if (!isnan(r.battery) && r.battery < CRITICAL_BATTERY_V) next = max(next, LOW_BATTERY_SLEEP_S);
  sleepFor(next);
}

void loop() {}
