# -*- coding: utf-8 -*-
"""Generates deterministic architectural SVG placeholders.

No photography of Kaylin, her listings or the communities is available, and
stock imagery cannot be licensed here. Rather than ship grey boxes or imply
these are real photographs, each placeholder is an original geometric
composition seeded from the subject's slug, so every property, neighbourhood
and article gets a stable, distinct image. Every file carries a title/desc
identifying it as a placeholder. Replace assets/img/ with real photography
before launch; build.py picks up real files automatically when a matching
.jpg/.webp/.avif exists.
"""
import hashlib, os, math

OUT = "assets/img"
os.makedirs(OUT, exist_ok=True)

NAVY   = "#07182D"
DEEP   = "#06111F"
MID    = "#12294a"
MID2   = "#1b3a63"
LIGHT  = "#F7F7F4"
GREY   = "#E9EBED"
LINE   = "#22456f"

class R:
    """Small deterministic PRNG seeded from a string."""
    def __init__(self, seed):
        self.h = hashlib.sha256(seed.encode("utf-8")).digest()
        self.i = 0
    def byte(self):
        b = self.h[self.i % len(self.h)]
        self.i += 1
        if self.i % len(self.h) == 0:
            self.h = hashlib.sha256(self.h).digest()
        return b
    def f(self):  return self.byte() / 256.0
    def r(self, a, b): return a + (b - a) * self.f()
    def i_(self, a, b): return min(b, int(self.r(a, b + 1)))
    def pick(self, xs): return xs[self.i_(0, len(xs) - 1)]


def windows(r, x, y, w, h, cols, rows, fill, op_lo=.10, op_hi=.55):
    """Grid of window lights across a facade."""
    out = []
    gx, gy = w / cols, h / rows
    pw, ph = gx * .58, gy * .48
    for c in range(cols):
        for rw in range(rows):
            if r.f() < .42:
                continue
            op = r.r(op_lo, op_hi)
            out.append(
                '<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="%s" opacity="%.2f"/>'
                % (x + c * gx + (gx - pw) / 2, y + rw * gy + (gy - ph) / 2, pw, ph, fill, op))
    return "".join(out)


def scene_towers(r, w, h):
    """Dense vertical skyline. Used for condo and urban subjects."""
    s = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, DEEP)]
    n = r.i_(7, 11)
    bw = w / float(n)
    for i in range(n):
        bh = r.r(h * .30, h * .84)
        x = i * bw + r.r(-2, 2)
        bwi = bw * r.r(.80, 1.02)
        y = h - bh
        s.append('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="%s"/>'
                 % (x, y, bwi, bh, r.pick([NAVY, MID, MID2])))
        s.append(windows(r, x, y + 10, bwi, bh - 14, max(2, int(bwi / 26)), max(3, int(bh / 38)), LIGHT))
    s.append('<rect y="%.0f" width="%d" height="%.0f" fill="%s" opacity=".5"/>' % (h * .92, w, h * .08, DEEP))
    return "".join(s)


def scene_lowrise(r, w, h):
    """Pitched-roof residential row. Detached and townhouse subjects."""
    s = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, NAVY)]
    # horizon
    hz = h * r.r(.56, .68)
    s.append('<rect y="%.0f" width="%d" height="%.0f" fill="%s"/>' % (hz, w, h - hz, DEEP))
    n = r.i_(4, 6)
    bw = w / float(n)
    for i in range(n):
        bh = r.r(h * .20, h * .36)
        x = i * bw + r.r(-3, 3)
        bwi = bw * r.r(.78, .96)
        y = hz - bh
        roof = bh * r.r(.30, .46)
        col = r.pick([MID, MID2, "#16335a"])
        s.append('<polygon points="%.0f,%.0f %.0f,%.0f %.0f,%.0f" fill="%s"/>'
                 % (x - bwi * .06, y, x + bwi / 2, y - roof, x + bwi * 1.06, y, col))
        s.append('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="%s"/>' % (x, y, bwi, bh, col))
        s.append(windows(r, x, y + 6, bwi, bh - 10, 2, max(2, int(bh / 26)), LIGHT, .14, .5))
    s.append('<line x1="0" y1="%.0f" x2="%d" y2="%.0f" stroke="%s" stroke-width="1" opacity=".55"/>'
             % (hz, w, hz, LINE))
    return "".join(s)


def scene_facade(r, w, h):
    """Close architectural elevation. Interiors and detail shots."""
    s = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, NAVY)]
    cols = r.i_(4, 7)
    cw = w / float(cols)
    for c in range(cols):
        if r.f() < .3:
            s.append('<rect x="%.0f" width="%.0f" height="%d" fill="%s" opacity="%.2f"/>'
                     % (c * cw, cw, h, MID, r.r(.25, .8)))
    bands = r.i_(4, 7)
    bh = h / float(bands)
    for b in range(bands):
        s.append('<line x1="0" y1="%.0f" x2="%d" y2="%.0f" stroke="%s" stroke-width="1" opacity=".5"/>'
                 % (b * bh, w, b * bh, LINE))
        s.append(windows(r, 0, b * bh + bh * .2, w, bh * .6, max(2,cols), 1, LIGHT, .12, .46))
    return "".join(s)


def scene_landscape(r, w, h):
    """Layered horizon. Rural, park and neighbourhood-overview subjects."""
    s = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, NAVY)]
    layers = r.i_(3, 5)
    for L in range(layers):
        base = h * (.44 + .13 * L)
        amp = h * r.r(.03, .09) / (L + 1)
        pts = []
        steps = 14
        ph = r.r(0, 6.28)
        for i in range(steps + 1):
            x = w * i / steps
            y = base + math.sin(ph + i * r.r(.4, .9)) * amp
            pts.append("%.0f,%.0f" % (x, y))
        pts += ["%d,%d" % (w, h), "0,%d" % h]
        col = [MID2, MID, "#0e2140", NAVY, DEEP][min(L, 4)]
        s.append('<polygon points="%s" fill="%s"/>' % (" ".join(pts), col))
    return "".join(s)


def scene_portrait(r, w, h):
    """Abstract figure-in-space. Used only where a portrait would sit, and is
    deliberately non-representational so it can never read as a photograph."""
    s = ['<rect width="%d" height="%d" fill="%s"/>' % (w, h, NAVY)]
    s.append('<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="%s"/>'
             % (w * .08, h * .1, w * .84, h * .9, MID))
    cx, cy = w * .5, h * .42
    rr = min(w, h) * .13
    s.append('<circle cx="%.0f" cy="%.0f" r="%.0f" fill="%s" opacity=".55"/>' % (cx, cy, rr, LIGHT))
    s.append('<path d="M %.0f %.0f Q %.0f %.0f %.0f %.0f L %.0f %.0f Z" fill="%s" opacity=".5"/>'
             % (cx - rr * 2.1, h, cx, cy + rr * 1.1, cx + rr * 2.1, h, cx - rr * 2.1, h, LIGHT))
    for i in range(4):
        y = h * (.14 + i * .2)
        s.append('<line x1="0" y1="%.0f" x2="%d" y2="%.0f" stroke="%s" stroke-width="1" opacity=".4"/>'
                 % (y, w, y, LINE))
    return "".join(s)


SCENES = {
    "towers": scene_towers, "lowrise": scene_lowrise, "facade": scene_facade,
    "landscape": scene_landscape, "portrait": scene_portrait,
}


def make(slug, kind, w, h, label):
    r = R(slug + "|" + kind)
    body = SCENES[kind](r, w, h)
    # grain + vignette keep it from reading as flat vector clipart
    grain = ('<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/>'
             '<feColorMatrix type="saturate" values="0"/></filter>'
             '<rect width="%d" height="%d" filter="url(#g)" opacity=".045"/>' % (w, h))
    vign = ('<radialGradient id="v" cx="50%%" cy="45%%" r="78%%">'
            '<stop offset="55%%" stop-color="#000" stop-opacity="0"/>'
            '<stop offset="100%%" stop-color="#000" stop-opacity=".42"/></radialGradient>'
            '<rect width="%d" height="%d" fill="url(#v)"/>' % (w, h))
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
        'role="img" aria-labelledby="t d" preserveAspectRatio="xMidYMid slice">'
        '<title id="t">%s</title>'
        '<desc id="d">Generated placeholder graphic. Not a photograph. '
        'Replace with real photography before launch.</desc>'
        '%s%s%s</svg>'
    ) % (w, h, w, h, label, body, grain, vign)
    path = os.path.join(OUT, slug + ".svg")
    with open(path, "w") as f:
        f.write(svg)
    return path


if __name__ == "__main__":
    import json
    n = 0

    props = json.load(open("data/properties.json"))["properties"]
    for p in props:
        kind = "towers" if p["property_type"].startswith("Condo") else "lowrise"
        base = "prop-" + p["id"]
        make(base, kind, 1200, 800, "Placeholder image for demo listing " + p["mls_number"])
        n += 1
        for j in range(1, 5):
            make("%s-%d" % (base, j), ["facade", "lowrise", "towers", "landscape"][j - 1],
                 1200, 800, "Placeholder gallery image %d for demo listing %s" % (j + 1, p["mls_number"]))
            n += 1

    nbs = json.load(open("data/neighbourhoods.json"))["neighbourhoods"]
    TONE = {"heritage": "lowrise", "planned": "facade", "residential": "lowrise",
            "estate": "landscape", "urban": "towers", "rural": "landscape"}
    for nb in nbs:
        make("nb-" + nb["slug"], TONE.get(nb["hero_tone"], "lowrise"), 1600, 1000,
             "Placeholder image for " + nb["name"])
        n += 1

    arts = json.load(open("data/articles.json"))["articles"]
    for a in arts:
        make("art-" + a["slug"], "facade", 1200, 800, "Placeholder image for article: " + a["title"])
        n += 1

    for slug, kind, w, h, label in [
        ("hero-home",       "towers",    2000, 1200, "Placeholder homepage hero image"),
        ("kaylin-portrait", "portrait",  1000, 1250, "Placeholder portrait image"),
        ("kaylin-about",    "portrait",  1200, 1500, "Placeholder portrait image"),
        ("hero-buy",        "lowrise",   2000, 1000, "Placeholder image for the buying page"),
        ("hero-sell",       "facade",    2000, 1000, "Placeholder image for the selling page"),
        ("hero-consulting", "landscape", 2000, 1000, "Placeholder image for the consulting page"),
        ("hero-invest",     "towers",    2000, 1000, "Placeholder image for the investing page"),
        ("hero-marketing",  "facade",    2000, 1000, "Placeholder image for the marketing page"),
        ("hero-nb",         "landscape", 2000, 1000, "Placeholder image for the neighbourhoods index"),
        ("hero-insights",   "facade",    2000, 1000, "Placeholder image for the insights index"),
        ("hero-contact",    "towers",    2000, 1000, "Placeholder image for the contact page"),
        ("split-buy",       "lowrise",   1200, 1400, "Placeholder image for the buying section"),
        ("split-sell",      "facade",    1200, 1400, "Placeholder image for the selling section"),
        ("og-default",      "towers",    1200,  630, "Kaylin Smith Real Estate"),
    ]:
        make(slug, kind, w, h, label); n += 1

    for i in range(1, 13):
        make("mk-%02d" % i, ["facade", "lowrise", "towers", "landscape"][i % 4], 1200, 900,
             "Placeholder image for marketing chapter %d" % i)
        n += 1

    print("generated %d placeholder SVGs in %s" % (n, OUT))
