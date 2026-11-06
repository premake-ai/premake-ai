# Desk Tesla coil replica: wiring

Low voltage only: 5 V from any USB charger through the ESP32-C3's own USB-C port. There is no high voltage in this product.
24 LEDs x 20 mA typical = about 0.5 A (brightness is capped in firmware), plus 0.1 A for the ESP32-C3, so a 5 V 1 A charger is enough. The USB port's own current limit protects the circuit, so no fuse is needed.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32-C3 SuperMini | 5V | LED ring | 5V / VCC | 26 AWG red, 250 mm |
| ESP32-C3 SuperMini | GND | LED ring | GND | 26 AWG black, 250 mm |
| ESP32-C3 SuperMini | GPIO4 | 330 Ω resistor → LED ring | DIN | 26 AWG green, 250 mm |

The three wires run up through the base's centre hole, inside the Secondary coil tube, through the small hole in the Toroid bottom and along its groove to the ring pads. Leave about 30 mm of slack under the base.

## Assembly
1. Use a soldering iron to press the 6 heat-set inserts in: 3 into the bosses inside the Base and 3 into the underside of the Primary ring.
2. Screw the Primary ring onto the Base top with 3 × M3×6 screws from inside the Base.
3. Solder the 3 wires to the LED ring, with the 330 Ω resistor in the data line. Thread the wires down through the Toroid bottom and the Secondary coil, then solder them to the ESP32-C3.
4. Lay the ring in the Toroid bottom's pocket, LEDs facing up. Press the Toroid top on (the ring lines up both halves) and run a thin bead of CA glue around the seam.
5. Press the Secondary coil into the Toroid collar and into the Primary ring (0.15 mm press fit).
6. Stick the ESP32-C3 to the plywood Bottom plate with VHB tape so its USB-C port sits in the back wall slot. Close the plate with 3 × M3×8 screws and stick on the 3 rubber feet.
7. Flash `firmware/tesla_glow` (Arduino IDE, board "ESP32C3 Dev Module", USB CDC on boot enabled, library Adafruit NeoPixel).

## Electronics parts
- ESP32-C3 SuperMini
- 24-LED WS2812B ring, 66 mm OD / 52 mm ID
- 330 Ω resistor, 26 AWG wire
- USB-C cable plus any 5 V ≥1 A USB charger
