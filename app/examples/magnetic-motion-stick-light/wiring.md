# Stick light wiring notes

- Power: one protected 18650 through the TP4056 USB-C charger (protection board, 1 A charge). The OUT+/OUT- pads feed everything; no fuse needed (load < 0.5 A, the board cuts out at ~3 A).
- Power budget: 6 LEDs x 60 mA = 0.36 A at full white, capped to 60 % in firmware (~0.22 A) + ESP32-C3 ~0.1 A awake = ~0.32 A. Deep sleep between motions.
- Battery sense: 100k / 100k divider from OUT+ to GPIO1 (halves 4.2 V to 2.1 V for the ADC).
- **Flashing:** take the cell out (or unscrew the diffuser and unplug the battery) before plugging USB into the ESP32-C3. Its 5V pin is wired to the battery, and USB 5 V would back-feed it. The ESP32-C3's USB-C points down into the diffuser joint: remove the one M2.5 screw at the back, pull the diffuser off, and the port is right there.
- Charge from the USB-C slot in the top end.
- Keep wires short and run them down the front corners past the cell holder. Press the PIR lens into its hole from inside and tack it with a dot of hot glue.
- Magnets: fit the stick magnets and the disc magnets in **attracting** polarity (test each pair before gluing them with a drop of CA).
