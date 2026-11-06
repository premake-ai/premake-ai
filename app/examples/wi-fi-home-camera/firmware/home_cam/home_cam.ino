// Board: ESP32 DevKit (ESP32-WROOM-32)
// (HiLetgo ESP32-CAM, Ai-Thinker layout, ESP32-S + OV3660, flashed through the ESP32-CAM-MB board)
//
// Home Camera: live MJPEG stream on the local network.
//   http://homecam.local/         page with the live view
//   http://<ip>:81/stream         MJPEG stream
//   http://homecam.local/capture  single JPEG
//
// Pin map (no external wiring, Ai-Thinker ESP32-CAM camera bus):
//   PWDN 32, RESET -1, XCLK 0, SIOD 26, SIOC 27,
//   Y9 35, Y8 34, Y7 39, Y6 36, Y5 21, Y4 19, Y3 18, Y2 5,
//   VSYNC 25, HREF 23, PCLK 22
//   Red status LED: GPIO33 (active LOW). Flash LED GPIO4 kept off.
//
// Readings to Premake: online (1), uptime_min, rssi

#include "premake_wifi.h"
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "esp_camera.h"

#define LED_PIN 33
#define FLASH_PIN 4

WebServer web(80);
WiFiServer streamServer(81);

volatile bool camOk = false;
unsigned long ingestIntervalMs = 60000;
unsigned long lastIngestMs = 0;
bool netStarted = false;

bool startCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = 5;
  c.pin_d1 = 18;
  c.pin_d2 = 19;
  c.pin_d3 = 21;
  c.pin_d4 = 36;
  c.pin_d5 = 39;
  c.pin_d6 = 34;
  c.pin_d7 = 35;
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
    c.frame_size = FRAMESIZE_VGA;
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    c.frame_size = FRAMESIZE_QVGA;
    c.jpeg_quality = 15;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[homecam] camera init failed 0x%x\n", err);
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  if (s && s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  Serial.println("[homecam] camera ok");
  return true;
}

void handleRoot() {
  String page =
    "<!doctype html><html><head><meta name=viewport content='width=device-width'>"
    "<title>Home Camera</title><style>body{margin:0;background:#111;color:#ddd;font-family:sans-serif;text-align:center}"
    "img{width:100%;max-width:800px}</style></head><body><h3>Home Camera</h3>"
    "<img id=v><script>"
    "document.getElementById('v').src='http://'+location.hostname+':81/stream';"
    "</script></body></html>";
  web.send(200, "text/html", page);
}

void handleCapture() {
  if (!camOk) { web.send(503, "text/plain", "camera not found"); return; }
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { web.send(500, "text/plain", "capture failed"); return; }
  web.sendHeader("Access-Control-Allow-Origin", "*");
  web.send_P(200, "image/jpeg", (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// MJPEG stream runs in its own task so the web page stays responsive
void streamTask(void *arg) {
  for (;;) {
    WiFiClient client = streamServer.available();
    if (!client) { vTaskDelay(pdMS_TO_TICKS(50)); continue; }
    unsigned long t0 = millis();
    while (client.connected() && millis() - t0 < 1000) {
      String line = client.readStringUntil('\n');
      if (line.length() <= 1) break;
    }
    client.print("HTTP/1.1 200 OK\r\n"
                 "Access-Control-Allow-Origin: *\r\n"
                 "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n");
    Serial.println("[homecam] stream client connected");
    digitalWrite(LED_PIN, LOW);
    while (client.connected() && camOk) {
      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) { vTaskDelay(pdMS_TO_TICKS(20)); continue; }
      client.printf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n", fb->len);
      size_t sent = client.write(fb->buf, fb->len);
      client.print("\r\n");
      esp_camera_fb_return(fb);
      if (sent == 0) break;
      vTaskDelay(pdMS_TO_TICKS(30));
    }
    client.stop();
    digitalWrite(LED_PIN, HIGH);
    Serial.println("[homecam] stream client gone");
  }
}

void sendReadings() {
  if (!PremakeWiFi.connected()) return;
  WiFiClientSecure tls;
  tls.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(tls, "https://premake.ai/api/d/ingest")) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Device ") + PremakeWiFi.deviceKey());
  String body = String("{\"r\":{\"online\":") + (camOk ? 1 : 0) +
                ",\"uptime_min\":" + String(millis() / 60000UL) +
                ",\"rssi\":" + String(WiFi.RSSI()) + "},\"fw\":\"1.0.0\"}";
  int code = http.POST(body);
  if (code == 200) {
    String reply = http.getString();
    int i = reply.indexOf("\"interval\":");
    if (i >= 0) {
      long s = reply.substring(i + 11).toInt();
      if (s >= 20) ingestIntervalMs = (unsigned long)s * 1000UL;
    }
  } else {
    Serial.printf("[homecam] ingest http %d\n", code);
  }
  http.end();
}

void startNetwork() {
  if (MDNS.begin("homecam")) MDNS.addService("http", "tcp", 80);
  web.on("/", handleRoot);
  web.on("/capture", handleCapture);
  web.on("/stream", []() {
    web.sendHeader("Location", String("http://") + WiFi.localIP().toString() + ":81/stream");
    web.send(302, "text/plain", "");
  });
  web.begin();
  streamServer.begin();
  xTaskCreatePinnedToCore(streamTask, "stream", 8192, nullptr, 1, nullptr, 0);
  netStarted = true;
  Serial.print("[homecam] connected, open http://homecam.local/ or http://");
  Serial.println(WiFi.localIP());
}

void setup() {
  PremakeWiFi.begin("Home Camera", "1.0.0");
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);   // off
  pinMode(FLASH_PIN, OUTPUT);
  digitalWrite(FLASH_PIN, LOW);  // bright flash LED off
  camOk = startCamera();
  if (!camOk) Serial.println("[homecam] camera not found, check the camera ribbon");
}

void loop() {
  if (!netStarted) {
    if (PremakeWiFi.connected()) startNetwork();
    else {
      static unsigned long lastMsg = 0;
      if (millis() - lastMsg > 10000) { lastMsg = millis(); Serial.println("[homecam] set up Wi-Fi"); }
    }
  } else {
    web.handleClient();
  }

  if (netStarted && (lastIngestMs == 0 || millis() - lastIngestMs > ingestIntervalMs)) {
    lastIngestMs = millis();
    sendReadings();
  }
  delay(10);
}
