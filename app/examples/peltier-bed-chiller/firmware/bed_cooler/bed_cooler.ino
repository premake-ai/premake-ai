// Bed cooler: ESP32-C3 SuperMini. Holds the water at a setpoint with 2 Peltiers.
// Libraries: OneWire, DallasTemperature, Preferences.
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>

const int PIN_TEC1 = 3, PIN_TEC2 = 4, PIN_PUMP = 5, PIN_TEMP = 6;
const int PIN_ENC_A = 0, PIN_ENC_B = 1, PIN_ENC_SW = 7, PIN_LED = 10;

const float SET_MIN = 14.0, SET_MAX = 30.0;   // C, below ~14 condensation gets bad
const float SINK_MAX = 60.0;                  // hot-side cutoff
const int PWM_MAX = 230;                       // ~90 % cap

OneWire ow(PIN_TEMP);
DallasTemperature temps(&ow);
Preferences prefs;
float setpoint = 20.0;
bool running = false;
int lastA;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_ENC_A, INPUT_PULLUP);
  pinMode(PIN_ENC_B, INPUT_PULLUP);
  pinMode(PIN_ENC_SW, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  ledcAttach(PIN_TEC1, 1000, 8);
  ledcAttach(PIN_TEC2, 1000, 8);
  ledcAttach(PIN_PUMP, 1000, 8);
  temps.begin();
  temps.setWaitForConversion(false);
  prefs.begin("cooler");
  setpoint = prefs.getFloat("set", 20.0);
  lastA = digitalRead(PIN_ENC_A);
}

void allOff() {
  ledcWrite(PIN_TEC1, 0);
  ledcWrite(PIN_TEC2, 0);
  ledcWrite(PIN_PUMP, 0);
}

void loop() {
  // encoder: turn = setpoint, press = on/off
  int a = digitalRead(PIN_ENC_A);
  if (a != lastA && a == LOW) {
    setpoint += digitalRead(PIN_ENC_B) ? 0.5 : -0.5;
    setpoint = constrain(setpoint, SET_MIN, SET_MAX);
    prefs.putFloat("set", setpoint);
  }
  lastA = a;
  static unsigned long lastPress = 0;
  if (digitalRead(PIN_ENC_SW) == LOW && millis() - lastPress > 400) {
    running = !running;
    lastPress = millis();
  }

  static unsigned long lastCtl = 0;
  if (millis() - lastCtl < 1000) return;
  lastCtl = millis();

  float water = temps.getTempCByIndex(0);
  float sink = temps.getTempCByIndex(1);
  temps.requestTemperatures();

  bool fault = water == DEVICE_DISCONNECTED_C || sink == DEVICE_DISCONNECTED_C || sink > SINK_MAX;
  if (!running || fault) {
    allOff();
    digitalWrite(PIN_LED, fault ? (millis() / 250) % 2 : LOW);  // blink on fault
    return;
  }

  // proportional control: full power 2 C above setpoint, off at setpoint
  float err = water - setpoint;
  int duty = constrain((int)(err / 2.0 * PWM_MAX), 0, PWM_MAX);
  ledcWrite(PIN_PUMP, 255);   // pump + fans always on while running
  ledcWrite(PIN_TEC1, duty);
  ledcWrite(PIN_TEC2, duty);
  digitalWrite(PIN_LED, HIGH);
  Serial.printf("set %.1f water %.1f sink %.1f duty %d\n", setpoint, water, sink, duty);
}
