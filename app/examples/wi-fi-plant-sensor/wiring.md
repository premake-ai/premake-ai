# Wi-Fi Plant Sensor wiring

Power: one protected 18650 (3.0-4.2 V) charged by the TP4056 USB-C board (1 A max, its own protection IC). No fuse is needed under 1 A: the cell's protection board and the TP4056's DW01 handle shorts.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Bay floor contact (+) | tab | TP4056 | B+ | 26 AWG red |
| Cap spring contact (-) | tab | TP4056 | B- | 26 AWG black, ~60 mm loop so the cap can open |
| TP4056 | OUT+ | ESP32-C3 SuperMini | 5V | 26 AWG red |
| TP4056 | OUT- | ESP32-C3 SuperMini | GND | 26 AWG black |
| TP4056 | OUT+ | 100k -> GPIO4 -> 100k | GND | battery divider (reads half the cell voltage) |
| Soil probe | VCC | ESP32-C3 | GPIO10 | probe cable red (powered only while measuring, ~5 mA) |
| Soil probe | GND | ESP32-C3 | GND | probe cable black |
| Soil probe | AOUT | ESP32-C3 | GPIO3 (ADC1) | probe cable yellow |
| BH1750 + BME280 | VCC | ESP32-C3 | 3V3 | 26 AWG |
| BH1750 + BME280 | GND | ESP32-C3 | GND | 26 AWG |
| BH1750 + BME280 | SDA | ESP32-C3 | GPIO6 | 26 AWG |
| BH1750 + BME280 | SCL | ESP32-C3 | GPIO7 | 26 AWG |
| BH1750 | ADDR | GND | | (address 0x23) |

Notes
- Strapping pins 2, 8, 9 are not used.
- Do not plug USB into the ESP32-C3 while the battery is fitted: flash it first (or use OTA), then charge through the side USB-C port only.
- Seal the probe slot in the Body floor with a bead of neutral-cure silicone (keeps water out and holds the probe). Push the probe in only up to the head; the head bottom is the soil line.
- Electronics parts: ESP32-C3 SuperMini, TP4056 USB-C (with protection), capacitive soil sensor v1.2, BH1750 (GY-302), BME280 3.3 V, protected 18650, 18650 spring contacts, 2 x 100k resistors. Soldering needed (header pads).

Solderless build (no iron)
- Buy the ESP32-C3 SuperMini, BH1750 (GY-302) and BME280 with pin headers already soldered, and use female-female Dupont jumper leads for every row above. The soil probe's own PH2.0 cable ends in Dupont plugs on most kits.
- Power it from a USB-C cable instead of the 18650: skip the TP4056, the cell, the spring contacts and the 100k divider. The firmware leaves battery out of the reading when there's no divider, and the app shows "USB" power instead.
- Share 3V3 and GND between the two I2C boards with a 1-to-2 Dupont splitter or a mini breadboard.
- Any module that isn't plugged in is left out of the reading, so you can start with just the soil probe.

Firmware: firmware/plant_sensor (Arduino IDE, board "ESP32C3 Dev Module", USB CDC On Boot: Enabled; libraries PubSubClient and Adafruit BME280). First boot opens the Formery-Plant-XXXX setup Wi-Fi; paste the key from Add sensor in the app. It reports to https://formery.ai/api/d/ingest every 30 minutes and deep-sleeps in between. Firmware updates: the setup page's "Update firmware" takes the .bin from Sketch > Export Compiled Binary.
