# Wiring: Modular Desk Dock

12 V DC from a UL-listed 12 V 5 A plug-in adapter. Worst-case draw ~2.6 A
(Qi charger 1.7 A, speaker 0.4 A, lamp 0.35 A, display 0.1 A), so the 5 A brick has ample headroom.
A 4 A PTC resettable fuse sits on +12 V right after the jack.

Rails: front brass strip (y = -20 mm) = **+12 V**, back strip (y = +28 mm) = **GND**.
The rails are asymmetric, so a module put on backwards has its pins on wood and gets no power.

## Base

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | centre (+) | PTC fuse 4 A | leg 1 | 18 AWG red |
| PTC fuse | leg 2 | Front brass rail | underside, left end | 18 AWG red, soldered |
| DC jack | sleeve (-) | Back brass rail | underside, left end | 18 AWG black, soldered |

## Every module (4 pogo pins: 2 on +12 V, 2 on GND, paralleled)

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Front pogo pins (x2) | + | module input | +12 V | 18 AWG (charger) / 22 AWG |
| Back pogo pins (x2) | - | module input | GND | same |

## Charger module
| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Pogo +12 V / GND | | Qi board | VIN+ / GND (12 V input pads) | 18 AWG |

## Speaker module
| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Pogo +12 V / GND | | MP1584 | IN+ / IN- | 22 AWG |
| MP1584 (set to 5.0 V before connecting) | OUT+ / OUT- | BT amp | 5V / GND | 22 AWG |
| BT amp | SPK+ / SPK- | 2 in driver | + / - | 22 AWG |

## Lamp module
| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Pogo +12 V | | Latching switch | C | 22 AWG |
| Latching switch | NO | COB strips (2, in parallel) | + | 22 AWG |
| Pogo GND | | COB strips | - | 22 AWG |

## Display module
| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Pogo +12 V / GND | | MP1584 | IN+ / IN- | 22 AWG |
| MP1584 (5.0 V) | OUT+ / OUT- | ESP32-C3 SuperMini | 5V / GND | 22 AWG |
| ESP32-C3 | 3V3 / GND | e-paper | VCC / GND | Dupont |
| ESP32-C3 | GPIO4 | e-paper | CLK | Dupont |
| ESP32-C3 | GPIO6 | e-paper | DIN | Dupont |
| ESP32-C3 | GPIO7 | e-paper | CS | Dupont |
| ESP32-C3 | GPIO5 | e-paper | DC | Dupont |
| ESP32-C3 | GPIO10 | e-paper | RST | Dupont |
| ESP32-C3 | GPIO3 | e-paper | BUSY | Dupont |

Avoid C3 strapping pins 2, 8 and 9. Set both MP1584s to 5.0 V with a meter **before** wiring the loads.
Soldering needed (rails, pogo pins, module boards).
