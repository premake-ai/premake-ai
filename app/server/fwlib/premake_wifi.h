// premake_wifi.h - Wi-Fi setup over USB for Premake firmware (ESP32, Arduino core 3.x).
//
// Premake copies this file into every sketch folder when it compiles, so a sketch only needs:
//
//   #include "premake_wifi.h"
//   void setup() {
//     PremakeWiFi.begin("Wave Buddy", "1.0.0");   // first thing in setup(): starts Serial at 115200 too
//     ...
//   }
//   void loop() {
//     if (PremakeWiFi.connected()) { ... use the network ... }
//   }
//
// How Wi-Fi gets set: after "Flash to my ESP32" in the browser, ESP Web Tools asks for the Wi-Fi name and password and
// sends them over the USB cable with the Improv Wi-Fi serial protocol (https://www.improv-wifi.com/serial/). This file
// answers it, connects, and saves them in flash (Preferences, namespace "premake"), so they survive reboots and
// reflashing. Nothing is ever hardcoded in the sketch. Improv runs in its own FreeRTOS task, so a busy loop() (delays,
// HTTP calls, servo moves) never makes the browser time out.
//
// Also over USB serial (115200, one line each):
//   PREMAKE KEY <device key>   saves the Premake device key (companion app ingest / commands), PremakeWiFi.deviceKey()
//   PREMAKE FORGET             forgets the Wi-Fi network and the device key
#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <Preferences.h>

#ifndef PREMAKE_WIFI_CONNECT_MS
#define PREMAKE_WIFI_CONNECT_MS 20000
#endif

class PremakeWiFiClass {
 public:
  // name: the product's name (shown in the browser); version: firmware version.
  void begin(const char* name, const char* version = "1.0.0", const char* nextUrl = nullptr) {
    if (started_) return;
    started_ = true;
    name_ = name ? name : "Premake device";
    version_ = version ? version : "1.0.0";
    next_ = nextUrl ? nextUrl : "";
    Serial.begin(115200);
    prefs_.begin("premake", false);
    ssid_ = prefs_.getString("ssid", "");
    pass_ = prefs_.getString("pass", "");
    key_ = prefs_.getString("key", "");
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    if (ssid_.length()) {
      WiFi.begin(ssid_.c_str(), pass_.c_str());
      Serial.printf("[premake] Wi-Fi: connecting to \"%s\"\n", ssid_.c_str());
    } else {
      Serial.println("[premake] Wi-Fi: not set up yet. On the Premake page, click Connect to Wi-Fi.");
    }
    xTaskCreate(task_, "premake_wifi", 6144, this, 1, nullptr);
  }
  bool connected() { return WiFi.status() == WL_CONNECTED; }
  bool hasCredentials() { return ssid_.length() > 0; }
  String ssid() { return ssid_; }
  String deviceKey() { return key_; }
  void forget() {
    prefs_.remove("ssid"); prefs_.remove("pass"); prefs_.remove("key");
    ssid_ = ""; pass_ = ""; key_ = "";
    WiFi.disconnect(false, true);
  }

 private:
  static constexpr uint8_t TYPE_STATE = 0x01, TYPE_ERROR = 0x02, TYPE_RPC = 0x03, TYPE_RESULT = 0x04;
  static constexpr uint8_t ST_READY = 0x02, ST_PROVISIONING = 0x03, ST_PROVISIONED = 0x04;
  static constexpr uint8_t ERR_NONE = 0x00, ERR_INVALID = 0x01, ERR_UNKNOWN_CMD = 0x02, ERR_CONNECT = 0x03;

  bool started_ = false, provisioning_ = false;
  String name_, version_, next_, ssid_, pass_, key_;
  Preferences prefs_;
  uint8_t buf_[300];
  size_t pos_ = 0;
  char line_[160];
  size_t lineLen_ = 0;

  static void task_(void* self) {
    for (;;) { static_cast<PremakeWiFiClass*>(self)->poll_(); vTaskDelay(pdMS_TO_TICKS(10)); }
  }

  static const char* chip_() {
#if defined(CONFIG_IDF_TARGET_ESP32C3)
    return "ESP32-C3";
#elif defined(CONFIG_IDF_TARGET_ESP32S3)
    return "ESP32-S3";
#elif defined(CONFIG_IDF_TARGET_ESP32S2)
    return "ESP32-S2";
#elif defined(CONFIG_IDF_TARGET_ESP32C6)
    return "ESP32-C6";
#else
    return "ESP32";
#endif
  }

  void lineByte_(uint8_t b) {
    if (b == '\r') return;
    if (b == '\n') {
      line_[lineLen_] = 0;
      if (!strncmp(line_, "PREMAKE KEY ", 12) && lineLen_ > 12) {
        key_ = String(line_ + 12); key_.trim();
        prefs_.putString("key", key_);
        Serial.println("[premake] device key saved");
      } else if (!strcmp(line_, "PREMAKE FORGET")) {
        forget();
        Serial.println("[premake] Wi-Fi and device key forgotten");
      }
      lineLen_ = 0;
      return;
    }
    if (lineLen_ < sizeof(line_) - 1) line_[lineLen_++] = (char)b;
  }

  void poll_() {
    while (Serial.available() > 0) {
      int c = Serial.read();
      if (c < 0) break;
      uint8_t b = (uint8_t)c;
      static const char H[] = "IMPROV";
      if (pos_ < 6) {
        if (b == (uint8_t)H[pos_]) { buf_[pos_++] = b; continue; }
        for (size_t i = 0; i < pos_; i++) lineByte_(buf_[i]); // not a packet after all: those bytes were text
        pos_ = 0;
        if (b == 'I') { buf_[pos_++] = b; continue; }
        lineByte_(b);
        continue;
      }
      buf_[pos_++] = b;
      if (pos_ == 9 && (buf_[6] != 1 || buf_[8] > 250)) { pos_ = 0; continue; }
      if (pos_ >= 10 && pos_ == (size_t)(10 + buf_[8])) {
        uint8_t sum = 0;
        for (size_t i = 0; i < pos_ - 1; i++) sum += buf_[i];
        const uint8_t type = buf_[7], len = buf_[8];
        const bool ok = sum == buf_[pos_ - 1];
        pos_ = 0;
        if (!ok) { sendError_(ERR_INVALID); continue; }
        if (type == TYPE_RPC) handleRpc_(buf_ + 9, len);
      }
    }
    // the network dropped or came back on its own: nothing to send, the browser asks for the state when it needs it
  }

  void send_(uint8_t type, const uint8_t* data, uint8_t len) {
    uint8_t p[9 + 256 + 2];
    memcpy(p, "IMPROV", 6);
    p[6] = 1; p[7] = type; p[8] = len;
    if (len) memcpy(p + 9, data, len);
    uint8_t sum = 0;
    for (size_t i = 0; i < 9u + len; i++) sum += p[i];
    p[9 + len] = sum;
    p[10 + len] = '\n';
    Serial.write(p, 11 + len); // one write, so a log line from loop() can't land inside a packet
    Serial.flush();
  }
  void sendState_(uint8_t s) { send_(TYPE_STATE, &s, 1); }
  void sendError_(uint8_t e) { send_(TYPE_ERROR, &e, 1); }
  // RPC result: command, length of the rest, then each string as length + bytes
  void sendResult_(uint8_t cmd, const char* const* strs, size_t n) {
    uint8_t d[250];
    size_t at = 2;
    for (size_t i = 0; i < n; i++) {
      size_t l = strlen(strs[i]);
      if (l > 64) l = 64;
      if (at + 1 + l > sizeof(d)) break;
      d[at++] = (uint8_t)l;
      memcpy(d + at, strs[i], l);
      at += l;
    }
    d[0] = cmd; d[1] = (uint8_t)(at - 2);
    send_(TYPE_RESULT, d, (uint8_t)at);
  }
  uint8_t state_() { return provisioning_ ? ST_PROVISIONING : connected() ? ST_PROVISIONED : ST_READY; }
  void sendUrl_(uint8_t cmd) {
    if (next_.length()) { const char* s[] = { next_.c_str() }; sendResult_(cmd, s, 1); }
    else sendResult_(cmd, nullptr, 0);
  }

  void handleRpc_(const uint8_t* d, uint8_t len) {
    if (len < 2 || (size_t)d[1] + 2 > len) { sendError_(ERR_INVALID); return; }
    const uint8_t cmd = d[0];
    const uint8_t* p = d + 2;
    const uint8_t n = d[1];
    if (cmd == 0x01) { // send Wi-Fi settings: ssid_len ssid pass_len pass
      if (n < 1 || p[0] + 1u > n) { sendError_(ERR_INVALID); return; }
      const uint8_t sl = p[0];
      if (sl + 2u > n) { sendError_(ERR_INVALID); return; }
      const uint8_t pl = p[1 + sl];
      if (sl + 2u + pl > n) { sendError_(ERR_INVALID); return; }
      String ssid((const char*)p + 1, sl), pass((const char*)p + 2 + sl, pl);
      provisioning_ = true;
      sendState_(ST_PROVISIONING);
      Serial.printf("\n[premake] Wi-Fi: trying \"%s\"\n", ssid.c_str());
      WiFi.disconnect(false, false);
      delay(100);
      WiFi.begin(ssid.c_str(), pass.c_str());
      const uint32_t t0 = millis();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < PREMAKE_WIFI_CONNECT_MS) delay(100);
      provisioning_ = false;
      if (WiFi.status() == WL_CONNECTED) {
        ssid_ = ssid; pass_ = pass;
        prefs_.putString("ssid", ssid_);
        prefs_.putString("pass", pass_);
        Serial.printf("\n[premake] Wi-Fi: connected to \"%s\", IP %s\n", ssid_.c_str(), WiFi.localIP().toString().c_str());
        sendState_(ST_PROVISIONED);
        sendUrl_(0x01);
      } else {
        Serial.println("\n[premake] Wi-Fi: could not connect (check the name and password; 2.4 GHz networks only)");
        sendError_(ERR_CONNECT);
        sendState_(ST_READY);
        if (ssid_.length()) WiFi.begin(ssid_.c_str(), pass_.c_str()); // back to the network that worked before
      }
    } else if (cmd == 0x02) { // current state
      const uint8_t s = state_();
      sendState_(s);
      if (s == ST_PROVISIONED) sendUrl_(0x02);
    } else if (cmd == 0x03) { // device info: firmware name, version, chip, device name
      const char* s[] = { name_.c_str(), version_.c_str(), chip_(), name_.c_str() };
      sendResult_(0x03, s, 4);
    } else if (cmd == 0x04) { // scan: one result per network (ssid, rssi, "YES" if it needs a password), then an empty one
      const int found = WiFi.scanNetworks();
      int sent = 0;
      for (int i = 0; i < found && sent < 20; i++) {
        String s = WiFi.SSID(i);
        if (!s.length()) continue;
        bool dup = false;
        for (int j = 0; j < i; j++) if (WiFi.SSID(j) == s) { dup = true; break; }
        if (dup) continue;
        String rssi(WiFi.RSSI(i));
        const char* r[] = { s.c_str(), rssi.c_str(), WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "NO" : "YES" };
        sendResult_(0x04, r, 3);
        sent++;
      }
      WiFi.scanDelete();
      sendResult_(0x04, nullptr, 0);
    } else {
      sendError_(ERR_UNKNOWN_CMD);
    }
  }
};

inline PremakeWiFiClass PremakeWiFi;
