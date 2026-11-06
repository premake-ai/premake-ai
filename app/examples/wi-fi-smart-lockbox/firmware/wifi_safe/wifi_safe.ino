// WiFi lockbox: ESP32-C3 SuperMini + SG90. Open http://wifi-safe.local/
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ESP32Servo.h>

const int PIN_SERVO = 4;
const int ANGLE_LOCKED = 0, ANGLE_OPEN = 90;

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
const char* SAFE_PIN  = "1234";   // change me

WebServer server(80);
Servo bolt;
bool locked = true;
int badTries = 0;
unsigned long lockoutUntil = 0;

String page(const String& msg) {
  return "<html><meta name=viewport content='width=device-width'><body style='font-family:sans-serif'>"
         "<h2>Lockbox: " + String(locked ? "LOCKED" : "OPEN") + "</h2><p>" + msg + "</p>"
         "<form method=POST action=/unlock><input name=pin type=password inputmode=numeric><button>Unlock</button></form>"
         "<form method=POST action=/lock><button>Lock</button></form></body></html>";
}

void setLock(bool l) {
  locked = l;
  bolt.attach(PIN_SERVO);
  bolt.write(l ? ANGLE_LOCKED : ANGLE_OPEN);
  delay(600);
  bolt.detach();   // no jitter, no hum
}

void handleUnlock() {
  if (millis() < lockoutUntil) { server.send(429, "text/html", page("Too many tries, wait.")); return; }
  if (server.arg("pin") == SAFE_PIN) { badTries = 0; setLock(false); server.send(200, "text/html", page("Unlocked.")); }
  else {
    if (++badTries >= 5) { lockoutUntil = millis() + 60000; badTries = 0; }
    server.send(403, "text/html", page("Wrong PIN."));
  }
}

void setup() {
  setLock(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  MDNS.begin("wifi-safe");
  server.on("/", [] { server.send(200, "text/html", page("")); });
  server.on("/unlock", HTTP_POST, handleUnlock);
  server.on("/lock", HTTP_POST, [] { setLock(true); server.send(200, "text/html", page("Locked.")); });
  server.begin();
}

void loop() {
  server.handleClient();
  if (WiFi.status() != WL_CONNECTED) WiFi.reconnect();
}
