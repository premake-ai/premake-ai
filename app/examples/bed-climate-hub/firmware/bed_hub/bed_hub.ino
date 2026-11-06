// Bed Climate Hub - ESP32 (DevKitC). Libraries: OneWire, DallasTemperature,
// Adafruit_SSD1306, Adafruit_GFX, WiFi, WebServer, Preferences.
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Adafruit_SSD1306.h>

// ---- pin map ----
const int PIN_COOL = 25, PIN_HEAT = 26;   // BTS7960 RPWM / LPWM
const int PIN_PUMP = 27, PIN_FAN = 14;    // MOSFET modules
const int PIN_TEMP = 4;                   // DS18B20 bus (water = index 0, bed = index 1)
const int PIN_ENC_A = 32, PIN_ENC_B = 33, PIN_ENC_SW = 13;

const char *WIFI_SSID = "your-ssid", *WIFI_PASS = "your-pass";
const float MIN_SET = 13, MAX_SET = 40, WATER_MIN = 12, WATER_MAX = 42;

OneWire ow(PIN_TEMP);
DallasTemperature temps(&ow);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
WebServer server(80);
Preferences prefs;

float setpoint = 27, water = 25, bed = 25;
bool on = false;
int drive = 0;   // -255 (cool) .. +255 (heat)
float integ = 0;

void applyOutputs() {
  bool run = on && water > WATER_MIN && water < WATER_MAX;
  if (!run) drive = 0;
  analogWrite(PIN_COOL, drive < 0 ? -drive : 0);
  analogWrite(PIN_HEAT, drive > 0 ? drive : 0);
  digitalWrite(PIN_PUMP, on);
  digitalWrite(PIN_FAN, on);
}

void control() {   // PI loop on water temperature, 1 Hz
  float err = setpoint - water;
  integ = constrain(integ + err, -60, 60);
  drive = constrain((int)(err * 60 + integ * 3), -255, 255);
}

void draw() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1); oled.setCursor(0, 0);
  oled.print(on ? (drive < 0 ? "COOLING" : drive > 0 ? "HEATING" : "HOLD") : "OFF");
  oled.setTextSize(3); oled.setCursor(0, 18); oled.printf("%.0fC", setpoint);
  oled.setTextSize(1); oled.setCursor(0, 54); oled.printf("water %.1f  bed %.1f", water, bed);
  oled.display();
}

void handleRoot() {
  if (server.hasArg("set")) setpoint = constrain(server.arg("set").toFloat(), MIN_SET, MAX_SET);
  if (server.hasArg("on")) on = server.arg("on") == "1";
  prefs.putFloat("set", setpoint);
  String s = "<html><body style='font-family:sans-serif'><h2>Bed Climate Hub</h2>";
  s += "<p>Water " + String(water, 1) + " C, bed " + String(bed, 1) + " C, " + (on ? "ON" : "OFF") + "</p>";
  s += "<form>Set <input name=set type=number value=" + String(setpoint, 0) + "> C ";
  s += "<button name=on value=1>On</button> <button name=on value=0>Off</button></form></body></html>";
  server.send(200, "text/html", s);
}

void setup() {
  pinMode(PIN_PUMP, OUTPUT); pinMode(PIN_FAN, OUTPUT);
  pinMode(PIN_COOL, OUTPUT); pinMode(PIN_HEAT, OUTPUT);
  pinMode(PIN_ENC_A, INPUT_PULLUP); pinMode(PIN_ENC_B, INPUT_PULLUP); pinMode(PIN_ENC_SW, INPUT_PULLUP);
  prefs.begin("hub");
  setpoint = prefs.getFloat("set", 27);
  temps.begin();
  oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  server.on("/", handleRoot);
  server.begin();
}

void loop() {
  static int lastA = HIGH, lastSw = HIGH;
  static unsigned long tick = 0;
  int a = digitalRead(PIN_ENC_A);
  if (a != lastA && a == LOW) setpoint = constrain(setpoint + (digitalRead(PIN_ENC_B) ? 0.5 : -0.5), MIN_SET, MAX_SET);
  lastA = a;
  int sw = digitalRead(PIN_ENC_SW);
  if (sw == LOW && lastSw == HIGH) { on = !on; integ = 0; delay(30); }
  lastSw = sw;
  server.handleClient();

  if (millis() - tick > 1000) {
    tick = millis();
    temps.requestTemperatures();
    float w = temps.getTempCByIndex(0), b = temps.getTempCByIndex(1);
    if (w > -50) water = w; else on = false;   // sensor missing -> safe off
    if (b > -50) bed = b;
    control();
    applyOutputs();
    draw();
  }
}
