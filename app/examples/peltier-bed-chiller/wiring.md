# Bed cooler wiring

Supply: sealed UL-listed 12 V 20 A brick -> XT60 panel inlet -> 20 A inline blade fuse -> Wago 221 bus (+12 V / GND).
Budget: 2 x Peltier ~5.5 A + pump 0.6 A + fans 0.3 A + logic 0.1 A = ~12 A (40 % headroom).
Use 14 AWG for every 12 V / GND run carrying Peltier current; 22 AWG for signals.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| XT60 inlet | + | Fuse holder | in | 14 AWG red |
| Fuse holder | out | Wago +12 V | - | 14 AWG red |
| XT60 inlet | - | Wago GND | - | 14 AWG black |
| Wago +12 V | - | MOSFET 1/2/3 | VIN+ | 14 AWG red |
| Wago GND | - | MOSFET 1/2/3 | VIN- | 14 AWG black |
| MOSFET 1 | OUT+/- | Peltier 1 | red/black | 14 AWG |
| MOSFET 2 | OUT+/- | Peltier 2 | red/black | 14 AWG |
| MOSFET 3 | OUT+/- | Pump + both fans (parallel) | +/- | 18 AWG |
| Wago +12 V / GND | - | MP1584 | IN+ / IN- | 22 AWG |
| MP1584 (set to 5.0 V first!) | OUT+ / OUT- | ESP32-C3 | 5V / GND | 22 AWG |
| ESP32-C3 | GPIO3 | MOSFET 1 | PWM/TRIG | 22 AWG |
| ESP32-C3 | GPIO4 | MOSFET 2 | PWM/TRIG | 22 AWG |
| ESP32-C3 | GPIO5 | MOSFET 3 | PWM/TRIG | 22 AWG |
| ESP32-C3 | GND | MOSFET 1/2/3 | GND (signal) | 22 AWG |
| ESP32-C3 | GPIO6 | DS18B20 x2 | data (yellow), 4.7 k to 3V3 | 22 AWG |
| ESP32-C3 | 3V3 / GND | DS18B20 x2 | red / black | 22 AWG |
| ESP32-C3 | GPIO0 / GPIO1 | Encoder | A / B (C to GND) | 22 AWG |
| ESP32-C3 | GPIO7 | Encoder | switch (other leg GND) | 22 AWG |
| ESP32-C3 | GPIO10 | LED via 220 ohm | anode (cathode GND) | 22 AWG |

Notes
- Strapping pins 2, 8, 9 are left unused.
- Fans and pump are on whenever either Peltier is on; firmware cuts the Peltiers if the heatsink probe passes 60 C or the water probe fails.
- Don't chill water below ~14 C: cold lines sweat in a humid bedroom. Wrap the cold blocks and internal cold tubing in foam.
- Strain-relieve the pad hoses at the bulkheads. Never run the Peltiers dry (pump on, loop filled).
- Soldering: headers on the ESP32-C3 and the DS18B20 pull-up.
