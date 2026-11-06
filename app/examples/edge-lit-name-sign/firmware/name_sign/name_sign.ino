// Edge-lit name sign - ESP32-C3 SuperMini + 12 x WS2812B
// Slow rainbow fade. Brightness capped to keep USB current under ~0.6 A.
#include <FastLED.h>

#define LED_PIN     10   // GPIO10 (avoid strapping pins 2, 8, 9)
#define NUM_LEDS    12
#define BRIGHTNESS  90   // of 255

CRGB leds[NUM_LEDS];
uint8_t hue = 0;

void setup() {
  FastLED.addLeds<WS2812B, LED_PIN, GRB>(leds, NUM_LEDS);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 600);
}

void loop() {
  fill_rainbow(leds, NUM_LEDS, hue, 255 / NUM_LEDS);
  FastLED.show();
  hue++;
  delay(40);
}
