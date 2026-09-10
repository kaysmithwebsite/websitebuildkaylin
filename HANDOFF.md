# Handoff

Written 2026-09-10. Read `README.md` for how the site is built and
`CRM-ARCHITECTURE.md` for the CRM. This file covers only what those two do not:
the decisions still open, what is actually connected, and which code has been
executed rather than merely checked.

---

## Where things stand

| | |
|---|---|
| Live site | https://kaylinsmith.com (Netlify project `kaylinwebsitetest`) |
| Build | `python3 build.py --production`, 25 pages. Netlify runs this itself; see `netlify.toml`. |
| Lead capture | **Working.** Netlify Forms, no database needed. |
| CRM | **Written and tested, not connected.** No Supabase project exists. |
| Domain | `kaylinsmith.com` added in Netlify. **DNS not yet pointed.** |
| Git | Committed as `1497d8f` on `main`, remote set, **never pushed** (auth was broken). |

Three audits gate every build and all currently pass at zero:
`python3 build.py` (link check), `python3 audit.py` (accessibility, contrast),
`python3 antiai_audit.py` (design and copy rules).

---

## Decisions still open

These are the things a fresh pair of eyes will otherwise get wrong.

**1. Kay Smith or Kaylin Smith Consulting Group?**
The supplied logo artwork reads `KAY SMITH CONSULTING GROUP`. The written brief
said "Kaylin Smith Consulting Group" twice. The booking address was
`kaysmithconsultinggroup@gmail.com` until 2026-09-10, when the client changed it
to `kaylinsmithconsultinggroup@gmail.com`. The site displays **Kay Smith
Consulting Group**, chosen when the logo and the email agreed. Only the logo says
Kay now. If it is Kaylin, the displayed name changes *and* the logo needs
replacing. Recorded in `data/site.json` under `brands.consulting._name_discrepancy`.

**2. The DCCF board seat has changed three times.**
Currently: Community Representative on the Board of Directors of the **Durham
Catholic Children's Foundation (DCCF)**. It was DCCF (3 Sept), then DCPIC
(8 Sept), then DCCF again (8 Sept, current). It is a board seat, so it should be
confirmed once and left alone. History is in `data/organizations.json`.

**3. Lead scoring may be backwards for a brokerage.**
A luxury seller with a 30-day timeline and an address scores 40 (warm); a
first-time buyer scores 45 (hot). The point values come verbatim from the CRM
brief §32. They are editable in the `lead_scoring_rules` table. Run
`python3 tools_crm_check.py` to see every persona's score.

**4. Headline capitalisation.**
The client writes headlines in Title Case; the site uses sentence case
throughout. Sentence case was chosen for consistency and never contested.

---

## What is not connected

Nothing below is broken. It is unconfigured, and the code fails honestly rather
than pretending.

**Netlify Forms notification addresses — 5 minutes, do this first.**
Both forms are registered and capture works, but no notification address is set,
so submissions land in the dashboard and nobody is emailed. In Netlify:
Forms → `real-estate-enquiry` → Settings and usage → Form notifications →
`info@kaylinsmith.com`. Then `consulting-enquiry` → `kaylinsmithconsultinggroup@gmail.com`.

**Supabase — turns the whole CRM on.**
Create a project, put the URL and anon key in `data/site.json` under `supabase`,
run the seven migrations in `supabase/migrations/` in order, deploy the five
functions in `supabase/functions/` with the service-role key. Set the secrets
`NOTIFY_TO_REAL_ESTATE` and `NOTIFY_TO_CONSULTING`. Lead capture already works
without this; Supabase adds contacts, scoring, pipelines, automation and
follow-up.

**Transactional email provider.** Resend or similar. Until then the automation
engine queues rows in `emails` at `status='queued'` and sends nothing. This is
deliberate, not a bug.

**Google Calendar OAuth.** Needed for booking (phase 5, not built).

---

## Content still awaited from the client

Each of these makes the build print a warning, and several show a visitor-facing
"Not yet verified" banner on the live site.

| File | What is missing | Visitor-facing? |
|---|---|---|
| `data/reviews.json` | 3-5 Google reviews, verbatim. **Do not write these.** | Section hidden in production |
| `data/tax-rates.json` | `last_verified` on land transfer tax rates | **Yes** — banner on 3 calculators |
| `data/government-programs.json` | `last_verified` per programme | **Yes** — banner on the programmes page |
| `data/organizations.json` | Charity logo files + written permission | Logos simply absent |
| `data/guides.json` | Chapter lists (the PDFs are image-based) | No |
| `data/professionals.json` | Vetted trades for Find an Expert | Honest empty state |

Also outstanding: RECO registration number, and the official REALTOR®/MLS® mark
assets from TRREB (the written trademark attribution in the footer satisfies the
disclosure meanwhile).

---

## The hard rule

**Nothing about Kaylin may be invented.** No sales volume, transaction counts,
awards, testimonials, rankings or years of experience. No MLS or demo listings.
Content renders only behind `verified: true` / `permission_confirmed` /
`byline_approved` flags, `--production` drops unverified content entirely, and
empty states say plainly that data was not supplied.

Never redraw, recolour or alter the proportions of the RE/MAX or CREA marks.
Official supplied assets only.

Copy rules, enforced by `antiai_audit.py`: no em dashes, no litotes, no
"whether you're looking to…" openers, no generic AI phrasing.

---

## Deploying

Netlify builds from the uploaded folder; **git is not the deploy path**. The
current procedure, which has quirks worth knowing:

1. `python3 build.py --production` and confirm all three audits are clean.
2. Set aside `incoming-photos/`, `dist/` and `kaylinsmith-preview.zip`. The
   upload is 174MB otherwise and Netlify's build endpoint returns 500. Trimmed
   to 39MB it succeeds. Netlify rebuilds `dist/` itself.
3. Deploy, **from `kaylinsmith/` and never the parent directory** — the parent
   holds several unrelated client projects and a stray `index.html` that would
   be published as the homepage.
4. Restore the three folders.

Netlify's zip-and-build endpoint returns a transient 500 fairly often. It took
three attempts on 2026-09-10. Retry with a fresh token; nothing is left
half-deployed.

To return the site to a private preview: set `command = "python3 build.py
--preview"` in `netlify.toml` and restore the `X-Robots-Tag` header (see the
comment there).

---

## DNS, still to do

`kaylinsmith.com` is registered at GoDaddy on GoDaddy nameservers. Three changes
in GoDaddy → DNS → Manage Zones:

| Action | Type | Name | Value |
|---|---|---|---|
| Edit | A | `@` | `75.2.60.5` (replaces `108.168.178.102`) |
| Delete | A | `www` | the existing `108.168.178.102` record |
| Add | CNAME | `www` | `kaylinwebsitetest.netlify.app` |

GoDaddy offers no ALIAS/ANAME/flattened CNAME, so Netlify's A-record fallback is
the only option.

**Do not move the nameservers to Netlify.** Microsoft 365 email runs on the
GoDaddy zone: `MX`, the `MS=ms14076635` verification TXT, and `autodiscover`.
Anything missed takes down `info@kaylinsmith.com`, which is where every real
estate lead routes. Leave `MX`, `TXT`, `SPF`, `_dmarc`, `autodiscover`, `email`
and `_domainconnect` alone.

Two findings not yet acted on: something is already live at `108.168.178.102`
(IBM Cloud) that will be replaced, and SPF authorizes GoDaddy
(`include:secureserver.net`) while the mail is Microsoft 365, which will hurt
deliverability once the CRM sends from that domain.

---

## What has actually been run, and what has not

This distinction matters for trusting the CRM.

**Executed and passing (139 tests):**
`node --experimental-strip-types tools_engine_test.ts` (34),
`tools_flow_test.ts` (32), `tools_outcome_test.ts` (73). The flow and outcome
suites parse the real seeded SQL, so a bad stage key or missing template fails
locally. The automation engine and outcome planner are import-free modules
precisely so they run in Node as well as Deno.

**Structure-checked only, never executed:**
the 7 migrations (39 tables) and the 5 edge functions. There is no Postgres on
the build machine. `tools_sql_check.py` catches unbalanced dollar-quoting,
forward foreign keys, duplicate tables and unknown column types;
`tools_crm_check.py` cross-checks form options, ingest logic, SQL enums and lead
routing. Neither proves the SQL runs. **Expect to fix things on the first real
migration run.**

**Verified live on the deployed site:** Netlify Forms capture and two-inbox
routing, by posting one test submission to each form and confirming which form
each landed in. Both test submissions were deleted afterwards.
