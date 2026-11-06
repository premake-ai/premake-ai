// Camera slider: ESP32-C3 SuperMini + TMC2209 (1/8 step) + NEMA17, GT2 20T pulley.
// Join Wi-Fi "Slider" (password "slider123"), open http://192.168.4.1
#include <WiFi.h>
#include <WebServer.h>
#include <AccelStepper.h>

const int PIN_STEP = 4, PIN_DIR = 5, PIN_EN = 6, PIN_LIMIT = 7;
const float STEPS_PER_MM = 200.0 * 8 / 40.0;   // 40 steps/mm
const float TRAVEL_MM = 495;                   // usable travel after homing
const float BACKOFF_MM = 3;

AccelStepper motor(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);
WebServer server(80);
bool homed = false;

void home() {
  digitalWrite(PIN_EN, LOW);
  motor.setMaxSpeed(40 * STEPS_PER_MM);
  motor.setSpeed(-20 * STEPS_PER_MM);
  while (digitalRead(PIN_LIMIT) == HIGH) { motor.runSpeed(); yield(); }
  motor.setCurrentPosition(0);
  motor.runToNewPosition(BACKOFF_MM * STEPS_PER_MM);
  motor.setCurrentPosition(0);
  homed = true;
}

// Move from a to b (mm) in s seconds with a gentle ramp.
void moveTo(float a, float b, float s) {
  a = constrain(a, 0, TRAVEL_MM); b = constrain(b, 0, TRAVEL_MM);
  motor.setMaxSpeed(80 * STEPS_PER_MM);
  motor.setAcceleration(40 * STEPS_PER_MM);
  motor.runToNewPosition(a * STEPS_PER_MM);
  float v = fabs(b - a) / max(s, 1.0f);
  motor.setMaxSpeed(max(v, 0.2f) * STEPS_PER_MM);
  motor.setAcceleration(max(v, 1.0f) * STEPS_PER_MM);
  motor.moveTo(b * STEPS_PER_MM);
}

const char PAGE[] PROGMEM = R"(<html><meta name=viewport content='width=device-width'>
<body style='font-family:sans-serif'><h2>Camera Slider</h2>
<form action=/go>Start mm <input name=a value=0><br>End mm <input name=b value=495><br>
Seconds <input name=s value=30><br><button>Go</button></form>
<a href=/home>Home</a> &nbsp; <a href=/stop>Stop</a></body></html>)";

void setup() {
  pinMode(PIN_EN, OUTPUT); digitalWrite(PIN_EN, HIGH);
  pinMode(PIN_LIMIT, INPUT_PULLUP);
  WiFi.softAP("Slider", "slider123");
  server.on("/", [] { server.send_P(200, "text/html", PAGE); });
  server.on("/home", [] { home(); server.sendHeader("Location", "/"); server.send(303); });
  server.on("/stop", [] { motor.stop(); server.sendHeader("Location", "/"); server.send(303); });
  server.on("/go", [] {
    if (!homed) home();
    moveTo(server.arg("a").toFloat(), server.arg("b").toFloat(), server.arg("s").toFloat());
    server.sendHeader("Location", "/"); server.send(303);
  });
  server.begin();
}

void loop() {
  server.handleClient();
  motor.run();
  if (digitalRead(PIN_LIMIT) == LOW && motor.speed() < 0 && homed) motor.setCurrentPosition(0);
}
