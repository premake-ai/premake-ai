// Desk Tesla coil replica: lightning-flicker glow in the toroid.
// ESP32-C3 SuperMini + 24 x WS2812B ring. No high voltage anywhere.
#include <Adafruit_NeoPixel.h>

// ---- pin map ----
const int PIN_LEDS = 4;      // GPIO4 -> 330 ohm -> ring DIN (avoid strapping pins 2, 8, 9)
const int NUM_LEDS = 24;
const int MAX_BRIGHT = 90;   // cap: ~24 x 20 mA, safe on any USB port

Adafruit_NeoPixel ring(NUM_LEDS, PIN_LEDS, NEO_GRB + NEO_KHZ800);

// base colour: violet plasma
const uint8_t BR = 120, BG = 60, BB = 255;

void fillDim(uint8_t level) {
  for (int i = 0; i < NUM_LEDS; i++)
    ring.setPixelColor(i, ring.Color(BR * level / 255, BG * level / 255, BB * level / 255));
}

void strike() {
  // a bright white-violet arc that jumps around the ring for a few flashes
  int flashes = random(2, 6);
  int pos = random(NUM_LEDS);
  for (int f = 0; f < flashes; f++) {
    fillDim(20);
    int len = random(2, 6);
    for (int k = 0; k < len; k++) {
      int p = (pos + k) % NUM_LEDS;
      ring.setPixelColor(p, ring.Color(220, 200, 255));
    }
    ring.show();
    delay(random(15, 60));
    fillDim(5);
    ring.show();
    delay(random(20, 90));
    pos = (pos + random(-3, 4) + NUM_LEDS) % NUM_LEDS;
  }
}

void setup() {
  ring.begin();
  ring.setBrightness(MAX_BRIGHT);
  ring.clear();
  ring.show();
  randomSeed(esp_random());
}

void loop() {
  // slow corona breathing between strikes
  unsigned long until = millis() + random(400, 2500);
  while (millis() < until) {
    float t = millis() / 700.0;
    uint8_t level = 25 + 20 * (0.5 + 0.5 * sin(t));
    fillDim(level);
    ring.show();
    delay(20);
  }
  strike();
}
