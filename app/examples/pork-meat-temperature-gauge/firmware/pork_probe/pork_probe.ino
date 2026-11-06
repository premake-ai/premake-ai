// Pork probe: ESP32-C3 SuperMini + 100k NTC food probe + SSD1306 OLED + buzzer.
// iPhone: open http://porkprobe.local (home Wi-Fi) or join "PorkProbe" and open http://192.168.4.1
// Libraries: Adafruit SSD1306 + Adafruit GFX (Library Manager). Board: "ESP32C3 Dev Module", USB CDC on boot enabled.
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

// ---- pin map (matches wiring.json) ----
const int PIN_BATT = 0;    // 470k/470k divider
const int PIN_PROBE = 1;   // 100k to 3V3, probe tip to GND
const int PIN_BTN = 3;     // to GND, deep-sleep wake
const int PIN_SDA = 6;
const int PIN_SCL = 7;
const int PIN_BUZZ = 10;   // active buzzer +

// ---- your home Wi-Fi (leave blank to use the PorkProbe hotspot) ----
const char* WIFI_SSID = "";
const char* WIFI_PASS = "";

const float R_FIXED = 100000.0;
struct Preset { const char* name; float f; };
// USDA: whole cuts 145 F + 3 min rest, ground pork 160 F; pulled pork is a BBQ texture target.
Preset PRESETS[] = {{"CHOP/LOIN", 145}, {"GROUND", 160}, {"PULLED", 203}};
const int NPRESET = 3;

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
WebServer server(80);
Preferences prefs;
float r25 = 100000.0, beta = 3950.0;   // replaced by 2-point calibration
int preset = 0;
float tempF = NAN, battV = 0;
bool alarmOn = false, silenced = false;
unsigned long btnDown = 0;

float probeOhms() {
  uint32_t mv = 0;
  for (int i = 0; i < 16; i++) mv += analogReadMilliVolts(PIN_PROBE);
  float v = mv / 16.0;
  if (v > 3200 || v < 20) return NAN;                 // unplugged / shorted
  return R_FIXED * v / (3300.0 - v);
}

float ohmsToF(float r) {
  if (isnan(r)) return NAN;
  float k = 1.0 / (1.0 / 298.15 + log(r / r25) / beta);
  return (k - 273.15) * 9.0 / 5.0 + 32.0;
}

void calibrate(int point) {                           // point 0 = ice water, 100 = boiling
  float r = probeOhms();
  if (isnan(r)) return;
  prefs.putFloat(point == 0 ? "r0" : "r100", r);
  float r0 = prefs.getFloat("r0", 0), r100 = prefs.getFloat("r100", 0);
  if (r0 > 0 && r100 > 0) {
    beta = log(r0 / r100) / (1.0 / 273.15 - 1.0 / 373.15);
    r25 = r0 * exp(beta * (1.0 / 298.15 - 1.0 / 273.15));
    prefs.putFloat("beta", beta);
    prefs.putFloat("r25", r25);
  }
}

void beep(int ms) { digitalWrite(PIN_BUZZ, HIGH); delay(ms); digitalWrite(PIN_BUZZ, LOW); }

void sleepNow() {
  oled.clearDisplay(); oled.display(); oled.ssd1306_command(SSD1306_DISPLAYOFF);
  while (digitalRead(PIN_BTN) == LOW) delay(10);
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_BTN, ESP_GPIO_WAKEUP_GPIO_LOW);
  esp_deep_sleep_start();
}

const char PAGE[] PROGMEM = R"HTML(<!doctype html><html><head><meta name=viewport content="width=device-width,initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes"><title>Pork Probe</title>
<style>body{font-family:-apple-system,sans-serif;background:#111;color:#eee;text-align:center;margin:0;padding:24px}
#t{font-size:96px;font-weight:700}#s{font-size:20px;color:#aaa}.hot{color:#ff5a36}
button{font-size:18px;margin:6px;padding:12px 16px;border-radius:12px;border:0;background:#333;color:#fff}</style></head><body>
<div id=t>--</div><div id=s></div><p>
<button onclick="go('/preset?i=0')">Chop/loin 145</button><button onclick="go('/preset?i=1')">Ground 160</button>
<button onclick="go('/preset?i=2')">Pulled 203</button></p><p><button onclick="go('/silence')">Silence alarm</button></p>
<details><summary>Calibrate probe</summary><p><button onclick="go('/cal?p=0')">Probe in ice water</button>
<button onclick="go('/cal?p=100')">Probe in boiling water</button></p></details>
<script>function go(u){fetch(u).then(r=>u2())}
function u2(){fetch('/t').then(r=>r.json()).then(j=>{t.textContent=j.f==null?'no probe':j.f.toFixed(1)+'°F';
t.className=j.alarm?'hot':'';s.textContent=j.preset+' target '+j.target+'°F  |  battery '+j.batt.toFixed(2)+' V';
if(j.alarm&&navigator.vibrate)navigator.vibrate(300)})}setInterval(u2,2000);u2()</script></body></html>)HTML";

void setupWeb() {
  server.on("/", [] { server.send_P(200, "text/html", PAGE); });
  server.on("/t", [] {
    String j = "{\"f\":" + (isnan(tempF) ? String("null") : String(tempF, 1)) + ",\"target\":" +
               String(PRESETS[preset].f, 0) + ",\"preset\":\"" + PRESETS[preset].name + "\",\"alarm\":" +
               (alarmOn ? "true" : "false") + ",\"batt\":" + String(battV, 2) + "}";
    server.send(200, "application/json", j);
  });
  server.on("/preset", [] { preset = constrain(server.arg("i").toInt(), 0, NPRESET - 1); silenced = false;
                            prefs.putInt("preset", preset); server.send(200, "text/plain", "ok"); });
  server.on("/silence", [] { silenced = true; server.send(200, "text/plain", "ok"); });
  server.on("/cal", [] { calibrate(server.arg("p").toInt()); server.send(200, "text/plain", "ok"); });
  server.begin();
}

void setup() {
  pinMode(PIN_BTN, INPUT_PULLUP);
  pinMode(PIN_BUZZ, OUTPUT);
  analogSetAttenuation(ADC_11db);
  prefs.begin("probe");
  r25 = prefs.getFloat("r25", r25);
  beta = prefs.getFloat("beta", beta);
  preset = prefs.getInt("preset", 0);

  Wire.begin(PIN_SDA, PIN_SCL);
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  oled.setTextColor(SSD1306_WHITE);

  WiFi.setHostname("porkprobe");
  bool joined = false;
  if (strlen(WIFI_SSID)) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
    joined = WiFi.status() == WL_CONNECTED;
  }
  if (!joined) { WiFi.mode(WIFI_AP); WiFi.softAP("PorkProbe"); }
  WiFi.setSleep(true);                                // modem sleep saves battery
  MDNS.begin("porkprobe");
  setupWeb();
  beep(60);
}

void loop() {
  server.handleClient();

  // button: short press = next preset / silence, hold 2 s = sleep
  if (digitalRead(PIN_BTN) == LOW) {
    if (!btnDown) btnDown = millis();
    if (millis() - btnDown > 2000) sleepNow();
  } else if (btnDown) {
    if (millis() - btnDown > 40) {
      if (alarmOn && !silenced) silenced = true;
      else { preset = (preset + 1) % NPRESET; silenced = false; prefs.putInt("preset", preset); }
    }
    btnDown = 0;
  }

  static unsigned long last = 0;
  if (millis() - last < 500) return;
  last = millis();

  tempF = ohmsToF(probeOhms());
  battV = analogReadMilliVolts(PIN_BATT) * 2.0 / 1000.0;
  alarmOn = !isnan(tempF) && tempF >= PRESETS[preset].f;
  if (!alarmOn) silenced = false;
  if (alarmOn && !silenced) beep(120);

  oled.clearDisplay();
  oled.setTextSize(3);
  oled.setCursor(0, 4);
  if (isnan(tempF)) oled.print("--.-"); else { oled.print(tempF, 1); }
  oled.setTextSize(1);
  oled.setCursor(110, 4); oled.print("F");
  oled.setCursor(0, 40);
  oled.print(PRESETS[preset].name); oled.print(" > "); oled.print(PRESETS[preset].f, 0);
  oled.setCursor(0, 54);
  oled.print(alarmOn ? (silenced ? "DONE (quiet)" : "DONE! rest 3 min") : WiFi.getMode() == WIFI_AP ? "wifi: PorkProbe" : "porkprobe.local");
  if (battV < 3.4) { oled.setCursor(100, 54); oled.print("LOW"); }
  oled.display();
}
