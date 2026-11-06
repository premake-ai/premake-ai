// Board: ESP32 DevKit (ESP32-WROOM-32)
// Runs on the AI-Thinker ESP32-CAM (ESP32-D0WD, same chip). Flash it through the ESP32-CAM-MB's micro-USB.
// Care Cam: private home camera. MJPEG stream on the local network only, no cloud.
//
// Pin map (AI-Thinker ESP32-CAM):
//   Camera: PWDN 32, XCLK 0, SDA 26, SCL 27, D7..D0 = 35 34 39 36 21 19 18 5,
//           VSYNC 25, HREF 23, PCLK 22
//   Status LED (green, via 220 ohm): GPIO13 -> LED -> GND
//   Flash LED GPIO4: kept OFF
// Status LED: fast blink = no Wi-Fi, solid dim = on Wi-Fi, slow pulse = someone is watching.
// Stream: http://carecam.local/ (user "family", password printed on Serial at boot)

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include "premake_wifi.h"

#define PIN_STATUS 13
#define PIN_FLASH 4

WebServer server(80);
Preferences prefs;
String password;
bool serverStarted = false;
volatile bool streaming = false;
bool cameraOk = false;

void ledTask(void *arg) {
  int phase = 0;
  for (;;) {
    int duty;
    if (!PremakeWiFi.connected()) {
      duty = (phase % 4 < 2) ? 60 : 0;          // fast blink
    } else if (streaming) {
      int p = phase % 40;
      duty = 5 + (p < 20 ? p : 40 - p) * 4;      // slow pulse
    } else {
      duty = 25;                                 // solid dim
    }
    ledcWrite(PIN_STATUS, duty);
    phase++;
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

bool startCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 5;  c.pin_d1 = 18; c.pin_d2 = 19; c.pin_d3 = 21;
  c.pin_d4 = 36; c.pin_d5 = 39; c.pin_d6 = 34; c.pin_d7 = 35;
  c.pin_xclk = 0;
  c.pin_pclk = 22;
  c.pin_vsync = 25;
  c.pin_href = 23;
  c.pin_sccb_sda = 26;
  c.pin_sccb_scl = 27;
  c.pin_pwdn = 32;
  c.pin_reset = -1;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.grab_mode = CAMERA_GRAB_LATEST;
  if (psramFound()) {
    c.frame_size = FRAMESIZE_SVGA;
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    c.frame_size = FRAMESIZE_VGA;
    c.jpeg_quality = 14;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[carecam] camera not found (0x%x)\n", err);
    return false;
  }
  Serial.println("[carecam] camera ok");
  return true;
}

bool checkAuth() {
  if (!server.authenticate("family", password.c_str())) {
    server.requestAuthentication();
    return false;
  }
  return true;
}

void handleRoot() {
  if (!checkAuth()) return;
  server.send(200, "text/html",
              "<!doctype html><html><head><meta name=viewport content='width=device-width'>"
              "<title>Care Cam</title></head><body style='margin:0;background:#111'>"
              "<img src='/stream' style='width:100%'></body></html>");
}

void handleCapture() {
  if (!checkAuth()) return;
  if (!cameraOk) { server.send(503, "text/plain", "camera not found"); return; }
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { server.send(503, "text/plain", "no frame"); return; }
  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");
  server.client().write(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void handleStream() {
  if (!checkAuth()) return;
  if (!cameraOk) { server.send(503, "text/plain", "camera not found"); return; }
  auto &client = server.client();
  client.print("HTTP/1.1 200 OK\r\n"
               "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n"
               "Cache-Control: no-cache\r\n\r\n");
  streaming = true;
  Serial.println("[carecam] viewer connected");
  while (client.connected()) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) { delay(20); continue; }
    client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n",
                  (unsigned)fb->len);
    size_t sent = client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);
    if (sent == 0) break;
    delay(30);   // ~15-20 fps max
  }
  streaming = false;
  Serial.println("[carecam] viewer left");
}

void setup() {
  PremakeWiFi.begin("Care Cam", "1.0.0");

  pinMode(PIN_FLASH, OUTPUT);
  digitalWrite(PIN_FLASH, LOW);
  ledcAttach(PIN_STATUS, 5000, 8);
  ledcWrite(PIN_STATUS, 0);

  prefs.begin("carecam", false);
  password = prefs.getString("pass", "");
  if (password.length() < 8) {
    const char *abc = "abcdefghjkmnpqrstuvwxyz23456789";
    password = "";
    for (int i = 0; i < 10; i++) password += abc[esp_random() % 31];
    prefs.putString("pass", password);
  }
  Serial.println("[carecam] login: family / " + password);

  cameraOk = startCamera();
  xTaskCreatePinnedToCore(ledTask, "led", 2048, NULL, 1, NULL, 0);

  server.on("/", handleRoot);
  server.on("/stream", handleStream);
  server.on("/capture", handleCapture);
}

void loop() {
  if (PremakeWiFi.connected()) {
    if (!serverStarted) {
      server.begin();
      if (MDNS.begin("carecam")) MDNS.addService("http", "tcp", 80);
      serverStarted = true;
      Serial.print("[carecam] connected, stream at http://carecam.local/  or http://");
      Serial.println(WiFi.localIP());
    }
    server.handleClient();
  }
  delay(2);
}
