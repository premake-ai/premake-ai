# Wiring notes

- Supply: Mean Well GST220A12 (12 V, 15 A, UL-listed desktop brick, 4-pin DIN). Power budget: 2 Peltiers ~9 A at full duty + 2 fans 0.4 A + pump 0.4 A + Nano/OLED 0.1 A = ~10 A, so the 15 A brick has ~50% headroom.
- Fuse: 15 A blade fuse right after the DIN socket (+12 V). Use 18 AWG from the fuse to the Wagos, the BTS7960 and the Peltiers; the Peltier leads go two per BTS7960 M+/M- terminal.
- DIN socket (KPJX-4S): pins 1+2 = GND, 3+4 = +12 V on the GST220A R7B plug. Check with a meter before connecting. This is the only solder job.
- Peltier polarity: with RPWM driving, the Peltier face touching the water block must get cold. If it gets hot, swap M+/M-.
- Never run the Peltiers without the fans and heatsink. The firmware cuts out at 60 °C on the heatsink probe or if either probe is missing.
- Fill the tank and run the pump (power on, then off: the run-on gives 60 s) before the Peltiers go to full duty, so the pump never runs dry.
