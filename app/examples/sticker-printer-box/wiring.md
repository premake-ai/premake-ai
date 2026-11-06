# Wiring: voice sticker printer

Power: USB-C PD charger (9 V) -> PD trigger (set 9 V) -> 2.5 A polyfuse -> 9 V rail.
9 V feeds the thermal printer directly and the MP1584 buck (set to 5.0 V BEFORE connecting) which feeds the ESP32-S3 5V pin.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| PD trigger | VOUT+ | Polyfuse | in | 20 AWG red |
| Polyfuse | out | Printer | VH (power +) | 20 AWG red |
| Polyfuse | out | MP1584 | IN+ | 22 AWG red |
| PD trigger | GND | Printer / MP1584 | GND / IN- | 20 AWG black |
| MP1584 | OUT+ (5 V) | ESP32-S3 | 5V | 22 AWG red |
| MP1584 | OUT- | ESP32-S3 | GND | 22 AWG black |
| ESP32-S3 | GPIO17 (TX) | Printer | RX (TTL) | Dupont |
| ESP32-S3 | GPIO18 (RX) | Printer | TX (TTL, 5 V tolerant? if 5 V, add 10k/20k divider) | Dupont |
| ESP32-S3 | GND | Printer | logic GND | Dupont |
| ESP32-S3 | 3V3 | INMP441 | VDD | Dupont |
| ESP32-S3 | GND | INMP441 | GND, L/R | Dupont |
| ESP32-S3 | GPIO4 | INMP441 | SCK | Dupont |
| ESP32-S3 | GPIO5 | INMP441 | WS | Dupont |
| ESP32-S3 | GPIO6 | INMP441 | SD | Dupont |
| ESP32-S3 | GPIO7 | Button | NO (other leg to GND) | Dupont |
| ESP32-S3 | GPIO15 | 5 mm LED anode via 220 ohm | cathode to GND | Dupont |

Notes
- Add a 470 uF cap across the printer power input (print heads pull ~2 A spikes).
- Avoid S3 strapping pins 0, 3, 45, 46.
- The PD trigger must be the only USB-C power input; don't power the printer from the ESP32's own USB port.
- Soldering needed: PD trigger, buck and mic headers.

Electronics parts: ESP32-S3-DevKitC-1, 58 mm TTL panel thermal printer, INMP441 mic, USB-C PD trigger (9 V), MP1584 buck, 2.5 A polyfuse, 470 uF 16 V cap, 24 mm push button, 5 mm LED + 220 ohm, wires.
