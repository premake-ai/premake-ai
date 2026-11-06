# Wiring notes (solderless, your ELEGOO ESP32 DevKit)

- The ELEGOO board (51.7 x 29 mm, pin rows 25.6 mm apart) is too wide for a breadboard. It lies upside down (pins up) in the floor cradle on a strip of foam tape, USB-C end against the left wall. Jumpers push straight onto its pins.
- The mini breadboard stands on edge against the right wall and works only as a power strip. Pick two neighbouring columns: one is "5V", the other "GND".
  - ESP32 5V pin (sometimes labelled VIN) -> 5V column (F-M jumper)
  - ESP32 GND -> GND column (F-M)
  - Servo red -> 5V column, servo brown -> GND column (M-M jumpers into the servo plug)
  - 470 uF capacitor: long leg in 5V, striped leg in GND
- Direct jumpers:
  - ESP32 GPIO18 (D18 / G18) -> servo orange (F-M)
  - ESP32 3V3 -> OLED VCC, a second GND pin -> OLED GND (F-F)
  - ESP32 GPIO21 -> OLED SDA, GPIO22 -> OLED SCL (F-F)
- Power: USB-C from any 5 V / 1 A+ phone charger. Budget: servo ~0.25 A moving (0.7 A stall) + ESP32 ~0.3 A with Wi-Fi + OLED 20 mA = about 1 A worst case. Never power the servo from 3V3.
- The board's labels are on its top face, which faces down here. Note which pin is which before you flip it in, or follow a 38-pin ESP32 DevKit pinout.
- Firmware: board "ESP32 Dev Module". Set WIFI_SSID / WIFI_PASS / COUNT_URL; the URL must return `{"visits":N,"designs":M}` for today.
- Centre the servo by powering up once, then fit the horn with the arm pointing straight up.
