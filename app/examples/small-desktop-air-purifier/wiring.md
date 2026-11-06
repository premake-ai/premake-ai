# Wiring: desktop air purifier

12 V DC only, from a sealed UL-listed plug-in adapter. The fan draws about 0.1 A, so it needs no fuse.

| From | Pin | To | Pin | Wire |
|---|---|---|---|---|
| 12 V 1 A adapter | 5.5x2.1 plug | DC panel jack (rear of shroud) | barrel | adapter cable |
| DC panel jack | centre (+) | PWM controller | V+ / 12V in | 22 AWG red (solder to lug, heat-shrink) |
| DC panel jack | sleeve (−) | PWM controller | GND in | 22 AWG black (solder to lug, heat-shrink) |
| PWM controller | 4-pin fan header | 120 mm fan | 4-pin plug | fan's own lead |

The controller's pot goes through the 7.5 mm front hole and is held by its nut. Push the knob on from outside.
Tie the slack fan lead inside the shroud, away from the blades.

## Parts
- 120 mm 12 V 4-pin PWM fan
- 12 V 4-pin PWM fan speed controller with knob
- DC-022 panel barrel jack, 5.5x2.1
- 12 V 1 A adapter, 5.5x2.1
