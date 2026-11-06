// Board: ESP32 DevKit (ESP32-WROOM-32)
// Desk climate sensor: BME280 temperature / humidity / pressure, sent to Premake every interval.
//
// Pin map (matches wiring.json):
//   BME280 VIN -> 3V3
//   BME280 GND -> GND
//   BME280 SCL -> GPIO22
//   BME280 SDA -> GPIO21
//
// readings: temp_c, humidity, pressure_hpa

#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include "premake_wifi.h"

#define SDA_PIN 21
#define SCL_PIN 22
// The ESP32 warms its own case a little; subtract this after comparing with a reference thermometer.
#define TEMP_OFFSET_C 0.8f

uint8_t bmeAddr = 0;
bool bmeOk = false;

// Bosch calibration data
uint16_t dig_T1; int16_t dig_T2, dig_T3;
uint16_t dig_P1; int16_t dig_P2, dig_P3, dig_P4, dig_P5, dig_P6, dig_P7, dig_P8, dig_P9;
uint8_t dig_H1, dig_H3; int16_t dig_H2, dig_H4, dig_H5; int8_t dig_H6;
int32_t t_fine;

unsigned long sendIntervalMs = 60000;
unsigned long lastSend = 0;
unsigned long lastPrint = 0;

uint8_t read8(uint8_t reg) {
  Wire.beginTransmission(bmeAddr);
  Wire.write(reg);
  Wire.endTransmission();
  Wire.requestFrom((int)bmeAddr, 1);
  return Wire.available() ? Wire.read() : 0;
}

void readBytes(uint8_t reg, uint8_t *buf, int n) {
  Wire.beginTransmission(bmeAddr);
  Wire.write(reg);
  Wire.endTransmission();
  Wire.requestFrom((int)bmeAddr, n);
  for (int i = 0; i < n; i++) buf[i] = Wire.available() ? Wire.read() : 0;
}

void write8(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(bmeAddr);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool bmeBegin() {
  const uint8_t addrs[2] = {0x76, 0x77};
  for (int i = 0; i < 2; i++) {
    bmeAddr = addrs[i];
    if (read8(0xD0) == 0x60) {
      write8(0xE0, 0xB6);  // soft reset
      delay(10);
      uint8_t c[26];
      readBytes(0x88, c, 26);
      dig_T1 = (uint16_t)(c[1] << 8 | c[0]);
      dig_T2 = (int16_t)(c[3] << 8 | c[2]);
      dig_T3 = (int16_t)(c[5] << 8 | c[4]);
      dig_P1 = (uint16_t)(c[7] << 8 | c[6]);
      dig_P2 = (int16_t)(c[9] << 8 | c[8]);
      dig_P3 = (int16_t)(c[11] << 8 | c[10]);
      dig_P4 = (int16_t)(c[13] << 8 | c[12]);
      dig_P5 = (int16_t)(c[15] << 8 | c[14]);
      dig_P6 = (int16_t)(c[17] << 8 | c[16]);
      dig_P7 = (int16_t)(c[19] << 8 | c[18]);
      dig_P8 = (int16_t)(c[21] << 8 | c[20]);
      dig_P9 = (int16_t)(c[23] << 8 | c[22]);
      dig_H1 = c[25];
      uint8_t h[7];
      readBytes(0xE1, h, 7);
      dig_H2 = (int16_t)(h[1] << 8 | h[0]);
      dig_H3 = h[2];
      dig_H4 = (int16_t)(((int8_t)h[3]) * 16 | (h[4] & 0x0F));
      dig_H5 = (int16_t)(((int8_t)h[5]) * 16 | (h[4] >> 4));
      dig_H6 = (int8_t)h[6];
      return true;
    }
  }
  return false;
}

// Forced-mode reading (sensor sleeps between reads = no self-heating)
bool bmeRead(float &tC, float &rh, float &hPa) {
  write8(0xF2, 0x01);        // humidity x1
  write8(0xF4, 0x25);        // temp x1, pressure x1, forced mode
  delay(15);
  for (int i = 0; i < 20 && (read8(0xF3) & 0x08); i++) delay(2);
  uint8_t d[8];
  readBytes(0xF7, d, 8);
  int32_t adc_P = ((int32_t)d[0] << 12) | ((int32_t)d[1] << 4) | (d[2] >> 4);
  int32_t adc_T = ((int32_t)d[3] << 12) | ((int32_t)d[4] << 4) | (d[5] >> 4);
  int32_t adc_H = ((int32_t)d[6] << 8) | d[7];
  if (adc_T == 0x80000) return false;

  int32_t var1 = ((((adc_T >> 3) - ((int32_t)dig_T1 << 1))) * ((int32_t)dig_T2)) >> 11;
  int32_t var2 = (((((adc_T >> 4) - ((int32_t)dig_T1)) * ((adc_T >> 4) - ((int32_t)dig_T1))) >> 12) * ((int32_t)dig_T3)) >> 14;
  t_fine = var1 + var2;
  tC = ((t_fine * 5 + 128) >> 8) / 100.0f;

  int64_t p1 = ((int64_t)t_fine) - 128000;
  int64_t p2 = p1 * p1 * (int64_t)dig_P6;
  p2 = p2 + ((p1 * (int64_t)dig_P5) << 17);
  p2 = p2 + (((int64_t)dig_P4) << 35);
  p1 = ((p1 * p1 * (int64_t)dig_P3) >> 8) + ((p1 * (int64_t)dig_P2) << 12);
  p1 = (((((int64_t)1) << 47) + p1)) * ((int64_t)dig_P1) >> 33;
  if (p1 == 0) {
    hPa = 0;
  } else {
    int64_t p = 1048576 - adc_P;
    p = (((p << 31) - p2) * 3125) / p1;
    p1 = (((int64_t)dig_P9) * (p >> 13) * (p >> 13)) >> 25;
    p2 = (((int64_t)dig_P8) * p) >> 19;
    p = ((p + p1 + p2) >> 8) + (((int64_t)dig_P7) << 4);
    hPa = (float)p / 256.0f / 100.0f;
  }

  int32_t v = t_fine - ((int32_t)76800);
  v = (((((adc_H << 14) - (((int32_t)dig_H4) << 20) - (((int32_t)dig_H5) * v)) + ((int32_t)16384)) >> 15) *
       (((((((v * ((int32_t)dig_H6)) >> 10) * (((v * ((int32_t)dig_H3)) >> 11) + ((int32_t)32768))) >> 10) +
          ((int32_t)2097152)) * ((int32_t)dig_H2) + 8192) >> 14));
  v = (v - (((((v >> 15) * (v >> 15)) >> 7) * ((int32_t)dig_H1)) >> 4));
  v = (v < 0) ? 0 : v;
  v = (v > 419430400) ? 419430400 : v;
  rh = (v >> 12) / 1024.0f;
  return true;
}

void sendReading(float tC, float rh, float hPa) {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, "https://premake.ai/api/d/ingest")) return;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Device ") + PremakeWiFi.deviceKey());
  String body = String("{\"r\":{\"temp_c\":") + String(tC, 2) + ",\"humidity\":" + String(rh, 1) +
                ",\"pressure_hpa\":" + String(hPa, 1) + "},\"fw\":\"1.0.0\"}";
  int code = http.POST(body);
  if (code == 200) {
    String reply = http.getString();
    int i = reply.indexOf("\"interval\":");
    if (i >= 0) {
      long s = reply.substring(i + 11).toInt();
      if (s >= 20) sendIntervalMs = (unsigned long)s * 1000UL;
    }
    Serial.println("[desk-climate] sent");
  } else {
    Serial.printf("[desk-climate] send failed (%d)\n", code);
  }
  http.end();
}

void setup() {
  PremakeWiFi.begin("Desk Climate Sensor", "1.0.0");
  Wire.begin(SDA_PIN, SCL_PIN);
  bmeOk = bmeBegin();
  Serial.println(bmeOk ? "[desk-climate] BME280 found" : "[desk-climate] sensor not found (check SDA 21 / SCL 22)");
}

void loop() {
  unsigned long now = millis();
  if (!bmeOk) {
    if (now - lastPrint > 5000) {
      lastPrint = now;
      bmeOk = bmeBegin();
      if (!bmeOk) Serial.println("[desk-climate] sensor not found");
    }
    delay(10);
    return;
  }
  if (now - lastPrint >= 5000) {
    lastPrint = now;
    float t, h, p;
    if (bmeRead(t, h, p)) {
      t -= TEMP_OFFSET_C;
      Serial.printf("[desk-climate] %.2f C  %.1f %%RH  %.1f hPa\n", t, h, p);
      if (now - lastSend >= sendIntervalMs || lastSend == 0) {
        if (PremakeWiFi.connected()) {
          lastSend = now;
          sendReading(t, h, p);
        } else if (lastSend == 0) {
          Serial.println("[desk-climate] set up Wi-Fi to send readings");
          lastSend = now;
        }
      }
    }
  }
  delay(10);
}
