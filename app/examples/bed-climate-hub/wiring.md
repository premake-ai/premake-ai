# Bed Climate Hub – wiring

Supply: UL-listed 12 V 10 A plug-in adapter -> panel jack -> **10 A inline blade fuse** -> Wago 12 V bus.
Budget: TEC ~6 A + pump 0.5 A + fan 0.2 A + ESP32/OLED 0.3 A (via buck) ≈ 7 A, so 10 A leaves ~30% headroom.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + | Fuse holder | in | 18 AWG |
| Fuse holder | out | Wago 12 V | – | 18 AWG |
| DC jack | – | Wago GND | – | 18 AWG |
| Wago 12 V / GND | – | BTS7960 | B+ / B- | 18 AWG |
| BTS7960 | M+ / M- | Peltier TEC1-12706 | red / black | 18 AWG |
| Wago 12 V / GND | – | MP1584 (set to 5.0 V first!) | IN+ / IN- | 22 AWG |
| MP1584 | OUT+ / OUT- | ESP32 breakout | 5V / GND | 22 AWG |
| ESP32 | GPIO25 | BTS7960 | RPWM (cool) | 22 AWG |
| ESP32 | GPIO26 | BTS7960 | LPWM (heat) | 22 AWG |
| ESP32 | 3V3 | BTS7960 | R_EN + L_EN + VCC | 22 AWG |
| ESP32 | GPIO27 | MOSFET module 1 (pump) | SIG | 22 AWG |
| ESP32 | GPIO14 | MOSFET module 2 (fan) | SIG | 22 AWG |
| Wago 12 V / GND | – | MOSFET 1 / 2 | VIN+ / VIN- | 22 AWG |
| MOSFET 1 | OUT | Pump | + / – | 22 AWG |
| MOSFET 2 | OUT | 92 mm fan | + / – | 22 AWG |
| ESP32 | GPIO4 | DS18B20 x2 (water, bed) | DQ (yellow) | 22 AWG, 4.7 k pull-up to 3V3 |
| ESP32 | 3V3 / GND | DS18B20 x2 | red / black | 22 AWG |
| ESP32 | GPIO21 / GPIO22 | OLED | SDA / SCL | Dupont |
| ESP32 | GPIO32 / GPIO33 / GPIO13 | EC11 encoder | A / B / SW (C and other SW pin to GND) | Dupont |

Notes
- All grounds common. Strain-relieve the adapter cable with a zip tie to the base tray.
- Thermal paste on both Peltier faces; cold side (printed side) down onto the water block.
- Fan and pump always run when the Peltier runs; firmware cuts the TEC if water < 12 °C or > 42 °C.
- Loop: reservoir -> pump -> water block -> rear bulkhead OUT -> pad -> rear bulkhead IN -> reservoir. Use distilled water.
- Soldering: DS18B20 pull-up resistor and OLED header pins only.
