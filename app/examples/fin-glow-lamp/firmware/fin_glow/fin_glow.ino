// Fin glow lamp - ESP32-C3 SuperMini + 12 x WS2812B + EC11 encoder.
// Turn = brightness, push = next mode (warm, cool, sunset, rainbow, breathe). Settings survive power-off.
// Board: "ESP32C3 Dev Module", USB CDC On Boot: Enabled. Library: FastLED (3.6+).
#include <FastLED.h>
#include <Preferences.h>

// ---- pin map (see wiring.md) ----
const int PIN_LED = 4;     // WS2812B DIN via 330 ohm
const int PIN_ENC_A = 5;   // encoder A (CLK)
const int PIN_ENC_B = 6;   // encoder B (DT)
const int PIN_ENC_SW = 7;  // encoder push, to GND
const int NUM_LEDS = 12;
const int MAX_MA = 500;    // USB power budget for the strip

CRGB leds[NUM_LEDS];
Preferences prefs;
uint8_t brightness = 120, mode = 0;
const uint8_t MODES = 5;
volatile int encSteps = 0;
uint8_t lastAB = 0;

void IRAM_ATTR onEnc() {
  static const int8_t table[16] = {0, -1, 1, 0, 1, 0, 0, -1, -1, 0, 0, 1, 0, 1, -1, 0};
  uint8_t ab = (digitalRead(PIN_ENC_A) << 1) | digitalRead(PIN_ENC_B);
  encSteps += table[(lastAB << 2) | ab];
  lastAB = ab;
}

void save() {
  prefs.putUChar("b", brightness);
  prefs.putUChar("m", mode);
}

void setup() {
  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_ENC_SW, INPUT_PULLUP);
  attachInterrupt(PIN_ENC_A, onEnc, CHANGE);
  attachInterrupt(PIN_ENC_B, onEnc, CHANGE);
  prefs.begin("fin", false);
  brightness = prefs.getUChar("b", 120);
  mode = prefs.getUChar("m", 0) % MODES;
  FastLED.addLeds<WS2812B, PIN_LED, GRB>(leds, NUM_LEDS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, MAX_MA);
}

void render(uint32_t t) {
  switch (mode) {
    case 0: fill_solid(leds, NUM_LEDS, CRGB(255, 147, 41)); break;           // warm white
    case 1: fill_solid(leds, NUM_LEDS, CRGB(201, 226, 255)); break;          // cool white
    case 2: fill_gradient_RGB(leds, NUM_LEDS, CRGB(255, 60, 0), CRGB(160, 0, 90)); break;  // sunset
    case 3: fill_rainbow(leds, NUM_LEDS, t / 40, 255 / NUM_LEDS); break;     // slow rainbow
    case 4: fill_solid(leds, NUM_LEDS, CHSV(24, 200, beatsin8(8, 40, 255))); break;  // breathe
  }
}

void loop() {
  static uint32_t lastPress = 0, lastChange = 0;
  static bool dirty = false;
  int steps;
  noInterrupts(); steps = encSteps / 4; encSteps -= steps * 4; interrupts();
  if (steps) {
    brightness = constrain(brightness + steps * 8, 4, 255);
    dirty = true; lastChange = millis();
  }
  if (digitalRead(PIN_ENC_SW) == LOW && millis() - lastPress > 300) {
    mode = (mode + 1) % MODES;
    lastPress = millis(); dirty = true; lastChange = millis();
  }
  if (dirty && millis() - lastChange > 2000) { save(); dirty = false; }  // spare the flash
  render(millis());
  FastLED.setBrightness(brightness);
  FastLED.show();
  delay(10);
}
