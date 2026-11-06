// Motorized roller blind: ESP32-C3 SuperMini + TMC2209 (UART + StallGuard) + NEMA17
// Open http://blind.local (or the IP printed on Serial) on your phone.
// Libraries: AccelStepper, TMCStepper (both in the Arduino Library Manager).
//
// Homing: the TOP of the blind is found sensorlessly. The motor winds the blind up
// slowly at reduced current until the bottom bar touches the headrail; the TMC2209's
// StallGuard sees the load jump and raises DIAG. That point (minus a small back-off)
// is position 0 = fully open. Fully closed is stored as a step count from there.
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <AccelStepper.h>
#include <TMCStepper.h>

// ---- pin map (avoid strapping pins 2, 8, 9) ----
const int PIN_STEP = 4;
const int PIN_DIR  = 5;
const int PIN_EN   = 6;    // LOW = driver enabled
const int PIN_LED  = 7;
const int PIN_DIAG = 3;    // TMC2209 DIAG, HIGH on stall
const int PIN_TX   = 21;   // -> 1k -> TMC2209 PDN_UART
const int PIN_RX   = 20;   // <- TMC2209 PDN_UART

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";

// 200 steps x 8 microsteps = 1600 steps/rev ~ 96 mm of chain
const float MAX_SPEED   = 1600;  // steps/s
const float ACCEL       = 2000;
const float HOME_SPEED  = 500;   // slow and gentle for stall detection
const int   RUN_MA      = 900;
const int   HOME_MA     = 500;   // low current: stalls softly, can't strain the blind
const long  BACKOFF     = 160;   // steps below the stall point that count as "fully open"
const long  NEAR_TOP    = 800;   // full "Open" goes fast to here, then re-homes slowly

AccelStepper motor(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);
TMC2209Stepper driver(&Serial1, 0.11f, 0b00);
WebServer server(80);
Preferences prefs;

long bottomPos = 20000;          // fully closed (steps from top), set from the phone
int  sgThreshold = 70;           // StallGuard sensitivity: higher = trips more easily
enum { IDLE, MOVING, HOME_FAST, HOMING, BACKING } state = IDLE;
bool homed = false;
uint32_t homeStart;
String status = "booting";

const char PAGE[] PROGMEM = R"(<!doctype html><meta name=viewport content="width=device-width">
<style>body{font-family:sans-serif;text-align:center}button{font-size:1.3em;width:80%;margin:6px;padding:12px}</style>
<h2>Blind</h2>
<button onclick="f('/open')">Open</button><button onclick="f('/stop')">Stop</button>
<button onclick="f('/close')">Close</button>
<input type=range min=0 max=100 style="width:80%" onchange="f('/pos?p='+this.value)">
<h4>Setup</h4>
<button onclick="f('/home')">Home now (find top)</button>
<button onclick="f('/jog?d=-400')">Jog up</button><button onclick="f('/jog?d=400')">Jog down</button>
<button onclick="f('/setbottom')">Here = fully closed</button>
StallGuard <input type=number id=sg style="width:4em"><button style="width:auto" onclick="f('/sg?v='+sg.value)">Set</button>
<p id=s></p><script>function f(u){fetch(u).then(r=>r.text()).then(t=>s.innerText=t)}f('/status')</script>)";

void current(int ma) { driver.rms_current(ma); }

void enable(bool on) { digitalWrite(PIN_EN, on ? LOW : HIGH); }

void markMoving() { prefs.putBool("moving", true); }   // if power dies now, re-home on boot

void moveTo(long p) {
  if (!homed) { startHoming(); return; }
  enable(true);
  current(RUN_MA);
  if (p <= 0) {                     // full open: fast to near the top, then re-home slowly
    motor.moveTo(NEAR_TOP);
    state = HOME_FAST;
  } else {
    motor.moveTo(constrain(p, 0, bottomPos));
    state = MOVING;
  }
  markMoving();
}

void startHoming() {
  enable(true);
  current(HOME_MA);
  motor.setMaxSpeed(HOME_SPEED);
  motor.move(-(bottomPos + 4000));  // up; give up if no stall after the full travel + margin
  homeStart = millis();
  state = HOMING;
  status = "homing";
  markMoving();
}

void finish(const char* msg) {
  motor.setMaxSpeed(MAX_SPEED);
  current(RUN_MA);
  enable(false);                    // the blind's own clutch holds it
  prefs.putLong("pos", motor.currentPosition());
  prefs.putBool("moving", false);
  state = IDLE;
  status = msg;
}

String report() {
  return status + " | pos " + String(motor.currentPosition()) + " / " + String(bottomPos) +
         " | homed " + String(homed) + " | SG " + String(driver.SG_RESULT()) + " thr " + String(sgThreshold);
}
void ok() { server.send(200, "text/plain", report()); }

void setup() {
  Serial.begin(115200);
  pinMode(PIN_EN, OUTPUT);
  enable(false);
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_DIAG, INPUT);

  prefs.begin("blind", false);
  bottomPos   = prefs.getLong("bottom", bottomPos);
  sgThreshold = prefs.getInt("sg", sgThreshold);

  Serial1.begin(115200, SERIAL_8N1, PIN_RX, PIN_TX);
  driver.begin();
  driver.toff(4);
  driver.blank_time(24);
  driver.microsteps(8);
  driver.en_spreadCycle(false);     // StallGuard4 only works in StealthChop
  driver.pwm_autoscale(true);
  driver.TCOOLTHRS(0xFFFFF);        // StallGuard active at all speeds
  driver.SGTHRS(sgThreshold);
  current(RUN_MA);

  motor.setMaxSpeed(MAX_SPEED);
  motor.setAcceleration(ACCEL);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(250); }
  digitalWrite(PIN_LED, HIGH);
  Serial.println(WiFi.localIP());
  MDNS.begin("blind");

  server.on("/", [] { server.send(200, "text/html", PAGE); });
  server.on("/status", ok);
  server.on("/open", [] { moveTo(0); ok(); });
  server.on("/close", [] { moveTo(bottomPos); ok(); });
  server.on("/pos", [] { moveTo(bottomPos * server.arg("p").toInt() / 100); ok(); });
  server.on("/stop", [] { motor.setCurrentPosition(motor.currentPosition()); finish("stopped"); ok(); });
  server.on("/home", [] { startHoming(); ok(); });
  server.on("/jog", [] { enable(true); state = MOVING; motor.move(server.arg("d").toInt()); markMoving(); ok(); });
  server.on("/setbottom", [] { bottomPos = motor.currentPosition(); prefs.putLong("bottom", bottomPos); ok(); });
  server.on("/sg", [] {
    sgThreshold = constrain(server.arg("v").toInt(), 0, 255);
    driver.SGTHRS(sgThreshold); prefs.putInt("sg", sgThreshold); ok();
  });
  server.begin();

  // Power-cut recovery: if we were stopped cleanly, the saved position is right.
  // If power died mid-move (or never saved), find the top again.
  if (!prefs.getBool("moving", true)) {
    motor.setCurrentPosition(prefs.getLong("pos", 0));
    homed = true;
    status = "restored saved position";
  } else {
    startHoming();
  }
}

void loop() {
  server.handleClient();
  motor.run();

  switch (state) {
    case HOMING:
      // ignore DIAG while accelerating (StallGuard reads garbage at low speed)
      if (millis() - homeStart > 400 && digitalRead(PIN_DIAG)) {
        motor.setCurrentPosition(-BACKOFF);   // stall point; 0 is just below it
        homed = true;
        motor.setMaxSpeed(HOME_SPEED);
        motor.moveTo(0);
        state = BACKING;
      } else if (motor.distanceToGo() == 0) {
        finish("homing failed: no stall (lower StallGuard? chain slipping?)");
      }
      break;
    case HOME_FAST:
      if (motor.distanceToGo() == 0) startHoming();
      break;
    case BACKING:
      if (motor.distanceToGo() == 0) finish("open (homed)");
      break;
    case MOVING:
      if (motor.distanceToGo() == 0) finish("idle");
      break;
    default:
      break;
  }
}
