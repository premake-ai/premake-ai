"""The reference-model library: one spec per key (what it is, where it came from, how the viewer matches and fits it).

`python -m cadlib.refmodels build` turns these into web/refmodels/<key>/{model.glb, license.json} plus the indexes
(web/refmodels/index.json for the viewer, cadlib/refmodels/catalog.json for ref()). See LICENSES.md for the rules.

Spec fields
  title      what it is ("Nintendo Switch OLED console")
  kind       "product" (a consumer product: the customer's own item, label says "reference model, not included")
             or "part" (a bought part)
  src        "build:<builder>" (cadlib/refmodels/builders.py, Premake original) or "file:<path>" (a vetted download,
             path relative to the download folder passed to `build --downloads`; the file itself is not kept in git)
  rotate     degrees about X, Y, Z applied to a downloaded file to reach the library frame
  front      the model's front in the library frame: "-y" (standing products: screen / buttons) or "+z" (flat parts:
             component side, fan airflow, motor shaft)
  match      regexes (JavaScript syntax, case-insensitive) a bought part's name must match for the viewer's heuristic
  prefer     regexes that make this key win over other matching keys
  lib_keys   cadlib.parts keys this model also replaces in the viewer (library parts with a weaker model)
  fit        "fixed" (real size), "tile" (repeat `pitch` mm along the longest axis) or "stretch" (scale the longest axis)
  tint       material role the viewer recolours with the design's colour of the part ("body"), or None
  dims       cross-checks against cadlib.dims: [(dims key, field, axis "x"|"y"|"z", offset_mm)]; the model extent
             along axis minus offset must be within 1 mm of the published number
  license    the license.json fields that depend on the source
"""

KICAD = {
    "author": "KiCad Library contributors",
    "license": "CC-BY-SA-4.0 WITH KiCad-libraries-exception",
    "license_url": "https://www.kicad.org/libraries/license/",
}
FREECAD = {
    "license": "CC-BY-3.0",
    "license_url": "https://creativecommons.org/licenses/by/3.0/",
}
OWN = {
    "author": "Premake",
    "license": "Premake-original",
    "license_url": "",
    "source_url": "",
}
KCR = "https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/"
FCR = "https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/"

STANDING = {"front": "-y"}
FLAT = {"front": "+z"}

SPECS = [
    # ---------------------------------------------------------------- consoles and controllers (parametric)
    dict(key="switch_oled", title="Nintendo Switch OLED console", kind="product", src="build:switch_oled", **STANDING,
         match=[r"\bswitch\b"], prefer=[r"\boled\b"],
         dims=[("switch_oled", "height_mm", "z", 0), ("switch_oled", "depth_mm", "y", 0)]),
    dict(key="switch_v1", title="Nintendo Switch console", kind="product", src="build:switch_v1", **STANDING,
         match=[r"\bswitch\b"], prefer=[r"\b(original|v1|v2|hac)\b"],
         dims=[("switch_v1", "height_mm", "z", 0), ("switch_v1", "depth_mm", "y", 0)]),
    dict(key="switch_oled_full", title="Nintendo Switch OLED with Joy-Con", kind="product", src="build:switch_oled_full",
         **STANDING, match=[r"\bswitch\b"], prefer=[r"with joy-?cons?|\+ ?joy-?cons?|joy-?cons? attached"],
         dims=[("switch_oled", "width_mm", "x", 0), ("switch_oled", "height_mm", "z", 0),
               ("switch_oled", "max_depth_mm", "y", 0)]),
    dict(key="joycon_l", title="Nintendo Joy-Con (L)", kind="product", src="build:joycon_l", **STANDING, tint="body",
         match=[r"joy-?cons?"], prefer=[r"\b(l|left)\b|\(l\)"],
         dims=[("joycon", "height_mm", "z", 0), ("joycon", "width_mm", "x", 0), ("joycon", "depth_mm", "y", 0)]),
    dict(key="joycon_r", title="Nintendo Joy-Con (R)", kind="product", src="build:joycon_r", **STANDING, tint="body",
         match=[r"joy-?cons?"], prefer=[r"\b(r|right)\b|\(r\)"],
         dims=[("joycon", "height_mm", "z", 0), ("joycon", "width_mm", "x", 0), ("joycon", "depth_mm", "y", 0)]),
    # ---------------------------------------------------------------- phones (parametric)
    dict(key="iphone_15", title="iPhone 15", kind="product", src="build:iphone_15", **STANDING,
         match=[r"\biphone\b|\bphone\b"], prefer=[r"iphone ?1[2-5]\b"],
         dims=[("iphone_15", "height_mm", "z", 0), ("iphone_15", "width_mm", "x", 0)]),
    dict(key="iphone_16", title="iPhone 16", kind="product", src="build:iphone_16", **STANDING,
         match=[r"\biphone\b|\bphone\b"], prefer=[r"iphone ?1[6-9]\b|\biphone\b"],
         dims=[("iphone_16", "height_mm", "z", 0), ("iphone_16", "width_mm", "x", 0)]),
    dict(key="android_phone", title="Android phone (Galaxy S25 size)", kind="product", src="build:android_phone",
         **STANDING, match=[r"\bphone\b|\bandroid\b|\bgalaxy\b|\bpixel\b|\bsamsung\b|\boneplus\b"],
         prefer=[r"\bandroid\b|\bgalaxy\b|\bpixel\b|\bsamsung\b|\boneplus\b"],
         dims=[("galaxy_s25", "height_mm", "z", 0), ("galaxy_s25", "width_mm", "x", 0)]),
    # ---------------------------------------------------------------- microcontrollers and boards
    dict(key="esp32_c3_supermini", title="ESP32-C3 SuperMini", kind="part", src="build:esp32_c3_supermini", **FLAT,
         match=[r"esp32[- ]?c3"], prefer=[r"super ?mini"], lib_keys=["esp32_c3_supermini"]),
    dict(key="esp32_devkitc", title="ESP32 DevKitC (WROOM-32)", kind="part", src="build:esp32_devkitc", **FLAT,
         match=[r"\besp-?32(?![- ]?(c3|s3|s2|c6|cam))"], prefer=[r"devkit|wroom|38"],
         dims=[("esp32_devkitc_v4", "overall_length_mm", "x", 1.0), ("esp32_devkitc_v4", "width_mm", "y", 0)]),
    dict(key="esp32_wroom32", title="ESP32-WROOM-32 module", kind="part", src="file:esp32_wroom32/ESP32-WROOM-32.step",
         **FLAT, rotate=(0, 0, 90), tol=0.1, match=[r"wroom-?32"], prefer=[r"module"],
         source_url=KCR + "RF_Module.3dshapes/ESP32-WROOM-32.step", **KICAD),
    dict(key="arduino_nano", title="Arduino Nano", kind="part", src="build:arduino_nano", **FLAT,
         match=[r"arduino nano|\bnano\b"],
         dims=[("arduino_nano", "length_mm", "x", 1.5), ("arduino_nano", "width_mm", "y", 0)]),
    dict(key="rpi_pico", title="Raspberry Pi Pico", kind="part", src="build:rpi_pico", **FLAT,
         match=[r"\bpico\b|rp2040"], dims=[("rpi_pico", "width_mm", "y", 0)]),
    dict(key="rpi_4", title="Raspberry Pi 4 Model B", kind="part", src="build:rpi_4", **FLAT,
         match=[r"raspberry ?pi ?[345]|\brpi ?[345]\b|\bpi ?[45]\b"],
         dims=[("rpi_4", "width_mm", "y", 0.55)]),
    # ---------------------------------------------------------------- LEDs, displays, IO
    dict(key="ws2812b_strip", title="WS2812B LED strip (60/m)", kind="part", src="build:ws2812b_strip", **FLAT,
         fit="tile", pitch=1000.0 / 60, match=[r"ws2812|sk6812|neopixel|led strip|addressable"],
         lib_keys=["ws2812_strip"]),
    dict(key="ws2812b_5050", title="WS2812B LED (5050)", kind="part",
         src="file:ws2812b_5050/LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm.step", **FLAT,
         match=[r"ws2812b?(?!.*strip)|\b5050\b|neopixel(?!.*strip)"],
         source_url=KCR + "LED_SMD.3dshapes/LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm.step", **KICAD),
    dict(key="led_5mm", title="5 mm LED", kind="part", src="file:led_5mm/LED_D5.0mm.step", **FLAT,
         match=[r"\bled\b(?!.*strip)"], prefer=[r"5 ?mm"],
         source_url=KCR + "LED_THT.3dshapes/LED_D5.0mm.step", **KICAD),
    dict(key="lcd1602", title="LCD 16x2 character display (1602)", kind="part", src="file:lcd1602/WC1602A.step", **FLAT,
         match=[r"1602|16 ?x ?2|lcd"], prefer=[r"1602|16 ?x ?2"],
         dims=[("lcd_1602_i2c", "length_mm", "x", 0), ("lcd_1602_i2c", "width_mm", "y", 0)],
         source_url=KCR + "Display.3dshapes/WC1602A.step", **KICAD),
    dict(key="oled_096", title="0.96 inch OLED display (SSD1306)", kind="part", src="build:oled_096", **FLAT,
         match=[r"0\.96|ssd1306|oled (display|module)|i2c oled"],
         dims=[("oled_096_ssd1306", "length_mm", "x", 0), ("oled_096_ssd1306", "width_mm", "y", 0)]),
    dict(key="usbc_breakout", title="USB-C breakout board", kind="part", src="build:usbc_breakout", **FLAT,
         match=[r"usb[- ]?c"], prefer=[r"breakout|board|module|pcb"]),
    dict(key="usbc_receptacle", title="USB-C receptacle", kind="part",
         src="file:usbc_receptacle/USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal.step", **FLAT,
         match=[r"usb[- ]?c"], prefer=[r"receptacle|socket|port|jack|connector"],
         source_url=KCR + "Connector_USB.3dshapes/USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal.step", **KICAD),
    dict(key="tact_6x6", title="6 x 6 mm tactile button", kind="part", src="file:tact_6x6/SW_PUSH_6mm.step", **FLAT,
         match=[r"tact|push ?button|tactile|\bbutton\b"],
         source_url=KCR + "Button_Switch_THT.3dshapes/SW_PUSH_6mm.step", **KICAD),
    # ---------------------------------------------------------------- motion
    dict(key="nema17", title="NEMA 17 stepper motor", kind="part", src="build:nema17", **FLAT,
         match=[r"nema ?17|17hs|stepper"], prefer=[r"nema ?17"],
         dims=[("nema17", "face_mm", "x", 0)]),
    dict(key="byj48", title="28BYJ-48 geared stepper", kind="part", src="build:byj48", **FLAT,
         match=[r"28byj|byj-?48|stepper"], prefer=[r"28byj|byj"]),
    dict(key="sg90", title="SG90 micro servo", kind="part", src="file:servo_sg90/Servo-sg90.step", **FLAT,
         rotate=(0, 0, 90), match=[r"\bsg-?90\b|micro servo|\bmg90|\bservo\b"],
         source_url=FCR + "Electrical%20Parts/Servos/SG-90/Servo-sg90.step", author="Gafeju (FreeCAD-library)", **FREECAD),
    # ---------------------------------------------------------------- fans, bearings, extrusion
    dict(key="fan_120", title="120 mm case fan", kind="part", src="build:fan_120", **FLAT, match=[r"\bfan\b"],
         dims=[("fan_120", "frame_mm", "x", 0), ("fan_120", "thickness_mm", "z", 0)]),
    dict(key="fan_80", title="80 mm case fan", kind="part", src="build:fan_80", **FLAT, match=[r"\bfan\b"],
         dims=[("fan_80", "frame_mm", "x", 0), ("fan_80", "thickness_mm", "z", 0)]),
    dict(key="fan_40", title="40 mm fan", kind="part", src="file:fan_40mm/fan-40x40mm.step", **FLAT, match=[r"\bfan\b"],
         dims=[("fan_40", "frame_mm", "x", 0), ("fan_40", "thickness_mm", "z", 0)],
         source_url=FCR + "Electrical%20Parts/fans/fan-40x40mm.step", author="Obijuan (FreeCAD-library)", **FREECAD),
    dict(key="bearing_608", title="608 ball bearing", kind="part", src="file:bearing_608/608ZZ_Ball_Bearing.step", **FLAT,
         match=[r"\b608|skate bearing|\bbearing\b"], prefer=[r"\b608"],
         source_url=FCR + "Mechanical%20Parts/Bearings/608ZZ_Ball_Bearing.step", author="Normand C (FreeCAD-library)",
         **FREECAD),
    dict(key="extrusion_2020", title="2020 aluminium extrusion (V-slot)", kind="part",
         src="file:extrusion_2020/2020x50_V_slot_profile-Part.step", **FLAT, rotate=(0, 0, 90), fit="stretch",
         match=[r"\b2020\b.*(extrusion|profile|v-?slot)|v-?slot"],
         source_url=FCR + "Mechanical%20Parts/Mountings/2020_V-slot_Al_extrusion/2020x50_V_slot_profile-Part.step",
         author="hasecilu (FreeCAD-library)", **FREECAD),
]
