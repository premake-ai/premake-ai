// Board: ESP32 DevKit (ESP32-WROOM-32)
// Desk CNC Mill - small Grbl-style G-code controller over USB serial (115200 baud).
// Works with simple senders (Universal Gcode Sender, CNCjs, Candle) that speak Grbl's
// "ok" / "error:N" / "?" status protocol.
//
// Pin map (matches wiring.json):
//   GPIO25 X STEP   GPIO26 X DIR     (TMC2209 X)
//   GPIO27 Y STEP   GPIO14 Y DIR     (TMC2209 Y)
//   GPIO32 Z STEP   GPIO33 Z DIR     (TMC2209 Z)
//   GPIO13 EN (all three drivers, LOW = enabled)
//   GPIO4  spindle PWM -> D4184 MOSFET module
//   GPIO19 touch probe plate (INPUT_PULLUP, clip on the bit = GND)
// TMC2209 in standalone mode, MS1/MS2 open = 1/8 microstep.
// T8 lead screws, 8 mm lead: 200 full steps * 8 / 8 mm = 200 steps/mm.
//
// No limit switches: before power-on (or after a reset with Ctrl-X) jog the machine
// to X front-left, Y front, Z fully up. That point is machine zero; soft limits keep
// every move inside X 0..200, Y 0..200, Z -200..0. Set work zero with G92 X0 Y0, and
// G38.2 Z-50 F60 with the touch plate for Z (then G92 Z<plate thickness>).
//
// Supported: G0 G1 G4 G17 G21 G28 G38.2 G53 G54 G90 G91 G92 G94, M0 M2 M3 M4 M5 M17 M18 M30 M84,
//            F S P X Y Z, $$ $X $G $I $J= (jog), realtime ? ! ~ Ctrl-X.

#include <AccelStepper.h>
#include <MultiStepper.h>
#include "premake_wifi.h"

#define X_STEP 25
#define X_DIR 26
#define Y_STEP 27
#define Y_DIR 14
#define Z_STEP 32
#define Z_DIR 33
#define EN_PIN 13
#define SPINDLE_PIN 4
#define PROBE_PIN 19

const float STEPS_PER_MM = 200.0;
const float MAX_FEED[3] = {1500.0, 1500.0, 600.0};  // mm/min per axis
const float LIM_MIN[3] = {0.0, 0.0, -200.0};
const float LIM_MAX[3] = {200.0, 200.0, 0.0};
const bool INVERT_DIR[3] = {false, true, false};    // Y: the bed moves, so the tool moves the other way
const int SPINDLE_MAX_S = 1000;

AccelStepper sx(AccelStepper::DRIVER, X_STEP, X_DIR);
AccelStepper sy(AccelStepper::DRIVER, Y_STEP, Y_DIR);
AccelStepper sz(AccelStepper::DRIVER, Z_STEP, Z_DIR);
AccelStepper *axes[3] = {&sx, &sy, &sz};
MultiStepper group;

float wco[3] = {0.0, 0.0, 0.0};  // work offset: machine = work + wco
bool absMode = true;
int motionMode = 0;
float feed = 300.0;
float spindleS = SPINDLE_MAX_S;
bool spindleOn = false;
volatile bool hold = false;
bool moving = false;
bool resetRequested = false;
String line;

float mpos(int i) {
  return axes[i]->currentPosition() / STEPS_PER_MM;
}

void setSpindle(bool on, float s) {
  spindleOn = on;
  spindleS = s;
  int duty = 0;
  if (on) {
    float f = s / (float)SPINDLE_MAX_S;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    duty = (int)(f * 255.0);
  }
  ledcWrite(SPINDLE_PIN, duty);
}

void stopAll() {
  for (int i = 0; i < 3; i++) {
    axes[i]->setCurrentPosition(axes[i]->currentPosition());
  }
}

void printWelcome() {
  Serial.println();
  Serial.println("Grbl 1.1h ['$' for help]");
  Serial.println("[MSG:Desk CNC Mill - no homing, power-on position is machine zero]");
}

void reportStatus() {
  const char *state = hold ? "Hold" : (moving ? "Run" : "Idle");
  Serial.printf("<%s|MPos:%.3f,%.3f,%.3f|WCO:%.3f,%.3f,%.3f|FS:%d,%d>\n", state,
                mpos(0), mpos(1), mpos(2), wco[0], wco[1], wco[2],
                (int)feed, spindleOn ? (int)spindleS : 0);
}

// Handle a realtime character if one is waiting. Returns true if it was consumed.
bool pollRealtime() {
  if (!Serial.available()) return false;
  int c = Serial.peek();
  if (c == '?') { Serial.read(); reportStatus(); return true; }
  if (c == '!') { Serial.read(); hold = true; return true; }
  if (c == '~') { Serial.read(); hold = false; return true; }
  if (c == 0x18) { Serial.read(); resetRequested = true; return true; }
  return false;
}

// Straight move to a machine-coordinate target. 0 = done, 1 = probe touched, -1 = outside soft limits,
// -2 = reset requested.
int moveMachine(const float tgt[3], float feedMmMin, bool probe) {
  for (int i = 0; i < 3; i++) {
    if (tgt[i] < LIM_MIN[i] - 0.001 || tgt[i] > LIM_MAX[i] + 0.001) return -1;
  }
  float d[3];
  float dist2 = 0;
  long steps[3];
  for (int i = 0; i < 3; i++) {
    steps[i] = lround(tgt[i] * STEPS_PER_MM);
    d[i] = fabs(tgt[i] - mpos(i));
    dist2 += d[i] * d[i];
  }
  float dist = sqrt(dist2);
  if (dist < 0.001) return 0;
  float f = feedMmMin;
  if (f < 1) f = 1;
  for (int i = 0; i < 3; i++) {
    if (d[i] > 0) {
      float axisF = f * d[i] / dist;
      if (axisF > MAX_FEED[i]) f = MAX_FEED[i] * dist / d[i];
    }
  }
  float t = dist / (f / 60.0);  // seconds
  for (int i = 0; i < 3; i++) {
    float ds = fabs((float)(steps[i] - axes[i]->currentPosition()));
    float sp = ds / t;
    if (sp < 1) sp = 1;
    axes[i]->setMaxSpeed(sp);
  }
  group.moveTo(steps);
  moving = true;
  int result = 0;
  while (group.run()) {
    if (probe && digitalRead(PROBE_PIN) == LOW) {
      stopAll();
      result = 1;
      break;
    }
    pollRealtime();
    while (hold && !resetRequested) {
      pollRealtime();
      delay(1);
    }
    if (resetRequested) {
      stopAll();
      result = -2;
      break;
    }
  }
  moving = false;
  return result;
}

void softReset() {
  stopAll();
  setSpindle(false, spindleS);
  hold = false;
  resetRequested = false;
  absMode = true;
  motionMode = 0;
  line = "";
  printWelcome();
}

void stripComments(String &s) {
  String out = "";
  bool inParen = false;
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == ';') break;
    if (c == '(') { inParen = true; continue; }
    if (c == ')') { inParen = false; continue; }
    if (inParen) continue;
    if (c == ' ' || c == '\t') continue;
    out += (char)toupper(c);
  }
  s = out;
}

// Run one block of G-code. jog = true for $J= lines. Returns 0 for ok, else a Grbl error number.
int runGcode(const String &s, bool jog) {
  bool has[3] = {false, false, false};
  float val[3] = {0, 0, 0};
  bool absLocal = absMode;
  int mode = jog ? 1 : motionMode;
  bool doDwell = false, doG92 = false, doG28 = false, doProbe = false, machineCoords = false;
  bool spindleCmd = false, spindleNewOn = spindleOn;
  float p = 0;
  float newS = spindleS;
  int i = 0;
  int n = s.length();
  const char *cs = s.c_str();
  while (i < n) {
    char letter = cs[i];
    if (letter < 'A' || letter > 'Z') return 1;  // expected a letter
    i++;
    char *endp;
    float num = strtod(cs + i, &endp);
    if (endp == cs + i) return 2;                 // bad number
    i = endp - cs;
    int code10 = (int)lround(num * 10.0);
    switch (letter) {
      case 'G':
        if (code10 == 0) mode = 0;
        else if (code10 == 10) mode = 1;
        else if (code10 == 40) doDwell = true;
        else if (code10 == 170 || code10 == 210 || code10 == 540 || code10 == 940) {}
        else if (code10 == 200) return 20;          // inches not supported
        else if (code10 == 280) doG28 = true;
        else if (code10 == 382) doProbe = true;
        else if (code10 == 530) machineCoords = true;
        else if (code10 == 900) absLocal = true;
        else if (code10 == 910) absLocal = false;
        else if (code10 == 920) doG92 = true;
        else return 20;
        break;
      case 'M': {
        int m = (int)num;
        if (m == 3 || m == 4) { spindleCmd = true; spindleNewOn = true; }
        else if (m == 5 || m == 0 || m == 2 || m == 30) { spindleCmd = true; spindleNewOn = false; }
        else if (m == 17) digitalWrite(EN_PIN, LOW);
        else if (m == 18 || m == 84) digitalWrite(EN_PIN, HIGH);
        else return 20;
        if (m == 2 || m == 30) { absMode = true; motionMode = 0; }
        break;
      }
      case 'X': has[0] = true; val[0] = num; break;
      case 'Y': has[1] = true; val[1] = num; break;
      case 'Z': has[2] = true; val[2] = num; break;
      case 'F': if (num > 0) feed = num; break;
      case 'S': newS = num; break;
      case 'P': p = num; break;
      case 'N': break;
      case 'T': break;
      default: return 20;
    }
  }

  if (!jog) absMode = absLocal;
  if (newS != spindleS) { spindleS = newS; if (spindleOn) setSpindle(true, spindleS); }
  if (spindleCmd) setSpindle(spindleNewOn, spindleS);

  if (doDwell) {
    unsigned long until = millis() + (unsigned long)(p * 1000.0);
    while (millis() < until) { pollRealtime(); delay(1); }
    return 0;
  }
  if (doG92) {
    bool any = has[0] || has[1] || has[2];
    for (int k = 0; k < 3; k++) {
      if (has[k] || !any) wco[k] = mpos(k) - (has[k] ? val[k] : 0.0);
    }
    return 0;
  }
  if (doG28) {
    float up[3] = {mpos(0), mpos(1), 0.0};
    int r = moveMachine(up, MAX_FEED[2], false);
    if (r < 0) return r == -1 ? 15 : 0;
    float home[3] = {0.0, 0.0, 0.0};
    r = moveMachine(home, MAX_FEED[0], false);
    return r == -1 ? 15 : 0;
  }

  bool any = has[0] || has[1] || has[2];
  if (!any) return 0;
  if (!jog) motionMode = mode;

  float tgt[3];
  for (int k = 0; k < 3; k++) {
    if (!has[k]) tgt[k] = mpos(k);
    else if (machineCoords) tgt[k] = val[k];
    else if (absLocal) tgt[k] = val[k] + wco[k];
    else tgt[k] = mpos(k) + val[k];
  }

  if (doProbe) {
    if (digitalRead(PROBE_PIN) == LOW) return 1;  // already touching
    int r = moveMachine(tgt, feed, true);
    if (r == -1) return 15;
    bool hit = (r == 1);
    Serial.printf("[PRB:%.3f,%.3f,%.3f:%d]\n", mpos(0), mpos(1), mpos(2), hit ? 1 : 0);
    if (!hit && r != -2) {
      Serial.println("ALARM:5");
      return 0;
    }
    return 0;
  }

  float f = (mode == 0 && !jog) ? 100000.0 : feed;  // G0 = as fast as each axis allows
  int r = moveMachine(tgt, f, false);
  if (r == -1) return 15;
  return 0;
}

void runDollar(const String &s) {
  if (s == "$$") {
    Serial.printf("$100=%.3f\n$101=%.3f\n$102=%.3f\n", STEPS_PER_MM, STEPS_PER_MM, STEPS_PER_MM);
    Serial.printf("$110=%.3f\n$111=%.3f\n$112=%.3f\n", MAX_FEED[0], MAX_FEED[1], MAX_FEED[2]);
    Serial.println("$130=200.000\n$131=200.000\n$132=200.000");
    Serial.println("ok");
  } else if (s == "$I") {
    Serial.println("[VER:1.1h.DeskCNC:]");
    Serial.println("ok");
  } else if (s == "$G") {
    Serial.printf("[GC:G%d G54 G17 G21 %s G94 %s M9 T0 F%d S%d]\n", motionMode, absMode ? "G90" : "G91",
                  spindleOn ? "M3" : "M5", (int)feed, (int)spindleS);
    Serial.println("ok");
  } else if (s.startsWith("$J=")) {
    int e = runGcode(s.substring(3), true);
    if (e) Serial.printf("error:%d\n", e); else Serial.println("ok");
  } else {
    Serial.println("ok");  // $X, $H and unknown settings: accepted, nothing to do
  }
}

void runLine(String s) {
  stripComments(s);
  if (s.length() == 0) { Serial.println("ok"); return; }
  if (s[0] == '$') { runDollar(s); return; }
  int e = runGcode(s, false);
  if (resetRequested) { softReset(); return; }
  if (e) Serial.printf("error:%d\n", e); else Serial.println("ok");
}

void setup() {
  PremakeWiFi.begin("Desk CNC Mill", "1.0.0");
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);  // drivers on
  pinMode(PROBE_PIN, INPUT_PULLUP);
  ledcAttach(SPINDLE_PIN, 20000, 8);
  ledcWrite(SPINDLE_PIN, 0);
  for (int i = 0; i < 3; i++) {
    axes[i]->setPinsInverted(INVERT_DIR[i], false, false);
    axes[i]->setMinPulseWidth(3);
    axes[i]->setMaxSpeed(1000);
    axes[i]->setCurrentPosition(0);
    group.addStepper(*axes[i]);
  }
  printWelcome();
  Serial.println(PremakeWiFi.connected() ? "[MSG:cnc wifi connected]" : "[MSG:cnc wifi not set up (not needed)]");
}

void loop() {
  while (Serial.available()) {
    int c = Serial.read();
    if (c == '?') { reportStatus(); continue; }
    if (c == '!') { hold = true; continue; }
    if (c == '~') { hold = false; continue; }
    if (c == 0x18) { softReset(); continue; }
    if (c == '\n' || c == '\r') {
      if (line.length() > 0) {
        String s = line;
        line = "";
        runLine(s);
      }
    } else if (line.length() < 128) {
      line += (char)c;
    }
  }
}
