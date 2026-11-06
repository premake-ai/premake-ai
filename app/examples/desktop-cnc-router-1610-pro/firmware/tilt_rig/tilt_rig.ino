// Board: ESP32 DevKit (ESP32-WROOM-32)
// Spindle tilt rig for the 1610 PRO: two NEMA17s on a saddle over the Z motor wind cords that pull a shuttle on
// a lever rod clamped to the spindle (X motor pulls +X, Y motor pulls +Y); extension springs pull back -X / -Y.
// Zero with the springs at their preload; positive mm pulls past it, negative mm lets the spring win.
//
// Pin map (matches wiring.json):
//   GPIO25 -> X pull driver STEP     GPIO26 -> X pull driver DIR
//   GPIO27 -> Y pull driver STEP     GPIO14 -> Y pull driver DIR
//   GPIO13 -> EN on both TMC2209 (LOW = motors powered)
//   TMC2209 MS1/MS2 left open = 1/8 microstep (1600 steps/rev)
//
// controls: pull_x (range -10-20 mm), pull_y (range -10-20 mm), motors (toggle), zero (button)
//
// USB serial (115200), one command per line, for a PC-side vision loop:
//   X <mm>    set X cord pull       Y <mm>    set Y cord pull
//   Z         zero both here (do it with the cords just slack)
//   E 1 / E 0 motors on / off       ?         print status

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <AccelStepper.h>
#include "premake_wifi.h"

static const int PIN_X_STEP = 25;
static const int PIN_X_DIR = 26;
static const int PIN_Y_STEP = 27;
static const int PIN_Y_DIR = 14;
static const int PIN_EN = 13;

static const float SPOOL_DIA_MM = 16.0f;                 // spool core
static const float STEPS_PER_REV = 200.0f * 8.0f;        // 1/8 microstep
static const float STEPS_PER_MM = STEPS_PER_REV / (PI * SPOOL_DIA_MM);   // ~31.8
static const float PULL_MIN_MM = -10.0f;                 // spring side wins (preload ~10 N at 0.5 N/mm)
static const float PULL_MAX_MM = 20.0f;                  // cord side wins; stay inside the spring's stretch

AccelStepper stepX(AccelStepper::DRIVER, PIN_X_STEP, PIN_X_DIR);
AccelStepper stepY(AccelStepper::DRIVER, PIN_Y_STEP, PIN_Y_DIR);

volatile float targetX = 0.0f;
volatile float targetY = 0.0f;
volatile bool motorsOn = true;
volatile bool zeroRequest = false;

float clampPull(float v, float lo) {
  if (isnan(v)) return 0.0f;
  if (v < lo) return lo;
  if (v > PULL_MAX_MM) return PULL_MAX_MM;
  return v;
}

void setMotors(bool on) {
  motorsOn = on;
  digitalWrite(PIN_EN, on ? LOW : HIGH);
}

void printStatus() {
  Serial.printf("[tilt] x=%.2f mm (target %.2f)  y=%.2f mm (target %.2f)  motors=%s\n",
                stepX.currentPosition() / STEPS_PER_MM, (float)targetX,
                stepY.currentPosition() / STEPS_PER_MM, (float)targetY, motorsOn ? "on" : "off");
}

// ------------------------------------------------------------------ serial commands
String lineBuf;

void handleLine(String s) {
  s.trim();
  if (s.length() == 0) return;
  char c = toupper(s.charAt(0));
  float v = s.length() > 1 ? s.substring(1).toFloat() : 0.0f;
  if (c == 'X') {
    targetX = clampPull(v, PULL_MIN_MM);
  } else if (c == 'Y') {
    targetY = clampPull(v, PULL_MIN_MM);
  } else if (c == 'Z') {
    zeroRequest = true;
  } else if (c == 'E') {
    setMotors(v > 0.5f);
  } else if (c != '?') {
    Serial.println("[tilt] commands: X <mm>, Y <mm>, Z, E 1|0, ?");
    return;
  }
  printStatus();
}

void readSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (lineBuf.length()) handleLine(lineBuf);
      lineBuf = "";
    } else if (lineBuf.length() < 40) {
      lineBuf += ch;
    }
  }
}

// ------------------------------------------------------------------ Premake commands + readings (own task)
void postReadings(uint32_t &intervalMs) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(15000);
  if (!http.begin(client, "https://premake.ai/api/d/ingest")) return;
  http.addHeader("Authorization", String("Device ") + String(PremakeWiFi.deviceKey()));
  http.addHeader("Content-Type", "application/json");
  JsonDocument doc;
  doc["r"]["pull_x_mm"] = stepX.currentPosition() / STEPS_PER_MM;
  doc["r"]["pull_y_mm"] = stepY.currentPosition() / STEPS_PER_MM;
  doc["fw"] = "1.0.0";
  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  if (code == 200) {
    JsonDocument rep;
    if (!deserializeJson(rep, http.getString())) {
      uint32_t iv = rep["interval"] | 0;
      if (iv > 0) intervalMs = (iv < 1000 ? iv * 1000UL : iv);
      if (intervalMs < 20000) intervalMs = 20000;
    }
  }
  http.end();
}

void netTask(void *) {
  uint32_t seq = 0;
  long lastZero = -1;                 // button counter: ignore its first value after boot
  bool haveZero = false;
  uint32_t lastPost = 0;
  uint32_t postInterval = 20000;
  const char *hdrs[] = {"Retry-After"};

  for (;;) {
    if (!PremakeWiFi.connected()) {
      vTaskDelay(pdMS_TO_TICKS(2000));
      continue;
    }
    if (millis() - lastPost > postInterval) {
      lastPost = millis();
      postReadings(postInterval);
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
    if (code == 200) {
      JsonDocument doc;
      if (!deserializeJson(doc, http.getString())) {
        uint32_t s = doc["seq"] | seq;
        if (s != seq) {
          seq = s;
          JsonObject set = doc["set"];
          if (!set["pull_x"].isNull()) targetX = clampPull(set["pull_x"].as<float>(), PULL_MIN_MM);
          if (!set["pull_y"].isNull()) targetY = clampPull(set["pull_y"].as<float>(), PULL_MIN_MM);
          if (!set["motors"].isNull()) setMotors(set["motors"].as<bool>());
          if (!set["zero"].isNull()) {
            long z = set["zero"].as<long>();
            if (haveZero && z != lastZero) zeroRequest = true;
            lastZero = z;
            haveZero = true;
          }
          Serial.printf("[tilt] app seq %u\n", (unsigned)seq);
        }
      }
      http.end();
    } else if (code == 429) {
      int wait = http.header("Retry-After").toInt();
      http.end();
      vTaskDelay(pdMS_TO_TICKS((wait > 0 ? wait : 5) * 1000));
    } else {
      http.end();
      vTaskDelay(pdMS_TO_TICKS(5000));
    }
  }
}

// ------------------------------------------------------------------ setup / loop
void setup() {
  PremakeWiFi.begin("Spindle Tilt Rig", "1.0.0");
  pinMode(PIN_EN, OUTPUT);
  setMotors(true);

  stepX.setMaxSpeed(25.0f * STEPS_PER_MM);       // 25 mm/s cord speed
  stepX.setAcceleration(60.0f * STEPS_PER_MM);
  stepY.setMaxSpeed(25.0f * STEPS_PER_MM);
  stepY.setAcceleration(60.0f * STEPS_PER_MM);

  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);
  Serial.println("[tilt] ready: slacken both cords by hand, then send Z to zero");
  printStatus();
}

void loop() {
  readSerial();
  if (zeroRequest) {
    zeroRequest = false;
    stepX.setCurrentPosition(0);
    stepY.setCurrentPosition(0);
    targetX = 0.0f;
    targetY = 0.0f;
    Serial.println("[tilt] zeroed");
  }
  stepX.moveTo(lroundf(targetX * STEPS_PER_MM));
  stepY.moveTo(lroundf(targetY * STEPS_PER_MM));
  if (motorsOn) {
    stepX.run();
    stepY.run();
  }
}
