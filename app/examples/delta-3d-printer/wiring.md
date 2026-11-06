# Delta printer wiring

Runs stock **Klipper** or **Marlin** in delta mode, so there's no custom firmware. Key numbers for the config:
arm length 300 mm, delta radius 125 mm (carriage ball radius 155 mm minus effector ball radius 30 mm), towers at 90 / 210 / 330 deg,
print radius ~100 mm, endstops at the top, GT2 20T pulleys = 80 steps/mm at 1/16.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| 24 V adapter | + | Fuse holder (15 A) | in | 14 AWG |
| Fuse holder | out | Mainboard | VIN + | 14 AWG |
| 24 V adapter | - | Mainboard | VIN - | 14 AWG |
| Mainboard | X motor | Tower A motor (back, 90 deg) | 4-pin | stepper cable |
| Mainboard | Y motor | Tower B motor (front left) | 4-pin | stepper cable |
| Mainboard | Z motor | Tower C motor (front right) | 4-pin | stepper cable |
| Mainboard | E motor | Extruder motor | 4-pin | stepper cable |
| Mainboard | X/Y/Z-STOP | Top endstops A/B/C | S, G | 22 AWG |
| Mainboard | HE0 | Hotend heater | 2 | 22 AWG silicone |
| Mainboard | TH0 | Hotend thermistor | 2 | 22 AWG |
| Mainboard | BED | Heated bed | 2 | 16 AWG silicone |
| Mainboard | THB | Bed thermistor | 2 | 22 AWG |
| Mainboard | FAN0 | 4010 part-cooling blower | 2 | 22 AWG |
| Mainboard | FAN1 (always on) | 30 mm hotend fan (24 V) | 2 | 22 AWG |

Power budget: bed ~6.3 A + hotend 1.7 A + motors ~1 A, about 9 A peak on a 10 A brick; fuse 15 A.
Strain-relieve the effector cable bundle and the bed leads. Never unplug a motor while it's powered.
No soldering needed if you buy a pre-wired hotend and bed; crimp JST-XH plugs or use pre-made cables.
