# Wi-Fi Pet Feeder – wiring

Supply: 12 V 2 A sealed plug-in adapter -> panel DC jack (back) -> 1.5 A inline fuse -> 12 V rail.
Motor draws ~0.6 A RMS (TMC2209 set by its Vref pot to ~0.8 V), ESP32 ~0.1 A via the MP1584. Peak < 1 A.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + (centre) | Inline fuse 1.5 A | in | 18 AWG red |
| Inline fuse | out | TMC2209 | VM | 18 AWG red |
| Inline fuse | out | MP1584 | IN+ | 22 AWG red |
| DC jack | – | TMC2209 / MP1584 | GND / IN– | 18 AWG black |
| 100 uF 35 V cap | + / – | TMC2209 | VM / GND | at the driver |
| MP1584 (set to 5.0 V BEFORE connecting) | OUT+ | ESP32-C3 SuperMini | 5V | 22 AWG |
| MP1584 | OUT– | ESP32-C3 SuperMini | GND | 22 AWG |
| ESP32-C3 | 3V3 | TMC2209 | VIO | 22 AWG |
| ESP32-C3 | GND | TMC2209 | GND (logic) | 22 AWG |
| ESP32-C3 | GPIO4 | TMC2209 | STEP | 22 AWG |
| ESP32-C3 | GPIO5 | TMC2209 | DIR | 22 AWG |
| ESP32-C3 | GPIO6 | TMC2209 | EN | 22 AWG |
| TMC2209 | MS1, MS2 | GND | | 1/8 microstep |
| ESP32-C3 | GPIO7 | Feed button | 1 | 22 AWG |
| Feed button | 2 | GND | | 22 AWG |
| TMC2209 | A1 A2 B1 B2 | NEMA17 | coil A / coil B | JST-XH 4-pin, through cable hole behind the motor cover |

Notes
- Avoid C3 strapping pins 2, 8, 9. The button uses the internal pull-up.
- Never unplug the motor while powered.
- Low voltage only. The adapter is the only thing that touches mains.

Electronics parts: ESP32-C3 SuperMini, TMC2209 stepstick, MP1584 buck, 12 V 2 A adapter, panel DC jack, inline fuse holder + 1.5 A fuse, 100 uF cap, 16 mm momentary button, 50x70 perfboard with female headers, JST-XH lead.
