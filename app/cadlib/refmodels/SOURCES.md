# Reference models: where each one came from

Searched and vetted on 2026-10-30. Licence rules: LICENSES.md. The exact source file, its SHA-256 and the licence are in
each model's `web/refmodels/<key>/license.json`. Downloaded originals are not kept in git. Re-download them from the
URLs below to rebuild.

Key URL prefixes:

- `KCR` = `https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/`. The licence is in `LICENSE.md` in that
  repo, also at https://www.kicad.org/libraries/license/.
- `FCR` = `https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/`. The README says "All Parts in this
  repository are licensed under CC-BY 3.0", attributed to each part's author through the commit history.

## In the library (30 models)

### Third-party models (10)

| key | source | author | licence | notes |
|---|---|---|---|---|
| esp32_wroom32 | KCR `RF_Module.3dshapes/ESP32-WROOM-32.step` | KiCad Library contributors | CC BY-SA 4.0 + KiCad exception | Checked: no logo text on the can |
| ws2812b_5050 | KCR `LED_SMD.3dshapes/LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm.step` | KiCad (Frank Severinsen per CREDITS.md) | CC BY-SA 4.0 + KiCad exception | |
| led_5mm | KCR `LED_THT.3dshapes/LED_D5.0mm.step` | KiCad Library contributors | CC BY-SA 4.0 + KiCad exception | |
| lcd1602 | KCR `Display.3dshapes/WC1602A.step` | KiCad Library contributors | CC BY-SA 4.0 + KiCad exception | No text in the model |
| usbc_receptacle | KCR `Connector_USB.3dshapes/USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal.step` | KiCad Library contributors | CC BY-SA 4.0 + KiCad exception | |
| tact_6x6 | KCR `Button_Switch_THT.3dshapes/SW_PUSH_6mm.step` | KiCad (Obijuan, Poeschl, Shackmeister per CREDITS.md) | CC BY-SA 4.0 + KiCad exception | |
| sg90 | FCR `Electrical%20Parts/Servos/SG-90/Servo-sg90.step` | Gafeju (FreeCAD-library, 2015) | CC BY 3.0 | Checked: no label text |
| fan_40 | FCR `Electrical%20Parts/fans/fan-40x40mm.step` | Obijuan (FreeCAD-library, 2014) | CC BY 3.0 | No colours in the STEP, so it shows grey |
| bearing_608 | FCR `Mechanical%20Parts/Bearings/608ZZ_Ball_Bearing.step` | Normand C (FreeCAD-library, 2013) | CC BY 3.0 | |
| extrusion_2020 | FCR `Mechanical%20Parts/Mountings/2020_V-slot_Al_extrusion/2020x50_V_slot_profile-Part.step` | hasecilu (FreeCAD-library, 2022) | CC BY 3.0 | 50 mm piece, stretched along its length to fit |

### Premake parametric models (20)

These are built in `builders.py` from `cadlib.dims` sizes. Licence: `Premake-original`.

| key | why parametric |
|---|---|
| switch_oled, switch_v1, switch_oled_full, joycon_l, joycon_r | No allowlisted model without trademark problems (see "Rejected"). Ours have no logos. They show the screen, the Joy-Con rails, sticks, the face buttons with no letters, the shoulder and trigger buttons, the top vents and buttons, the USB-C port and the kickstand. Sizes come from Nintendo's specs (`switch_oled`, `switch_v1`, `joycon`). The console-only widths are 176 mm (OLED) and 173 mm (original), worked out as the with-Joy-Con width minus 2 × 35.9 mm plus 2 × 2.9 mm of rail overlap. |
| iphone_15, iphone_16, android_phone | No allowlisted Apple or Samsung model. Sizes come from Apple and Samsung tech specs. Camera bumps and corner radii are estimates, since Apple's drawings are not machine-readable. |
| esp32_c3_supermini | Not in KiCad, Espressif, SparkFun or FreeCAD-library. Built more detailed than the parts-library model: QFN chip, crystal, ceramic chip antenna, BOOT and RESET buttons, LEDs, castellated pins. |
| ws2812b_strip | One 16.67 mm unit (60/m) that the viewer tiles along the strip. It is our own so it can be tiled; combining KiCad's LED into a strip would be an adaptation. |
| esp32_devkitc | Espressif's repo has modules only, no DevKitC board. Same model as the cadlib.parts library. |
| arduino_nano | The FreeCAD-library Nano (CC BY 3.0) was accepted, but its original author is unclear: the file was moved in a 2026 commit and the STEP header says "alexandre", 2015. Arduino's own CAD zip has Eagle files only, no 3D. So we use our own model. |
| rpi_pico | The official Raspberry Pi STEP (`RP-008311-DS-1-Pico-R3-step.zip`, "openly available with no limitations") was accepted and converted, but it has no colours, so it shows all grey. The KiCad Pico (CC BY-SA, Peter S. Hollander) has silkscreen geometry we would need to strip. We use our own model. |
| rpi_4 | The FreeCAD-library Pi 4B STEP is 52 MB. No official Pi 4 STEP was found. |
| nema17 | The FreeCAD-library `NEMA_17_with_connector.step` (CC BY 3.0) converts to 305k triangles and a 6 MB GLB. We use our own lighter model. |
| byj48 | The FreeCAD-library 28BYJ-48 (CC BY 3.0) has an unclear original author (moved in a 2026 commit). We use our own model. |
| fan_120, fan_80 | No allowlisted 120 mm or 80 mm fan model: Printables results showed no licence, and CGTrader uses custom terms. Hole spacing comes from `cadlib.dims` (105 / 71.5 mm). |
| oled_096, usbc_breakout | KiCad's SSD1306 is Adafruit's board, not the generic blue 4-pin module. Ours match `cadlib.dims`. |

## Accepted but not used

- `RP-008311-DS-1-Pico-R3-step.zip`, from https://pip.raspberrypi.com/documents/RP-008311-DS (Raspberry Pi Ltd).
  Permission is stated on the Pico documentation page. It has no colours.
- KCR `Module.3dshapes/RaspberryPi_Pico.step`. It has silkscreen geometry.
- `ESP32-C3-MINI-1.STEP` from github.com/espressif/kicad-libraries (CC BY-SA 4.0 + KiCad exception). It is a module,
  not the SuperMini board.
- KCR `RF_Module.3dshapes/ESP32-C3-WROOM-02.step`. It is a module.
- FCR `Computing/SingleBoardComputers/ESP32/ESP32_DOIT_DevKit_v1/ESP32_DOIT_DevKit_V1.step`. Its original author is
  unclear (moved in 2026).
- FCR NEMA 17 and 28BYJ-48. See above.
- Poly Pizza "smartphone" by smallbigsquare (https://poly.pizza/m/4DRZmTs3jq, CC0). It is low-poly, and our
  `android_phone` reads better.

## Searched and rejected

| Searched | What was found | Why rejected |
|---|---|---|
| Poly Pizza "nintendo switch" | "Nintendo Switch" by Jasmine Roberts (/m/600PeFCBopv) and "Switch" by sugamo (/m/47Rdi4mHQjJ), both CC BY 3.0 | The licence is fine, but both show Nintendo trademarks and trade dress. On hold for a legal look. We built a logo-free parametric model instead. |
| Printables, Thangs "switch oled", "joy-con" | Grips, mounts and stands, not console bodies | No body models, and no licence shown in the results |
| TurboSquid Switch OLED set | | "Editorial Uses Only" |
| RenderHub Switch, iPhone | | "IP Restricted" |
| Thingiverse / CGTrader "iPhone 15" | | Paid or custom licence, or editorial |
| Poly Pizza phones | NotchPhone, Modern Cell Phone, Smart phone (CC BY 3.0) | Licence OK, but low-poly. Not needed, since we have our own. |
| ESP32 DevKitC on SnapEDA, Flux | | SnapEDA needs a login. Flux shows no licence. |
| Arduino Nano on Printables, Thangs, Gumroad, CGTrader | | Licence unclear or paid |
| docs.arduino.cc Nano CAD (A000005-cad-files.zip) | CC BY-SA 4.0 | Eagle `.brd`/`.sch` only, no 3D model |
| 120 / 80 mm fans with CC0 or CC BY | Printables grills and mounts, CGTrader | No licence shown, or custom terms |
| Raspberry Pi 5 STEP (pip.raspberrypi.com RP-010083-CA) | Official, licensed MIT | MIT is not on the allowlist yet, and the STEP is 77 MB. Owner to decide. |
| Raspberry Pi 5 on Elecrow | | Third-party, no licence stated |
| Adafruit_CAD_Parts (github.com/adafruit) | NeoPixel strip 1376, OLEDs 938 and 931, NEMA-17 324, 28BYJ-48 858, 2020 extrusion 1221, 6 mm button 3347, USB-C breakout 4090, QT Py ESP32-C3 5405 | The repo licence is MIT, so these are candidates waiting for owner approval |
| SparkFun-KiCad-Libraries | USB-C_16, WS2812-2020, ESP32-WROOM-32D | CC BY 4.0 is allowed, but KiCad already covered these. Some files may be third-party, so check each one first. |
| McMaster-Carr | | Terms forbid redistribution |
| GrabCAD | | Default terms, no redistribution |
