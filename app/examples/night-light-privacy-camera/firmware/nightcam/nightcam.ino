// Board: AI-Thinker ESP32-CAM
// Frosted Night-Light Camera: MJPEG stream on the local network + warm night light.
// Privacy first: no cloud, nothing leaves the home network. Lens shutter is mechanical.
//
// Pin map (matches wiring.json):
//   IO13 -> 220 ohm -> status LED (+), LED (-) -> GND
//   IO14 -> 330 ohm -> WS2812B 12-LED ring DI; ring 5V via 0.5 A polyfuse from 5V; ring GND -> GND
//   IO4  = on-board flash LED, kept off
//   Camera: AI-Thinker OV2640 standard pins (below)
//
// Status LED: fast blink = Wi-Fi not set up / connecting,
//             one short blink every 3 s = connected and streaming.
// Local pages: http://<ip>/            viewer + night-light slider
//              http://<ip>:81/stream   MJPEG stream
//              http://<ip>/light?b=N   night light 0..255 (saved)

#include "esp_camera.h"
#include "esp_http_server.h"
#include <WiFi.h>
#include <Preferences.h>
#include <Adafruit_NeoPixel.h>
#include "premake_wifi.h"

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

const int STATUS_LED = 13;
const int RING_PIN = 14;
const int FLASH_LED = 4;
const int RING_COUNT = 12;
const uint8_t MAX_LIGHT = 128;   // cap: 12 LEDs at half = ~0.36 A

Adafruit_NeoPixel ring(RING_COUNT, RING_PIN, NEO_GRB + NEO_KHZ800);
Preferences prefs;

volatile int lightLevel = 40;     // 0..255 as set by the user
volatile bool lightDirty = true;
bool cameraOk = false;
bool serversUp = false;
httpd_handle_t webHttpd = NULL;
httpd_handle_t streamHttpd = NULL;

#define PART_BOUNDARY "123456789000000000000987654321"
static const char *STREAM_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char *STREAM_BOUNDARY = "\r\n--" PART_BOUNDARY "\r\n";
static const char *STREAM_PART = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static const char INDEX_HTML[] =
  "<!doctype html><html><head><meta name=viewport content='width=device-width,initial-scale=1'>"
  "<title>Night-Light Camera</title><style>body{font-family:sans-serif;background:#111;color:#eee;"
  "text-align:center;margin:0;padding:12px}img{width:100%;max-width:640px;border-radius:8px}"
  "input{width:80%}</style></head><body><h3>Night-Light Camera</h3>"
  "<img id=s alt='Stream (shutter closed?)'><p>Night light</p>"
  "<input type=range min=0 max=255 id=b onchange=\"fetch('/light?b='+this.value)\">"
  "<script>document.getElementById('s').src='http://'+location.hostname+':81/stream';"
  "fetch('/light').then(r=>r.text()).then(t=>{document.getElementById('b').value=t});</script>"
  "</body></html>";

static esp_err_t indexHandler(httpd_req_t *req) {
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, INDEX_HTML, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t lightHandler(httpd_req_t *req) {
  char query[32];
  char val[8];
  if (httpd_req_get_url_query_str(req, query, sizeof(query)) == ESP_OK &&
      httpd_query_key_value(query, "b", val, sizeof(val)) == ESP_OK) {
    int b = atoi(val);
    if (b < 0) b = 0;
    if (b > 255) b = 255;
    lightLevel = b;
    lightDirty = true;
  }
  char out[8];
  snprintf(out, sizeof(out), "%d", (int)lightLevel);
  httpd_resp_set_type(req, "text/plain");
  return httpd_resp_send(req, out, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t *req) {
  if (!cameraOk) {
    httpd_resp_send_500(req);
    return ESP_FAIL;
  }
  esp_err_t res = httpd_resp_set_type(req, STREAM_TYPE);
  if (res != ESP_OK) return res;
  char part[64];
  Serial.println("[nightcam] stream client connected");
  while (true) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb) {
      Serial.println("[nightcam] frame capture failed");
      res = ESP_FAIL;
      break;
    }
    int hlen = snprintf(part, sizeof(part), STREAM_PART, (unsigned)fb->len);
    res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, part, hlen);
    if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char *)fb->buf, fb->len);
    esp_camera_fb_return(fb);
    if (res != ESP_OK) break;
  }
  Serial.println("[nightcam] stream client left");
  return res;
}

void startServers() {
  httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
  cfg.server_port = 80;
  cfg.ctrl_port = 32768;
  httpd_uri_t indexUri = {"/", HTTP_GET, indexHandler, NULL};
  httpd_uri_t lightUri = {"/light", HTTP_GET, lightHandler, NULL};
  if (httpd_start(&webHttpd, &cfg) == ESP_OK) {
    httpd_register_uri_handler(webHttpd, &indexUri);
    httpd_register_uri_handler(webHttpd, &lightUri);
  }
  httpd_config_t scfg = HTTPD_DEFAULT_CONFIG();
  scfg.server_port = 81;
  scfg.ctrl_port = 32769;
  httpd_uri_t streamUri = {"/stream", HTTP_GET, streamHandler, NULL};
  if (httpd_start(&streamHttpd, &scfg) == ESP_OK) {
    httpd_register_uri_handler(streamHttpd, &streamUri);
  }
  Serial.print("[nightcam] open http://");
  Serial.print(WiFi.localIP());
  Serial.println("/");
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
  if (psramFound()) {
    c.frame_size = FRAMESIZE_VGA;
    c.jpeg_quality = 12;
    c.fb_count = 2;
    c.fb_location = CAMERA_FB_IN_PSRAM;
    c.grab_mode = CAMERA_GRAB_LATEST;
  } else {
    c.frame_size = FRAMESIZE_QVGA;
    c.jpeg_quality = 14;
    c.fb_count = 1;
    c.fb_location = CAMERA_FB_IN_DRAM;
    c.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  }
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("[nightcam] camera not found (0x%x)\n", err);
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_vflip(s, 1);      // board is mounted antenna-up, so flip the image
    s->set_hmirror(s, 1);
  }
  Serial.println("[nightcam] camera ok");
  return true;
}

void applyLight() {
  int b = lightLevel;
  int capped = (b * MAX_LIGHT) / 255;
  ring.setBrightness(capped);
  for (int i = 0; i < RING_COUNT; i++) ring.setPixelColor(i, ring.Color(255, 150, 60));  // warm white
  ring.show();
  prefs.putInt("light", b);
}

void setup() {
  PremakeWiFi.begin("Frosted Night-Light Camera", "1.0.0");
  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, LOW);

  prefs.begin("nightcam", false);
  lightLevel = prefs.getInt("light", 40);
  ring.begin();
  lightDirty = true;

  cameraOk = startCamera();
}

void loop() {
  unsigned long now = millis();
  bool online = PremakeWiFi.connected();

  if (online && !serversUp) {
    Serial.println("[nightcam] connected");
    startServers();
    serversUp = true;
  }

  // status LED
  if (!online) {
    digitalWrite(STATUS_LED, (now / 150) % 2);
  } else {
    digitalWrite(STATUS_LED, (now % 3000) < 60 ? HIGH : LOW);
  }

  if (lightDirty) {
    lightDirty = false;
    applyLight();
  }
  delay(10);
}
