# Wiring: motorized roller blind

Supply: 12 V 2 A UL-listed plug-in adapter -> panel jack in the bottom of the body -> 1.5 A polyfuse -> 12 V rail.
Motor draws ~1 A peak, ESP32 ~0.1 A via the buck, so 2 A has plenty of headroom.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| DC jack | + (centre) | Polyfuse 1.5 A | in | 22 AWG red |
| Polyfuse | out | TMC2209 | VM | 22 AWG red |
| Polyfuse | out | MP1584 | IN+ | 22 AWG red |
| DC jack | - | TMC2209 / MP1584 | GND / IN- | 22 AWG black |
| 100 uF cap | + / - | TMC2209 | VM / GND | at the driver pins |
| MP1584 (set to 5.0 V before connecting!) | OUT+ | ESP32-C3 | 5V | 22 AWG red |
| MP1584 | OUT- | ESP32-C3 | GND | 22 AWG black |
| ESP32-C3 | 3V3 | TMC2209 | VIO | 22 AWG |
| ESP32-C3 | GND | TMC2209 | GND (logic) | 22 AWG |
| ESP32-C3 | GPIO4 | TMC2209 | STEP | 22 AWG |
| ESP32-C3 | GPIO5 | TMC2209 | DIR | 22 AWG |
| ESP32-C3 | GPIO6 | TMC2209 | EN | 22 AWG |
| ESP32-C3 | GPIO21 (TX) | 1 kohm -> TMC2209 | PDN_UART | 22 AWG |
| ESP32-C3 | GPIO20 (RX) | TMC2209 | PDN_UART (direct) | 22 AWG |
| TMC2209 | DIAG | ESP32-C3 | GPIO3 | 22 AWG (stall signal) |
| TMC2209 | MS1, MS2 | GND | | sets UART address 0 |
| ESP32-C3 | GPIO7 | 330 ohm -> LED | anode | LED cathode to GND |
| TMC2209 | A1 A2 B1 B2 | NEMA17 | coil A, coil B | motor cable |

Notes
- Use a TMC2209 board with the PDN_UART and DIAG pins broken out (most BIGTREETECH / FYSETC v1.2+ boards; some need a solder bridge for UART, check the board's notes).
- Motor current is set over UART by the firmware (0.9 A running, 0.5 A when homing); the Vref pot is ignored.
- Never unplug the motor while powered.
- Flash the firmware over USB-C before closing the box (edit Wi-Fi name/password at the top of blind.ino; install AccelStepper and TMCStepper).

## Installing and tensioning
1. Screw an anchor + 4 mm pan-head screw with washer through the TOP of each side slot, loosely.
2. Put the chain loop around the sprocket, pull the box down until the chain is taut (it should deflect ~5 mm when pressed), tighten both screws. The slots give 60 mm of adjustment.

## How it knows where the blind is (homing)
- Every stop saves the position to flash. After a power cut while idle, it simply restores that.
- If power died mid-move, or the position was never saved, it homes on boot: it winds the blind UP slowly at low current until the bottom bar touches the headrail. The TMC2209's StallGuard detects the extra load and pulls DIAG high; that point (minus a small back-off) becomes "fully open". No switch or wiring at the blind.
- Every full "Open" also ends with this gentle homing, so drift from someone pulling the chain by hand is corrected automatically.
- Setup: press "Home now", then jog down to the closed position and press "Here = fully closed".
- Tuning: the status line shows the live StallGuard value. If homing stops early, lower the threshold (e.g. 50); if it pushes against the headrail without stopping, raise it (e.g. 100). Homing gives up after the full travel and reports an error rather than grinding.
