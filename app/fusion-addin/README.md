# Premake for Autodesk Fusion

Hover a body in Fusion to see what it costs to make, then select parts and get a quote with live prices from shops.

## Install (2 minutes)

1. In Fusion: **Utilities → Add-Ins → Scripts and Add-Ins** (Shift+S), **Add-Ins** tab, click **+** next to "My Add-Ins".
2. Pick this folder: `fusion-addin/Premake`.
3. Select **Premake**, tick **Run on Startup**, click **Run**.
4. **Utilities → Add-ins → Connect Premake.** Your browser opens premake.ai with a code. Check it matches, click **Connect**, go back to Fusion and click OK.

## Use

- **Utilities → Add-ins → Buy parts** (also pinned to the toolbar).
- Hover any body: the panel shows the price each, process, material and lead time.
- Click bodies to add them, pick material and quantity, then **Get quote**. Premake uploads each body as STEP and opens your quote page, where live prices from RMFG and other shops appear within about a minute.

## How it works

- Prices on hover come from Premake's model (`server/fusion.js`, `estimatePart`). Every estimate and every live shop quote is logged in `data/.fusion/` to train the model.
- The add-in stores its token in `~/.premake-fusion.json`. Set `"server"` there to point at another Premake (e.g. `http://127.0.0.1:8800`).
- It can only get prices and make quotes. It can't order or pay.
