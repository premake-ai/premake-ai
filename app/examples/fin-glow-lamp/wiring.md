# Fin glow lamp - wiring

Power: 5 V from the ESP32-C3 SuperMini's USB-C port (any 5 V 2 A USB-C phone charger). Firmware caps the strip at 500 mA. No soldering if you use a pre-wired JST-SM strip pigtail and Dupont jumpers; otherwise 6 solder joints.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32-C3 SuperMini | 5V | WS2812B strip | +5V (red) | 22 AWG, through the rail tunnel |
| ESP32-C3 SuperMini | GND | WS2812B strip | GND (white) | 22 AWG |
| ESP32-C3 SuperMini | GPIO4 | 330 ohm resistor | - | in-line, close to the board |
| 330 ohm resistor | - | WS2812B strip | DIN (green) | 22 AWG |
| WS2812B strip | +5V / GND | 470 uF 10 V capacitor | + / - | across the strip input |
| ESP32-C3 SuperMini | GPIO5 | EC11 encoder | A (CLK) | Dupont |
| ESP32-C3 SuperMini | GPIO6 | EC11 encoder | B (DT) | Dupont |
| ESP32-C3 SuperMini | GPIO7 | EC11 encoder | SW | Dupont |
| ESP32-C3 SuperMini | GND | EC11 encoder | C + SW common | Dupont |

Notes
- 12 LEDs x 60 mA = 0.72 A worst case at full white; the 500 mA firmware cap keeps it inside a USB port's budget, so no extra fuse is needed. Do not raise MAX_MA above 900.
- GPIO 2, 8 and 9 are strapping pins on the C3; leave them free.
- Flash: Arduino IDE, board "ESP32C3 Dev Module", USB CDC On Boot enabled, library FastLED. Hold BOOT while plugging in if the port does not appear.

Electronics parts: ESP32-C3 SuperMini, WS2812B 60/m strip (12 LEDs, 200 mm), EC11 rotary encoder, 330 ohm resistor, 470 uF capacitor, 22 AWG wire, USB-C cable + 5 V charger.
