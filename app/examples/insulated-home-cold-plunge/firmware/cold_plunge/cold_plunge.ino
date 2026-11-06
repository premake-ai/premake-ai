// Cold plunge controller: ESP32 DevKitC (WROOM-32)
// Reads the tub water temperature (DS18B20) and runs the chiller and the pump through two
// Shelly Plug US Gen4 smart plugs over local Wi-Fi (HTTP RPC). Nothing here touches mains:
// the plugs are UL-listed appliances on a GFCI cord.
//
// Fail-safe: every "on" sent to a plug carries toggle_after, so a plug switches itself OFF
// if this board stops re-confirming it (chiller after 180 s, pump after 300 s: the chiller
// always stops before the flow does). The chiller's own thermostat stays set to its
// coldest safe point (39 F / 4 C) as a second limit.
//
// controls: target (range 4-15 °C), chill (toggle), filter_hours (range 0-12 h per day), circulate (button)
// readings: water_c, target_c, chiller_on, pump_on, pump_w, fault
//
// Libraries: OneWire, DallasTemperature, ArduinoJson (v7), WiFi, WebServer, HTTPClient, Preferences.

#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <ArduinoJson.h>

// ---- pin map (matches wiring.json) ----
const int PIN_ONEWIRE = 4;     // DS18B20 adapter DAT
const int PIN_SETUP   = 0;     // BOOT button: hold at power-up for the setup page

const char* FW = "1.0.0";
const char* API = "https://premake.ai/api/d";

// ---- safety limits ----
const float TARGET_MIN = 4.0, TARGET_MAX = 15.0;
const float FREEZE_C = 2.5;                        // never chill below this
const float HYST = 0.5;                            // +-0.5 C around the target
const uint32_t PUMP_LEAD_MS   = 30000;             // flow for 30 s before the compressor starts
const uint32_t PUMP_RUNON_MS  = 60000;             // flow for 60 s after it stops
const uint32_t MIN_OFF_MS     = 10UL * 60000;      // compressor rest (anti short-cycle)
const uint32_t MIN_ON_MS      = 3UL * 60000;
const float PUMP_MIN_W = 30.0;                     // pump draws ~110 W; below this = no flow

OneWire ow(PIN_ONEWIRE);
DallasTemperature probe(&ow);
Preferences prefs;
WebServer web(80);

String ssid, pass, devKey, ipChiller, ipPump;

// desired state from the app (commands)
volatile float target = 10.0;
volatile bool chill = false;
volatile int filterHours = 4;
volatile long circulatePress = -1;
uint32_t circulateUntil = 0;

// live state
float waterC = NAN;
bool chillerOn = false, pumpOn = false;
float pumpW = -1;                                  // -1 = plug has no reading
uint32_t chillerChanged = 0, pumpChanged = 0, lastPumpOk = 0;
int fault = 0;                                     // 0 ok, 1 probe, 2 pump plug, 3 no flow, 4 chiller plug
uint32_t ingestEvery = 60000;

// ---------- setup page ----------
void handleRoot() {
  String h = "<html><body style='font-family:sans-serif'><h2>Cold Plunge setup</h2><form action='/save' method='post'>"
             "Wi-Fi name<br><input name='s' value='" + ssid + "'><br>Wi-Fi password<br><input name='p' type='password'><br>"
             "Device key<br><input name='k' value='" + devKey + "'><br>"
             "Chiller plug IP<br><input name='c' value='" + ipChiller + "'><br>"
             "Pump plug IP<br><input name='u' value='" + ipPump + "'><br><br><button>Save</button></form></body></html>";
  web.send(200, "text/html", h);
}

void handleSave() {
  prefs.putString("ssid", web.arg("s"));
  if (web.arg("p").length()) prefs.putString("pass", web.arg("p"));
  prefs.putString("key", web.arg("k"));
  prefs.putString("ipc", web.arg("c"));
  prefs.putString("ipu", web.arg("u"));
  web.send(200, "text/html", "Saved. Restarting...");
  delay(1000);
  ESP.restart();
}

void runSetupPortal() {
  uint8_t mac[6];
  WiFi.macAddress(mac);
  char ap[40];
  snprintf(ap, sizeof(ap), "Premake-ColdPlunge-%02X%02X", mac[4], mac[5]);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap);
  web.on("/", handleRoot);
  web.on("/save", HTTP_POST, handleSave);
  web.begin();
  for (;;) { web.handleClient(); delay(5); }
}

// ---------- Shelly plugs (Gen2+ RPC) ----------
bool plugSet(const String& ip, bool on, int toggleAfter) {
  if (ip.length() == 0) return false;
  HTTPClient http;
  String url = "http://" + ip + "/rpc/Switch.Set?id=0&on=" + String(on ? "true" : "false");
  if (on) url += "&toggle_after=" + String(toggleAfter);
  http.setTimeout(3000);
  http.begin(url);
  int code = http.GET();
  http.end();
  return code == 200;
}

// returns true if reachable; fills output state and active power (W, -1 if not reported)
bool plugStatus(const String& ip, bool& output, float& watts) {
  HTTPClient http;
  http.setTimeout(3000);
  http.begin("http://" + ip + "/rpc/Switch.GetStatus?id=0");
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  JsonDocument doc;
  DeserializationError e = deserializeJson(doc, http.getString());
  http.end();
  if (e) return false;
  output = doc["output"] | false;
  watts = doc["apower"].is<float>() ? doc["apower"].as<float>() : -1;
  return true;
}

// ---------- Premake commands (own task, long-poll) ----------
void commandTask(void*) {
  long seq = 0;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED || devKey.length() == 0) { delay(5000); continue; }
    WiFiClientSecure tls;
    tls.setInsecure();
    HTTPClient http;
    http.setTimeout(30000);
    http.begin(tls, String(API) + "/commands?since=" + String(seq) + "&wait=25");
    http.addHeader("Authorization", "Device " + devKey);
    const char* keep[] = {"Retry-After"};
    http.collectHeaders(keep, 1);
    int code = http.GET();
    if (code == 200) {
      JsonDocument doc;
      if (!deserializeJson(doc, http.getString())) {
        long s = doc["seq"] | seq;
        if (s != seq) {
          JsonObject set = doc["set"];
          if (set["target"].is<float>()) target = constrain(set["target"].as<float>(), TARGET_MIN, TARGET_MAX);
          if (set["chill"].is<bool>()) chill = set["chill"].as<bool>();
          if (set["filter_hours"].is<int>()) filterHours = constrain(set["filter_hours"].as<int>(), 0, 12);
          if (set["circulate"].is<long>()) {
            long p = set["circulate"].as<long>();
            if (circulatePress >= 0 && p != circulatePress) circulateUntil = millis() + 15UL * 60000;  // 15 min stir
            circulatePress = p;
          }
          seq = s;
        }
      }
      http.end();
    } else {
      int wait = 5;
      if (code == 429) { String ra = http.header("Retry-After"); if (ra.toInt() > 0) wait = ra.toInt(); }
      http.end();
      delay(wait * 1000);
    }
  }
}

void ingest() {
  if (WiFi.status() != WL_CONNECTED || devKey.length() == 0) return;
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(tls, String(API) + "/ingest");
  http.addHeader("Authorization", "Device " + devKey);
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  JsonObject r = doc["r"].to<JsonObject>();
  if (!isnan(waterC)) r["water_c"] = round(waterC * 10) / 10.0;
  r["target_c"] = target;
  r["chiller_on"] = chillerOn ? 1 : 0;
  r["pump_on"] = pumpOn ? 1 : 0;
  if (pumpW >= 0) r["pump_w"] = round(pumpW);
  r["fault"] = fault;
  doc["fw"] = FW;
  String body;
  serializeJson(doc, body);
  if (http.POST(body) == 200) {
    JsonDocument rep;
    if (!deserializeJson(rep, http.getString()) && rep["interval"].is<int>())
      ingestEvery = max(20, rep["interval"].as<int>()) * 1000UL;
  }
  http.end();
}

// ---------- control ----------
bool filterWindow() {
  // filter_hours spread over the day: that share of every hour, no clock needed
  uint32_t minuteOfHour = (millis() / 60000) % 60;
  return minuteOfHour < (uint32_t)(filterHours * 60 / 24);
}

void readProbe() {
  probe.requestTemperatures();
  float t = probe.getTempCByIndex(0);
  if (t == DEVICE_DISCONNECTED_C || t < -5 || t > 45 || t == 85.0) waterC = NAN;
  else waterC = t;
}

void control() {
  uint32_t now = millis();
  bool probeOk = !isnan(waterC);

  // thermostat with hysteresis
  bool wantCold = chill && probeOk && waterC > FREEZE_C &&
                  (chillerOn ? waterC > target - HYST : waterC > target + HYST);

  // pump: whenever chilling, during run-on, filter window or a circulate press
  bool wantPump = wantCold || chillerOn || (now - chillerChanged < PUMP_RUNON_MS && chillerChanged) ||
                  filterWindow() || now < circulateUntil;

  // read the pump plug: confirm it is on and drawing power (= water is flowing)
  bool out = false; float w = -1;
  bool pumpReach = plugStatus(ipPump, out, w);
  pumpW = pumpReach ? w : -1;
  bool flowing = pumpReach && out && (w < 0 || w > PUMP_MIN_W);
  if (flowing) lastPumpOk = now;

  fault = !probeOk ? 1 : (!pumpReach ? 2 : 0);

  // chiller decision
  bool chillerNext = chillerOn;
  if (chillerOn) {
    bool mustStop = !probeOk || !flowing || waterC <= FREEZE_C;
    if (!flowing && pumpReach && out) fault = 3;
    if (mustStop) chillerNext = false;
    else if (!wantCold && now - chillerChanged > MIN_ON_MS) chillerNext = false;
  } else if (wantCold && flowing && now - lastPumpOk < 5000 && now - pumpChanged > PUMP_LEAD_MS &&
             (chillerChanged == 0 || now - chillerChanged > MIN_OFF_MS)) {
    chillerNext = true;
  }

  // apply (re-sent every loop so the plugs' toggle_after timers never run out while we're alive)
  if (!plugSet(ipChiller, chillerNext, 180) && chillerNext) { chillerNext = false; fault = 4; }
  if (chillerNext != chillerOn) { chillerOn = chillerNext; chillerChanged = now; }
  if (chillerOn) wantPump = true;
  plugSet(ipPump, wantPump, 300);
  if (wantPump != pumpOn) { pumpOn = wantPump; pumpChanged = now; }
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_SETUP, INPUT_PULLUP);
  probe.begin();
  probe.setResolution(11);
  prefs.begin("plunge", false);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  devKey = prefs.getString("key", "");
  ipChiller = prefs.getString("ipc", "");
  ipPump = prefs.getString("ipu", "");
  if (ssid.length() == 0 || digitalRead(PIN_SETUP) == LOW) runSetupPortal();

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  xTaskCreatePinnedToCore(commandTask, "cmd", 8192, nullptr, 1, nullptr, 0);
}

void loop() {
  static uint32_t lastCtl = 0, lastIngest = 0;
  uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    // plugs time out to OFF on their own (toggle_after); just keep trying to reconnect
    static uint32_t lastTry = 0;
    if (now - lastTry > 10000) { WiFi.reconnect(); lastTry = now; }
    if (chillerOn) { chillerOn = false; chillerChanged = now; }   // rest timer starts now
  }
  if (now - lastCtl > 10000) {            // control step every 10 s
    lastCtl = now;
    readProbe();
    if (WiFi.status() == WL_CONNECTED) control();
  }
  if (now - lastIngest > ingestEvery) {
    lastIngest = now;
    ingest();
  }
  delay(20);
}
