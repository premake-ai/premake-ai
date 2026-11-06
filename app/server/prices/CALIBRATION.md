# Calibrating sheet-metal and laser-cut prices

Sheet and laser parts are priced the way SendCutSend prices them. SendCutSend has no public quote API, so the model is fitted to real prices instead. Today it is fitted to the 24 example prices SendCutSend publishes on its own pages (`published_fab_examples.json`, checked Oct 29 2026). The quote labels these lines "Estimate, calibrated to SendCutSend pricing (Oct 2026)".

Paste in 5 to 10 real quotes of your own and the label becomes "calibrated to N real SendCutSend quotes". Real quotes count 5 times as much as the published examples.

## The model (`fab_model.js`)

```
qty-1 piece = max($1.50, base + area_cm2 × t_mm × rate[material] + cut_mm × t_mm² × cut
                         + (bends ? bend_setup + bends × bend_each : 0))
piece at qty q = qty-1 piece × discount(q)      (log-interpolated between the fitted points)
per order      = at least $39, SendCutSend's order minimum, across all of a design's sheet/laser parts
lead time      = 8 days cut only, 10 days with bends (2–4 production, +1–2 bending, 2–4 ground shipping)
```

The material classes are aluminium, steel, stainless, acrylic, wood and copper. The coefficients are in `fab_calibration.json`.

## Get real quotes (about 20 minutes)

1. Open `server/prices/calibration_samples/`. It has 6 DXFs in mm: plates with holes, a flat L-bracket, a disc and an acrylic panel. `index.json` lists each part's size and cut length.
2. Go to sendcutsend.com and upload each DXF yourself, in your own account. Don't automate this.
3. For each part, pick the material and thickness you actually use. Good choices are 5052 aluminium at 0.063" and 0.125", mild steel at 0.060", 304 stainless at 0.048", and acrylic at 0.118" (3 mm).
4. Note the price per part at qty 1, 10 and 100. You don't need to place an order.
5. For a bent quote, upload the STEP of a real bent design. Use the studio's download, because SendCutSend needs a 3D file for bending. Record its size and number of bends.
6. Add one entry per part per quantity to `server/prices/sendcutsend_quotes.json`:

```json
{
  "quotes": [
    { "part": "plate-100x60", "file": "plate-100x60-4x5.5.dxf", "material": "5052 aluminium", "thickness_mm": 3.18,
      "size_mm": [100, 60], "cut_length_mm": 389, "bends": 0, "qty": 1, "price_usd": 9.87, "date": "2026-11-02" },
    { "part": "plate-100x60", "file": "plate-100x60-4x5.5.dxf", "material": "5052 aluminium", "thickness_mm": 3.18,
      "size_mm": [100, 60], "cut_length_mm": 389, "bends": 0, "qty": 10, "price_usd": 4.91, "date": "2026-11-02" }
  ]
}
```

   - `price_usd` is the price per part, not the line total.
   - Give every quantity of the same part the same `part` name. The script uses those names to fit the quantity discount.
   - `cut_length_mm` is optional. Copy it from `index.json` for the sample parts.
7. Refit: `node server/prices/refit_fab.js`. Use `--dry` first to preview.
   - It prints the new coefficients and each qty-1 quote next to what the model now predicts.
   - It writes `fab_calibration.json`.
8. Restart the server. The fabricated lines now read "Estimate, calibrated to N real SendCutSend quotes".

## How good is it today?

These are the qty-1 published examples next to what the model predicts:

| Part | Actual | Model |
|---|---|---|
| Hardboard tab | $1.60 | $1.97 |
| Acrylic 3 mm tab | $2.24 | $2.31 |
| 5052 aluminium, 4.75 mm tab | $8.47 | $5.90 |
| Mild steel tab, simple / moderate / dense | $3.38 / $4.12 / $7.19 | $2.58 for all three |
| 5052 bracket, cut only | $16.48 | $17.76 |
| 5052 bracket, cut and bent | $37.49 | $37.61 |

Thick, small or dense parts are the weak spot. The published examples don't give their cut lengths, so the model can't see how long the cut path is. Real quotes that include `cut_length_mm` fix this.

## Not used

- **OSHCut:** it publishes no part prices. It has no minimum order, a 2-day lead time, and tapping at under $10 for the first hole plus $0.10 for each extra hole.
- **Ponoko:** its published prices are a headline "from $50 for 1 part" plus 2018 blog examples from an older pricing model. Acrylic is priced through SendCutSend's acrylic examples instead.
