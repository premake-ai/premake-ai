# Recirculating Shower Unit – wiring

Supply: sealed UL-listed 12 V 10 A adapter (plug into a GFCI outlet outside the shower) -> panel barrel jack -> 10 A blade fuse -> 12 V Wago bus.
Pump ~6.5 A + UV ~0.5 A + valve ~0.5 A + logic 0.3 A = ~7.8 A, adapter has ~25 % headroom.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Barrel jack | + | Fuse holder | in | 18 AWG red |
| Fuse holder | out | Wago 12 V bus | – | 18 AWG red |
| Barrel jack | – | Wago GND bus | – | 18 AWG black |
| Wago 12 V / GND | – | MP1584 buck (set 5 V) | IN+ / IN- | 22 AWG |
| MP1584 | OUT+ / OUT- | ESP32-C3 SuperMini | 5V / GND | 22 AWG |
| Wago 12 V / GND | – | MOSFET 1, 2, 3 | VIN+ / VIN- | 18 AWG |
| ESP32-C3 | GPIO4 | MOSFET 1 (pump) | SIG (TRIG) | 22 AWG |
| ESP32-C3 | GPIO5 | MOSFET 2 (dump valve) | SIG | 22 AWG |
| ESP32-C3 | GPIO6 | MOSFET 3 (UV-C) | SIG | 22 AWG |
| ESP32-C3 | GND | MOSFET 1-3 | GND (signal) | 22 AWG |
| MOSFET 1 | OUT+ / OUT- | Pump | + / – | 18 AWG |
| MOSFET 2 | OUT+ / OUT- | Solenoid valve (N.O.) | + / – | 22 AWG |
| MOSFET 3 | OUT+ / OUT- | UV-C sterilizer | + / – | 22 AWG |
| ESP32-C3 | GPIO3 | DS18B20 | DATA (yellow), 4.7 k to 3V3 | 22 AWG |
| ESP32-C3 | 3V3 / GND | DS18B20 | red / black | 22 AWG |
| ESP32-C3 | GPIO7 (INPUT_PULLUP) | Float switch | lead 1 (lead 2 to GND) | 22 AWG |

Notes
- Avoid C3 strapping pins 2, 8, 9. Put a flyback diode across the solenoid if the MOSFET module lacks one.
- All electronics sit in the printed controller box above the water line; cable glands / silicone where wires exit.
- Plumbing: the recirculated water must NEVER be able to flow back into the house supply. Feed the shower head through the diverter so it is either on mains (fresh) or on the pump, never both, and fit a check valve on the fresh-water side.
- Use the "fresh" side for soap/shampoo; switch to recirculate for the warm rinse. The N.O. dump valve sends water to the drain whenever the unit is unpowered, the water is too cold or too old.
- Screw terminals, Wago and pre-made leads only: no soldering needed if you buy the DS18B20 module version with the resistor on board.
