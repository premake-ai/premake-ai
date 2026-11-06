// Smart Roller Blind Motor - ESP32-C3 SuperMini + TMC2209 (step/dir) + NEMA17
// Phone control: open http://blind.local (or the IP printed on Serial).
// Libraries: AccelStepper, plus ESP32 core (WiFi, WebServer, ESPmDNS, Preferences).
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <AccelStepper.h>

// ---- pin map ----
// ULN2003 IN1..IN4
const int PIN_IN1 = 25, PIN_IN2 = 26, PIN_IN3 = 27, PIN_IN4 = 14;
const int PIN_BTN  = 33;   // to GND, internal pull-up

// ---- settings ----
const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
const long STEPS_PER_REV = 4096;              // 28BYJ-48, half-step
// 12-pocket sprocket x 6 mm pitch = 72 mm of chain per turn
const float MAX_SPEED = 700;                  // steps/s (~12 mm/s chain, max torque)
const float ACCEL     = 400;

// AccelStepper wants the 28BYJ-48 coil order IN1, IN3, IN2, IN4
AccelStepper stepper(AccelStepper::HALF4WIRE, PIN_IN1, PIN_IN3, PIN_IN2, PIN_IN4);
WebServer server(80);
Preferences prefs;

long topPos = 0;          // fully open
long bottomPos = 20000;   // fully closed (set from the phone)
bool limitsSet = false;
bool wasRunning = false;
bool lastBtn = HIGH;
int  lastDir = 1;         // button toggles direction

const char PAGE[] PROGMEM = R"HTML(<!doctype html><html><head>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font-family:sans-serif;max-width:380px;margin:20px auto;text-align:center}
button{font-size:20px;width:30%;padding:14px;margin:4px;border-radius:10px}
input{width:90%}small button{font-size:14px;width:45%;padding:8px}</style></head><body>
<h2>Blind</h2>
<button onclick="go('open')">Open</button><button onclick="go('stop')">Stop</button><button onclick="go('close')">Close</button>
<p><input type=range min=0 max=100 id=p onchange="go('pos?p='+this.value)"></p>
<p id=s></p><hr><small>Setup: jog, then save limits<br>
<button onclick="go('jog?d=-1')">Jog up</button><button onclick="go('jog?d=1')">Jog down</button><br>
<button onclick="go('settop')">Save as top</button><button onclick="go('setbottom')">Save as bottom</button><br>
<button onclick="go('reverse')">Reverse motor</button></small>
<script>function go(c){fetch('/'+c).then(r=>r.text()).then(t=>s.innerText=t)}
setInterval(()=>go('status'),2000);go('status')</script></body></html>)HTML";

void enableMotor(bool on) { if (on) stepper.enableOutputs(); else stepper.disableOutputs(); }

void moveTo(long target) {
  enableMotor(true);
  stepper.moveTo(target);
}

int percent() {
  if (bottomPos == topPos) return 0;
  return constrain((stepper.currentPosition() - topPos) * 100 / (bottomPos - topPos), 0, 100);
}

String status() {
  return String(limitsSet ? "" : "Limits not set. ") + "Closed " + percent() + "%" +
         (stepper.isRunning() ? " (moving)" : "");
}

void reply() { server.send(200, "text/plain", status()); }

void setup() {
  Serial.begin(115200);
  enableMotor(false);
  pinMode(PIN_BTN, INPUT_PULLUP);

  prefs.begin("blind", false);
  topPos    = prefs.getLong("top", 0);
  bottomPos = prefs.getLong("bottom", 20000);
  limitsSet = prefs.getBool("set", false);
  stepper.setPinsInverted(prefs.getBool("rev", false), false, false);
  stepper.setCurrentPosition(prefs.getLong("pos", 0));
  stepper.setMaxSpeed(MAX_SPEED);
  stepper.setAcceleration(ACCEL);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  Serial.println(WiFi.localIP());
  MDNS.begin("blind");

  server.on("/", [] { server.send_P(200, "text/html", PAGE); });
  server.on("/status", reply);
  server.on("/open",  [] { if (limitsSet) moveTo(topPos); reply(); });
  server.on("/close", [] { if (limitsSet) moveTo(bottomPos); reply(); });
  server.on("/stop",  [] { stepper.stop(); reply(); });
  server.on("/pos", [] {
    if (limitsSet) moveTo(topPos + (bottomPos - topPos) * server.arg("p").toInt() / 100);
    reply();
  });
  server.on("/jog", [] {   // ~1 turn per tap; no limits while setting up
    moveTo(stepper.currentPosition() + server.arg("d").toInt() * STEPS_PER_REV);
    reply();
  });
  server.on("/settop", [] {
    topPos = stepper.currentPosition();
    prefs.putLong("top", topPos);
    limitsSet = (topPos != bottomPos);
    prefs.putBool("set", limitsSet);
    reply();
  });
  server.on("/setbottom", [] {
    bottomPos = stepper.currentPosition();
    prefs.putLong("bottom", bottomPos);
    limitsSet = (topPos != bottomPos);
    prefs.putBool("set", limitsSet);
    reply();
  });
  server.on("/reverse", [] {
    bool r = !prefs.getBool("rev", false);
    prefs.putBool("rev", r);
    stepper.setPinsInverted(r, false, false);
    reply();
  });
  server.begin();
}

void loop() {
  server.handleClient();
  stepper.run();

  // manual button: press = go the other way, press while moving = stop
  bool b = digitalRead(PIN_BTN);
  if (lastBtn == HIGH && b == LOW && limitsSet) {
    if (stepper.isRunning()) stepper.stop();
    else { lastDir = -lastDir; moveTo(lastDir > 0 ? bottomPos : topPos); }
    delay(30);
  }
  lastBtn = b;

  // when a move ends: save position (survives power cuts), release the motor.
  // The blind's own clutch holds the blind, so the driver can sleep (silent, cool).
  bool running = stepper.isRunning();
  if (wasRunning && !running) {
    prefs.putLong("pos", stepper.currentPosition());
    enableMotor(false);
  }
  wasRunning = running;
}
