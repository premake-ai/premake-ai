// Board: ESP32-C3 SuperMini
// Adjustable LED Desk Lamp
//
// Pin map (matches wiring.json):
//   GPIO4 -> 330 ohm -> LED ring 24 DIN
//   GPIO0 -> Encoder EC11 A
//   GPIO1 -> Encoder EC11 B
//   GPIO3 -> Encoder EC11 SW1 (SW2 and C to GND)
//
// Knob: turn = brightness, press = on/off.
// controls: power (toggle), brightness (range 0-100 %), color (color)

#include <Adafruit_NeoPixel.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include "premake_wifi.h"

#define PIN_LED 4
#define PIN_A 0
#define PIN_B 1
#define PIN_SW 3
#define NUM_LEDS 24
#define MAX_LEVEL 180  // of 255: ~1.2 A at full white, keeps the head cool

Adafruit_NeoPixel ring(NUM_LEDS, PIN_LED, NEO_GRB + NEO_KHZ800);
Preferences prefs;

volatile bool lampOn = true;
volatile int brightness = 60;          // percent
volatile uint32_t color = 0xFFC890;    // warm white
volatile bool dirty = true;
unsigned long lastChange = 0;
bool unsaved = false;

const int8_t ENC_TABLE[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
uint8_t encState = 0;
int encAcc = 0;
bool swLast = true;
unsigned long swTime = 0;

void showLamp() {
  uint8_t r = (color >> 16) & 0xFF, g = (color >> 8) & 0xFF, b = color & 0xFF;
  int level = lampOn ? (brightness * MAX_LEVEL) / 100 : 0;
  // scale by hand so colours stay exact at every level
  for (int i = 0; i < NUM_LEDS; i++) {
    ring.setPixelColor(i, ring.Color((r * level) / 255, (g * level) / 255, (b * level) / 255));
  }
  ring.show();
}

void localChange() {
  dirty = true;
  unsaved = true;
  lastChange = millis();
}

void readKnob() {
  encState = ((encState << 2) | (digitalRead(PIN_A) << 1) | digitalRead(PIN_B)) & 0x0F;
  encAcc += ENC_TABLE[encState];
  if (encAcc >= 4 || encAcc <= -4) {
    int step = encAcc > 0 ? 5 : -5;
    encAcc = 0;
    if (!lampOn) lampOn = true;
    brightness = constrain(brightness + step, 1, 100);
    localChange();
  }
  bool sw = digitalRead(PIN_SW);
  if (sw != swLast && millis() - swTime > 30) {
    swTime = millis();
    swLast = sw;
    if (!sw) {
      lampOn = !lampOn;
      Serial.printf("[lamp] knob press: %s\n", lampOn ? "on" : "off");
      localChange();
    }
  }
}

uint32_t parseColor(const char* s) {
  if (!s) return color;
  if (s[0] == '#') s++;
  return (uint32_t)strtoul(s, nullptr, 16) & 0xFFFFFF;
}

void cloudTask(void* arg) {
  uint32_t seq = 0;
  const char* hdrs[] = {"Retry-After"};
  for (;;) {
    if (!PremakeWiFi.connected()) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }
    WiFiClientSecure client;
    client.setInsecure();
    HTTPClient http;
    http.setTimeout(30000);
    String url = String("https://premake.ai/api/d/commands?since=") + String(seq) + "&wait=25";
    if (!http.begin(client, url)) {
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }
    http.addHeader("Authorization", String("Device ") + String(PremakeWiFi.deviceKey()));
    http.collectHeaders(hdrs, 1);
    int code = http.GET();
    int waitMs = 0;
    if (code == 200) {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, http.getString());
      if (!err) {
        uint32_t ns = doc["seq"] | seq;
        if (ns != seq) {
          seq = ns;
          JsonObject set = doc["set"];
          if (!set["power"].isNull()) lampOn = set["power"].as<bool>();
          if (!set["brightness"].isNull()) brightness = constrain((int)set["brightness"].as<float>(), 0, 100);
          if (!set["color"].isNull()) color = parseColor(set["color"].as<const char*>());
          dirty = true;
          unsaved = true;
          lastChange = millis();
          Serial.printf("[lamp] app: seq %u, %s, %d%%, #%06X\n", (unsigned)seq, lampOn ? "on" : "off", brightness, (unsigned)color);
        }
      }
    } else if (code == 429) {
      int ra = http.header("Retry-After").toInt();
      waitMs = (ra > 0 ? ra : 5) * 1000;
    } else {
      Serial.printf("[lamp] commands error %d\n", code);
      waitMs = 5000;
    }
    http.end();
    if (waitMs) vTaskDelay(pdMS_TO_TICKS(waitMs));
  }
}

void setup() {
  PremakeWiFi.begin("Adjustable LED Desk Lamp", "1.0.0");
  pinMode(PIN_A, INPUT_PULLUP);
  pinMode(PIN_B, INPUT_PULLUP);
  pinMode(PIN_SW, INPUT_PULLUP);

  prefs.begin("lamp", false);
  brightness = prefs.getInt("bright", 60);
  color = prefs.getUInt("color", 0xFFC890);
  lampOn = prefs.getBool("on", true);

  ring.begin();
  showLamp();
  Serial.println("[lamp] ready");

  xTaskCreate(cloudTask, "cloud", 8192, nullptr, 1, nullptr);
}

void loop() {
  readKnob();
  if (dirty) {
    dirty = false;
    showLamp();
  }
  if (unsaved && millis() - lastChange > 3000) {
    unsaved = false;
    prefs.putInt("bright", brightness);
    prefs.putUInt("color", color);
    prefs.putBool("on", lampOn);
  }
  delay(1);
}
