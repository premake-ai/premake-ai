# Retro Pixel Desk Display: wiring and setup

No soldering or jumper wires. The MatrixPortal S3 plugs straight onto the panel.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| MatrixPortal S3 | HUB75 2x8 socket | LED panel | HUB75 **input** header (arrow points away from it) | direct plug-in |
| MatrixPortal S3 | screw terminals +5V / GND | LED panel | VH4 power socket +5V / GND | power cable included with the panel (red = +5V) |
| USB-C PSU 5.1 V 3 A | USB-C plug | MatrixPortal S3 | USB-C | PSU's own 1.5 m cable, out through the back-cover notch, zip-tied to the two holes |

Supply: the panel draws up to 12 W (2.4 A) at full white and the ESP32-S3 up to 0.3 A, so 2.7 A worst case. Keep Tronbyt brightness at or below ~60% (typical draw is under 1 A). The PSU is UL listed and has its own overcurrent and short-circuit shutdown, so no separate fuse is fitted. Only 5 V goes to the panel.

## Software: Tronbyt (open-source Tidbyt firmware and app server)
1. Run the Tronbyt server (Docker on a PC, NAS or Raspberry Pi): github.com/tronbyt/server
2. In the server, add a device of type **MatrixPortal S3 Waveshare** (it swaps the colour order for this panel). Enter your Wi-Fi, then download the firmware.
3. Flash it over USB-C with the web flasher linked from the server. The display connects and starts cycling apps.
4. Add apps from the community library: clock, weather, sports scores, stocks, news, Google/ICS calendar and hundreds more.
5. To make your own app, write a small Pixlet (Starlark) script, upload it to your server and share the `.star` file or send a pull request to the community apps repo.

## Assembly
1. With a soldering iron at ~220 C, press the 4 M3 heat-set inserts into the rear of the case's corner bosses.
2. Drop the smoked acrylic into the case from the back (peel the film off first). It sits against the front bezel.
3. Plug the MatrixPortal onto the panel and fit the power cable. Lay the panel LEDs-down on the acrylic, between the four corner guides.
4. Stick a 5 mm foam pad on the panel back at each standoff position.
5. Screw the 4 brass standoffs to the plywood back with M3x8 screws. Route the USB-C cable through the notch and zip-tie it. Screw the back onto the inserts with 4 M3x8 screws.
6. Stick the 4 rubber feet under the case.
