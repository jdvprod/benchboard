"""FloorCall logo tool: cut a logo out of its background and redraw it in any colours, size and crop.

Each master in brand/logos has up to four parts drawn in flat colours:
  figure  the player and the ball (and the FLOORCALL wordmark in 01)
  swoosh  the dotted swoosh and the sparkle
  fc      the small "FC"
The tool finds each part by its colour, removes the background (keeping smooth edges), and paints each part in
the colour you give it, or leaves it out.

  python3 brand/tools/logo.py 15-setter-grey-on-dark out.png --figure "#FFFFFF" --swoosh "#9BD3F2" --fc none \
      --bg "#000000" --size 512 --crop mark

  --crop full   the whole 2000 x 2000 square
         mark   tight around everything that's drawn, plus padding
         figure tight around the player and ball only (best for small icons)
  --bg none     a transparent PNG
  --round 0.22  rounded corners (as a share of the size), for app icons
"""
import argparse
import numpy as np
from PIL import Image, ImageDraw

LOGOS = __file__.rsplit("/tools/", 1)[0] + "/logos/"
PALETTE = {"black": "#000000", "ink": "#111111", "white": "#FFFFFF", "grey": "#B4B4B4", "light": "#E2E2E2",
           "columbia": "#9BD3F2", "blue": "#2670A5"}


def hexrgb(h):
    h = PALETTE.get(h, h).lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def parts(name):
    """Alpha (0..1) for each part of a master logo."""
    img = np.asarray(Image.open(LOGOS + name + ".png").convert("RGB")).astype(float)
    flat = (img // 8 * 8).reshape(-1, 3).astype(int)
    colours, counts = np.unique(flat, axis=0, return_counts=True)
    order = np.argsort(-counts)
    bg = img[0, 0]
    centres = [colours[i] + 4 for i in order[1:8] if counts[i] > 1500 and np.abs(colours[i] + 4 - bg).sum() > 60]
    fc = [c for c in centres if c[2] - c[0] >= 6]  # the FC is a slightly blue grey
    rest = [c for c in centres if c[2] - c[0] < 6 and not any(np.abs(c - f).sum() < 1 for f in fc)]
    named = {"figure": rest[0]}
    if len(rest) > 1: named["swoosh"] = rest[1]
    d = img - bg
    # Which part a pixel belongs to: look at the strongest colour within 2 pixels (an edge pixel of a swoosh dot is
    # a faded swoosh colour, which can look like a faded figure colour when both are greys), and take the nearest part.
    n = np.linalg.norm(d, axis=2)
    core, best = d.copy(), n.copy()
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            nn, dd = np.roll(n, (dy, dx), (0, 1)), np.roll(d, (dy, dx), (0, 1))
            m = nn > best
            best = np.where(m, nn, best); core = np.where(m[..., None], dd, core)
    keys = list(named)
    pick = np.argmin(np.stack([np.linalg.norm(core - (named[k] - bg), axis=2) for k in keys]), axis=0)
    alpha = {}
    for i, k in enumerate(keys):
        v = named[k] - bg
        alpha[k] = np.where(pick == i, np.clip((d @ v) / (v @ v), 0, 1), 0)
    # the FC: everything drawn inside the box where the FC colour sits
    if fc:
        f = fc[0]
        exact = (np.abs(img - f).sum(axis=2) < 10) & (img[..., 2] - img[..., 0] >= 5)
        ys, xs = np.nonzero(exact)
        # the FC is one small dense patch: take the middle of the matches, not stray edge pixels
        y0, y1 = np.percentile(ys, [2, 98]).astype(int); x0, x1 = np.percentile(xs, [2, 98]).astype(int)
        y0, y1, x0, x1 = y0 - 8, y1 + 9, x0 - 8, x1 + 9
        box = np.zeros(img.shape[:2], bool); box[y0:y1, x0:x1] = True
        drawn = np.clip(np.linalg.norm(d, axis=2) / np.linalg.norm(f - bg), 0, 1)
        alpha["fc"] = np.where(box, drawn, 0)
        for k in keys: alpha[k] = np.where(box, 0, alpha[k])
    return alpha


def render(name, colours, bg=None, size=512, crop="mark", pad=0.08, rounded=0.0):
    """colours: {"figure": "#fff", "swoosh": "#9BD3F2", "fc": None}; a part left out or None isn't drawn."""
    A = parts(name)
    h, w = next(iter(A.values())).shape
    rgb, a = np.zeros((h, w, 3)), np.zeros((h, w))
    for k, al in A.items():
        c = colours.get(k)
        if c is None or c == "none": continue
        col = hexrgb(c)
        rgb = rgb * (1 - al[..., None]) + col * al[..., None]
        a = a + al * (1 - a)
    out = np.dstack([np.where(a[..., None] > 0, rgb / np.maximum(a[..., None], 1e-6) * a[..., None] / np.maximum(a[..., None], 1e-6), 0), a * 255])
    out[..., :3] = np.clip(np.where(a[..., None] > 0, rgb / np.maximum(a[..., None], 1e-6), 0), 0, 255)
    im = Image.fromarray(out.astype(np.uint8), "RGBA")
    if crop != "full":
        keep = A["figure"] if crop == "figure" else a
        ys, xs = np.nonzero(keep > 0.08)
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        side = max(y1 - y0, x1 - x0) * (1 + 2 * pad)
        cy, cx = (y0 + y1) / 2, (x0 + x1) / 2
        im = im.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))
    im = im.resize((size, size), Image.LANCZOS)
    if bg and bg != "none":
        base = Image.new("RGBA", im.size, tuple(int(x) for x in hexrgb(bg)) + (255,))
        base.alpha_composite(im); im = base
        if rounded:
            m = Image.new("L", im.size, 0)
            ImageDraw.Draw(m).rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * rounded), fill=255)
            im.putalpha(m)
    return im


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("logo"); p.add_argument("out")
    p.add_argument("--figure", default="white"); p.add_argument("--swoosh", default="columbia"); p.add_argument("--fc", default="grey")
    p.add_argument("--bg", default="none"); p.add_argument("--size", type=int, default=512)
    p.add_argument("--crop", default="mark", choices=["full", "mark", "figure"]); p.add_argument("--pad", type=float, default=0.08)
    p.add_argument("--round", type=float, default=0.0)
    x = p.parse_args()
    render(x.logo, {"figure": x.figure, "swoosh": x.swoosh, "fc": x.fc}, x.bg, x.size, x.crop, x.pad, x.round).save(x.out)
    print("wrote", x.out)
