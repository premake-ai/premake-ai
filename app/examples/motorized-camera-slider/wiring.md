# Camera slider wiring

12 V 2 A adapter -> panel DC jack -> 1.5 A inline fuse -> TMC2209 VM and MP1584 IN. MP1584 set to 5.0 V (adjust before connecting!) -> ESP32-C3 5V pin.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + (centre) | Fuse holder | in | 22 AWG red |
| Fuse holder | out | TMC2209 | VM | 22 AWG red |
| Fuse holder | out | MP1584 | IN+ | 22 AWG red |
| DC jack | - | TMC2209 / MP1584 | GND / IN- | 22 AWG black |
| 100 uF cap | + / - | TMC2209 | VM / GND | at the driver pins |
| MP1584 | OUT+ (5 V) | ESP32-C3 | 5V | 22 AWG red |
| MP1584 | OUT- | ESP32-C3 | GND | 22 AWG black |
| ESP32-C3 | 3V3 | TMC2209 | VIO | Dupont |
| ESP32-C3 | GND | TMC2209 | GND (logic) | Dupont |
| ESP32-C3 | GPIO4 | TMC2209 | STEP | Dupont |
| ESP32-C3 | GPIO5 | TMC2209 | DIR | Dupont |
| ESP32-C3 | GPIO6 | TMC2209 | EN | Dupont |
| TMC2209 | MS1, MS2 | GND | | 1/8 microstep (standalone) |
| TMC2209 | A1 A2 B1 B2 | NEMA17 | coil A / coil B | motor cable |
| ESP32-C3 | GPIO7 | Limit switch | NO | 22 AWG |
| ESP32-C3 | GND | Limit switch | COM | 22 AWG |

Notes
- Set the TMC2209 Vref for ~0.8 A RMS before first run; never unplug the motor while powered.
- GPIO 2, 8, 9 are strapping pins on the C3 and are left free.
- Run the motor and switch cables through the notch in the box floor and clip them along the underside of the rail.
- Electronics: ESP32-C3 SuperMini, TMC2209, MP1584 buck, panel DC jack, 12 V 2 A adapter, inline fuse, 100 uF cap, KW10 switch. Headers must be soldered on the C3 and TMC2209.
