// Wi-Fi Pet Feeder – ESP32-C3 SuperMini + TMC2209 + NEMA17
// One portion = 1/6 turn of the 6-pocket wheel (~50 ml, ~20 g kibble).
// Web page at http://feeder.local (or the printed IP) to set times and portions.
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <time.h>

// ---- pin map ----
const int PIN_STEP = 4;
const int PIN_DIR = 5;
const int PIN_EN = 6;
const int PIN_BTN = 7;

// ---- settings ----
const char *WIFI_SSID = "your-wifi";
const char *WIFI_PASS = "your-password";
const char *TZ_INFO = "EST5EDT,M3.2.0,M11.1.0";   // New York
const int STEPS_PER_REV = 200 * 8;                // 1/8 microstep (MS1, MS2 to GND)
const int STEPS_PER_PORTION = STEPS_PER_REV / 6;
const int STEP_US = 600;                          // half period, slow = more torque
const int MAX_MEALS = 4;

Preferences prefs;
WebServer server(80);
int mealMin[MAX_MEALS];      // minutes after midnight, -1 = off
int mealPortions[MAX_MEALS];
int lastFedDay[MAX_MEALS];

void stepN(int n, bool fwd) {
  digitalWrite(PIN_DIR, fwd ? HIGH : LOW);
  for (int i = 0; i < n; i++) {
    digitalWrite(PIN_STEP, HIGH); delayMicroseconds(STEP_US);
    digitalWrite(PIN_STEP, LOW);  delayMicroseconds(STEP_US);
  }
}

void dispense(int portions) {
  digitalWrite(PIN_EN, LOW);
  for (int p = 0; p < portions; p++) {
    stepN(STEPS_PER_PORTION, true);
    stepN(STEPS_PER_PORTION / 8, false);   // small back-off clears a pinched kibble
    stepN(STEPS_PER_PORTION / 8, true);
    delay(300);
  }
  digitalWrite(PIN_EN, HIGH);              // motor off between meals (quiet, cool)
}

void loadSettings() {
  prefs.begin("feeder", true);
  for (int i = 0; i < MAX_MEALS; i++) {
    char k[8];
    sprintf(k, "t%d", i); mealMin[i] = prefs.getInt(k, i == 0 ? 7 * 60 : (i == 1 ? 18 * 60 : -1));
    sprintf(k, "p%d", i); mealPortions[i] = prefs.getInt(k, 2);
    lastFedDay[i] = -1;
  }
  prefs.end();
}

void saveSettings() {
  prefs.begin("feeder", false);
  for (int i = 0; i < MAX_MEALS; i++) {
    char k[8];
    sprintf(k, "t%d", i); prefs.putInt(k, mealMin[i]);
    sprintf(k, "p%d", i); prefs.putInt(k, mealPortions[i]);
  }
  prefs.end();
}

void handleRoot() {
  String h = "<html><body style='font-family:sans-serif'><h2>Pet Feeder</h2><form action='/save'>";
  for (int i = 0; i < MAX_MEALS; i++) {
    char t[6] = "";
    if (mealMin[i] >= 0) sprintf(t, "%02d:%02d", mealMin[i] / 60, mealMin[i] % 60);
    h += "Meal " + String(i + 1) + ": <input type='time' name='t" + i + "' value='" + t + "'> portions <input type='number' min='1' max='6' name='p" + i + "' value='" + mealPortions[i] + "'><br>";
  }
  h += "<input type='submit' value='Save'></form><p><a href='/feed'>Feed 1 portion now</a></p></body></html>";
  server.send(200, "text/html", h);
}

void handleSave() {
  for (int i = 0; i < MAX_MEALS; i++) {
    String t = server.arg("t" + String(i));
    mealMin[i] = t.length() == 5 ? t.substring(0, 2).toInt() * 60 + t.substring(3).toInt() : -1;
    mealPortions[i] = constrain(server.arg("p" + String(i)).toInt(), 1, 6);
  }
  saveSettings();
  server.sendHeader("Location", "/"); server.send(303);
}

void handleFeed() {
  dispense(1);
  server.sendHeader("Location", "/"); server.send(303);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_STEP, OUTPUT); pinMode(PIN_DIR, OUTPUT); pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, HIGH);
  pinMode(PIN_BTN, INPUT_PULLUP);
  loadSettings();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  Serial.println(WiFi.localIP());
  configTzTime(TZ_INFO, "pool.ntp.org");
  MDNS.begin("feeder");
  server.on("/", handleRoot);
  server.on("/save", handleSave);
  server.on("/feed", handleFeed);
  server.begin();
}

void loop() {
  server.handleClient();

  // manual feed button (debounced, one portion per press)
  static uint32_t lastBtn = 0;
  if (digitalRead(PIN_BTN) == LOW && millis() - lastBtn > 800) {
    lastBtn = millis();
    dispense(1);
  }

  // schedule (needs NTP time; keeps running on the RTC if Wi-Fi drops later)
  struct tm now;
  if (getLocalTime(&now, 10)) {
    int m = now.tm_hour * 60 + now.tm_min;
    for (int i = 0; i < MAX_MEALS; i++) {
      if (mealMin[i] >= 0 && m == mealMin[i] && lastFedDay[i] != now.tm_yday) {
        lastFedDay[i] = now.tm_yday;
        dispense(mealPortions[i]);
      }
    }
  }
}
