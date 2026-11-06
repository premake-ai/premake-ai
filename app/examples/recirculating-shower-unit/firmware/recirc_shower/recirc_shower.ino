// Recirculating shower controller, ESP32-C3 SuperMini
// Libraries: OneWire, DallasTemperature
#include <OneWire.h>
#include <DallasTemperature.h>

const int PIN_PUMP  = 4;   // MOSFET 1
const int PIN_DUMP  = 5;   // MOSFET 2, N.O. valve: HIGH = closed (keep water), LOW = dump to drain
const int PIN_UV    = 6;   // MOSFET 3
const int PIN_TEMP  = 3;   // DS18B20
const int PIN_FLOAT = 7;   // LOW = sump has water

const float MIN_TEMP_C   = 34.0;           // colder than this: dump instead of recirculating
const float MAX_TEMP_C   = 50.0;           // scald guard
const unsigned long MAX_LOOP_MS = 15UL * 60 * 1000;  // never recirculate one batch longer than 15 min
const unsigned long UV_WARMUP_MS = 3000;   // UV on before the pump

OneWire ow(PIN_TEMP);
DallasTemperature temp(&ow);
unsigned long batchStart = 0;
bool running = false;

void stopAll(bool dump) {
  digitalWrite(PIN_PUMP, LOW);
  digitalWrite(PIN_UV, LOW);
  digitalWrite(PIN_DUMP, dump ? LOW : HIGH);
  running = false;
}

void setup() {
  pinMode(PIN_PUMP, OUTPUT);
  pinMode(PIN_DUMP, OUTPUT);
  pinMode(PIN_UV, OUTPUT);
  pinMode(PIN_FLOAT, INPUT_PULLUP);
  Serial.begin(115200);
  temp.begin();
  stopAll(true);
}

void loop() {
  temp.requestTemperatures();
  float t = temp.getTempCByIndex(0);
  bool water = digitalRead(PIN_FLOAT) == LOW;
  bool sensorOk = t > -50;

  if (!water) {                       // shower off / sump empty: reset the batch
    stopAll(true);
    batchStart = 0;
  } else if (!sensorOk || t < MIN_TEMP_C || t > MAX_TEMP_C ||
             (batchStart && millis() - batchStart > MAX_LOOP_MS)) {
    stopAll(true);                    // too cold, too hot or too old: send to drain
  } else if (!running) {
    if (!batchStart) batchStart = millis();
    digitalWrite(PIN_DUMP, HIGH);     // close dump valve, keep the warm water
    digitalWrite(PIN_UV, HIGH);
    delay(UV_WARMUP_MS);
    digitalWrite(PIN_PUMP, HIGH);
    running = true;
  }

  Serial.printf("T=%.1fC water=%d running=%d\n", t, water, running);
  delay(1000);
}
