# CoreXY printer wiring

Supply: 24 V 10 A UL-listed brick → 5.5x2.5 panel jack → 15 A blade fuse → rocker switch → SKR Mini E3 V3 power input. Nothing touches mains.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| Panel jack | + | Fuse holder (15 A) | in | 18 AWG red |
| Fuse holder | out | Rocker switch | 1 | 18 AWG red |
| Rocker switch | 2 | SKR Mini E3 V3 | POWER + | 18 AWG red |
| Panel jack | − | SKR Mini E3 V3 | POWER − | 18 AWG black |
| SKR | HB +/− | Heated bed | heater leads | 18 AWG (bed's own) |
| SKR | TB | Bed thermistor | 2-pin | 22 AWG |
| SKR | E0 heater | Hotend heater 24 V | 2-pin | hotend kit leads |
| SKR | TH0 | Hotend thermistor | 2-pin | hotend kit leads |
| SKR | X motor | Stepper A (back left) | 4-pin | motor cable |
| SKR | Y motor | Stepper B (back right) | 4-pin | motor cable |
| SKR | Z motor | Z stepper | 4-pin | motor cable |
| SKR | E motor | Extruder pancake stepper | 4-pin | motor cable |
| SKR | Z-STOP | Z microswitch | S/G | 22 AWG |
| SKR | FAN0 | 4010 blower (part cooling) | 2-pin | 22 AWG |
| SKR | FAN1 (always on) | 4010 hotend fan | 2-pin | 22 AWG |
| SKR | EXP1 / EXP2 | 12864 LCD | EXP1 / EXP2 | ribbon cables |

Firmware: Marlin for SKR Mini E3 V3 with `COREXY`, bed 220 x 220, Z max 250, sensorless homing on X/Y (TMC2209 DIAG jumpers fitted), thermal runaway protection ON (default — never disable).

Notes:
- Run the toolhead cables (heater, thermistor, fans, extruder motor) through the drag chain; strain-relieve at both ends.
- Check motor direction after first power-up: if X moves diagonally, swap the A/B motor plugs.
- Never unplug a stepper while powered.
