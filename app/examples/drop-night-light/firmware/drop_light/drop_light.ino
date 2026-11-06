// Drop night light - ESP32-C3 SuperMini + 8 x WS2812B ring + flexure button
// Board: "ESP32C3 Dev Module", USB CDC On Boot: Enabled. Library: FastLED (3.6+).
// Short press: next mode. Long press (> 0.6 s): next brightness. Hold 3 s: off / on.
// Auto-dims to off after SLEEP_MIN minutes. Mode and brightness survive power cycles.
#include <FastLED.h>
#include <Preferences.h>

// ---- pin map ----
const int PIN_LED = 4;     // -> 330 ohm -> ring DIN
const int PIN_BTN = 3;     // -> tact switch -> GND (internal pull-up)
// avoid strapping pins 2, 8, 9 on the C3

const int NUM_LEDS = 8;
const int MAX_MA = 400;               // whole ring stays inside any USB port's budget
const uint8_t LEVELS[] = {12, 40, 90, 160};
const uint32_t SLEEP_MIN = 45;

CRGB leds[NUM_LEDS];
Preferences prefs;
uint8_t mode = 0, level = 1;
bool on = true;
uint32_t lastActivity = 0;

enum { WARM, CANDLE, DRIFT, NIGHT_RED, NUM_MODES };

void save() {
  prefs.putUChar("mode", mode);
  prefs.putUChar("level", level);
}

void setup() {
  pinMode(PIN_BTN, INPUT_PULLUP);
  FastLED.addLeds<WS2812B, PIN_LED, GRB>(leds, NUM_LEDS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, MAX_MA);
  prefs.begin("drop", false);
  mode = prefs.getUChar("mode", 0) % NUM_MODES;
  level = prefs.getUChar("level", 1) % sizeof(LEVELS);
  lastActivity = millis();
}

void handleButton() {
  static bool down = false;
  static uint32_t t0 = 0;
  static bool longDone = false, holdDone = false;
  bool pressed = digitalRead(PIN_BTN) == LOW;
  uint32_t now = millis();
  if (pressed && !down) { down = true; t0 = now; longDone = holdDone = false; }
  if (pressed && down) {
    if (!holdDone && now - t0 > 3000) { on = !on; holdDone = true; }
    else if (!longDone && now - t0 > 600) { level = (level + 1) % sizeof(LEVELS); longDone = true; save(); }
  }
  if (!pressed && down) {
    down = false;
    if (now - t0 > 30 && now - t0 < 600) { if (!on) on = true; else { mode = (mode + 1) % NUM_MODES; save(); } }
    lastActivity = now;
  }
}

void render() {
  uint32_t t = millis();
  switch (mode) {
    case WARM:
      fill_solid(leds, NUM_LEDS, CRGB(255, 120, 30));
      break;
    case CANDLE:
      for (int i = 0; i < NUM_LEDS; i++) {
        uint8_t f = 160 + (inoise8(i * 40, t / 4) >> 1) - 32;
        leds[i] = CRGB(255, 90, 12).nscale8(f);
      }
      break;
    case DRIFT:
      fill_rainbow(leds, NUM_LEDS, (t / 120) & 0xFF, 6);
      break;
    case NIGHT_RED:
      fill_solid(leds, NUM_LEDS, CRGB(120, 8, 0));
      break;
  }
  uint8_t b = on ? LEVELS[level] : 0;
  // fade out over the last minute before auto-off
  uint32_t idle = millis() - lastActivity, sleepMs = SLEEP_MIN * 60000UL;
  if (on && idle > sleepMs) on = false;
  else if (on && idle > sleepMs - 60000UL) b = (uint32_t)b * (sleepMs - idle) / 60000UL;
  FastLED.setBrightness(b);
  FastLED.show();
}

void loop() {
  handleButton();
  render();
  delay(16);
}
