// Voice sticker printer: hold the button, speak, release.
// Audio is POSTed to your own server, which does speech-to-text + image
// generation and returns a 384 px wide 1-bit bitmap (raw rows, MSB first).
// The ESP32 prints it with ESC/POS "GS v 0".
#include <WiFi.h>
#include <HTTPClient.h>
#include <driver/i2s.h>

// ---- pin map ----
#define PIN_PRN_TX 17
#define PIN_PRN_RX 18
#define PIN_MIC_SCK 4
#define PIN_MIC_WS 5
#define PIN_MIC_SD 6
#define PIN_BUTTON 7
#define PIN_LED 15

const char* WIFI_SSID = "your-wifi";
const char* WIFI_PASS = "your-password";
const char* SERVER_URL = "http://192.168.1.10:8000/sticker";  // your backend

const int SAMPLE_RATE = 16000;
const int MAX_SECONDS = 6;
int16_t* audio;
size_t audioLen = 0;

void micInit() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = 0, .dma_buf_count = 8, .dma_buf_len = 256};
  i2s_pin_config_t pins = {.bck_io_num = PIN_MIC_SCK, .ws_io_num = PIN_MIC_WS,
                           .data_out_num = -1, .data_in_num = PIN_MIC_SD};
  i2s_driver_install(I2S_NUM_0, &cfg, 0, NULL);
  i2s_set_pin(I2S_NUM_0, &pins);
}

void record() {
  audioLen = 0;
  int32_t buf[256];
  size_t got;
  while (digitalRead(PIN_BUTTON) == LOW && audioLen < SAMPLE_RATE * MAX_SECONDS) {
    i2s_read(I2S_NUM_0, buf, sizeof(buf), &got, portMAX_DELAY);
    for (size_t i = 0; i < got / 4 && audioLen < SAMPLE_RATE * MAX_SECONDS; i++)
      audio[audioLen++] = buf[i] >> 14;
  }
}

void printBitmap(uint8_t* data, int len) {
  int rows = len / 48;  // 384 px = 48 bytes per row
  const uint8_t hdr[] = {0x1D, 0x76, 0x30, 0, 48, 0, (uint8_t)(rows & 255), (uint8_t)(rows >> 8)};
  Serial1.write(hdr, sizeof(hdr));
  for (int i = 0; i < len; i++) {
    Serial1.write(data[i]);
    if (i % 48 == 47) delay(2);  // let the head keep up
  }
  Serial1.write("\n\n\n\n");
}

void setup() {
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_LED, OUTPUT);
  Serial1.begin(9600, SERIAL_8N1, PIN_PRN_RX, PIN_PRN_TX);
  audio = (int16_t*)ps_malloc(SAMPLE_RATE * MAX_SECONDS * 2);
  micInit();
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { digitalWrite(PIN_LED, !digitalRead(PIN_LED)); delay(250); }
  digitalWrite(PIN_LED, LOW);
}

void loop() {
  if (digitalRead(PIN_BUTTON) != LOW) return;
  digitalWrite(PIN_LED, HIGH);
  record();
  digitalWrite(PIN_LED, LOW);
  if (audioLen < SAMPLE_RATE / 2) return;  // too short

  HTTPClient http;
  http.begin(SERVER_URL);
  http.setTimeout(60000);
  http.addHeader("Content-Type", "application/octet-stream");
  int code = http.POST((uint8_t*)audio, audioLen * 2);
  if (code == 200) {
    int len = http.getSize();
    uint8_t* img = (uint8_t*)ps_malloc(len);
    http.getStream().readBytes(img, len);
    printBitmap(img, len);
    free(img);
  }
  http.end();
}
