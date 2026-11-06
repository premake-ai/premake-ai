// Board: ESP32 DevKit (ESP32-WROOM-32)
// Desk buddy: OLED eyes that blink and glance around while the SG90 pans the head to match. No Wi-Fi needed.
// Pin map (wiring.json): OLED SDA GPIO21, SCL GPIO22, VCC 3V3, GND. Servo signal GPIO13, V+ 5V, GND.
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>

const int PIN_SDA = 21, PIN_SCL = 22, PIN_SERVO = 13;
const int CENTER = 90, SWING = 35;          // head pan: 90 = straight ahead, +/- 35 degrees
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo neck;
bool haveOled = false;

int gazeX = 0, gazeY = 0;                    // eye offset in pixels (-12..12, -6..6)
int servoNow = CENTER;

void drawEyes(int openH) {                   // openH: eye height (24 = open, 2 = closed)
  if (!haveOled) return;
  oled.clearDisplay();
  const int w = 26, cy = 30 + gazeY;
  const int lx = 34 + gazeX, rx = 94 + gazeX;
  oled.fillRoundRect(lx - w / 2, cy - openH / 2, w, openH, openH > 8 ? 8 : 1, SSD1306_WHITE);
  oled.fillRoundRect(rx - w / 2, cy - openH / 2, w, openH, openH > 8 ? 8 : 1, SSD1306_WHITE);
  oled.display();
}

void blink() {
  for (int h = 24; h >= 2; h -= 6) { drawEyes(h); delay(12); }
  delay(60);
  for (int h = 2; h <= 24; h += 6) { drawEyes(h); delay(12); }
  drawEyes(24);
}

void turnHeadTo(int angle) {                 // ease the neck so it moves like a head, not a robot arm
  angle = constrain(angle, CENTER - SWING, CENTER + SWING);
  while (servoNow != angle) {
    servoNow += (angle > servoNow) ? 1 : -1;
    neck.write(servoNow);
    delay(12);
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(PIN_SDA, PIN_SCL);
  haveOled = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  Serial.println(haveOled ? "OLED ok" : "OLED not found: check SDA 21 / SCL 22 / 3V3");
  neck.setPeriodHertz(50);
  neck.attach(PIN_SERVO, 500, 2400);
  neck.write(CENTER);
  drawEyes(24);
  Serial.println("Desk buddy ready");
}

void loop() {
  // pick somewhere to look: eyes lead, the head follows
  int look = random(-1, 2);                  // -1 left, 0 ahead, 1 right
  gazeX = look * 12; gazeY = random(-4, 5);
  drawEyes(24);
  delay(250);
  turnHeadTo(CENTER + look * random(15, SWING + 1));
  gazeX = look * 5; drawEyes(24);            // eyes settle as the head arrives
  unsigned long hold = millis() + random(1500, 4000);
  while (millis() < hold) {
    if (random(0, 100) < 3) blink();
    delay(40);
  }
}
