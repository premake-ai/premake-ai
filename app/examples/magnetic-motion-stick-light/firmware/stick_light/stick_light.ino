// Board: ESP32-C3 SuperMini
// Magnetic motion-sensor stick light.
//
// Pin map (matches wiring.json):
//   GPIO3  <- AM312 PIR OUT (also deep-sleep wake pin)
//   GPIO4  -> WS2812B strip DIN (6 LEDs)
//   GPIO1  <- battery sense, 100k/100k divider from TP4056 OUT+
//   5V / GND <- TP4056 OUT+ / OUT- (18650 cell)
//
// controls: brightness (range 5-100 %), warmth (range 0-100), on_time (range 10-300 s), lamp (toggle)
// readings: battery_v, battery_pct, motions

#include "premake_wifi.h"
#include <Adafruit_NeoPixel.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "esp_sleep.h"

#define PIN_PIR 3
#define PIN_LED 4
#define PIN_BAT 1
#define NUM_LEDS 6
#define MAX_BRIGHT 153          // 60 % cap: ~0.22 A at full white

Adafruit_NeoPixel strip(NUM_LEDS, PIN_LED, NEO_GRB + NEO_KHZ800);
Preferences prefs;

int brightness = 70;            // %
int warmth = 80;                // 0 = cool white, 100 = warm
int onTime = 30;                // s after last motion
bool lamp = false;              // stay on until switched off
long cmdSeq = 0;

RTC_DATA_ATTR uint32_t motions = 0;
RTC_DATA_ATTR uint32_t wakeCount = 0;

unsigned long lastMotion = 0;
unsigned long awakeUntil = 0;   // keep awake after power-on for Wi-Fi setup
unsigned long lastPost = 0;
unsigned long postInterval = 60000;
unsigned long nextPoll = 0;
bool synced = false;
uint8_t level = 0;              // current fade level 0..255

void loadSettings() {
  prefs.begin("stick", true);
  brightness = prefs.getInt("bright", brightness);
  warmth = prefs.getInt("warmth", warmth);
  onTime = prefs.getInt("ontime", onTime);
  lamp = prefs.getBool("lamp", false);
  cmdSeq = prefs.getLong("seq", 0);
  prefs.end();
}

void saveSettings() {
  prefs.begin("stick", false);
  prefs.putInt("bright", brightness);
  prefs.putInt("warmth", warmth);
  prefs.putInt("ontime", onTime);
  prefs.putBool("lamp", lamp);
  prefs.putLong("seq", cmdSeq);
  prefs.end();
}

void showLevel(uint8_t lv) {
  // blend cool white (255,240,224) to warm white (255,147,41)
  int r = 255;
  int g = 240 + (147 - 240) * warmth / 100;
  int b = 224 + (41 - 224) * warmth / 100;
  uint32_t scale = (uint32_t)lv * MAX_BRIGHT / 255;
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, strip.Color(r * scale / 255, g * scale / 255, b * scale / 255));
  }
  strip.show();
}

void fadeTowards(uint8_t target) {
  if (level < target) level = min<int>(level + 5, target);
  else if (level > target) level = max<int>(level - 5, target);
  showLevel(level);
}

float batteryVolts() {
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_BAT);
  return (mv / 8.0f) * 2.0f / 1000.0f;
}

int batteryPct(float v) {
  int p = (int)((v - 3.3f) / (4.15f - 3.3f) * 100.0f);
  return constrain(p, 0, 100);
}

bool applyCommands(const String &body) {
  JsonDocument doc;
  if (deserializeJson(doc, body)) return false;
  long seq = doc["seq"] | cmdSeq;
  if (seq == cmdSeq) return true;
  cmdSeq = seq;
  JsonObject set = doc["set"];
  if (!set.isNull()) {
    if (set["brightness"].is<int>()) brightness = constrain(set["brightness"].as<int>(), 5, 100);
    if (set["warmth"].is<int>()) warmth = constrain(set["warmth"].as<int>(), 0, 100);
    if (set["on_time"].is<int>()) onTime = constrain(set["on_time"].as<int>(), 10, 300);
    if (set["lamp"].is<bool>()) lamp = set["lamp"].as<bool>();
  }
  saveSettings();
  Serial.printf("[stick] settings: bright %d warmth %d on %ds lamp %d\n", brightness, warmth, onTime, lamp);
  return true;
}

// Short (non-blocking-ish) command check; wait=0 so the light never stalls long.
void pollCommands() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);
  String url = "https://premake.ai/api/d/commands?since=" + String(cmdSeq) + "&wait=0";
  if (!http.begin(client, url)) return;
  http.addHeader("Authorization", String("Device ") + PremakeWiFi.deviceKey());
  int code = http.GET();
  if (code == 200) {
    applyCommands(http.getString());
    synced = true;
  } else {
    Serial.printf("[stick] commands error %d\n", code);
  }
  http.end();
}

void postReading() {
  float v = batteryVolts();
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, "https://premake.ai/api/d/ingest")) return;
  http.addHeader("Authorization", String("Device ") + PremakeWiFi.deviceKey());
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  doc["r"]["battery_v"] = round(v * 100) / 100.0;
  doc["r"]["battery_pct"] = batteryPct(v);
  doc["r"]["motions"] = motions;
  doc["fw"] = "1.0.0";
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code == 200) {
    JsonDocument reply;
    if (!deserializeJson(reply, http.getString())) {
      int iv = reply["interval"] | 60;
      postInterval = (unsigned long)max(iv, 20) * 1000UL;
    }
    Serial.printf("[stick] posted battery %.2f V\n", v);
  } else {
    Serial.printf("[stick] ingest error %d\n", code);
  }
  http.end();
  lastPost = millis();
}

void goToSleep() {
  showLevel(0);
  Serial.println("[stick] sleeping");
  Serial.flush();
  // wait for the PIR output to drop so it doesn't wake us straight away
  unsigned long t = millis();
  while (digitalRead(PIN_PIR) == HIGH && millis() - t < 10000) delay(50);
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PIN_PIR, ESP_GPIO_WAKEUP_GPIO_HIGH);
  esp_deep_sleep_start();
}

void setup() {
  PremakeWiFi.begin("Stick Light", "1.0.0");
  pinMode(PIN_PIR, INPUT);
  analogReadResolution(12);
  strip.begin();
  strip.show();
  loadSettings();
  wakeCount++;

  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  if (cause == ESP_SLEEP_WAKEUP_GPIO) {
    motions++;
    Serial.println("[stick] motion wake");
  } else {
    // fresh power-on or flash: stay awake 3 min so Wi-Fi can be set up over USB
    awakeUntil = millis() + 180000UL;
    Serial.println("[stick] power on");
  }
  lastMotion = millis();
  float v = batteryVolts();
  Serial.printf("[stick] battery %.2f V (%d%%)\n", v, batteryPct(v));
  if (v > 2.5f && v < 3.35f) {          // low battery: dim red blink, then sleep
    for (int i = 0; i < 3; i++) {
      strip.fill(strip.Color(40, 0, 0)); strip.show(); delay(150);
      strip.clear(); strip.show(); delay(150);
    }
  }
}

void loop() {
  unsigned long now = millis();
  if (digitalRead(PIN_PIR) == HIGH) {
    if (now - lastMotion > 3000) motions++;
    lastMotion = now;
  }

  bool lit = lamp || (now - lastMotion < (unsigned long)onTime * 1000UL);
  uint8_t target = lit ? (uint8_t)(brightness * 255 / 100) : 0;
  fadeTowards(target);

  if (PremakeWiFi.connected()) {
    if (now >= nextPoll) {
      pollCommands();
      // while the lamp is held on, keep checking so it can be switched off
      nextPoll = millis() + ((lamp || now < awakeUntil) ? 3000UL : 20000UL);
    }
    if (lastPost == 0 || millis() - lastPost > postInterval) postReading();
  }

  bool stayAwake = lit || now < awakeUntil || level > 0;
  // give Wi-Fi a few seconds after the light goes out to sync once
  if (!stayAwake && (synced || now - lastMotion > (unsigned long)onTime * 1000UL + 8000UL)) {
    goToSleep();
  }
  delay(20);
}
