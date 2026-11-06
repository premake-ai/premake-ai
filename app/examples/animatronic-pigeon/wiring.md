# Animatronic Pigeon wiring

Power: 5 V 3 A USB-C adapter -> USB-C breakout (in base) -> 3 A polyfuse -> 5 V rail. 3 wires (5V, GND, PIR) run up the hollow right leg into the body. 1000 uF cap across the 5 V rail at the servos.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| USB-C breakout | VBUS | Polyfuse 3 A | in | 22 AWG red |
| Polyfuse | out | 5 V rail (up right leg) | | 28 AWG red |
| USB-C breakout | GND | GND rail (up right leg) | | 28 AWG black |
| AM312 PIR | VCC / GND | 5 V / GND rail | | |
| AM312 PIR | OUT | ESP32-C3 | GPIO 1 | 28 AWG yellow (up leg) |
| 5 V rail | | ESP32-C3 | 5V | |
| GND rail | | ESP32-C3 | GND | |
| Neck pan servo | signal | ESP32-C3 | GPIO 3 | servo lead |
| Head tilt servo | signal | ESP32-C3 | GPIO 4 | servo lead + extension |
| Left wing servo | signal | ESP32-C3 | GPIO 5 | servo lead |
| Right wing servo | signal | ESP32-C3 | GPIO 6 | servo lead |
| All servos | red / brown | 5 V / GND rail | | |
| DFPlayer | VCC / GND | 5 V / GND rail | | |
| DFPlayer | RX | ESP32-C3 | GPIO 21 (TX) via 1 k | |
| DFPlayer | TX | ESP32-C3 | GPIO 20 (RX) | |
| DFPlayer | SPK1 / SPK2 | Speaker 28 mm | + / - | |
| 1000 uF cap | + / - | 5 V / GND rail | | at servos |

Avoid GPIO 2, 8, 9 (strapping). microSD: put coo sounds as `/mp3/0001.mp3`, `0002.mp3`, `0003.mp3`.
Soldering needed for the rail, polyfuse and USB-C breakout.
