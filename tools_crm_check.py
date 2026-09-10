#!/usr/bin/env python3
"""Consistency check across the three places CRM rules are expressed.

The form options live in data/crm-forms.json, the classification logic lives in
supabase/functions/ingest-inquiry/index.ts, and the storage types live in the
SQL enums. Those can drift, and the failure is silent: a form offers a value,
the ingest maps it, and Postgres rejects it at 2am. This checks they agree, and
runs the section 78 demo personas through the rules so the expected tags,
score and temperature are visible without a database.
"""
import json, re, sys

forms = json.load(open("data/crm-forms.json", encoding="utf-8"))
ts    = open("supabase/functions/ingest-inquiry/index.ts", encoding="utf-8").read()
sql   = "".join(open(f, encoding="utf-8").read()
                for f in sorted(__import__("glob").glob("supabase/migrations/*.sql")))
problems = []

# --- 1. every enum value the form offers must exist in the Postgres enum -----
def pg_enum(name):
    m = re.search(r"create type %s as enum \(([^)]*)\)" % name, sql, re.S)
    return set(re.findall(r"'([^']+)'", m.group(1))) if m else set()

pairs = [("real_estate", "intent", "re_intent"), ("real_estate", "timeline", "re_timeline"),
         ("real_estate", "budget", "re_budget"), ("business", "stage", "biz_stage"),
         ("business", "challenge", "biz_challenge"), ("business", "revenue", "biz_revenue"),
         ("business", "urgency", "biz_urgency")]
for group, key, enum in pairs:
    allowed = pg_enum(enum)
    for value, label in forms[group][key]:
        if value == "":
            continue
        if value not in allowed:
            problems.append("form offers %s.%s=%r which enum %s does not accept"
                            % (group, key, value, enum))

# --- 2. the TS allow-lists must match the enums ------------------------------
for const, enum in [("RE_INTENT","re_intent"), ("RE_TIMELINE","re_timeline"),
                    ("RE_BUDGET","re_budget"), ("BIZ_STAGE","biz_stage"),
                    ("BIZ_CHALLENGE","biz_challenge"), ("BIZ_REVENUE","biz_revenue"),
                    ("BIZ_URGENCY","biz_urgency")]:
    m = re.search(r"const %s = \[(.*?)\] as const" % const, ts, re.S)
    if not m:
        problems.append("ingest is missing the %s allow-list" % const); continue
    got, want = set(re.findall(r'"([^"]+)"', m.group(1))), pg_enum(enum)
    if got != want:
        problems.append("%s != enum %s (only in ts: %s / only in sql: %s)"
                        % (const, enum, sorted(got - want) or "-", sorted(want - got) or "-"))

# --- 3. tag rules in the TS must match the form config -----------------------
def ts_map(name):
    m = re.search(r"const %s: Record<string, string\[\]> = \{(.*?)\n\};" % name, ts, re.S)
    if not m: return None
    out = {}
    for k, v in re.findall(r'(\w+):\s*\[([^\]]*)\]', m.group(1)):
        out[k] = sorted(re.findall(r'"([^"]+)"', v))
    return out

for ts_name, cfg_key in [("PATH_TAGS","path"), ("INTENT_TAGS","real_estate.intent"),
                         ("STAGE_TAGS","business.stage"), ("CHALLENGE_TAGS","business.challenge")]:
    got = ts_map(ts_name)
    want = {k: sorted(v) for k, v in forms["tag_rules"][cfg_key].items()}
    if got is None:
        problems.append("cannot read %s from the ingest function" % ts_name); continue
    if got != want:
        problems.append("%s drifted from tag_rules['%s']: ts=%s cfg=%s"
                        % (ts_name, cfg_key, got, want))

# --- 4. every tag and scoring key referenced must be seeded ------------------
seeded_tags   = set(re.findall(r"^\s*\('([a-z_0-9]+)','[^']*','[a-z_]*',\s*(?:true|false)\)",
                               sql, re.M))
seeded_scores = set(re.findall(r"\('([a-z_0-9]+)','[^']*','[a-z_]*',\s*-?\d+\)", sql))
for group in forms["tag_rules"].values():
    if not isinstance(group, dict): continue
    for tags in group.values():
        if not isinstance(tags, list): continue
        for t in tags:
            if t not in seeded_tags:
                problems.append("tag %r is used by a rule but never seeded" % t)
for key in re.findall(r'scoreKeys\.push\("([a-z_0-9]+)"\)', ts):
    if key not in seeded_scores:
        problems.append("scoring key %r is pushed by the ingest but never seeded" % key)

# --- 4b. every automation the ingest can enrol must be seeded ---------------
enrol_keys = set(re.findall(r'"(re_\w+_inquiry|biz_\w+_inquiry)"', ts))
seeded_autos = set(re.findall(r"^\('([a-z_0-9]+)','\d\d [^']*'", sql, re.M))
for k in sorted(enrol_keys - seeded_autos):
    problems.append("ingest enrols into %r but no such automation is seeded" % k)

# --- 4c. lead routing: every form must land in a named inbox ---------------
#     A table with no rule used to fall through to real estate, which mixed a
#     consulting enquiry into the property pipeline. This makes that a failure.
import glob as _glob
site = json.load(open("data/site.json", encoding="utf-8"))
routing = site["routing"]
notify = open("supabase/functions/notify-lead/index.ts", encoding="utf-8").read()

re_tables  = set(routing["real_estate"]["tables"])
con_tables = set(routing["consulting"]["tables"])
re_paths   = set(routing["real_estate"]["paths"])
con_paths  = set(routing["consulting"]["paths"])

# the TS must agree with the config
ts_re_tables = set(re.findall(r'"(\w+)"',
    re.search(r"REAL_ESTATE_TABLES = new Set\(\[(.*?)\]\)", notify, re.S).group(1)))
ts_re_paths = set(re.findall(r'"(\w+)"',
    re.search(r"REAL_ESTATE_PATHS = new Set\(\[(.*?)\]\)", notify, re.S).group(1)))
if ts_re_tables != re_tables:
    problems.append("notify-lead real estate tables != site.json (%s)"
                    % sorted(ts_re_tables ^ re_tables))
if ts_re_paths != re_paths:
    problems.append("notify-lead real estate paths != site.json (%s)"
                    % sorted(ts_re_paths ^ re_paths))

# a path may not belong to both practices, and every form path must be routed
both = re_paths & con_paths
if both:
    problems.append("paths routed to both inboxes: %s" % sorted(both))
for pth in forms["paths"]:
    if pth["value"] not in (re_paths | con_paths):
        problems.append("form offers path %r but no inbox claims it" % pth["value"])

# every data-table rendered on the site must be routed
built = " ".join(open(f, encoding="utf-8").read()
                 for f in _glob.glob("dist/**/*.html", recursive=True))
for tbl in sorted(set(re.findall(r'data-table="(\w+)"', built))):
    if tbl == "crm_inquiries":
        continue                      # routed by path, checked above
    if tbl not in re_tables and tbl not in con_tables:
        problems.append("form posts to %r but no routing rule names it" % tbl)

# --- 5. run the section 78 personas through the rules -----------------------
points = dict(re.findall(r"\('([a-z_0-9]+)','[^']*','[a-z_]*',\s*(-?\d+)\)", sql))
NEAR = {"immediately", "within_30_days", "1_3_months"}
def score_for(p):
    keys = []
    if p.get("branch") == "real_estate":
        if p.get("re_timeline") in NEAR: keys.append("re_timeline_under_90")
        if p.get("re_pre_approved") == "yes": keys.append("re_financing_ready")
        if p.get("re_budget") and p["re_budget"] != "unsure": keys.append("re_budget_specified")
        if p.get("re_seller_address"): keys.append("re_seller_address")
    else:
        if p.get("biz_urgency") == "now": keys.append("biz_immediate_problem")
        if p.get("biz_stage") in ("established","scaling"): keys.append("biz_established")
        if p.get("biz_revenue") and p["biz_revenue"] != "undisclosed": keys.append("biz_revenue_supplied")
        if p.get("biz_challenge"): keys.append("biz_clear_project")
    return keys, sum(int(points.get(k, 0)) for k in keys)

def temp(s):
    for band in forms["temperature_rules"]["bands"]:
        if s >= band["min_score"]: return band["temperature"]
    return "cold"

personas = [
  ("First-time buyer", dict(branch="real_estate", path="buy", re_intent="buy",
      re_timeline="1_3_months", re_budget="500k_750k", re_pre_approved="yes")),
  ("Luxury seller", dict(branch="real_estate", path="sell", re_intent="sell",
      re_timeline="within_30_days", re_seller_address="Unionville", re_budget="2m_plus")),
  ("Investment buyer", dict(branch="real_estate", path="invest", re_intent="invest",
      re_timeline="6_12_months", re_budget="1m_1_5m")),
  ("Relocation family", dict(branch="real_estate", path="buy", re_intent="relocate",
      re_timeline="3_6_months", re_budget="unsure")),
  ("Startup founder", dict(branch="business", path="consulting", biz_stage="idea",
      biz_challenge="strategy", biz_revenue="pre_revenue", biz_urgency="exploring")),
  ("Established small business", dict(branch="business", path="consulting",
      biz_stage="established", biz_challenge="operations", biz_revenue="250k_500k",
      biz_urgency="now")),
  ("Growth-stage company", dict(branch="business", path="consulting", biz_stage="scaling",
      biz_challenge="growth", biz_revenue="1m_5m", biz_urgency="within_30_days")),
  ("Founder needing ops", dict(branch="business", path="consulting", biz_stage="growing",
      biz_challenge="systems", biz_revenue="undisclosed", biz_urgency="1_3_months")),
]

print("CRM rule consistency\n")
print("  %-28s %-6s %-9s %s" % ("persona", "score", "temp", "rules fired"))
for name, p in personas:
    keys, s = score_for(p)
    print("  %-28s %-6d %-9s %s" % (name, s, temp(s), ", ".join(keys) or "-"))

print()
if problems:
    print("PROBLEMS (%d):" % len(problems))
    for x in problems[:25]: print("  -", x)
    sys.exit(1)
print("Form options, ingest logic and SQL enums agree.")
