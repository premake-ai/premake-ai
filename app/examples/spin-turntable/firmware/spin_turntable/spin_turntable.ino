// Spin turntable - ESP32 DevKit V1 + TMC2209 (step/dir) + NEMA17.
// Knob = speed. Short press = start/stop continuous spin. Long press (1 s) = photo mode:
// 24 stops of 15 degrees, 1.5 s pause each, then stop.
// Board: "ESP32 Dev Module". Library: AccelStepper.
#include <AccelStepper.h>

// ---- pin map (see wiring.md) ----
const int PIN_STEP = 26;
const int PIN_DIR = 27;
const int PIN_EN = 25;      // LOW = driver enabled
const int PIN_BTN = 32;     // 16 mm button to GND
const int PIN_POT = 34;     // speed pot wiper (input-only ADC pin)

const long STEPS_REV = 200L * 16;   // 1.8 deg motor, TMC2209 at 16 microsteps (MS1/MS2 default)
const float MAX_SPS = STEPS_REV / 6.0;   // fastest: 1 rev per 6 s
const float MIN_SPS = STEPS_REV / 120.0; // slowest: 1 rev per 2 min
const int PHOTO_STOPS = 24;
const unsigned long PHOTO_PAUSE_MS = 1500;

AccelStepper stepper(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);
enum Mode { IDLE, SPIN, PHOTO } mode = IDLE;
int photoLeft = 0;
unsigned long pauseUntil = 0;

void setMode(Mode m) {
  mode = m;
  digitalWrite(PIN_EN, m == IDLE ? HIGH : LOW);   // release the motor when idle (cool, quiet)
  if (m == PHOTO) { photoLeft = PHOTO_STOPS; pauseUntil = millis() + 500; stepper.setCurrentPosition(0); }
}

float potSpeed() {
  float k = analogRead(PIN_POT) / 4095.0;
  return MIN_SPS + k * (MAX_SPS - MIN_SPS);
}

void setup() {
  pinMode(PIN_EN, OUTPUT);
  pinMode(PIN_BTN, INPUT_PULLUP);
  stepper.setMaxSpeed(MAX_SPS);
  stepper.setAcceleration(MAX_SPS / 2);
  setMode(IDLE);
}

void handleButton() {
  static unsigned long downAt = 0;
  static bool wasDown = false, longDone = false;
  bool down = digitalRead(PIN_BTN) == LOW;
  unsigned long now = millis();
  if (down && !wasDown) { downAt = now; longDone = false; }
  if (down && !longDone && now - downAt > 1000) { setMode(PHOTO); longDone = true; }
  if (!down && wasDown && !longDone && now - downAt > 40) setMode(mode == IDLE ? SPIN : IDLE);
  wasDown = down;
}

void loop() {
  handleButton();
  if (mode == SPIN) {
    stepper.setSpeed(potSpeed());
    stepper.runSpeed();
  } else if (mode == PHOTO) {
    if (stepper.distanceToGo() == 0 && millis() > pauseUntil) {
      if (photoLeft-- <= 0) { setMode(IDLE); return; }
      stepper.setMaxSpeed(potSpeed());
      stepper.move(STEPS_REV / PHOTO_STOPS);
      pauseUntil = 0;
    }
    if (stepper.distanceToGo() == 0 && pauseUntil == 0) pauseUntil = millis() + PHOTO_PAUSE_MS;
    stepper.run();
  }
}
