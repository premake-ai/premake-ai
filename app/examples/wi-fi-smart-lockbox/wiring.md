# WiFi lockbox wiring

Supply: 5 V USB charger -> USB-C cable -> ESP32-C3 SuperMini (port exposed in the right wall).

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| ESP32-C3 | 5V | SG90 | red (+) | Dupont |
| ESP32-C3 | GND | SG90 | brown (GND) | Dupont |
| ESP32-C3 | GPIO4 | SG90 | orange (signal) | Dupont |

Notes
- Servo arm pushes a bolt through the lid's latch tab. Locked = 0 deg, open = 90 deg.
- Servo holds its position without power; if unplugged it stays locked. Keep a USB cable handy.
- Solder headers on the SuperMini (soldering needed). Avoid strapping pins 2, 8, 9.
