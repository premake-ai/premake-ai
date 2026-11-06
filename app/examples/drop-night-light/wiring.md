# Drop night light - wiring

Power: 5 V from the ESP32-C3 SuperMini's USB-C port (any 5 V 1 A USB-C charger). The firmware caps the ring at 400 mA, so no fuse is needed. 7 solder joints.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32-C3 SuperMini | 5V | WS2812B 8-LED ring | 5V / VCC | 26 AWG silicone, up through the centre post |
| ESP32-C3 SuperMini | GND | WS2812B 8-LED ring | GND | 26 AWG |
| ESP32-C3 SuperMini | GPIO4 | 330 ohm resistor | - | in-line, heat-shrink it |
| 330 ohm resistor | - | WS2812B 8-LED ring | DIN (IN, not OUT) | 26 AWG |
| WS2812B ring | 5V / GND | 100 uF 10 V electrolytic | + / - | solder on the ring pads |
| ESP32-C3 SuperMini | GPIO3 | 6 x 6 mm tact switch | pin 1 | 26 AWG |
| ESP32-C3 SuperMini | GND | 6 x 6 mm tact switch | pin 2 (diagonal) | 26 AWG |

Assembly
1. Glue the tact switch to the front post (plunger facing the wall tab) with a drop of CA; check the tab clicks it.
2. Slide the C3 onto the rails, USB-C into the back opening; a dab of hot glue on the rails holds it.
3. Feed the 3 ring wires up the hollow post, seat the ring on the flange, LEDs up.
4. Flash the firmware, test, then press the diffuser down until the bead clicks into the groove.

Notes
- 8 LEDs x 60 mA = 480 mA worst case at full white; MAX_MA 400 keeps it below the USB 500 mA budget.
- GPIO 2, 8 and 9 are strapping pins on the C3; leave them free.
- Flash: Arduino IDE, board "ESP32C3 Dev Module", USB CDC On Boot enabled, library FastLED. Hold BOOT while plugging in if the port does not appear.
- Low voltage only. Never power it from anything but a USB charger or port.

Electronics parts: ESP32-C3 SuperMini, WS2812B 8-LED ring (32 mm), 6 x 6 x 5 mm tact switch, 330 ohm resistor, 100 uF 10 V capacitor, 26 AWG silicone wire, USB-C cable.
