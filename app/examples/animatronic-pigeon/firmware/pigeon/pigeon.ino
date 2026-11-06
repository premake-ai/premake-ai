// Animatronic pigeon: ESP32-C3 SuperMini, 4 x SG90, DFPlayer Mini, AM312 PIR.
// Libraries: ESP32Servo, DFRobotDFPlayerMini.
#include <ESP32Servo.h>
#include <DFRobotDFPlayerMini.h>

const int PIN_PAN = 3, PIN_TILT = 4, PIN_WING_L = 5, PIN_WING_R = 6;
const int PIN_PIR = 1, PIN_DF_RX = 20, PIN_DF_TX = 21;

Servo pan, tilt, wingL, wingR;
DFRobotDFPlayerMini player;
HardwareSerial dfSerial(1);

// Neutral positions (trim after assembly) and wing direction (mirrored).
int PAN0 = 90, TILT0 = 90, WL0 = 10, WR0 = 170;

void ease(Servo &s, int from, int to, int ms) {
  for (int i = 0; i <= 20; i++) {
    float t = i / 20.0, e = t * t * (3 - 2 * t);
    s.write(from + (to - from) * e);
    delay(ms / 20);
  }
}

void wings(int up) {  // up 0..95 deg
  wingL.write(WL0 + up);
  wingR.write(WR0 - up);
}

void flap(int times) {
  for (int i = 0; i < times; i++) {
    for (int a = 0; a <= 90; a += 10) { wings(a); delay(12); }
    for (int a = 90; a >= 0; a -= 10) { wings(a); delay(12); }
  }
}

void headBob(int n) {  // quick pigeon pecking nods
  for (int i = 0; i < n; i++) { tilt.write(TILT0 + 15); delay(110); tilt.write(TILT0 - 5); delay(110); }
  tilt.write(TILT0);
}

void look(int deg) {   // -60..60
  pan.write(PAN0 + deg);
  delay(250 + random(400));
}

void coo() { player.play(random(1, 4)); }

void setup() {
  pinMode(PIN_PIR, INPUT);
  pan.attach(PIN_PAN); tilt.attach(PIN_TILT);
  wingL.attach(PIN_WING_L); wingR.attach(PIN_WING_R);
  pan.write(PAN0); tilt.write(TILT0); wings(0);
  dfSerial.begin(9600, SERIAL_8N1, PIN_DF_RX, PIN_DF_TX);
  if (player.begin(dfSerial)) player.volume(20);
  randomSeed(esp_random());
}

unsigned long lastAct = 0;

void loop() {
  bool someone = digitalRead(PIN_PIR);
  if (someone) {                     // startled: look, coo, flap
    look(random(-50, 51)); coo(); headBob(3); flap(3); look(0);
    delay(1500);
  } else if (millis() - lastAct > 4000 + random(6000)) {  // idle life
    lastAct = millis();
    switch (random(4)) {
      case 0: look(random(-60, 61)); look(random(-30, 31)); look(0); break;
      case 1: headBob(4); break;
      case 2: coo(); headBob(2); break;
      case 3: flap(1); break;
    }
  }
  delay(20);
}
