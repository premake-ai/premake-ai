// Board: ESP32 DevKit (ESP32-WROOM-32)
// Hardware: AI-Thinker ESP32-CAM (OV2640) on ESP32-CAM-MB, powered + flashed via the MB micro-USB.
// Privacy first: no cloud. MJPEG stream only on the local network:
//   http://<ip>/        small page with the live view
//   http://<ip>:81/stream   MJPEG stream
//   http://<ip>/jpg     single snapshot
//
// Pin map (AI-Thinker):
//   Camera: PWDN 32, RESET -1, XCLK 0, SIOD 26, SIOC 27,
//           Y9 35, Y8 34, Y7 39, Y6 36, Y5 21, Y4 19, Y3 18, Y2 5,
//           VSYNC 25, HREF 23, PCLK 22
//   Status LED (front, via 220 ohm): IO13 -> LED+ ; LED- -> GND
//   Onboard red LED: IO33 (active LOW), mirrors status
//   Flash LED: IO4, kept off
//
// LED: slow blink = no Wi-Fi set up / connecting, solid = connected, fast blink = camera error.

#include "premake_wifi.h"
#include <WiFi.h>
#include "esp_camera.h"
#include "esp_http_server.h"

#define PIN_LED 13
#define PIN_LED_RED 33
#define PIN_FLASH 4

static bool cameraOk = false;
static bool serversUp = false;
static httpd_handle_t webHttpd = NULL;
static httpd_handle_t streamHttpd = NULL;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char INDEX_HTML[] =
  "<!doctype html><html><head><meta name=viewport content='width=device-width'>"
  "<title>Tube Cam</title><style>body{background:#111;color:#ccc;font-family:sans-serif;text-align:center}"
  "img{max-width:100%;}</style></head><body><h3>Tube Cam</h3>"
  "<img id=s><script>document.getElementById('s').src='http://'+location.hostname+':81/stream';</script>"
  "</body></html>";

bool initCamera() {
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
    Serial.printf("[tubecam] camera init failed 0x%x\n", err);
    return false;
  }
  Serial.println("[tubecam] camera ok");
  return true;
}

static esp_err_t indexHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t jpgHandler(httpd_req_t *req) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  httpd_resp_set_type(req, "image/jpeg");
  esp_err_t res = httpd_resp_send(req, (const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
  return res;
}

static esp_err_t streamHandler(httpd_req_t *req) {
  char part[64];
  esp_err_t res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  Serial.println("[tubecam] stream client connected");
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      res = ESP_FAIL;
      break;
    }
    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  Serial.println("[tubecam] stream client left");
  return res;
}

void startServers() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = 80;
  cfg.ctrl_port = 32768;
  httpd_uri_t idx = {"/", HTTP_GET, indexHandler, NULL};
  httpd_uri_t jpg = {"/jpg", HTTP_GET, jpgHandler, NULL};
  if (httpd_start(&webHttpd, &cfg) == ESP_OK) {
    httpd_register_uri_handler(webHttpd, &idx);
    httpd_register_uri_handler(webHttpd, &jpg);
  }
  cfg.server_port = 81;
  cfg.ctrl_port = 32769;
  httpd_uri_t st = {"/stream", HTTP_GET, streamHandler, NULL};
  if (httpd_start(&streamHttpd, &cfg) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &st);
  }
  serversUp = true;
  Serial.print("[tubecam] view at http://");
  Serial.println(WiFi.localIP());
}

void setLed(bool on) {
  digitalWrite(PIN_LED, on ? HIGH : LOW);
  digitalWrite(PIN_LED_RED, on ? LOW : HIGH);
}

void setup() {
  PremakeWiFi.begin("Tube Cam", "1.0.0");
  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  pinMode(PIN_FLASH, OUTPUT);
  digitalWrite(PIN_FLASH, LOW);
  setLed(false);
  cameraOk = initCamera();
  if (!cameraOk) Serial.println("[tubecam] camera not found: check the ribbon");
}

void loop() {
  unsigned long now = millis();
  bool wifi = PremakeWiFi.connected();

  if (wifi && cameraOk && !serversUp) startServers();
  if (wifi && !serversUp && !cameraOk) {
    static bool said = false;
    if (!said) { Serial.println("[tubecam] connected, but no camera"); said = true; }
  }
  if (!wifi && serversUp) {
    static unsigned long lastMsg = 0;
    if (now - lastMsg > 10000) { Serial.println("[tubecam] Wi-Fi lost, waiting"); lastMsg = now; }
  }

  if (!cameraOk) setLed((now / 150) % 2);          // fast blink: camera error
  else if (!wifi) setLed((now / 700) % 2);         // slow blink: set up / connecting Wi-Fi
  else setLed(true);                               // solid: streaming on the LAN

  delay(20);
}
