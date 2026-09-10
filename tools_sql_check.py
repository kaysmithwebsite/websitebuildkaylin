#!/usr/bin/env python3
"""Structural sanity check for the CRM migrations.

There is no Postgres on this machine, so this cannot prove the SQL runs. It
catches the errors that are cheap to make and expensive to discover in the
Supabase editor: unbalanced dollar-quoting, tables referenced by a foreign key
before they exist, duplicate definitions, and enums used but never created.
"""
import glob, os, re, sys

files = sorted(glob.glob("supabase/migrations/*.sql"))
text_by_file = {f: open(f, encoding="utf-8").read() for f in files}
problems = []

# 1. dollar-quoting must balance per file
for f, s in text_by_file.items():
    for tag in set(re.findall(r"\$[a-zA-Z_]*\$", s)):
        if s.count(tag) % 2 != 0:
            problems.append("%s: unbalanced dollar quote %s (%d)" % (f, tag, s.count(tag)))

# 2. parens balance per file
for f, s in text_by_file.items():
    stripped = re.sub(r"--[^\n]*", "", s)
    if stripped.count("(") != stripped.count(")"):
        problems.append("%s: paren imbalance %d open / %d close"
                        % (f, stripped.count("("), stripped.count(")")))

combined = "\n".join(text_by_file[f] for f in files)
existing = set(re.findall(r"create table if not exists (\w+)", combined))
existing |= {"auth.users"}

# 3. no duplicate table definitions
seen = {}
for f in files:
    for t in re.findall(r"create table if not exists (\w+)", text_by_file[f]):
        if t in seen:
            problems.append("duplicate table %s in %s and %s" % (t, seen[t], f))
        seen[t] = f

# 4. every FK target must be defined earlier in file order
defined_so_far = {"auth.users"}
for f in files:
    s = text_by_file[f]
    for t in re.findall(r"create table if not exists (\w+)", s):
        defined_so_far.add(t)
    for target in re.findall(r"references\s+([\w.]+)\s*\(", s):
        if target not in defined_so_far:
            problems.append("%s: foreign key -> %s before it is defined" % (f, target))

# 5. enums used in column definitions must be created
#    Function bodies are stripped first: a plpgsql SELECT inside $$ ... $$ is
#    not a column definition, and reading it as one produces noise.
def strip_bodies(src):
    """Function bodies and view definitions are SQL, not column lists. Reading
    a SELECT inside either as a table definition produces only noise."""
    src = re.sub(r"\$([a-zA-Z_]*)\$.*?\$\1\$", " /*body*/ ", src, flags=re.S)
    src = re.sub(r"create (?:or replace )?view\b.*?;", " /*view*/ ", src,
                 flags=re.S | re.I)
    return src

enums = set(re.findall(r"create type (\w+) as enum", combined))
builtin = {"text","uuid","boolean","integer","bigint","timestamptz","date","jsonb",
           "citext","inet","numeric","real","json","smallint","interval","time"}
for f in files:
    for line in strip_bodies(text_by_file[f]).splitlines():
        m = re.match(r"\s+(\w+)\s+(\w+)\s*(not null|primary key|references|default|,|$)", line)
        if not m: continue
        typ = m.group(2)
        if typ in builtin or typ in enums or typ in existing: continue
        if typ in ("generated","primary","check","constraint","unique","foreign","on","as"): continue
        if re.match(r"^(create|insert|select|from|where|values|do|end|begin|declare|for|loop|execute|if|return|language|with|order|union|drop|alter)$", typ, re.I): continue
        problems.append("%s: unknown column type %r on: %s" % (f, typ, line.strip()[:70]))

# 6. index/policy targets must exist
for f in files:
    for tbl in re.findall(r"create (?:unique )?index if not exists \w+\s+on (\w+)", text_by_file[f]):
        if tbl not in existing:
            problems.append("%s: index on undefined table %s" % (f, tbl))

print("files            : %d" % len(files))
print("tables defined   : %d" % len(seen))
print("enums defined    : %d" % len(enums))
print("indexes          : %d" % len(re.findall(r"create (?:unique )?index", combined)))
print("rls policies     : %d" % (combined.count("create policy") + combined.count("crm_staff_read")))
print()
if problems:
    print("PROBLEMS (%d):" % len(problems))
    for p in problems[:30]: print("  -", p)
    sys.exit(1)
print("No structural problems found.")
