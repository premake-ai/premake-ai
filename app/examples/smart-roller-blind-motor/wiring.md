# Wiring – Smart Roller Blind Motor (plug-in, no soldering)

Power: any UL-listed 5 V 2 A USB charger → USB cable into the ESP32. The motor draws ~0.25 A from the ESP32's 5V pin. No fuse needed on USB.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32 | GPIO25 | ULN2003 | IN1 | Dupont F-F |
| ESP32 | GPIO26 | ULN2003 | IN2 | Dupont F-F |
| ESP32 | GPIO27 | ULN2003 | IN3 | Dupont F-F |
| ESP32 | GPIO14 | ULN2003 | IN4 | Dupont F-F |
| ESP32 | 5V | ULN2003 | + (5-12V) | Dupont F-F |
| ESP32 | GND | ULN2003 | − | Dupont F-F |
| 28BYJ-48 | 5-pin plug | ULN2003 | motor socket | supplied cable |
| Push button | lead 1 | ESP32 | GPIO33 | Dupont F-F |
| Push button | lead 2 | ESP32 | GND | Dupont F-F |

Notes
- Leave the ULN2003 power jumper fitted.
- Never unplug the motor while it's running.

## Electronics parts
ESP32 DevKitC 38-pin, 28BYJ-48 5 V + ULN2003 board, 8 × female-female Dupont jumpers, 12 mm push button with leads, 5 V 2 A USB charger, USB cable.
