// Board: ESP32 DevKit (ESP32-WROOM-32)
// Fold-Up Plasma Table controller.
// Streams G-code over USB serial at 115200 with GRBL-style replies ("ok", "<Idle|MPos:...>"),
// so Universal G-code Sender or CNCjs (Grbl mode) can send jobs from a laptop.
//
// Pin map (matches wiring.json):
//   X  STEP GPIO25  DIR GPIO13          Y1 (left)  STEP GPIO26  DIR GPIO16
//   Y2 (right) STEP GPIO27  DIR GPIO17  Z  STEP GPIO14  DIR GPIO4
//   Driver EN GPIO18 (LOW = enabled, all four TMC2209 carriers)
//   Limit X GPIO19, Y1 GPIO21, Y2 GPIO22, Z GPIO23   (NC to GND: open = triggered)
//   Float switch GPIO32                              (NC to GND: open = torch touching the plate)
//   Torch relay GPIO33                               (HIGH = fire)
//
// G-code: G0 G1 G2 G3 (I J) G4 P(s) G20 G21 G28 (park for folding) G90 G91 G92, M3 M5 M2 M30
// $H home (Z up, X to left, both Y to the back: squares the gantry), $X unlock, $J= jog,
// realtime ? status, ! stop, Ctrl-X reset, 0x85 jog cancel.
// M3 = touch off on the plate with the floating head, rise to pierce height, fire, wait, drop to cut height.
// Work Z0 is the plate surface after each M3. M5 = torch off and rise to safe height.

#include "premake_wifi.h"
#include "soc/soc.h"
#include "soc/gpio_reg.h"
#include <math.h>

// ---------------- machine settings ----------------
const float STEPS_MM[3] = {80.0f, 80.0f, 400.0f};   // GT2 20T, 1/16 step; Z: 8 mm lead, 1/16
const float VMAX[3] = {200.0f, 200.0f, 15.0f};      // mm/s
const float ACC_XY = 800.0f;                        // mm/s^2
const float ACC_Z = 150.0f;
const float TRAVEL_X = 1240.0f, TRAVEL_Y = 1240.0f, TRAVEL_Z = 95.0f;
const float JUNCTION_DEV = 0.05f;                   // mm, corner speed (GRBL style)
const float ARC_SEG = 0.5f;                         // mm, arc chord length
const float PARK_X = 620.0f, PARK_Y = 1085.0f;      // G28: gantry parked for folding (lock knobs line up here)

// plasma
const float FLOAT_TRAVEL = 1.5f;   // mm the head floats before the switch opens
const float PIERCE_H = 3.8f;
const float CUT_H = 1.5f;
const float SAFE_H = 15.0f;
const uint32_t PIERCE_MS = 500;
const float PROBE_SPEED = 8.0f;
const float PROBE_MAX = 95.0f;

// homing
const float HOME_FAST = 25.0f, HOME_SLOW = 3.0f, HOME_PULL = 3.0f;

// ---------------- pins ----------------
const int STEP_PIN[4] = {25, 26, 27, 14};           // motors: 0 X, 1 Y1, 2 Y2, 3 Z
const int DIR_PIN[4] = {13, 16, 17, 4};
const bool DIR_INVERT[4] = {false, false, true, false};
const int LIM_PIN[4] = {19, 21, 22, 23};
const int MOTOR_AXIS[4] = {0, 1, 1, 2};
const int PIN_EN = 18, PIN_FLOAT = 32, PIN_TORCH = 33;

// ---------------- step generator (40 kHz timer, 1 ms chunks) ----------------
#define RING 64
#define TICKS 40
#define MAXD 20                                     // max steps per motor per 1 ms chunk (20 kHz)

volatile int8_t ringD[RING][4];
volatile uint16_t rHead = 0, rTail = 0;
volatile int32_t actual[4] = {0, 0, 0, 0};
volatile bool flushReq = false;
volatile bool isrBusy = false;
uint32_t stepMask[4], dirMask[4], stepAll = 0;
bool dirInv[4];
uint8_t isrTick = TICKS;
uint8_t isrCnt[4], isrAcc[4];
int8_t isrSign[4];
hw_timer_t *stepTimer = nullptr;

void IRAM_ATTR onStepTimer() {
  REG_WRITE(GPIO_OUT_W1TC_REG, stepAll);            // end of any step pulse (25 us wide)
  if (flushReq) {
    rTail = rHead;
    flushReq = false;
    isrTick = TICKS;
    isrBusy = false;
    return;
  }
  if (isrTick >= TICKS) {
    if (rTail == rHead) {
      isrBusy = false;
      return;
    }
    uint16_t t = rTail;
    uint32_t setm = 0, clrm = 0;
    for (int i = 0; i < 4; i++) {
      int8_t d = ringD[t][i];
      bool neg = d < 0;
      isrCnt[i] = neg ? -d : d;
      isrSign[i] = neg ? -1 : 1;
      isrAcc[i] = 0;
      if (neg != dirInv[i]) setm |= dirMask[i];
      else clrm |= dirMask[i];
    }
    REG_WRITE(GPIO_OUT_W1TS_REG, setm);
    REG_WRITE(GPIO_OUT_W1TC_REG, clrm);
    rTail = (t + 1) % RING;
    isrTick = 0;
    isrBusy = true;
  }
  uint32_t m = 0;
  for (int i = 0; i < 4; i++) {
    isrAcc[i] += isrCnt[i];
    if (isrAcc[i] >= TICKS) {
      isrAcc[i] -= TICKS;
      m |= stepMask[i];
      actual[i] += isrSign[i];
    }
  }
  if (m) REG_WRITE(GPIO_OUT_W1TS_REG, m);
  isrTick++;
}

int ringCount() { return ((int)rHead - (int)rTail + RING) % RING; }
int ringFree() { return RING - 1 - ringCount(); }
bool motionIdle() { return ringCount() == 0 && !isrBusy; }

void ringPush(const int8_t d[4]) {
  while (ringFree() <= 0) delay(1);
  uint16_t h = rHead;
  for (int i = 0; i < 4; i++) ringD[h][i] = d[i];
  rHead = (h + 1) % RING;
}

// ---------------- state ----------------
int32_t cmd[4] = {0, 0, 0, 0};       // steps already queued to the ring
float pos[3] = {0, 0, 0};            // machine mm at the end of the last queued move
float workOff[3] = {0, 0, 0};        // work = machine - workOff
bool absMode = true;
float unitScale = 1.0f;
int motionMode = 0;
float feedMMs = 25.0f;
bool alarmOn = false, homing = false, homed = false, torchOn = false;

struct Block {
  float start[3];
  float u[3];
  float len, vNom, vJunc, entry, acc;
};
#define PB 48
Block blocks[PB];
int bHead = 0, bCount = 0;
float execS = 0, execV = 0;

Block &blk(int i) { return blocks[(bHead + i) % PB]; }

void syncPosFromSteps() {
  for (int m = 0; m < 4; m++) cmd[m] = actual[m];
  pos[0] = cmd[0] / STEPS_MM[0];
  pos[1] = cmd[1] / STEPS_MM[1];
  pos[2] = cmd[3] / STEPS_MM[2];
}

void emitTarget(const float p[3]) {
  int8_t d[4];
  for (int m = 0; m < 4; m++) {
    int ax = MOTOR_AXIS[m];
    int32_t tgt = lroundf(p[ax] * STEPS_MM[ax]);
    int32_t delta = tgt - cmd[m];
    if (delta > MAXD) delta = MAXD;
    if (delta < -MAXD) delta = -MAXD;
    d[m] = (int8_t)delta;
    cmd[m] += delta;
  }
  ringPush(d);
}

bool produceChunk() {
  if (bCount == 0 || alarmOn) return false;
  const float dt = 0.001f;
  Block *b = &blk(0);
  float vExit = bCount > 1 ? blk(1).entry : 0.0f;
  float rem = b->len - execS;
  if (rem < 0) rem = 0;
  float vAllow = sqrtf(vExit * vExit + 2.0f * b->acc * rem);
  float vt = fminf(b->vNom, vAllow);
  if (execV < vt) execV = fminf(execV + b->acc * dt, vt);
  else execV = vt;
  if (execV < 0.5f) execV = 0.5f;
  execS += execV * dt;
  while (execS >= b->len) {
    execS -= b->len;
    bHead = (bHead + 1) % PB;
    bCount--;
    if (bCount == 0) {
      execS = 0;
      execV = 0;
      emitTarget(pos);
      return true;
    }
    b = &blk(0);
  }
  float p[3];
  for (int i = 0; i < 3; i++) p[i] = b->start[i] + b->u[i] * execS;
  emitTarget(p);
  return true;
}

void serviceMotion() {
  while (ringFree() > 0 && produceChunk()) {
  }
}

void replan() {
  float next = 0;
  for (int i = bCount - 1; i >= 1; i--) {
    Block &b = blk(i);
    float e = sqrtf(next * next + 2.0f * b.acc * b.len);
    b.entry = fminf(b.vJunc, e);
    next = b.entry;
  }
  float prevV = execV;
  float prevLen = blk(0).len - execS;
  if (prevLen < 0) prevLen = 0;
  float prevAcc = blk(0).acc;
  for (int i = 1; i < bCount; i++) {
    Block &b = blk(i);
    float lim = sqrtf(prevV * prevV + 2.0f * prevAcc * prevLen);
    if (b.entry > lim) b.entry = lim;
    prevV = b.entry;
    prevLen = b.len;
    prevAcc = b.acc;
  }
}

void reportStatus();
void stopMotion(const char *why, bool alarmIt);

// ---------------- switches + safety ----------------
bool limitHit(int m) { return digitalRead(LIM_PIN[m]) == HIGH; }
bool floatHit() { return digitalRead(PIN_FLOAT) == HIGH; }

uint8_t limCnt[4] = {0, 0, 0, 0};
bool limStable[4] = {false, false, false, false};
uint8_t floatCnt = 0;

void safetyCheck() {
  if (alarmOn || homing) return;
  bool moving = bCount > 0 || !motionIdle();
  for (int m = 0; m < 4; m++) {
    bool h = limitHit(m);
    if (h) {
      if (limCnt[m] < 10) limCnt[m]++;
    } else {
      limCnt[m] = 0;
    }
    if (limCnt[m] >= 5 && !limStable[m]) {     // switch just opened (debounced): stop only if moving
      limStable[m] = true;
      if (moving) {
        stopMotion("hard limit", true);
        return;
      }
    }
    if (!h) limStable[m] = false;
  }
  if (torchOn && floatHit()) {
    if (++floatCnt > 5) {
      floatCnt = 0;
      stopMotion("torch collision (float switch)", true);
    }
  } else {
    floatCnt = 0;
  }
}

void pollRealtime() {
  while (Serial.available()) {
    int c = Serial.peek();
    if (c == '?') {
      Serial.read();
      reportStatus();
    } else if (c == '!' || c == 0x18) {
      Serial.read();
      stopMotion(c == '!' ? "stop" : "reset", true);
    } else if (c == 0x85) {
      Serial.read();
      stopMotion("jog cancel", false);
    } else {
      break;
    }
  }
  safetyCheck();
}

void stopMotion(const char *why, bool alarmIt) {
  digitalWrite(PIN_TORCH, LOW);
  torchOn = false;
  flushReq = true;
  uint32_t t0 = millis();
  while (flushReq && millis() - t0 < 20) delay(1);
  bCount = 0;
  execS = 0;
  execV = 0;
  syncPosFromSteps();
  if (alarmIt) {
    alarmOn = true;
    Serial.printf("[MSG:plasma stopped: %s - $X to unlock, re-home if it was moving fast]\n", why);
    Serial.println("ALARM:1");
  }
}

void waitIdle() {
  while (!alarmOn && (bCount > 0 || !motionIdle())) {
    serviceMotion();
    pollRealtime();
    delay(1);
  }
}

void waitMs(uint32_t ms) {
  uint32_t t0 = millis();
  while (!alarmOn && millis() - t0 < ms) {
    pollRealtime();
    delay(1);
  }
}

// ---------------- planner input ----------------
void clampSoft(float t[3]) {
  const float lo[3] = {0.0f, 0.0f, -TRAVEL_Z};
  const float hi[3] = {TRAVEL_X, TRAVEL_Y, 0.0f};
  for (int i = 0; i < 3; i++) {
    if (t[i] < lo[i]) t[i] = lo[i];
    if (t[i] > hi[i]) t[i] = hi[i];
  }
}

void queueLine(const float tgtIn[3], float feed) {
  if (alarmOn) return;
  float tgt[3] = {tgtIn[0], tgtIn[1], tgtIn[2]};
  if (homed) clampSoft(tgt);
  float d[3];
  float len2 = 0;
  for (int i = 0; i < 3; i++) {
    d[i] = tgt[i] - pos[i];
    len2 += d[i] * d[i];
  }
  float len = sqrtf(len2);
  if (len < 0.001f) return;
  while (bCount >= PB) {
    serviceMotion();
    pollRealtime();
    if (alarmOn) return;
    delay(1);
  }
  Block &b = blocks[(bHead + bCount) % PB];
  for (int i = 0; i < 3; i++) {
    b.start[i] = pos[i];
    b.u[i] = d[i] / len;
  }
  b.len = len;
  float v = feed;
  float a = 1e9f;
  float uxy = sqrtf(b.u[0] * b.u[0] + b.u[1] * b.u[1]);
  if (uxy > 1e-6f) {
    v = fminf(v, VMAX[0] / uxy);
    a = fminf(a, ACC_XY / uxy);
  }
  float uz = fabsf(b.u[2]);
  if (uz > 1e-6f) {
    v = fminf(v, VMAX[2] / uz);
    a = fminf(a, ACC_Z / uz);
  }
  b.vNom = v;
  b.acc = a;
  float vj = 0;
  if (bCount > 0) {
    Block &p = blk(bCount - 1);
    float cosT = -(p.u[0] * b.u[0] + p.u[1] * b.u[1] + p.u[2] * b.u[2]);
    if (cosT < -0.9999f) {
      vj = fminf(p.vNom, b.vNom);
    } else if (cosT > 0.9999f) {
      vj = 0;
    } else {
      float sh = sqrtf(0.5f * (1.0f - cosT));
      vj = sqrtf(fminf(p.acc, b.acc) * JUNCTION_DEV * sh / (1.0f - sh));
      vj = fminf(vj, fminf(p.vNom, b.vNom));
    }
  }
  b.vJunc = vj;
  b.entry = vj;
  bCount++;
  for (int i = 0; i < 3; i++) pos[i] = tgt[i];
  replan();
  serviceMotion();
}

void arcTo(const float tgt[3], float I, float J, bool cw, float feed) {
  float cx = pos[0] + I, cy = pos[1] + J;
  float r = hypotf(pos[0] - cx, pos[1] - cy);
  float a0 = atan2f(pos[1] - cy, pos[0] - cx);
  float a1 = atan2f(tgt[1] - cy, tgt[0] - cx);
  float da = a1 - a0;
  if (cw) {
    if (da >= -1e-6f) da -= 2.0f * PI;
  } else {
    if (da <= 1e-6f) da += 2.0f * PI;
  }
  int n = (int)ceilf(fabsf(da) * r / ARC_SEG);
  if (n < 1) n = 1;
  if (n > 4000) n = 4000;
  float z0 = pos[2];
  for (int k = 1; k <= n; k++) {
    if (alarmOn) return;
    float p[3];
    if (k == n) {
      p[0] = tgt[0];
      p[1] = tgt[1];
      p[2] = tgt[2];
    } else {
      float a = a0 + da * k / n;
      p[0] = cx + r * cosf(a);
      p[1] = cy + r * sinf(a);
      p[2] = z0 + (tgt[2] - z0) * k / n;
    }
    queueLine(p, feed);
  }
}

// ---------------- raw moves: homing and probing ----------------
// Moves the motors in `mask` (bit per motor) in direction dir. sw: 0 = fixed distance, 1 = until each motor's
// limit switch opens, 2 = until the float switch opens. Returns false if a switch never triggered.
bool rawMove(uint8_t mask, int dir, float speed, float dist, int sw) {
  float acc[4] = {0, 0, 0, 0};
  float perMs[4] = {0, 0, 0, 0};
  int32_t left[4] = {0, 0, 0, 0};
  uint8_t hitCnt[4] = {0, 0, 0, 0};
  for (int m = 0; m < 4; m++) {
    if (!(mask & (1 << m))) continue;
    int ax = MOTOR_AXIS[m];
    perMs[m] = fminf(speed, VMAX[ax]) * STEPS_MM[ax] / 1000.0f;
    left[m] = lroundf(dist * STEPS_MM[ax]);
  }
  uint8_t active = mask;
  bool failed = false;
  while (active) {
    if (alarmOn) return false;
    if (ringCount() >= 2) {
      delay(1);
      continue;
    }
    int8_t d[4] = {0, 0, 0, 0};
    for (int m = 0; m < 4; m++) {
      if (!(active & (1 << m))) continue;
      if (sw) {
        bool hit = (sw == 1) ? limitHit(m) : floatHit();
        if (hit) {
          if (++hitCnt[m] >= 2) {
            active &= ~(1 << m);
            continue;
          }
        } else {
          hitCnt[m] = 0;
        }
      }
      acc[m] += perMs[m];
      int n = (int)acc[m];
      acc[m] -= n;
      if (n > left[m]) n = left[m];
      if (n > MAXD) n = MAXD;
      d[m] = (int8_t)(dir * n);
      cmd[m] += dir * n;
      left[m] -= n;
      if (left[m] <= 0) {
        active &= ~(1 << m);
        if (sw) failed = true;
      }
    }
    ringPush(d);
  }
  while (!motionIdle()) delay(1);
  return !failed;
}

bool anyHit(uint8_t mask) {
  for (int m = 0; m < 4; m++)
    if ((mask & (1 << m)) && limitHit(m)) return true;
  return false;
}

bool homeGroup(uint8_t mask, int dir, float maxDist) {
  if (anyHit(mask)) rawMove(mask, -dir, HOME_SLOW * 3, HOME_PULL * 3, 0);
  if (!rawMove(mask, dir, HOME_FAST, maxDist, 1)) return false;
  rawMove(mask, -dir, HOME_SLOW * 3, HOME_PULL, 0);
  if (!rawMove(mask, dir, HOME_SLOW, HOME_PULL * 3, 1)) return false;
  rawMove(mask, -dir, HOME_SLOW * 3, HOME_PULL, 0);
  return true;
}

void homeAll() {
  alarmOn = false;
  waitIdle();
  digitalWrite(PIN_TORCH, LOW);
  torchOn = false;
  homing = true;
  Serial.println("[MSG:plasma homing]");
  bool ok = homeGroup(1 << 3, +1, TRAVEL_Z + 20);                       // Z up
  if (ok) ok = homeGroup(1 << 0, -1, TRAVEL_X + 50);                   // X to the left
  if (ok) ok = homeGroup((1 << 1) | (1 << 2), +1, TRAVEL_Y + 50);      // both Y to the back: squares the gantry
  homing = false;
  if (!ok) {
    stopMotion("homing failed: switch not found", true);
    return;
  }
  actual[0] = 0;
  actual[1] = lroundf(TRAVEL_Y * STEPS_MM[1]);
  actual[2] = actual[1];
  actual[3] = 0;
  syncPosFromSteps();
  for (int i = 0; i < 3; i++) workOff[i] = 0;
  homed = true;
  Serial.println("[MSG:plasma homed]");
}

// ---------------- torch ----------------
void torchStart() {
  waitIdle();
  if (alarmOn) return;
  homing = true;                                    // the float switch is expected to open here
  bool ok = rawMove(1 << 3, -1, PROBE_SPEED, PROBE_MAX, 2);
  homing = false;
  syncPosFromSteps();
  if (!ok) {
    stopMotion("probe: no plate found", true);
    return;
  }
  float surface = pos[2] + FLOAT_TRAVEL;
  workOff[2] = surface;
  float t[3] = {pos[0], pos[1], surface + PIERCE_H};
  queueLine(t, 5.0f);
  waitIdle();
  if (alarmOn) return;
  digitalWrite(PIN_TORCH, HIGH);
  torchOn = true;
  waitMs(PIERCE_MS);
  t[2] = surface + CUT_H;
  queueLine(t, 5.0f);
  waitIdle();
}

void torchStop() {
  waitIdle();
  digitalWrite(PIN_TORCH, LOW);
  torchOn = false;
  if (alarmOn) return;
  float t[3] = {pos[0], pos[1], workOff[2] + SAFE_H};
  queueLine(t, VMAX[2]);
}

void goPark() {
  float t[3] = {pos[0], pos[1], 0.0f};
  queueLine(t, VMAX[2]);
  t[0] = PARK_X;
  t[1] = PARK_Y;
  queueLine(t, 1e9f);
  waitIdle();
  Serial.println("[MSG:plasma parked - tighten the gantry lock knobs before folding]");
}

// ---------------- G-code ----------------
void reportStatus() {
  const char *st = alarmOn ? "Alarm" : homing ? "Home" : (bCount > 0 || !motionIdle()) ? "Run" : "Idle";
  Serial.printf("<%s|MPos:%.3f,%.3f,%.3f|WCO:%.3f,%.3f,%.3f>\n", st, actual[0] / STEPS_MM[0],
                actual[1] / STEPS_MM[1], actual[3] / STEPS_MM[2], workOff[0], workOff[1], workOff[2]);
}

const char *runLine(const char *s);

const char *runDollar(const char *buf) {
  if (strcmp(buf, "$H") == 0) {
    homeAll();
    return alarmOn ? "error:9" : nullptr;
  }
  if (strcmp(buf, "$X") == 0) {
    alarmOn = false;
    Serial.println("[MSG:Caution: Unlocked]");
    return nullptr;
  }
  if (strncmp(buf, "$J=", 3) == 0) {
    if (alarmOn) return "error:9";
    bool savedAbs = absMode;
    int savedMode = motionMode;
    motionMode = 1;
    const char *err = runLine(buf + 3);
    absMode = savedAbs;
    motionMode = savedMode;
    return err;
  }
  if (strcmp(buf, "$G") == 0) {
    Serial.printf("[GC:G%d G54 G17 %s %s G94 M5 F%.0f]\n", motionMode, unitScale > 1 ? "G20" : "G21",
                  absMode ? "G90" : "G91", feedMMs * 60.0f / unitScale);
    return nullptr;
  }
  if (strcmp(buf, "$I") == 0) {
    Serial.println("[VER:1.1f.PlasmaFold:]");
    return nullptr;
  }
  return nullptr;  // other $ settings: accepted and ignored (settings live at the top of this sketch)
}

const char *runLine(const char *s) {
  char buf[128];
  int n = 0;
  bool paren = false;
  for (const char *p = s; *p && n < 127; p++) {
    char c = *p;
    if (c == '(') {
      paren = true;
      continue;
    }
    if (c == ')') {
      paren = false;
      continue;
    }
    if (paren) continue;
    if (c == ';') break;
    if (c == ' ' || c == '\t' || c == '\r') continue;
    buf[n++] = (char)toupper((unsigned char)c);
  }
  buf[n] = 0;
  if (n == 0) return nullptr;
  if (buf[0] == '$') return runDollar(buf);
  if (buf[0] == '%') return nullptr;
  if (alarmOn) return "error:9";

  float val[26];
  bool has[26];
  for (int i = 0; i < 26; i++) {
    val[i] = 0;
    has[i] = false;
  }
  int gcodes[8], ng = 0;
  int mcodes[4], nm = 0;
  char *p = buf;
  while (*p) {
    char L = *p++;
    if (L < 'A' || L > 'Z') return "error:1";
    char *end;
    float v = strtof(p, &end);
    if (end == p) return "error:2";
    p = end;
    if (L == 'G') {
      if (ng < 8) gcodes[ng++] = (int)lroundf(v * 10.0f);
    } else if (L == 'M') {
      if (nm < 4) mcodes[nm++] = (int)lroundf(v);
    } else {
      val[L - 'A'] = v;
      has[L - 'A'] = true;
    }
  }

  bool g4 = false, g28 = false, g92 = false;
  int mm = -1;
  for (int i = 0; i < ng; i++) {
    switch (gcodes[i]) {
      case 0: mm = 0; break;
      case 10: mm = 1; break;
      case 20: mm = 2; break;
      case 30: mm = 3; break;
      case 40: g4 = true; break;
      case 200: unitScale = 25.4f; break;
      case 210: unitScale = 1.0f; break;
      case 280: g28 = true; break;
      case 900: absMode = true; break;
      case 910: absMode = false; break;
      case 920: g92 = true; break;
      case 170: case 400: case 490: case 540: case 610: case 640: case 800: case 940: case 911: break;
      default: return "error:20";
    }
  }
  if (has['F' - 'A']) feedMMs = val['F' - 'A'] * unitScale / 60.0f;
  if (feedMMs < 0.1f) feedMMs = 0.1f;

  if (g4) {
    waitIdle();
    waitMs((uint32_t)(val['P' - 'A'] * 1000.0f));
  }
  const int AX[3] = {'X' - 'A', 'Y' - 'A', 'Z' - 'A'};
  if (g92) {
    for (int i = 0; i < 3; i++)
      if (has[AX[i]]) workOff[i] = pos[i] - val[AX[i]] * unitScale;
  } else if (g28) {
    goPark();
  } else {
    if (mm >= 0) motionMode = mm;
    bool anyAxis = has[AX[0]] || has[AX[1]] || has[AX[2]];
    if (anyAxis) {
      float tgt[3];
      for (int i = 0; i < 3; i++) {
        tgt[i] = pos[i];
        if (has[AX[i]]) tgt[i] = absMode ? val[AX[i]] * unitScale + workOff[i] : pos[i] + val[AX[i]] * unitScale;
      }
      if (motionMode == 0) queueLine(tgt, 1e9f);
      else if (motionMode == 1) queueLine(tgt, feedMMs);
      else arcTo(tgt, val['I' - 'A'] * unitScale, val['J' - 'A'] * unitScale, motionMode == 2, feedMMs);
    }
  }
  for (int i = 0; i < nm; i++) {
    switch (mcodes[i]) {
      case 3: case 4: torchStart(); break;
      case 5: torchStop(); break;
      case 2: case 30: torchStop(); waitIdle(); break;
      case 0: case 1: waitIdle(); break;
      default: break;
    }
  }
  return alarmOn ? "error:9" : nullptr;
}

// ---------------- setup / loop ----------------
char lineBuf[160];
int lineLen = 0;

void setup() {
  PremakeWiFi.begin("Fold-Up Plasma Table", "1.0.0");
  pinMode(PIN_TORCH, OUTPUT);
  digitalWrite(PIN_TORCH, LOW);
  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, HIGH);
  for (int m = 0; m < 4; m++) {
    pinMode(STEP_PIN[m], OUTPUT);
    pinMode(DIR_PIN[m], OUTPUT);
    digitalWrite(STEP_PIN[m], LOW);
    pinMode(LIM_PIN[m], INPUT_PULLUP);
    stepMask[m] = 1UL << STEP_PIN[m];
    dirMask[m] = 1UL << DIR_PIN[m];
    dirInv[m] = DIR_INVERT[m];
    stepAll |= stepMask[m];
  }
  pinMode(PIN_FLOAT, INPUT_PULLUP);
  stepTimer = timerBegin(1000000);
  timerAttachInterrupt(stepTimer, &onStepTimer);
  timerAlarm(stepTimer, 25, true, 0);
  digitalWrite(PIN_EN, LOW);
  delay(50);
  for (int m = 0; m < 4; m++)
    if (limitHit(m)) Serial.printf("[MSG:plasma limit switch %d open - check wiring]\n", m);
  if (floatHit()) Serial.println("[MSG:plasma float switch open - check wiring]");
  Serial.println();
  Serial.println("Grbl 1.1f ['$' for help]");
  Serial.println("[MSG:plasma ready - send $H to home]");
}

void loop() {
  serviceMotion();
  pollRealtime();
  while (Serial.available()) {
    int c = Serial.read();
    if (c == '?') {
      reportStatus();
      continue;
    }
    if (c == '!') {
      stopMotion("stop", true);
      continue;
    }
    if (c == 0x18) {
      stopMotion("reset", true);
      lineLen = 0;
      Serial.println("Grbl 1.1f ['$' for help]");
      continue;
    }
    if (c == 0x85) {
      stopMotion("jog cancel", false);
      continue;
    }
    if (c == '\n' || c == '\r') {
      if (lineLen > 0) {
        lineBuf[lineLen] = 0;
        const char *err = runLine(lineBuf);
        Serial.println(err ? err : "ok");
        lineLen = 0;
      }
      continue;
    }
    if (lineLen < (int)sizeof(lineBuf) - 1) lineBuf[lineLen++] = (char)c;
  }
  delay(1);
}
