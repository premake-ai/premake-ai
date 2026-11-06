## Master rules from the Premake team (always follow these)

Curated by the team from past design chats. They apply to every design.

- **Look good, not blocky.** Round or chamfer every exposed edge and corner (fillets of 2–20 mm to suit the part's size); avoid plain rectangular slabs. Products should look like something people would put on a shelf, not a prototype.
- **Use real dimensions.** When a design fits, holds or references a real product (AirPods Pro 3 case, a standard Apple USB-C cable and plug, a beer bottle cap, a Kodak Luma 350, a phone), take its size from `cadlib.dims`, or else look up its published dimensions (WebSearch, then WebFetch the spec page or datasheet) before modelling. Don't guess. State the numbers you used and their source.
- **Think like the end user before you finish.** Check: how it is assembled, what holds every joint together (include the fasteners or connectors), whether cables and moving parts stay in place, whether it can actually be printed and used. Fix problems rather than listing them.
- **Prefer off-the-shelf parts over custom metal.** Join 2020/2040 aluminium extrusion with standard Amazon T-slot hardware (L and T joining plates, corner brackets, pivot brackets, T-nuts) instead of custom cut or bent metal plates, unless custom metal is truly needed.
- **Aluminium extrusion comes in fixed stock lengths** that you can buy on Amazon (for 2020: commonly 100, 200, 250, 300, 400, 500, 600 and 1000 mm). Design around those lengths so nothing needs cutting, and list the exact length bought.
- **Keep it simple.** Use as few parts as possible, print-in-place where practical, and no hardware that doesn't do a job (no heat-set inserts or screws "just because"). Plastic-to-plastic joints use self-tapping screws into printed pilot holes; inserts only for joints opened often or under high load.
- **"3D printable" means printable.** When the user asks for a printed design, don't switch to sheet steel or machined parts.
- **Show the user's own items as reference.** When the product works with something the user owns (a cable, earbuds, a phone, a bottle), include it in the model as a reference part so they can see the fit.
- **Respect exact geometry requests.** "Right angle", "L-shaped", "perpendicular to the wall" mean exactly 90°; "less long, not thicker" changes only that dimension.

### From the round-1 benchmark review (Oct 2026)
- **Every made part is one solid.** Each printed, laser or sheet part must be exactly one solid body. Bosses, pockets, lips and ribs overlap their wall by at least 1 mm. Check this before you report.
- **Never hide a failed feature.** Only cosmetic fillets may fail silently. Text, holes, bores, pockets and joins must raise an error. Never put an outer fillet bigger than the wall thickness on a hollowed part.
- **Look at your model before you report.** Render iso, low-angle and back views and check them. Never describe a feature you haven't seen.
- **Look up every real-world fit, including hardware**: products, the hardware they mate with (spacer holes, D-shafts, shims, insert holes, sheet thickness) and how the product works. Cite your sources; never go from memory.
- **Design for the real range, then retain it.** Anything that clamps, fits or tensions needs adjustment or a stated range. Every held object needs positive retention against bumps and vibration.
- **Use the right fastener.** Self-tapping screws into printed pilot holes for plastic parts (M3: 2.5 mm pilot); wood screws in wood and drywall anchors; crush ribs or a press fit on D-shafts; heat-set inserts only for joints opened often or high loads; metal threads for structural loads like tripod mounts.
- **Cover the core use case.** Before modelling, list the 2–3 things a buyer expects (e.g. landscape mode, eye height, homing) and design them in.
- **Keep print time down.** Aim for about 3 h per unit and treat 6 h as a hard ceiling. If a fix adds time, win it back in the same turn.
- **Finish the turn.** Never end with "next I'll…". bom.json must match the model exactly.
- **Push back with one sentence, then do what they asked.** If a request hurts the product, say so briefly and name the better option, but build what the user explicitly chose (e.g. a solderless breadboard for a fun build). Never refuse or silently swap in your preference.
