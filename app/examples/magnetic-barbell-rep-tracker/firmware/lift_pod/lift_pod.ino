// Lift Pod firmware: M5StickC PLUS2 (ESP32-PICO-V3-02 + MPU6886)
// Counts reps and measures bar speed with the built-in IMU, shows them on the
// screen and uploads one summary per set to Premake over Wi-Fi (works with iPhone,
// no Web Bluetooth needed). Use the gym Wi-Fi or the phone's Personal Hotspot.
//
// Libraries: M5Unified (Library Manager), WiFi, WebServer, HTTPClient, Preferences.
// Board: "M5StickCPlus2" (M5Stack board package).
//
// Pin map (all on the stick's own PCB, nothing to wire):
//   IMU MPU6886  I2C SDA G21 / SCL G22 (handled by M5Unified)
//   Button A     G37  front "M5" button: start a new set / wake screen
//   Button B     G39  side button: hold 3 s for Wi-Fi setup
//   Button C     G35  power button
//   Buzzer       G2   beep per rep
//   Hold         G4   power hold (M5Unified keeps it high)
//
// readings (fields sent to Premake): reps, set_no, mcv, best_mcv, peak_vel,
//   vel_loss_pct, rom_cm, tut_s, battery_pct

#include <M5Unified.h>
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <Preferences.h>

#define FW_VERSION "1.0.0"
static const char* INGEST_URL = "https://premake.ai/api/d/ingest";

// ---- tuning ----
static const float G = 9.80665f;
static const int   RATE_HZ = 200;
static const float START_V = 0.12f;     // m/s, concentric starts above this
static const float END_V = 0.04f;       // m/s, concentric ends below this
static const float MIN_ROM = 0.08f;     // m, ignore twitches shorter than 8 cm
static const float STILL_ACC = 0.35f;   // m/s^2 deviation to count as still
static const float STILL_GYRO = 12.0f;  // deg/s
static const uint32_t STILL_MS = 120;   // zero-velocity update after this
static const uint32_t SET_END_MS = 6000;// rest this long = set over

Preferences prefs;
WebServer server(80);
String ssid, pass, devkey;
uint32_t uploadIntervalMs = 20000, lastUploadMs = 0;

// gravity estimate (unit vector in sensor frame)
float gx = 0, gy = 0, gz = 1;
float vel = 0, disp = 0;
uint32_t stillSince = 0, lastRepMs = 0, lastUs = 0;
bool inConcentric = false;
float repStartDisp = 0, repVelSum = 0, repPeak = 0; uint32_t repSamples = 0, repStartMs = 0;

// set stats
int reps = 0, setNo = 0;
float lastMcv = 0, bestMcv = 0, peakVel = 0, lastRom = 0, tut = 0;
bool setPending = false;

// ---------- display ----------
void draw(const char* status = nullptr) {
  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setTextColor(TFT_GREEN, TFT_BLACK);
  d.setTextSize(5); d.setCursor(8, 8);  d.printf("%d", reps);
  d.setTextSize(2); d.setCursor(110, 12); d.printf("SET %d", setNo);
  d.setCursor(110, 40); d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.printf("%.2f m/s", lastMcv);
  float loss = bestMcv > 0 ? 100.0f * (bestMcv - lastMcv) / bestMcv : 0;
  d.setCursor(8, 80); d.printf("loss %2.0f%%  rom %2.0fcm", loss, lastRom * 100);
  d.setCursor(8, 110); d.setTextColor(TFT_DARKGREY, TFT_BLACK);
  d.printf("%d%% %s", M5.Power.getBatteryLevel(), status ? status : "");
}

// ---------- Wi-Fi setup portal ----------
void setupPortal() {
  char ap[40];
  snprintf(ap, sizeof ap, "Premake-LiftPod-%04X", (uint16_t)(ESP.getEfuseMac() & 0xFFFF));
  WiFi.mode(WIFI_AP);
  WiFi.softAP(ap);
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextSize(2); M5.Display.setCursor(4, 10);
  M5.Display.printf("Join Wi-Fi\n%s\nopen 192.168.4.1", ap);
  server.on("/", HTTP_GET, [] {
    server.send(200, "text/html",
      "<meta name=viewport content='width=device-width'><h3>Lift Pod setup</h3>"
      "<form method=post action=/save>Wi-Fi name<br><input name=s><br>Password<br>"
      "<input name=p type=password><br>Device key<br><input name=k><br><br>"
      "<button>Save</button></form>");
  });
  server.on("/save", HTTP_POST, [] {
    prefs.putString("ssid", server.arg("s"));
    prefs.putString("pass", server.arg("p"));
    prefs.putString("key", server.arg("k"));
    server.send(200, "text/html", "Saved. Restarting...");
    delay(800); ESP.restart();
  });
  server.begin();
  while (true) { server.handleClient(); M5.update(); delay(5); }
}

// ---------- upload (Wi-Fi only on between sets, to save the 200 mAh cell) ----------
bool wifiUp(uint32_t timeoutMs = 8000) {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());
  uint32_t t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < timeoutMs) delay(50);
  return WiFi.status() == WL_CONNECTED;
}

void wifiDown() { WiFi.disconnect(true); WiFi.mode(WIFI_OFF); }

void uploadSet() {
  if (devkey.isEmpty() || millis() - lastUploadMs < uploadIntervalMs) return;
  draw("sync...");
  if (!wifiUp()) { draw("no wifi"); wifiDown(); return; }
  float loss = bestMcv > 0 ? 100.0f * (bestMcv - lastMcv) / bestMcv : 0;
  char body[320];
  snprintf(body, sizeof body,
    "{\"r\":{\"reps\":%d,\"set_no\":%d,\"mcv\":%.3f,\"best_mcv\":%.3f,\"peak_vel\":%.3f,"
    "\"vel_loss_pct\":%.1f,\"rom_cm\":%.1f,\"tut_s\":%.1f,\"battery_pct\":%d},\"fw\":\"" FW_VERSION "\"}",
    reps, setNo, lastMcv, bestMcv, peakVel, loss, lastRom * 100, tut, M5.Power.getBatteryLevel());
  HTTPClient http;
  http.setTimeout(10000);
  http.begin(INGEST_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Device " + devkey);
  int code = http.POST(body);
  if (code == 200) {
    String r = http.getString();
    int i = r.indexOf("\"interval\":");
    if (i >= 0) uploadIntervalMs = max(20, (int)r.substring(i + 11).toInt()) * 1000UL;
    setPending = false;
    lastUploadMs = millis();
    draw("synced");
  } else {
    draw("sync err");
  }
  http.end();
  wifiDown();
}

void newSet() {
  setNo++; reps = 0; lastMcv = bestMcv = peakVel = lastRom = tut = 0;
  vel = disp = 0; inConcentric = false;
  prefs.putInt("set", setNo);
  draw("ready");
}

// ---------- motion ----------
void processSample(float ax, float ay, float az, float gxs, float gys, float gzs, float dt) {
  // accel in g -> slow low-pass for the gravity direction while roughly still
  float an = sqrtf(ax * ax + ay * ay + az * az);
  float gyro = sqrtf(gxs * gxs + gys * gys + gzs * gzs);
  float k = (gyro < 30 && fabsf(an - 1.0f) < 0.15f) ? 0.02f : 0.002f;
  gx += k * (ax / an - gx); gy += k * (ay / an - gy); gz += k * (az / an - gz);
  float gn = sqrtf(gx * gx + gy * gy + gz * gz); gx /= gn; gy /= gn; gz /= gn;

  // vertical (along gravity, up positive) linear acceleration, m/s^2
  float aVert = ((ax * gx + ay * gy + az * gz) - 1.0f) * G;

  uint32_t now = millis();
  bool still = fabsf(aVert) < STILL_ACC && gyro < STILL_GYRO;
  if (!still) stillSince = now;
  if (now - stillSince > STILL_MS) { vel = 0; }        // zero-velocity update
  else { vel += aVert * dt; vel *= 0.999f; }             // leaky integrator
  disp += vel * dt;

  if (!inConcentric && vel > START_V) {
    inConcentric = true; repStartDisp = disp; repVelSum = 0; repSamples = 0;
    repPeak = 0; repStartMs = now;
  }
  if (inConcentric) {
    repVelSum += vel; repSamples++; repPeak = max(repPeak, vel);
    if (vel < END_V) {
      inConcentric = false;
      float rom = disp - repStartDisp;
      if (rom > MIN_ROM && repSamples > 10) {
        reps++; lastRepMs = now; setPending = true;
        lastMcv = repVelSum / repSamples;
        bestMcv = max(bestMcv, lastMcv);
        peakVel = max(peakVel, repPeak);
        lastRom = rom;
        tut += (now - repStartMs) / 1000.0f;
        M5.Speaker.tone(2800, 40);
        draw();
      }
    }
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(80);
  prefs.begin("liftpod", false);
  ssid = prefs.getString("ssid", "");
  pass = prefs.getString("pass", "");
  devkey = prefs.getString("key", "");
  setNo = prefs.getInt("set", 0);
  WiFi.mode(WIFI_OFF);
  if (ssid.isEmpty()) setupPortal();
  newSet();
  lastUs = micros();
}

void loop() {
  M5.update();
  if (M5.BtnB.pressedFor(3000)) { prefs.putString("ssid", ""); setupPortal(); }
  if (M5.BtnA.wasPressed()) {
    if (setPending) uploadSet();
    newSet();
  }

  if (M5.Imu.update()) {
    auto d = M5.Imu.getImuData();
    uint32_t us = micros();
    float dt = (us - lastUs) / 1e6f; lastUs = us;
    if (dt > 0 && dt < 0.05f)
      processSample(d.accel.x, d.accel.y, d.accel.z, d.gyro.x, d.gyro.y, d.gyro.z, dt);
  }

  // set over after a rest: send the summary, then start counting the next set
  if (reps > 0 && setPending && millis() - lastRepMs > SET_END_MS) {
    uploadSet();
    if (!setPending) newSet();
  }
  delay(1000 / RATE_HZ);
}
