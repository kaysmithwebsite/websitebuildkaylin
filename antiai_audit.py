# -*- coding: utf-8 -*-
"""ANTI-AI DESIGN AUDIT (section 76).

Checks the mechanically detectable half of the directive: rounded corners,
gradients, card density, centred stacks, icon spam, decorative shapes and
generated-sounding copy. Judgement items (is it art-directed, is Kaylin's
personality visible) still need eyes, and are listed at the end as prompts.
"""
from __future__ import print_function
import os, re, sys, collections

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, "dist")
CSS  = open(os.path.join(ROOT, "assets", "css", "site.css")).read()

findings = collections.OrderedDict()
def flag(cat, detail):
    findings.setdefault(cat, []).append(detail)

pages = []
for dp, _, fns in os.walk(DIST):
    for fn in fns:
        if fn.endswith(".html"):
            pages.append(os.path.join(dp, fn))
pages.sort()

# ---------------------------------------------------------------- 58: radius
for m in re.finditer(r"border-radius:\s*([0-9.]+)(px|rem|em)", CSS):
    v = float(m.group(1))
    px = v * (16 if m.group(2) in ("rem", "em") else 1)
    if px > 4:
        flag("58 border radius over 4px", "%s%s" % (m.group(1), m.group(2)))
if re.search(r"border-radius:\s*(999|9999)px|border-radius:\s*50%[^;]*;\s*/\*\s*pill", CSS):
    flag("58 pill shaped element", "found")

# ---------------------------------------------------------------- 59: gradients
grads = re.findall(r"(linear|radial|conic)-gradient\([^;]{0,140}", CSS)
ALLOWED = ("hero__scrim", "ncard__scrim", "phero__scrim", "nav::before")
for g in grads:
    # Legibility scrims over photography are a measured accessibility need and
    # are reported separately from decorative gradients.
    ctx_i = CSS.find(g)
    block_start = CSS.rfind("}", 0, ctx_i)
    block = CSS[max(0, block_start):ctx_i]
    is_scrim = any(a.split("::")[0] in block for a in ALLOWED) or "scrim" in block
    if not is_scrim:
        flag("59 decorative gradient", g[:90])
    else:
        flag("59 legibility scrim (accessibility exception, review)", g[:70])

# ------------------------------------------------------- 57/60: card soup, decor
for path in pages:
    rel = "/" + os.path.relpath(path, DIST).replace(os.sep, "/")
    rel = rel.replace("/index.html", "/")
    doc = open(path).read()
    body = doc[doc.find("<main"):doc.find("</main>")] if "<main" in doc else doc

    # Section 57 targets putting CONCEPTS in boxes. A property card is a data
    # record and a card is the correct pattern for it, so records are excluded
    # and only containers wrapping prose or ideas are counted.
    record_cards = len(re.findall(r'data-prop-id=', body))
    all_cards = len(re.findall(r'class="[^"]*\b(card|tile|panel|box)\b[^"]*"', body))
    concept_cards = max(0, all_cards - record_cards)
    if concept_cards > 8:
        flag("57 concepts boxed rather than typeset",
             "%s :: %d non-record containers" % (rel, concept_cards))

    # centred stacks
    centred = len(re.findall(r'class="[^"]*\btc\b[^"]*"', body))
    if centred > 1:
        flag("61 centred blocks", "%s :: %d" % (rel, centred))
    if re.search(r"margin-inline:\s*auto[^\"]*\"[^>]*>\s*<h[12]", body):
        flag("61 centred heading stack", rel)

    # Section 60 targets decorative iconography. Functional controls that repeat
    # once per record (the save control on each listing) are not decoration, so
    # they are excluded and only standalone icons are counted.
    total_svg = len(re.findall(r"<svg", body))
    functional = (len(re.findall(r'class="fav"', body))
                  + len(re.findall(r'class="nav__caret"', body))
                  + len(re.findall(r'class="socials"', body)) * 4
                  + len(re.findall(r'gallery__nav|iconbtn|floatc__btn', body)))
    decorative = max(0, total_svg - functional)
    if decorative > 8:
        flag("60 decorative icon density",
             "%s :: %d non-functional svg" % (rel, decorative))
    for bad, label in [(r"blur\((?!0)", "blur filter"),
                       (r"backdrop-filter", "glass effect"),
                       (r"box-shadow:[^;]*rgba\([^)]*0\.[4-9]", "heavy shadow")]:
        if re.search(bad, body):
            flag("60 decorative effect", "%s :: %s" % (rel, label))

if re.search(r"backdrop-filter", CSS):
    flag("60 glassmorphism in stylesheet", "backdrop-filter present")
if re.search(r"@keyframes\s+\w*(float|pulse|glow|blob|bounce)", CSS, re.I):
    flag("60 decorative animation", "float/pulse/glow keyframes")

# ---------------------------------------------------------------- 69/71: copy
COPY = [
 (r"whether you(?:'re| are)", "69 generated opener"),
 (r"\bseamless\b", "69 banned word"), (r"\belevate\b", "69 banned word"),
 (r"\bunlock\b", "69 banned word"), (r"your journey", "69 banned phrase"),
 (r"dream home", "69 banned phrase"), (r"perfect property", "69 banned phrase"),
 (r"tailored solutions", "69 banned phrase"), (r"exceptional service", "69 banned phrase"),
 (r"more than just", "69 banned phrase"), (r"designed with you in mind", "69 banned phrase"),
 (r"at every step", "69 banned phrase"), (r"where \w+ meets \w+", "69 banned construction"),
 (r">\s*Learn More\s*<", "71 vague button"), (r">\s*Get Started\s*<", "71 vague button"),
 (r">\s*Discover More\s*<", "71 vague button"), (r">\s*Explore Now\s*<", "71 vague button"),
]
for path in pages:
    rel = "/" + os.path.relpath(path, DIST).replace(os.sep, "/")
    rel = rel.replace("/index.html", "/")
    doc = open(path).read()
    for pat, label in COPY:
        m = re.search(pat, doc, re.I)
        if m:
            flag(label, "%s :: %r" % (rel, m.group(0)))

# ------------------------------------------------------- 72: fake social proof
for path in pages:
    doc = open(path).read()
    for pat in (r"★", r"#1 Realtor", r"Top Producer", r"Trusted by (hundreds|thousands)",
                r"\d{2,3}% satisfaction"):
        if re.search(pat, doc, re.I):
            rel = "/" + os.path.relpath(path, DIST).replace(os.sep, "/")
            flag("72 unverified social proof", "%s :: %s" % (rel, pat))

# ------------------------------------------------------ 63: grid span variety
spans = set(re.findall(r'class="[^"]*\bc(\d{1,2})\b', open(os.path.join(DIST, "index.html")).read()))
allspans = set()
for path in pages:
    allspans |= set(re.findall(r'class="[^"]*\bc(\d{1,2})\b', open(path).read()))
if len(allspans) < 4:
    flag("63 grid spans lack variety", "only %s in use" % sorted(allspans))

# --------------------------------------------------------------- 46: brokerage
missing = [p for p in pages if "RE/MAX Epic Realty" not in open(p).read()]
if missing:
    flag("46 brokerage not identified", "%d page(s)" % len(missing))
tiny = 0
for path in pages:
    doc = open(path).read()
    if "Independently Owned and Operated" in doc and 'class="bid' not in doc:
        tiny += 1
if tiny:
    flag("46 disclosure present but not via BrokerageIdentity", "%d page(s)" % tiny)

# ------------------------------------------------------------------- report
print("ANTI-AI DESIGN AUDIT")
print("=" * 68)
print("Pages examined: %d\n" % len(pages))
hard = 0
for cat, items in findings.items():
    soft = "review" in cat or "exception" in cat
    if not soft:
        hard += len(items)
    print("  [%s] %-52s %d" % ("note" if soft else "FLAG", cat, len(items)))
    for it in items[:4]:
        print("        %s" % it)
    if len(items) > 4:
        print("        ... and %d more" % (len(items) - 4))
if not findings:
    print("  Nothing flagged.")
print()
print("Mechanical flags requiring action: %d" % hard)
print()
print("JUDGEMENT ITEMS (need eyes, not regex):")
for q in ["Does any page read as a Tailwind template?",
          "Is the section rhythm varied, or hero/three-up/CTA repeated?",
          "Does the photography feel authentic and art-directed?",
          "Is Kaylin's personality visible in the copy?",
          "Is there enough negative space?",
          "Could this belong to any other agent?",
          "Does anything exist only because websites normally have it?"]:
    print("  - %s" % q)
sys.exit(1 if hard else 0)
