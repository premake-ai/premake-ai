# SCARA printer wiring

Power: 24 V 5 A sealed plug-in adapter -> panel DC jack -> 7.5 A inline blade fuse -> board VIN. No heated bed (PLA/PETG on PEI, unheated), so total draw is ~3 A (hotend 1.7 A + motors + board).

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + | Fuse holder | in | 18 AWG red |
| Fuse holder | out | Board | VIN + | 18 AWG red |
| DC jack | - | Board | VIN - | 18 AWG black |
| Board | X motor | Shoulder motor (left) | 4-pin | stepper cable 1 m |
| Board | Y motor | Elbow motor (right) | 4-pin | stepper cable 1 m |
| Board | Z motor | Z motor (base) | 4-pin | stepper cable |
| Board | E motor | Extruder motor (top) | 4-pin | stepper cable 1 m |
| Board | HE0 | Hotend heater | 2 wires | 22 AWG (supplied) |
| Board | TH0 | Hotend thermistor | 2-pin | supplied, extended |
| Board | FAN (always-on or HE fan) | 30 mm hotend fan (24 V version) | 2-pin | 22 AWG |
| Board | X-STOP | Shoulder endstop | S/G | 22 AWG |
| Board | Y-STOP | Elbow endstop | S/G | 22 AWG |
| Board | Z-STOP | Z endstop (bottom of column) | S/G | 22 AWG |

Notes
- Firmware: Marlin 2.1 with `MP_SCARA` enabled; `SCARA_LINKAGE_1 150`, `SCARA_LINKAGE_2 150`, `SCARA_OFFSET_X 0`, `SCARA_OFFSET_Y -125` (shoulder relative to bed centre). Shoulder and elbow have a 3:1 belt reduction (20T -> 60T): steps/deg = 200*16*3/360 = 26.67.
- Use the 24 V version of the 30 mm fan. Run motor/heater cables along link 1 with a spiral wrap; leave a loop at the shoulder.
- Never unplug a motor while powered.
