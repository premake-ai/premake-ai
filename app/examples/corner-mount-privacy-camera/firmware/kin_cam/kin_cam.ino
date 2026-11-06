// Board: ESP32 DevKit (ESP32-WROOM-32)
// Hardware: AI-Thinker ESP32-CAM (ESP32 + OV2640) plugged onto an ESP32-CAM-MB (power + flashing over micro-USB).
// Privacy first: video only goes to your local network. Nothing is sent to any cloud.
//
// Pin map (matches wiring.json):
//   IO13  -> 220 ohm -> status LED (+), LED (-) -> GND
//   IO4   onboard flash LED, kept off
//   Camera (AI-Thinker): PWDN 32, RESET -, XCLK 0, SIOD 26, SIOC 27,
//     Y9 35, Y8 34, Y7 39, Y6 36, Y5 21, Y4 19, Y3 18, Y2 5, VSYNC 25, HREF 23, PCLK 22
//
// Status LED: slow blink = Wi-Fi not set up yet, fast blink = connecting, solid = online.
// Viewer: http://kin-cam.local/  (stream on port 81). Login user "kin", password printed on Serial.

#include "premake_wifi.h"
#include <WiFi.h>
#include <ESPmDNS.h>
#include "esp_camera.h"
#include "esp_http_server.h"
#include "base64.h"

#define LED_PIN   13
#define FLASH_PIN 4

#define PWDN_GPIO_NUM  32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM   0
#define SIOD_GPIO_NUM  26
#define SIOC_GPIO_NUM  27
#define Y9_GPIO_NUM    35
#define Y8_GPIO_NUM    34
#define Y7_GPIO_NUM    39
#define Y6_GPIO_NUM    36
#define Y5_GPIO_NUM    21
#define Y4_GPIO_NUM    19
#define Y3_GPIO_NUM    18
#define Y2_GPIO_NUM     5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM  23
#define PCLK_GPIO_NUM  22

#define PART_BOUNDARY "kinframeboundary7f3a"
static const char *STREAM_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_SEP = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char INDEX_HTML[] =
  "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>Kin camera</title><style>body{margin:0;background:#111;color:#ddd;font-family:sans-serif;text-align:center}"
  "img{width:100%;max-width:800px}</style></head><body><p>Kin camera (local only)</p>"
  "<img id=s><script>document.getElementById('s').src=location.protocol+'//'+location.hostname+':81/stream';</script>"
  "</body></html>";

httpd_handle_t webHttpd = NULL;
httpd_handle_t streamHttpd = NULL;
String authHeader;
bool cameraOk = false;
bool serverStarted = false;

static bool authorized(httpd_req_t *req) {
  size_t len = httpd_req_get_hdr_value_len(req, "Authorization");
  if (len == 0 || len > 200) return false;
  char buf[201];
  if (httpd_req_get_hdr_value_str(req, "Authorization", buf, sizeof(buf)) != ESP_OK) return false;
  return authHeader == String(buf);
}

static esp_err_t askLogin(httpd_req_t *req) {
  httpd_resp_set_status(req, "401 Unauthorized");
  httpd_resp_set_hdr(req, "WWW-Authenticate", "Basic realm=\"Kin camera\"");
  return httpd_resp_send(req, "Login required", HTTPD_RESP_USE_STRLEN);
}

static esp_err_t indexHandler(httpd_req_t *req) {
  if (!authorized(req)) return askLogin(req);
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t *req) {
  if (!authorized(req)) return askLogin(req);
  esp_err_t res = httpd_resp_set_type(req, STREAM_TYPE);
  if (res != ESP_OK) return res;
  char part[64];
  Serial.println("[kin] viewer connected");
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[kin] frame capture failed");
      res = ESP_FAIL;
      break;
    }
    size_t hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)fb->len);
    res = httpd_resp_send_chunk(req, STREAM_SEP, strlen(STREAM_SEP));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  Serial.println("[kin] viewer left");
  return res;
}

void startServers() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 80;
  httpd_uri_t indexUri = {"/", HTTP_GET, indexHandler, NULL};
  if (httpd_start(&webHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(webHttpd, &indexUri);
  }
  config.server_port = 81;
  config.ctrl_port += 1;
  httpd_uri_t streamUri = {"/stream", HTTP_GET, streamHandler, NULL};
  if (httpd_start(&streamHttpd, &config) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &streamUri);
  }
}

bool startCamera() {
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
    c.frame_size = FRAMESIZE_VGA;
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
  } else {
    c.frame_size = FRAMESIZE_QVGA;
    c.jpeg_quality = 14;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[kin] camera not found (0x%x)\n", err);
    return false;
  }
  Serial.println("[kin] camera ready");
  return true;
}

void updateLed(bool online) {
  unsigned long now = millis();
  if (online) {
    digitalWrite(LED_PIN, HIGH);
  } else if (WiFi.getMode() == WIFI_MODE_NULL || WiFi.SSID().length() == 0) {
    digitalWrite(LED_PIN, (now / 1000) % 2 ? HIGH : LOW);   // not set up: slow blink
  } else {
    digitalWrite(LED_PIN, (now / 200) % 2 ? HIGH : LOW);    // connecting: fast blink
  }
}

void setup() {
  PremakeWiFi.begin("Kin Corner Camera", "1.0.0");
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  pinMode(FLASH_PIN, OUTPUT);
  digitalWrite(FLASH_PIN, LOW);

  String key = String(PremakeWiFi.deviceKey());
  String pass = key.length() >= 8 ? key.substring(key.length() - 8) : String("kincamera");
  authHeader = "Basic " + base64::encode(String("kin:") + pass);
  Serial.println("[kin] viewer login: user kin, password " + pass);

  cameraOk = startCamera();
}

void loop() {
  bool online = PremakeWiFi.connected();
  updateLed(online);
  if (online && !serverStarted && cameraOk) {
    startServers();
    if (MDNS.begin("kin-cam")) MDNS.addService("http", "tcp", 80);
    serverStarted = true;
    Serial.print("[kin] connected, open http://kin-cam.local/ or http://");
    Serial.println(WiFi.localIP());
  }
  delay(20);
}
