# Wiring notes

- Power: 5 V 2 A USB adapter -> panel micro-USB in the base -> 30 cm extension -> ESP32-CAM-MB micro-USB. The MB feeds 5 V to the ESP32-CAM.
- Budget: ESP32-CAM with camera + Wi-Fi ~0.5 A peak; ring of 12 WS2812B 0.72 A at full white, capped in firmware to about 50 % (~0.36 A). Total under 0.9 A, well inside 2 A.
- The 0.5 A polyfuse in the ring's 5 V lead protects the thin wires and the MB's 5 V trace.
- Solder the wires to the ESP32-CAM header pin stubs on the top side of the board (5V, GND, IO13, IO14 are all on the same header row). Keep the pins clean so the board still plugs into the MB.
- Ring wires (~13 cm) run down the back of the spine. Twist the data wire with GND. The 330 ohm resistor sits at the ESP32 end.
- IO4 drives the on-board flash LED; the firmware keeps it off. IO12 is a strapping pin and is not used.
- Flash: before closing it up, plug the MB in directly or through the extension and use "Flash to my ESP32". The MB does the auto-reset; if it doesn't, hold IO0 (BOOT on the MB) while pressing RST.
