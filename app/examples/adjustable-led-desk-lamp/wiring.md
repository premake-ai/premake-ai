# Desk lamp wiring

- Power: 5 V USB-C (any 15 W+ charger) -> USB-C breakout -> 2 A polyfuse -> ESP32-C3 5V pin and LED ring 5V.
- Budget: 24 LEDs x 60 mA = 1.44 A at full white + 0.15 A ESP32-C3 = ~1.6 A max; firmware caps brightness at 180/255 (~1.2 A) to keep the head cool. A 3 A supply gives ~2x headroom.
- Three wires (red 5V, black GND, green DATA) run up the stem's back slot under the slot cover, through the arm channel, and drop into the head behind the hinge. Leave ~40 mm slack at the hinge.
- 330 ohm resistor goes in the data line close to the ring; 1000 uF cap soldered right on the ring's 5V/GND pads.
- Encoder: A/B/C on one side (C = common to GND), the two push-switch pins on the other.
