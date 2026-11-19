"""Makes every logo file the sites use from the masters in brand/logos. Run after changing a logo or a colour:
    python3 brand/tools/site_assets.py
Writes the app icons in public/ and the marks in public/brand/. The main logo is 01 (and 04, the same spiker with
its parts in separate colours)."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
from logo import render

PUB = os.path.join(os.path.dirname(__file__), "..", "..", "public")
os.makedirs(os.path.join(PUB, "brand"), exist_ok=True)
MAIN = "04-spiker-pink-on-dark"  # the main spiker, drawn in layers
ON_DARK = {"figure": "white", "swoosh": "columbia", "fc": "grey"}
FIGURE = {"figure": "white"}

def save(im, name, **kw): im.save(os.path.join(PUB, name), optimize=True, **kw); print("wrote", name)

# app icons: the player and ball on black (phones round the corners themselves)
save(render(MAIN, FIGURE, "black", 512, "figure", 0.10), "icon-512.png")
save(render(MAIN, FIGURE, "black", 192, "figure", 0.10), "icon-192.png")
save(render(MAIN, FIGURE, "black", 512, "figure", 0.26), "icon-maskable-512.png")  # Android crops to a circle
save(render(MAIN, FIGURE, "black", 180, "figure", 0.12), "apple-touch-icon.png")
save(render(MAIN, FIGURE, "black", 64, "figure", 0.06, 0.22), "favicon.png")
# the mark beside "FLOORCALL" in every site's top bar, and on white pages
save(render(MAIN, {"figure": "white"}, None, 96, "figure", 0.02), "brand/mark-white.png")
save(render(MAIN, {"figure": "#111111"}, None, 96, "figure", 0.02), "brand/mark-black.png")
# the full logos
save(render("01-spiker-grey-wordmark-on-dark", {"figure": "light", "fc": "columbia"}, None, 960, "mark", 0.04), "brand/logo-wordmark-light.png")
save(render(MAIN, ON_DARK, None, 720, "mark", 0.04), "brand/logo-light.png")
save(render(MAIN, {"figure": "#111111", "swoosh": "blue", "fc": "#6A707A"}, None, 720, "mark", 0.04), "brand/logo-dark.png")
# Floorcall Academy: one mark per skill
for skill, logo in {"serving": "08-spiker-girl-pink-on-dark", "passing": "16-passer-grey-on-dark", "setting": "13-setter-girl-grey-on-dark",
                    "hitting": "04-spiker-pink-on-dark", "defense": "12-passer-girl-grey-on-dark"}.items():
    save(render(logo, {"figure": "white", "swoosh": "columbia", "fc": "none"}, "black", 360, "mark", 0.06), f"brand/skill-{skill}.png")
