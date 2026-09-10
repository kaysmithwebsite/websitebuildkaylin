# -*- coding: utf-8 -*-
"""Static audit of dist/. Checks the guarantees the build promises:
SEO metadata, accessibility basics, form wiring, and the section 43 rule that
no visible control is decorative."""
from __future__ import print_function
import os, re, json, sys, collections

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")
fails = collections.OrderedDict()
def fail(cat, msg):
    fails.setdefault(cat, []).append(msg)

pages = []
for dp, _, fns in os.walk(DIST):
    for fn in fns:
        if fn.endswith(".html"):
            pages.append(os.path.join(dp, fn))
pages.sort()

TAG = re.compile(r"<(\w+)([^>]*)>", re.S)
ATTR_RE = re.compile(r'([\w:.-]+)(?:="([^"]*)")?')
def attrs(s):
    """Captures valued AND boolean attributes; `data-share` has no value."""
    out = {}
    for m in ATTR_RE.finditer(s):
        out[m.group(1).lower()] = m.group(2) if m.group(2) is not None else ""
    return out

for path in pages:
    rel = "/" + os.path.relpath(path, DIST).replace(os.sep, "/")
    rel = rel.replace("/index.html", "/")
    with open(path) as f:
        doc = f.read()

    # ---- SEO ----------------------------------------------------------
    if '<html lang="en-CA">' not in doc:
        fail("lang", rel)
    if not re.search(r'<title>[^<]{10,}</title>', doc):
        fail("title missing or too short", rel)
    m = re.search(r'<meta name="description" content="([^"]*)"', doc)
    if not m or len(m.group(1)) < 50:
        fail("meta description missing or under 50 chars", rel)
    elif len(m.group(1)) > 320:
        fail("meta description over 320 chars", "%s (%d)" % (rel, len(m.group(1))))
    if '<link rel="canonical"' not in doc:
        fail("canonical missing", rel)
    for p in ("og:title", "og:description", "og:image", "og:url", "twitter:card"):
        if p not in doc:
            fail("open graph incomplete", "%s missing %s" % (rel, p))

    # ---- Structured data validity -------------------------------------
    for jm in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', doc, re.S):
        try:
            json.loads(jm.group(1))
        except ValueError as ex:
            fail("invalid JSON-LD", "%s (%s)" % (rel, ex))

    # ---- Headings -----------------------------------------------------
    h1s = re.findall(r"<h1[ >]", doc)
    if len(h1s) != 1:
        fail("h1 count != 1", "%s has %d" % (rel, len(h1s)))

    # ---- Images need alt ----------------------------------------------
    for m in re.finditer(r"<img([^>]*)>", doc):
        a = attrs(m.group(1))
        if "alt" not in a:
            fail("img without alt", "%s :: %s" % (rel, a.get("src", "?")[:60]))
        if "width" not in a or "height" not in a:
            fail("img without intrinsic size (causes layout shift)",
                 "%s :: %s" % (rel, a.get("src", "?")[:60]))

    # ---- Every image src must resolve to a real file -------------------
    for m in re.finditer(r'<img[^>]*\ssrc="([^"]+)"', doc):
        s = m.group(1).split("?")[0]
        if s.startswith(("http://", "https://", "data:")):
            continue
        if not os.path.isfile(os.path.join(DIST, s.lstrip("/"))):
            fail("image src does not resolve", "%s :: %s" % (rel, s[:70]))
    # srcset entries too
    for m in re.finditer(r'<img[^>]*\ssrcset="([^"]+)"', doc):
        for part in m.group(1).split(","):
            s = part.strip().split(" ")[0].split("?")[0]
            if not s or s.startswith(("http://", "https://", "data:")):
                continue
            if not os.path.isfile(os.path.join(DIST, s.lstrip("/"))):
                fail("srcset src does not resolve", "%s :: %s" % (rel, s[:70]))

    # ---- Form controls need labels ------------------------------------
    ids_labelled = set(re.findall(r'<label[^>]*for="([^"]+)"', doc))
    for m in re.finditer(r"<(input|select|textarea)([^>]*)>", doc):
        a = attrs(m.group(2))
        t = a.get("type", "text")
        if t in ("hidden", "submit", "reset", "button"):
            continue
        wrapped = m.group(0) in doc and re.search(
            r'<label[^>]*>(?:(?!</label>).)*' + re.escape(m.group(0)), doc, re.S)
        if a.get("id") in ids_labelled: continue
        if a.get("aria-label") or a.get("aria-labelledby"): continue
        if wrapped: continue
        fail("form control without label", "%s :: %s name=%s"
             % (rel, m.group(1), a.get("name", "?")))

    # ---- Buttons must do something (section 43) -----------------------
    for m in re.finditer(r"<button([^>]*)>(.*?)</button>", doc, re.S):
        a = attrs(m.group(1))
        inner = re.sub(r"<[^>]+>", "", m.group(2)).strip()
        has_hook = any(k in a for k in (
            "data-share", "data-view", "data-sort", "data-open-filters", "data-close-filters",
            "data-next", "data-back", "data-clear", "data-clear-all", "data-gprev", "data-gnext",
            "data-id", "aria-controls", "role", "onclick", "data-filter-form",
            # progressive inquiry form, driven by assets/js/inquiry.js
            "data-inq-next", "data-inq-back", "data-inq-send"))
        typ = a.get("type", "submit")
        if typ in ("submit", "reset"):
            has_hook = True
        if "class" in a and any(c in a["class"] for c in
                                ("nav__burger", "fav", "hero__dot", "gallery__thumb",
                                 "floatc__btn", "iconbtn", "tab", "chip")):
            has_hook = True
        if not has_hook:
            fail("button with no behaviour", "%s :: %r" % (rel, inner[:40]))

    # ---- Links must have a destination --------------------------------
    for m in re.finditer(r'<a\b([^>]*)>', doc):
        a = attrs(m.group(1))
        if "href" not in a or a["href"].strip() in ("", "#"):
            fail("link with no destination", "%s :: %s" % (rel, m.group(0)[:70]))

    # ---- Unsubstituted format placeholders ----------------------------
    # A literal %s or %d in rendered text means a template was concatenated
    # without its % operator. It renders as visible junk to a real visitor.
    visible = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", doc, flags=re.S)
    visible = re.sub(r"<[^>]+>", " ", visible)
    for m in re.finditer(r"%[sdrf](?![0-9a-zA-Z])", visible):
        ctx = " ".join(visible[max(0, m.start()-40):m.end()+20].split())
        fail("unsubstituted format placeholder in output", "%s :: %r" % (rel, ctx))
        break

    # ---- Duplicate ids break every label/aria association -------------
    ids = re.findall(r'\sid="([^"]+)"', doc)
    dupes = [k for k, n in collections.Counter(ids).items() if n > 1]
    if dupes:
        fail("duplicate element ids", "%s :: %s" % (rel, ", ".join(sorted(dupes)[:5])))

    # ---- aria-controls must point at a real element -------------------
    idset = set(ids)
    for m in re.finditer(r'aria-controls="([^"]+)"', doc):
        if m.group(1) not in idset:
            fail("aria-controls target missing", "%s :: %s" % (rel, m.group(1)))
    for m in re.finditer(r'aria-labelledby="([^"]+)"', doc):
        for ref in m.group(1).split():
            if ref not in idset:
                fail("aria-labelledby target missing", "%s :: %s" % (rel, ref))

    # ---- Accessibility scaffolding ------------------------------------
    if 'class="skip-link"' not in doc:
        fail("skip link missing", rel)
    if '<main id="main">' not in doc:
        fail("main landmark missing", rel)
    if 'aria-label="Primary"' not in doc:
        fail("primary nav landmark missing", rel)

    # ---- Registration category must be stated consistently -------------
    # Broker and Salesperson are distinct RECO categories. A page that claims
    # both is wrong whichever one is true.
    low = doc.lower()
    if "registered as a broker" in low and "registered real estate salesperson" in low:
        fail("contradictory RECO registration category on one page", rel)
    # Only a CLAIM that Kaylin is a salesperson is wrong. Explaining that Broker
    # sits above salesperson in the RECO hierarchy is accurate and useful.
    for pat in (r"kaylin[^.]{0,40}\bis a (?:registered )?(?:real estate )?salesperson",
                r"registered real estate salesperson"):
        if re.search(pat, low):
            fail("page claims Kaylin is a salesperson (she is a Broker)", rel)

    # ---- Legal: brokerage name on every page (Ontario TRESA) -----------
    LEGAL = "RE/MAX Epic Realty Inc., Brokerage"
    if LEGAL not in doc:
        fail("brokerage legal name missing (TRESA advertising rule)", rel)
    # A near-miss variant means two different names are in circulation.
    stray = re.findall(r"RE/MAX Epic Realty(?! Inc\.), Brokerage", doc)
    if stray:
        fail("brokerage named inconsistently (missing 'Inc.')",
             "%s :: %d occurrence(s)" % (rel, len(stray)))

    # ---- Honesty checks -----------------------------------------------
    if re.search(r"—", doc):
        fail("em dash in output (house style)", rel)
    for phrase in ("dream home", "your real estate journey", "turning dreams",
                   "luxury redefined", "elegance meets", "unlock your",
                   "nestled", "boasts", "a true gem", "must see", "priced to sell"):
        if phrase in doc.lower():
            fail("realtor cliche in copy", "%s :: %r" % (rel, phrase))

    # ---- Litotes and double negatives (house style bans them) ----------
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", doc, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    for pat in (r"\bnot un\w+", r"\bisn't (?:just|only|merely)\b",
                r"\bis not (?:just|only|merely)\b", r"\bnot only\b",
                r"\bno small\b", r"\bnot without\b", r"\bnot unlike\b",
                r"\bnot uncommon\b", r"\bnot merely\b", r"\bnothing if not\b",
                r"\bnot a bad\b", r"\bnever fails?\b"):
        m = re.search(pat, text, re.I)
        if m:
            fail("litotes / double negative in copy", "%s :: %r" % (rel, m.group(0)))

# ---- Faded text is a recurring source of contrast failures ----------
CSSRC = open(os.path.join(os.path.dirname(DIST), "assets", "css", "site.css")).read()
for m in re.finditer(r"([^{}]+)\{([^}]*)\}", CSSRC):
    sel, body = m.group(1).strip(), m.group(2)
    if "opacity:" not in body and "rgba" not in body:
        continue
    if any(k in sel for k in ("img", "svg", "::", "thumb", "hover", "media", "scrim",
                              "disabled", "veil", "reveal", "stagger", "caret", "mark")):
        continue
    o = re.search(r"opacity:\s*(\.\d+|0\.\d+)", body)
    if o and float(o.group(1)) < 0.8 and ("color" in body or "font" in body or "label" in sel):
        fail("text faded below 0.8 opacity (hurts contrast)", "%s :: opacity %s" % (sel[:48], o.group(1)))
    c = re.search(r"color:\s*rgba\([^)]*?,\s*(\.\d+|0\.\d+)\s*\)", body)
    if c and float(c.group(1)) < 0.8:
        fail("text colour alpha below 0.8 (hurts contrast)", "%s :: alpha %s" % (sel[:48], c.group(1)))

print("Audited %d pages\n" % len(pages))
total = 0
for cat, items in fails.items():
    total += len(items)
    print("  %-56s %d" % (cat, len(items)))
    for it in items[:6]:
        print("       %s" % it)
    if len(items) > 6:
        print("       ... and %d more" % (len(items) - 6))
    print()

if not total:
    print("  No issues found.")
print("TOTAL ISSUES: %d" % total)
sys.exit(1 if total else 0)
