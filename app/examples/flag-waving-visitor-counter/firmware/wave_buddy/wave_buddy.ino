// Wave Buddy: waves the flag for every new visit / design on premake.ai
// and shows today's count on the OLED.
// Board: ELEGOO ESP32 DevKit (ESP-WROOM-32), Arduino board "ESP32 Dev Module"
// Libraries: ESP32Servo, Adafruit SSD1306, Adafruit GFX

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>

// ---- pin map (matches wiring.json) ----
const int PIN_SERVO = 18;   // GPIO18
const int PIN_SDA   = 21;   // GPIO21 (default I2C)
const int PIN_SCL   = 22;   // GPIO22

// ---- settings ----
const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
// Must return JSON with today's totals, e.g. {"visits":123,"designs":45}
const char* COUNT_URL = "https://premake.ai/api/today";
const unsigned long POLL_MS = 15000;

const int CENTER = 90, SWING = 35;   // flag upright, +-35 deg wave
const int MAX_WAVES = 5;             // cap a burst of new events

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo flag;
long visits = -1, designs = -1;
unsigned long lastPoll = 0;

long jsonInt(const String& s, const char* key) {
  int i = s.indexOf(String("\"") + key + "\"");
  if (i < 0) return -1;
  i = s.indexOf(':', i);
  if (i < 0) return -1;
  return s.substring(i + 1).toInt();
}

void show(const char* status) {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.print("TODAY");
  oled.setCursor(128 - 6 * strlen(status), 0);
  oled.print(status);
  oled.setTextSize(3);
  oled.setCursor(0, 16);
  oled.print(visits < 0 ? 0 : visits);
  oled.setTextSize(1);
  oled.setCursor(0, 46);
  oled.print("visits");
  oled.setCursor(0, 56);
  oled.print("designs: ");
  oled.print(designs < 0 ? 0 : designs);
  oled.display();
}

void wave(int times) {
  for (int n = 0; n < times; n++) {
    flag.write(CENTER + SWING); delay(280);
    flag.write(CENTER - SWING); delay(280);
  }
  flag.write(CENTER);
  delay(300);
}

bool poll() {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();               // fine for a public counter
  HTTPClient http;
  if (!http.begin(client, COUNT_URL)) return false;
  int code = http.GET();
  if (code != 200) { http.end(); return false; }
  String body = http.getString();
  http.end();

  long v = jsonInt(body, "visits"), d = jsonInt(body, "designs");
  if (v < 0 || d < 0) return false;
  long fresh = 0;
  if (visits >= 0 && v >= visits) fresh += v - visits;   // a drop = new day, no wave
  if (designs >= 0 && d >= designs) fresh += d - designs;
  visits = v; designs = d;
  show("ok");
  if (fresh > 0) wave(min<long>(fresh, MAX_WAVES));
  return true;
}

void setup() {
  Wire.begin(PIN_SDA, PIN_SCL);
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  flag.setPeriodHertz(50);
  flag.attach(PIN_SERVO, 500, 2400);
  flag.write(CENTER);
  show("wifi..");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  wave(1);                             // hello
}

void loop() {
  if (millis() - lastPoll >= POLL_MS || lastPoll == 0) {
    lastPoll = millis();
    if (!poll()) show(WiFi.status() == WL_CONNECTED ? "err" : "no wifi");
  }
  delay(50);
}
