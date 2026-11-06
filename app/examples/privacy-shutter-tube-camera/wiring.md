# Wiring notes

- The ESP32-CAM plugs straight onto the ESP32-CAM-MB's female headers (5V, GND, U0T/U0R, IO0 are the header pins, no wires).
- Status LED: solder a 220 ohm resistor to the LED's long leg (+), then two ~60 mm wires (heat-shrink both joints) to the top-side solder joints of the ESP32-CAM header pins IO13 and GND. That's 3 small joints.
- IO13 is free because the microSD slot is not used (no recordings on the device: privacy).
- Power: 5 V 2 A USB adapter -> micro-USB cable -> MB. The ESP32-CAM peaks ~300 mA while streaming; 2 A is plenty, no fuse needed (USB adapter is current limited).
- The onboard red LED (IO33) mirrors the status; the bright flash LED (IO4) is kept off in firmware.
