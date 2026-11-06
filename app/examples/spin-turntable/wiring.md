# Spin turntable - wiring

Power: 12 V 2 A plug-in adapter (UL listed, 5.5 x 2.1 mm barrel) -> 2 A blade fuse -> panel DC jack. 12 V feeds the TMC2209 motor supply; an MP1584 buck makes 5 V for the ESP32. Set the MP1584 to 5.0 V with a meter BEFORE connecting the ESP32. Needs soldering (jack, buck, button).

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + (centre) | Inline fuse 2 A | in | 20 AWG |
| Inline fuse 2 A | out | TMC2209 | VM | 20 AWG |
| Inline fuse 2 A | out | MP1584 | IN+ | 20 AWG |
| DC jack | - | TMC2209 / MP1584 | GND / IN- | 20 AWG |
| 100 uF 35 V capacitor | + / - | TMC2209 | VM / GND | at the driver |
| MP1584 | OUT+ (5.0 V) | ESP32 DevKit | VIN | 22 AWG |
| MP1584 | OUT- | ESP32 DevKit | GND | 22 AWG |
| ESP32 DevKit | 3V3 | TMC2209 | VIO | Dupont |
| ESP32 DevKit | GPIO26 | TMC2209 | STEP | Dupont |
| ESP32 DevKit | GPIO27 | TMC2209 | DIR | Dupont |
| ESP32 DevKit | GPIO25 | TMC2209 | EN | Dupont |
| ESP32 DevKit | GND | TMC2209 | GND (logic) | Dupont |
| TMC2209 | A1 A2 B1 B2 | NEMA17 | coil A, coil B | 4-pin JST-XH motor cable |
| ESP32 DevKit | GPIO32 | 16 mm button | NO | 22 AWG |
| ESP32 DevKit | GND | 16 mm button | COM | 22 AWG |
| ESP32 DevKit | 3V3 / GND | 10k pot | ends | 22 AWG |
| ESP32 DevKit | GPIO34 | 10k pot | wiper | 22 AWG |

Notes
- Set the TMC2209 current with its Vref pot to ~0.8 A (the turntable needs little torque; it runs cool and silent).
- Never plug or unplug the motor while 12 V is on: it kills the driver.
- Never power the ESP32 from USB and the buck at the same time unless the buck is disconnected.
- Max draw ~1 A at 12 V; the 2 A fuse and 2 A adapter give headroom.

Electronics parts: ESP32 DevKit V1, TMC2209 stepstick, NEMA17 40 mm stepper + cable, MP1584 buck, 12 V 2 A adapter, panel DC jack, inline blade fuse holder + 2 A fuse, 16 mm momentary button, B10K 16 mm pot, 100 uF 35 V capacitor, wire.
