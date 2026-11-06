# Pork probe wiring notes

- Power: one 18650 -> TP4056 USB-C charger (with DW01 protection) -> ESP32-C3 SuperMini 5V pin. Peak draw ~0.35 A (Wi-Fi 0.3 A + OLED 20 mA + buzzer 25 mA), well under the cell's protection limit; no separate fuse needed below 1 A.
- Battery life: ~100 mA average with Wi-Fi on, so a 3000 mAh cell gives roughly a full day of smoking. Deep sleep (hold the button 2 s) draws well under 0.2 mA.
- **Flash the firmware before you close the lid, with the battery out of the holder.** Never plug the ESP32's own USB in while the battery is connected (the 5V pin would back-feed the charger). Day-to-day charging is through the TP4056 port on the side.
- Probe: the jack's Tip goes to GPIO1, Sleeve to GND, Ring unused. GPIO1 is pulled up to 3V3 through the 100k 1% resistor, with 100 nF to GND right at the ESP32 pins.
- Battery sense: 470k + 470k from OUT+ to GND, midpoint to GPIO0, 100 nF to GND.
- Keep the probe wires short and twisted (Tip + Sleeve).
- GPIO3 is the button because ESP32-C3 can only wake from deep sleep on GPIO0-5. GPIO2, 8 and 9 are strapping pins and are left unused.
- The base stays OUTSIDE the oven or smoker (PETG is good to ~70 C). Only the probe and its braided cable go inside; shut the door on the flat part of the cable.
