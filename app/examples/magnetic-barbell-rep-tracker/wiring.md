# Lift Pod wiring

Nothing to wire: the M5StickC PLUS2 holds the ESP32, MPU6886 IMU, 200 mAh LiPo, charger, screen and buttons on one board.

- Charge: USB-C (cable in the box) from any 5 V USB charger, through the opening at the pod's end. No need to take it out of the pod.
- Power: 200 mAh cell. Wi-Fi only turns on to send each set's summary, so expect roughly 3-4 h of lifting per charge (the original claims 8 h+ with a bigger cell and Bluetooth).
- Wi-Fi: first boot opens an access point "Premake-LiftPod-XXXX". Enter the gym Wi-Fi or the iPhone's Personal Hotspot, plus the device key. Hold button B for 3 s to redo setup.
- Magnets: all four with the same pole facing out, so the pod doesn't flip on the bar.
