# Name sign wiring

Power: any 5 V USB charger (2 A or more) to the ESP32-C3 USB-C port. Max draw ~0.6 A (capped in firmware), so no extra fuse is needed; the USB charger is current-limited.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32-C3 SuperMini | 5V | LED strip | +5V | 22 AWG red |
| ESP32-C3 SuperMini | GND | LED strip | GND | 22 AWG black |
| ESP32-C3 SuperMini | GPIO10 | 330 ohm resistor | - | resistor leg |
| 330 ohm resistor | - | LED strip | DIN | 22 AWG green |
| 470 uF capacitor | + / - | LED strip | +5V / GND | soldered at strip input |

Notes
- Wire the strip's DIN end (arrows point away from it) on the left, next to the wire hole.
- Feed the wires through the hole in the channel floor, then solder them to the board.
- 3.3 V data drives 12 LEDs fine at this short length.

Assembly
1. Stick the strip into the channel, LEDs facing up.
2. Push the ESP32-C3 into the left end of the cavity, USB-C in the end-wall opening. Screwing on the bottom plate clamps it against the two ribs.
3. Screw on the bottom plate (4 x M3x8 countersunk, self-tapping into the printed bosses) and stick the 4 bumpers on.
4. Peel the film off the acrylic and drop it into the slot, with the engraved side facing front.

Electronics parts: ESP32-C3 SuperMini, WS2812B 60/m strip (12 LEDs, 200 mm), 330 ohm resistor, 470 uF 10 V cap, 22 AWG wire, USB-C cable.
