# Wiring notes

- **Supply:** 5 V 5 A UL-listed plug-in adapter -> pre-wired panel jack -> 5 A blade fuse -> Wago 5 V rail. Budget: 3 x MG996R ~0.5-1 A each while balancing (2.5 A stall each, brief), ESP32 0.3 A: ~3.3 A peak, 5 A adapter = 30%+ headroom.
- Servos are powered only from the PCA9685 **V+ screw terminal**, never from the ESP32. The 1000 uF capacitor goes in the same V+/GND terminal (stripe = minus = GND).
- The ESP32 runs from the breakout's 5 V terminal. Unplug the 5 V adapter while the USB cable is in for flashing.
- I2C: TSC2007 (0x48) and PCA9685 (0x40) share GPIO21 (SDA) and GPIO22 (SCL); both boards have pull-ups. Two wires per screw terminal is fine.
- Panel FPC tail: contacts face the side marked on the TSC2007 socket (it's double-sided); lift the latch, insert fully, close. Leave a 15 mm service loop through the slot in the plate.
- Leave the Qwiic cable a loose loop between the plate and the deck hole so the plate can tilt +-7 deg freely; tie it to the deck with a dab of hot glue or a cable tie.
- Servo order: A = back (PCA channel 0), B = front-left (1), C = front-right (2).
