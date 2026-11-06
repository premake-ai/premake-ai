// Bed chiller (Flux Sleep style): Peltier water cooler / heater for a mattress pad.
// Arduino Nano on a screw-terminal board. No app, no Wi-Fi: 4 front buttons + OLED.
// Libraries: U8g2 (U8x8 text mode), OneWire, DallasTemperature.
//
// Buttons: Power (on/off), Cool/Heat, Eco/Max, Timer (off/2/4/6/8/10 h auto-off)

#include <U8x8lib.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ---- pin map (matches wiring.json) ----
const uint8_t PIN_WATER  = 2;   // DS18B20 in the tank
const uint8_t PIN_HSINK  = 3;   // DS18B20 on the heatsink
const uint8_t PIN_BTN_PWR  = 4;
const uint8_t PIN_TEC_R  = 5;   // BTS7960 RPWM  (cool)
const uint8_t PIN_TEC_L  = 6;   // BTS7960 LPWM  (heat)
const uint8_t PIN_R_EN   = 7;
const uint8_t PIN_L_EN   = 8;
const uint8_t PIN_FAN    = 9;   // D4184 -> 2 x 80 mm fans
const uint8_t PIN_PUMP   = 10;  // D4184 -> pump
const uint8_t PIN_BTN_MODE = 11; // cool / heat
const uint8_t PIN_BTN_LVL  = 12; // eco / max
const uint8_t PIN_BTN_TMR  = A0;

// ---- limits ----
const float WATER_MIN_C = 13.0;   // never colder (condensation, comfort)
const float WATER_MAX_C = 38.0;   // never hotter in heat mode
const float HSINK_MAX_C = 60.0;   // hot side over-temperature cut-out
// Peltier duty (0-255). Full duty ~9 A on 12 V; supply is 15 A.
const uint8_t DUTY[2][2] = { {165, 255},     // cool: Eco, Max
                             {115, 180} };   // heat: Eco, Max
const uint8_t FAN_DUTY[2] = {150, 255};
const uint8_t TIMER_H[] = {0, 2, 4, 6, 8, 10};

U8X8_SSD1306_128X64_NONAME_HW_I2C oled(U8X8_PIN_NONE);
OneWire owW(PIN_WATER), owH(PIN_HSINK);
DallasTemperature tW(&owW), tH(&owH);

bool on = false, heat = false, maxMode = false, fault = false;
uint8_t timerIdx = 0;
unsigned long offAt = 0, runOnUntil = 0;
float water = NAN, hsink = NAN;
int duty = 0;           // current ramped duty
bool dirHeat = false;   // direction currently applied

struct Btn { uint8_t pin; bool last; unsigned long t; };
Btn btns[4] = {{PIN_BTN_PWR, 1, 0}, {PIN_BTN_MODE, 1, 0}, {PIN_BTN_LVL, 1, 0}, {PIN_BTN_TMR, 1, 0}};

bool pressed(Btn &b) {
  bool v = digitalRead(b.pin);
  if (v != b.last && millis() - b.t > 40) {
    b.t = millis(); b.last = v;
    return v == LOW;
  }
  return false;
}

void setTec(int d, bool h) {
  analogWrite(PIN_TEC_R, h ? 0 : d);
  analogWrite(PIN_TEC_L, h ? d : 0);
}

void draw() {
  char buf[17];
  oled.setFont(u8x8_font_chroma48medium8_r);
  if (!on) {
    oled.drawString(0, 0, "      OFF       ");
  } else {
    snprintf(buf, sizeof buf, "%s  %s     ", heat ? "HEAT" : "COOL", maxMode ? "MAX" : "ECO");
    oled.drawString(0, 0, buf);
  }
  oled.setFont(u8x8_font_inr21_2x4_r);
  if (isnan(water)) snprintf(buf, sizeof buf, " --.-");
  else { int t10 = (int)(water * 10 + 0.5); snprintf(buf, sizeof buf, "%3d.%dC", t10 / 10, abs(t10 % 10)); }
  oled.drawString(0, 2, buf);
  oled.setFont(u8x8_font_chroma48medium8_r);
  if (fault) oled.drawString(0, 7, "FAULT: hot side ");
  else if (on && TIMER_H[timerIdx]) {
    long m = (long)(offAt - millis()) / 60000L;
    snprintf(buf, sizeof buf, "Off in %ldh%02ldm   ", m / 60, m % 60);
    oled.drawString(0, 7, buf);
  } else oled.drawString(0, 7, "                ");
}

void setup() {
  for (auto &b : btns) pinMode(b.pin, INPUT_PULLUP);
  pinMode(PIN_R_EN, OUTPUT); pinMode(PIN_L_EN, OUTPUT);
  pinMode(PIN_FAN, OUTPUT); pinMode(PIN_PUMP, OUTPUT);
  digitalWrite(PIN_R_EN, HIGH); digitalWrite(PIN_L_EN, HIGH);
  setTec(0, false);
  tW.begin(); tH.begin();
  tW.setWaitForConversion(false); tH.setWaitForConversion(false);
  tW.requestTemperatures(); tH.requestTemperatures();
  oled.begin();
  draw();
}

void loop() {
  static unsigned long lastT = 0, lastRamp = 0, lastDraw = 0;
  unsigned long now = millis();

  if (pressed(btns[0])) {
    on = !on; fault = false;
    if (on) { offAt = now + TIMER_H[timerIdx] * 3600000UL; }
    else runOnUntil = now + 60000UL;          // pump + fans run on 60 s
  }
  if (pressed(btns[1]) && on) heat = !heat;
  if (pressed(btns[2]) && on) maxMode = !maxMode;
  if (pressed(btns[3]) && on) {
    timerIdx = (timerIdx + 1) % sizeof(TIMER_H);
    offAt = now + TIMER_H[timerIdx] * 3600000UL;
  }
  if (on && TIMER_H[timerIdx] && (long)(now - offAt) >= 0) { on = false; runOnUntil = now + 60000UL; }

  if (now - lastT > 1000) {                    // read sensors once a second
    lastT = now;
    float w = tW.getTempCByIndex(0), h = tH.getTempCByIndex(0);
    water = (w < -100) ? NAN : w;
    hsink = (h < -100) ? NAN : h;
    tW.requestTemperatures(); tH.requestTemperatures();
    if (on && (isnan(water) || isnan(hsink) || hsink > HSINK_MAX_C)) fault = true;
  }

  // target duty with simple hysteresis on the water limits
  static bool limitHold = false;
  int target = 0;
  if (on && !fault) {
    if (!heat) limitHold = limitHold ? water < WATER_MIN_C + 1.5 : water < WATER_MIN_C;
    else       limitHold = limitHold ? water > WATER_MAX_C - 1.5 : water > WATER_MAX_C;
    target = limitHold ? 0 : DUTY[heat][maxMode];
  }
  // never flip direction under load: ramp to 0 first
  if (heat != dirHeat && duty > 0) target = 0;
  if (duty == 0) dirHeat = heat;

  if (now - lastRamp > 20) {                   // ~5 s full ramp, soft on the supply
    lastRamp = now;
    if (duty < target) duty++;
    else if (duty > target) duty--;
    setTec(duty, dirHeat);
  }

  bool run = on || (long)(runOnUntil - now) > 0;
  analogWrite(PIN_PUMP, run ? 255 : 0);
  analogWrite(PIN_FAN, run ? (fault ? 255 : FAN_DUTY[maxMode]) : 0);

  if (now - lastDraw > 500) { lastDraw = now; draw(); }
}
