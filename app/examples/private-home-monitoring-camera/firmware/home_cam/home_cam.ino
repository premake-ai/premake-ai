// Board: ESP32 DevKit (ESP32-WROOM-32)
// Hardware: AI-Thinker ESP32-CAM (ESP32 + OV2640) on an ESP32-CAM-MB, compiled as a plain ESP32.
// Home camera: MJPEG stream on the local network only (no cloud).
//   http://<ip>/        small page with the live view
//   http://<ip>/stream  raw MJPEG stream (VLC, Home Assistant, a browser)
//   also http://homecam.local/ via mDNS
//
// Pin map (AI-Thinker camera bus, fixed by the board):
//   PWDN 32, RESET -1, XCLK 0, SIOD 26, SIOC 27
//   Y9 35, Y8 34, Y7 39, Y6 36, Y5 21, Y4 19, Y3 18, Y2 5, VSYNC 25, HREF 23, PCLK 22
//   GPIO4  = on-board flash LED, held OFF (privacy, no glare)
//   GPIO13 = status LED (+ through 220 ohm, - to GND), soldered to the MB header joints
// Status LED: slow blink = no Wi-Fi set up / connecting, solid = connected, fast blink = camera error.

#include "esp_camera.h"
#include "esp_http_server.h"
#include <ESPmDNS.h>
#include <WiFi.h>
#include "premake_wifi.h"

#define STATUS_LED 13
#define FLASH_LED 4

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

static bool cameraOk = false;
static httpd_handle_t server = nullptr;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char INDEX_HTML[] =
  "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>Home Cam</title><style>body{margin:0;background:#111;color:#ddd;font-family:sans-serif;text-align:center}"
  "img{width:100%;max-width:800px}</style></head><body><img src='/stream'>"
  "<p>Local stream only. Slide the shutter on top to cover the lens.</p></body></html>";

static esp_err_t indexHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t *req) {
  esp_err_t res = httpd_resp_set_type(req, STREAM_TYPE);
  if (res != ESP_OK) return res;
  char partBuf[64];
  Serial.println("[homecam] stream client connected");
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[homecam] frame capture failed");
      res = ESP_FAIL;
      break;
    }
    size_t hlen = snprintf(partBuf, sizeof(partBuf), STREAM_PART, (unsigned)fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, partBuf, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  Serial.println("[homecam] stream client left");
  return res;
}

static void startServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  if (httpd_start(&server, &config) != ESP_OK) {
    Serial.println("[homecam] web server failed to start");
    return;
  }
  httpd_uri_t indexUri = {"/", HTTP_GET, indexHandler, nullptr};
  httpd_uri_t streamUri = {"/stream", HTTP_GET, streamHandler, nullptr};
  httpd_register_uri_handler(server, &indexUri);
  httpd_register_uri_handler(server, &streamUri);
}

static bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;
  c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;
  c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;
  c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;
  c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;
  c.pin_pclk = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM;
  c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM;
  c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;
  c.pin_reset = RESET_GPIO_NUM;
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
    Serial.printf("[homecam] camera not found (0x%x)\n", err);
    return false;
  }
  Serial.println("[homecam] camera ok");
  return true;
}

void setup() {
  PremakeWiFi.begin("Home Cam", "1.0.0");
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);
  cameraOk = initCamera();
}

void loop() {
  static bool served = false;
  static unsigned long lastBlink = 0;
  static bool ledOn = false;
  unsigned long now = millis();

  if (!cameraOk) {
    if (now - lastBlink > 120) { lastBlink = now; ledOn = !ledOn; digitalWrite(STATUS_LED, ledOn); }
    delay(10);
    return;
  }

  if (PremakeWiFi.connected()) {
    digitalWrite(STATUS_LED, HIGH);
    if (!served) {
      startServer();
      if (MDNS.begin("homecam")) MDNS.addService("http", "tcp", 80);
      served = true;
      Serial.print("[homecam] connected, stream at http://");
      Serial.print(WiFi.localIP());
      Serial.println("/");
    }
  } else {
    if (now - lastBlink > 700) { lastBlink = now; ledOn = !ledOn; digitalWrite(STATUS_LED, ledOn); }
  }
  delay(10);
}
