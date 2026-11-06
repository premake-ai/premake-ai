# Cold plunge wiring

## Mains side: plug-in only, no wiring by you
Wall outlet → **GFCI 3-outlet pigtail** (UL, 15 A) → outlet 1: Shelly plug "Chiller" → chiller cord
                                                 → outlet 2: Shelly plug "Pump" → pump cord
                                                 → outlet 3: 5 V USB adapter → 3 m micro-USB → ESP32 pod

- Use a wall outlet at least **6 ft (1.8 m) from the tub's inside wall**, ideally on its own 15 A or 20 A circuit. Keep the GFCI cord and smart plugs off the floor and out of splash range.
- Load: chiller 5.4 A + pump 1.5 A + USB ~0.1 A ≈ 7 A, under half the 15 A rating. The breaker and GFCI protect the mains side, so no extra fuse is needed. The 5 V side draws about 0.3 A.
- Every cord gets a **drip loop**: it dips below its socket so water runs off the low point, not into the plug.
- Press the GFCI's TEST button before each plunge, and **unplug the GFCI pigtail before you get in** if you prefer nothing powered while you're in the water (the app's "chill" schedule can run before you plunge).
- Never use an extension cord between the GFCI and the chiller.

## Low-voltage side (3.3 V / 5 V)
- ESP32 3V3 / GND / GPIO4 → DS18B20 adapter VCC / GND / DAT (female-female Dupont).
- Probe red / black / yellow → adapter screw terminal VCC / GND / DAT. The probe cable enters through the PG7 gland on the underside of the pod.
- At the rim manifold, the probe cable passes through the centre hole. Put a cable tie on it above the manifold so the probe tip hangs about 230 mm below the rim, then tie the cable to the suction drop hose.

## Setup
1. Install both Shelly plugs in the Shelly app, name them, and give them fixed IP addresses (a DHCP reservation in your router).
2. Hold BOOT while you power the ESP32, join the Wi-Fi network "Premake-ColdPlunge-XXXX", open 192.168.4.1, and enter your Wi-Fi, the device key and the two plug IPs.
3. Set the chiller's own thermostat to 39 °F (4 °C). It is the backstop limit; the app sets the real target.
