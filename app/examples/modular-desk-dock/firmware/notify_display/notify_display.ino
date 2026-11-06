// E-paper notification module: ESP32-C3 SuperMini + 2.9" 296x128 SPI e-paper.
// Send a message:  http://<ip>/notify?msg=Stand-up%20at%2010:30
// Libraries: GxEPD2 (+ Adafruit GFX), WiFi, WebServer (ESP32 core).
#include <WiFi.h>
#include <WebServer.h>
#include <SPI.h>
#include <GxEPD2_BW.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSans9pt7b.h>

// --- pin map ---
#define PIN_SCK  4
#define PIN_MOSI 6
#define PIN_CS   7
#define PIN_DC   5
#define PIN_RST  10
#define PIN_BUSY 3

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";

GxEPD2_BW<GxEPD2_290_T94_V2, GxEPD2_290_T94_V2::HEIGHT> epd(
    GxEPD2_290_T94_V2(PIN_CS, PIN_DC, PIN_RST, PIN_BUSY));
WebServer server(80);
String lastMsg = "No new notifications";
int count = 0;

void draw() {
  epd.setRotation(1);  // landscape 296 x 128
  epd.setFullWindow();
  epd.firstPage();
  do {
    epd.fillScreen(GxEPD_WHITE);
    epd.setTextColor(GxEPD_BLACK);
    epd.setFont(&FreeSansBold12pt7b);
    epd.setCursor(8, 28);
    epd.print(String(count) + " new");
    epd.setFont(&FreeSans9pt7b);
    epd.setCursor(8, 64);
    epd.print(lastMsg.substring(0, 30));
    if (lastMsg.length() > 30) { epd.setCursor(8, 88); epd.print(lastMsg.substring(30, 60)); }
    epd.setCursor(8, 120);
    epd.print(WiFi.localIP().toString());
  } while (epd.nextPage());
  epd.hibernate();
}

void handleNotify() {
  if (server.hasArg("msg")) { lastMsg = server.arg("msg"); count++; }
  if (server.hasArg("clear")) { lastMsg = "No new notifications"; count = 0; }
  server.send(200, "text/plain", "ok");
  draw();
}

void setup() {
  SPI.begin(PIN_SCK, -1, PIN_MOSI, PIN_CS);
  epd.init(115200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(250);
  server.on("/notify", handleNotify);
  server.begin();
  draw();
}

void loop() {
  server.handleClient();
}
