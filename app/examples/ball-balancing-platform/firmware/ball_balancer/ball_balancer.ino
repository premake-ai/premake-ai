// Ball-balancing plate: ESP32 DevKitC + TSC2007 resistive touch controller + PCA9685 servo driver.
// 3-RRS linkage (servo arm, pinned link, ball joint), 100 Hz PID, inverse kinematics identical to design.py.
//
// controls: circle (toggle), radius (range 0-45 mm), period (range 3-15 s), level (button)
// readings: ball_x (mm), ball_y (mm), err_mm, ball_on (0/1), loop_hz
//
// Libraries (Library Manager): "Adafruit PWM Servo Driver Library", "ArduinoJson" (v7). Board: "ESP32 Dev Module".
// Serial 115200: "r" toggles raw touch print (calibration), "s" runs a servo direction test,
//                "p0.10" / "i0.02" / "d0.045" set the PID gains live.
// Hold BOOT (GPIO0) while powering up for 3 s to clear the saved Wi-Fi.

#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <Adafruit_PWMServoDriver.h>
#include <math.h>

// ---------------------------------------------------------------- pin map (matches wiring.json)
const int PIN_SDA = 21;          // TSC2007 + PCA9685 SDA
const int PIN_SCL = 22;          // TSC2007 + PCA9685 SCL
const int PIN_BOOT = 0;          // on-board BOOT button
const uint8_t TSC_ADDR = 0x48;
const uint8_t PCA_ADDR = 0x40;
const int SERVO_CH[3] = {0, 1, 2};   // A back, B front-left, C front-right

// ---------------------------------------------------------------- linkage geometry (mm, = design.py)
const float LEG_DEG[3] = {90, 210, 330};
const float R_B = 62, ARM = 20, LEN = 45, R_P = 82, Z_S = 50, Z_B = 95;
const float ARM_LIMIT = 38;      // deg each way (horn clears the deck)
const float TILT_LIMIT = 7;      // deg plate tilt

// ---------------------------------------------------------------- servos
const float US_CENTER = 1500, US_PER_DEG = 11.1;   // MG996R ~500-2500 us over ~180 deg
const int SERVO_DIR = -1;                          // flip to +1 if "s" test moves arms DOWN first
float SERVO_TRIM_US[3] = {0, 0, 0};                // level the plate by eye
const float MAX_STEP_DEG = 4.0;                    // per 10 ms (MG996R ~0.17 s / 60 deg)

// ---------------------------------------------------------------- touch panel (NJYTouch 8", view area 164 x 124)
int RAW_X_MIN = 200, RAW_X_MAX = 3900;            // calibrate: roll the ball to each edge, read "r"
int RAW_Y_MIN = 250, RAW_Y_MAX = 3850;
const float VIEW_W = 164, VIEW_H = 124;
const bool SWAP_XY = false, FLIP_X = false, FLIP_Y = false;
const int Z1_MIN = 40;                            // pressure needed to count as "ball on plate"

// ---------------------------------------------------------------- control
float KP = 0.10f, KI = 0.02f, KD = 0.045f;        // degrees of tilt per mm, per mm*s, per mm/s
const float LOOP_HZ = 100, DT = 1.0f / LOOP_HZ;

// ---------------------------------------------------------------- Premake cloud
const char *API = "https://premake.ai/api/d";
const char *FW = "1.0.0";

Adafruit_PWMServoDriver pwm(PCA_ADDR);
Preferences prefs;
portMUX_TYPE mux = portMUX_INITIALIZER_UNLOCKED;

// shared between the control loop (core 1) and the network task (core 0)
struct Shared {
  bool circle = false;
  float radius = 30, period = 6;
  uint32_t levelUntil = 0;
  float bx = 0, by = 0, err = 0, hz = 0;
  bool on = false;
} sh;

// ================================================================ inverse kinematics
static const float D2R = 0.01745329f;

static void mat3(const float A[3][3], const float B[3][3], float C[3][3]) {
  for (int i = 0; i < 3; i++)
    for (int j = 0; j < 3; j++) C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
}

static bool solve3(float J[3][3], float f[3], float d[3]) {
  float det = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) +
              J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
  if (fabsf(det) < 1e-9f) return false;
  for (int c = 0; c < 3; c++) {
    float M[3][3];
    for (int i = 0; i < 3; i++)
      for (int j = 0; j < 3; j++) M[i][j] = (j == c) ? f[i] : J[i][j];
    d[c] = (M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
            M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])) / det;
  }
  return true;
}

// tx tilts +Y up, ty tilts +X down (plate frame = Ry(ty) * Rx(tx)). Returns arm angles, + = arm up.
bool ik(float tx, float ty, float out[3]) {
  float a = tx * D2R, b = ty * D2R;
  float Rx[3][3] = {{1, 0, 0}, {0, cosf(a), -sinf(a)}, {0, sinf(a), cosf(a)}};
  float Ry[3][3] = {{cosf(b), 0, sinf(b)}, {0, 1, 0}, {-sinf(b), 0, cosf(b)}};
  float Rt[3][3], R[3][3];
  mat3(Ry, Rx, Rt);
  float x = 0, y = 0, psi = 0;
  for (int it = 0; it < 5; it++) {          // 3-RRS: each ball joint stays in its leg plane
    float Rz[3][3] = {{cosf(psi), -sinf(psi), 0}, {sinf(psi), cosf(psi), 0}, {0, 0, 1}};
    mat3(Rz, Rt, R);
    float J[3][3], f[3], d[3];
    for (int i = 0; i < 3; i++) {
      float c = cosf(LEG_DEG[i] * D2R), s = sinf(LEG_DEG[i] * D2R);
      float qx = R[0][0] * R_P * c + R[0][1] * R_P * s, qy = R[1][0] * R_P * c + R[1][1] * R_P * s;
      float tX = -s, tY = c;
      f[i] = (x + qx) * tX + (y + qy) * tY;
      J[i][0] = tX; J[i][1] = tY; J[i][2] = -qy * tX + qx * tY;
    }
    if (!solve3(J, f, d)) return false;
    x -= d[0]; y -= d[1]; psi -= d[2];
  }
  float Rz[3][3] = {{cosf(psi), -sinf(psi), 0}, {sinf(psi), cosf(psi), 0}, {0, 0, 1}};
  mat3(Rz, Rt, R);
  for (int i = 0; i < 3; i++) {
    float c = cosf(LEG_DEG[i] * D2R), s = sinf(LEG_DEG[i] * D2R);
    float Px = x + R[0][0] * R_P * c + R[0][1] * R_P * s;
    float Py = y + R[1][0] * R_P * c + R[1][1] * R_P * s;
    float Pz = Z_B + R[2][0] * R_P * c + R[2][1] * R_P * s;
    float dx = Px * c + Py * s - R_B, dz = Pz - Z_S;
    float r = sqrtf(dx * dx + dz * dz);
    float k = (dx * dx + dz * dz + ARM * ARM - LEN * LEN) / (2 * ARM);
    if (fabsf(k / r) > 1.0f) return false;
    out[i] = (atan2f(dz, dx) - acosf(k / r)) / D2R;
  }
  return true;
}

// ================================================================ hardware
float armNow[3] = {0, 0, 0};

void writeArms(const float deg[3], bool rateLimit) {
  for (int i = 0; i < 3; i++) {
    float t = constrain(deg[i], -ARM_LIMIT, ARM_LIMIT);
    if (rateLimit) t = armNow[i] + constrain(t - armNow[i], -MAX_STEP_DEG, MAX_STEP_DEG);
    armNow[i] = t;
    pwm.writeMicroseconds(SERVO_CH[i], (uint16_t)(US_CENTER + SERVO_DIR * t * US_PER_DEG + SERVO_TRIM_US[i]));
  }
}

// TSC2007 command byte: C3..C0 | PD1 PD0 | M | x. PD = 01 keeps the ADC on, 12-bit mode.
uint16_t tsc(uint8_t cmd) {
  Wire.beginTransmission(TSC_ADDR);
  Wire.write(cmd);
  if (Wire.endTransmission() != 0) return 0xFFFF;
  if (Wire.requestFrom((int)TSC_ADDR, 2) != 2) return 0xFFFF;
  uint8_t hi = Wire.read(), lo = Wire.read();
  return ((uint16_t)hi << 4) | (lo >> 4);
}
const uint8_t TSC_X = 0xC4, TSC_Y = 0xD4, TSC_Z1 = 0xE4;

static uint16_t med3(uint16_t a, uint16_t b, uint16_t c) {
  return max(min(a, b), min(max(a, b), c));
}

bool printRaw = false;

bool readBall(float &xmm, float &ymm) {
  uint16_t z1 = tsc(TSC_Z1);
  if (z1 == 0xFFFF || z1 < Z1_MIN) return false;
  uint16_t rx = med3(tsc(TSC_X), tsc(TSC_X), tsc(TSC_X));
  uint16_t ry = med3(tsc(TSC_Y), tsc(TSC_Y), tsc(TSC_Y));
  if (rx == 0xFFFF || ry == 0xFFFF) return false;
  if (SWAP_XY) { uint16_t t = rx; rx = ry; ry = t; }
  if (printRaw) Serial.printf("raw x %u  y %u  z1 %u\n", rx, ry, z1);
  float u = (float)(rx - RAW_X_MIN) / (RAW_X_MAX - RAW_X_MIN);
  float v = (float)(ry - RAW_Y_MIN) / (RAW_Y_MAX - RAW_Y_MIN);
  if (FLIP_X) u = 1 - u;
  if (FLIP_Y) v = 1 - v;
  xmm = (u - 0.5f) * VIEW_W;
  ymm = (v - 0.5f) * VIEW_H;
  return fabsf(xmm) < VIEW_W * 0.6f && fabsf(ymm) < VIEW_H * 0.6f;
}

void servoTest() {
  Serial.println("servo test: each arm goes UP 15 deg then back. If it goes down, flip SERVO_DIR.");
  for (int i = 0; i < 3; i++) {
    float d[3] = {0, 0, 0};
    d[i] = 15;
    writeArms(d, false);
    delay(700);
    d[i] = 0;
    writeArms(d, false);
    delay(500);
  }
}

void serialCommands() {
  if (!Serial.available()) return;
  String s = Serial.readStringUntil('\n');
  s.trim();
  if (s == "r") printRaw = !printRaw;
  else if (s == "s") servoTest();
  else if (s.length() > 1 && (s[0] == 'p' || s[0] == 'i' || s[0] == 'd')) {
    float v = s.substring(1).toFloat();
    if (s[0] == 'p') KP = v; else if (s[0] == 'i') KI = v; else KD = v;
    Serial.printf("KP %.3f KI %.3f KD %.3f\n", KP, KI, KD);
  }
}

// ================================================================ network task (core 0)
String ssid, pass, devKey;

void runPortal() {
  char ap[32];
  snprintf(ap, sizeof ap, "Premake-Balancer-%04X", (uint16_t)(ESP.getEfuseMac() & 0xFFFF));
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap);
  WebServer server(80);
  server.on("/", HTTP_GET, [&]() {
    server.send(200, "text/html",
                "<html><body style='font-family:sans-serif;max-width:420px;margin:40px auto'>"
                "<h2>Ball balancer setup</h2><form method='POST' action='/save'>"
                "Wi-Fi name<br><input name='s' style='width:100%'><br><br>"
                "Wi-Fi password<br><input name='p' type='password' style='width:100%'><br><br>"
                "Device key (from the Premake app)<br><input name='k' style='width:100%'><br><br>"
                "<button>Save</button></form></body></html>");
  });
  server.on("/save", HTTP_POST, [&]() {
    prefs.putString("ssid", server.arg("s"));
    prefs.putString("pass", server.arg("p"));
    prefs.putString("key", server.arg("k"));
    server.send(200, "text/html", "Saved. Restarting...");
    delay(800);
    ESP.restart();
  });
  server.begin();
  Serial.printf("setup: join Wi-Fi '%s', open http://192.168.4.1\n", ap);
  for (;;) {
    server.handleClient();
    vTaskDelay(2);
  }
}

void postReadings(WiFiClientSecure &client, uint32_t &intervalMs) {
  Shared s;
  portENTER_CRITICAL(&mux);
  s = sh;
  portEXIT_CRITICAL(&mux);
  JsonDocument doc;
  JsonObject r = doc["r"].to<JsonObject>();
  r["ball_x"] = roundf(s.bx * 10) / 10;
  r["ball_y"] = roundf(s.by * 10) / 10;
  r["err_mm"] = roundf(s.err * 10) / 10;
  r["ball_on"] = s.on ? 1 : 0;
  r["loop_hz"] = roundf(s.hz);
  doc["fw"] = FW;
  String body;
  serializeJson(doc, body);
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(client, String(API) + "/ingest");
  http.addHeader("Authorization", "Device " + devKey);
  http.addHeader("Content-Type", "application/json");
  if (http.POST(body) == 200) {
    JsonDocument rep;
    if (!deserializeJson(rep, http.getString()) && rep["interval"].is<float>())
      intervalMs = max(20000UL, (unsigned long)(rep["interval"].as<float>() * 1000));
  }
  http.end();
}

void netTask(void *) {
  prefs.begin("premake", false);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  devKey = prefs.getString("key", "");
  if (ssid.isEmpty() || devKey.isEmpty()) runPortal();       // never returns; balancing keeps running

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  WiFiClientSecure client;
  client.setInsecure();
  uint32_t seq = 0, intervalMs = 20000, lastIngest = 0;
  long lastLevel = -1;                                        // button counter seen; -1 = not yet known
  const char *hdrs[] = {"Retry-After"};

  for (;;) {
    if (WiFi.status() != WL_CONNECTED) { vTaskDelay(pdMS_TO_TICKS(1000)); continue; }
    if (millis() - lastIngest >= intervalMs) { postReadings(client, intervalMs); lastIngest = millis(); }

    HTTPClient http;
    http.setTimeout(30000);
    http.begin(client, String(API) + "/commands?since=" + seq + "&wait=25");
    http.addHeader("Authorization", "Device " + devKey);
    http.collectHeaders(hdrs, 1);
    int code = http.GET();
    if (code == 200) {
      JsonDocument doc;
      if (!deserializeJson(doc, http.getString())) {
        uint32_t ns = doc["seq"] | seq;
        if (ns != seq) {
          seq = ns;
          JsonObject set = doc["set"];
          portENTER_CRITICAL(&mux);
          if (set["circle"].is<bool>()) sh.circle = set["circle"];
          if (set["radius"].is<float>()) sh.radius = constrain(set["radius"].as<float>(), 0.0f, 45.0f);
          if (set["period"].is<float>()) sh.period = constrain(set["period"].as<float>(), 3.0f, 15.0f);
          portEXIT_CRITICAL(&mux);
          if (set["level"].is<long>()) {
            long n = set["level"];
            if (lastLevel >= 0 && n != lastLevel) {
              portENTER_CRITICAL(&mux);
              sh.levelUntil = millis() + 1500;
              portEXIT_CRITICAL(&mux);
            }
            lastLevel = n;
          }
        }
      }
    } else if (code == 429) {
      int wait = http.header("Retry-After").toInt();
      vTaskDelay(pdMS_TO_TICKS(1000 * max(wait, 5)));
    } else if (code != 204) {
      vTaskDelay(pdMS_TO_TICKS(5000));
    }
    http.end();
  }
}

// ================================================================ setup + 100 Hz control loop (core 1)
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BOOT, INPUT_PULLUP);
  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(50);
  float zero[3] = {0, 0, 0};
  writeArms(zero, false);                 // arms horizontal: fit the horns in this position

  prefs.begin("premake", false);
  if (digitalRead(PIN_BOOT) == LOW) {
    uint32_t t0 = millis();
    while (digitalRead(PIN_BOOT) == LOW && millis() - t0 < 3000) delay(10);
    if (millis() - t0 >= 3000) { prefs.clear(); Serial.println("Wi-Fi settings cleared"); }
  }
  prefs.end();
  delay(1500);
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);
}

void loop() {
  static uint32_t next = micros(), lastStat = 0, loops = 0;
  static float px = 0, py = 0, vx = 0, vy = 0, ix = 0, iy = 0;
  static int lost = 100;
  static float tx = 0, ty = 0;

  uint32_t now = micros();
  if ((int32_t)(now - next) < 0) return;
  next += (uint32_t)(1e6f / LOOP_HZ);
  if ((int32_t)(now - next) > 50000) next = now;   // fell behind (serial test etc.)
  serialCommands();

  Shared s;
  portENTER_CRITICAL(&mux);
  s = sh;
  portEXIT_CRITICAL(&mux);

  float sx = 0, sy = 0;
  if (s.circle) {
    float w = 2 * PI * (millis() / 1000.0f) / s.period;
    sx = s.radius * cosf(w);
    sy = s.radius * sinf(w);
  }

  float bx, by;
  bool on = readBall(bx, by);
  if (on && lost < 5 && hypotf(bx - px, by - py) > 25) on = false;   // reject a spike
  if (on) {
    if (lost >= 5) { px = bx; py = by; vx = vy = 0; }
    float nx = 0.6f * bx + 0.4f * px, ny = 0.6f * by + 0.4f * py;
    vx = 0.35f * (nx - px) * LOOP_HZ + 0.65f * vx;
    vy = 0.35f * (ny - py) * LOOP_HZ + 0.65f * vy;
    px = nx; py = ny;
    float ex = sx - px, ey = sy - py;
    ix = constrain(ix + ex * DT, -40.0f, 40.0f);
    iy = constrain(iy + ey * DT, -40.0f, 40.0f);
    ty = KP * ex + KI * ix - KD * vx;      // +ty lowers +X: ball rolls towards +X
    tx = -(KP * ey + KI * iy - KD * vy);   // +tx raises +Y
    lost = 0;
  } else if (++lost > 20) {                // ball gone for 0.2 s: settle level
    tx *= 0.9f; ty *= 0.9f; ix = iy = 0;
  }
  if ((int32_t)(millis() - s.levelUntil) < 0) { tx = ty = 0; ix = iy = 0; }

  float mag = hypotf(tx, ty);
  if (mag > TILT_LIMIT) { tx *= TILT_LIMIT / mag; ty *= TILT_LIMIT / mag; }
  float arms[3];
  if (ik(tx, ty, arms)) writeArms(arms, true);

  loops++;
  if (millis() - lastStat >= 1000) {
    portENTER_CRITICAL(&mux);
    sh.hz = loops * 1000.0f / (millis() - lastStat);
    sh.bx = px; sh.by = py; sh.on = lost < 5; sh.err = hypotf(sx - px, sy - py);
    portEXIT_CRITICAL(&mux);
    loops = 0;
    lastStat = millis();
  }
}
