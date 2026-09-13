# SEO protection

The CRM work this session did not touch the public site's SEO surface.
Confirmed, not assumed:

- **`build.py`'s page structure, titles, meta descriptions, canonical URLs,
  H1 hierarchy, structured data (JSON-LD), internal linking, sitemap, and
  robots.txt are all unchanged.** The only `build.py` edits this session
  were: (1) the `netlifyForms` config object passed into `KS_CONFIG`
  (invisible, non-rendered JS config), (2) the hidden Netlify form-detection
  stubs (`hidden aria-hidden="true" tabindex="-1"`, moved from inline in
  `inquiry_form()` to once-per-page in `page()` — same content, same
  invisibility, just centralized), and (3) `book_href("real_estate")`
  resolving to a Calendly URL instead of an internal anchor for the
  existing "Book a..." buttons (a link destination change on existing,
  already-indexed anchor text — not a new page, not a structural change).
- **`netlify.toml`'s redirects and headers are unchanged.** Only addition:
  a `[functions]` directory declaration, which does not affect any
  existing `[[redirects]]` rule — Netlify resolves real functions and
  files before falling through to the catch-all 404 redirect.
- **No SEO-critical content moved from static HTML to client-only
  rendering.** The three lead forms were already client-enhanced
  (`data-lead`, progressively enhanced per `assets/js/forms.js`'s existing
  design — see the comment in `inquiry_form()`'s docstring in `build.py`);
  this session changed *where their submission goes* (Netlify Forms
  instead of only an unconfigured Supabase endpoint), not their markup,
  visibility, or fallback-without-JS behavior.
- **The CRM required no rebuild of the public website's architecture.**
  `build.py` is still a plain Python static-site generator; there is no
  framework, no SPA shell, and no change to how a page is rendered or
  served. The CRM is additive (`netlify/functions/`, `db/`) rather than
  something the public site was rearchitected to sit inside.

## What to verify after the next real deploy

Nothing here needed to be verified in a browser against a live index
(no content changed, only a form's submission target and a button's
`href`), but confirm once deployed:

- Netlify's Forms detection actually picks up all ten hidden stub forms
  (Project configuration → Forms should list ten registered forms after
  the first deploy that includes them).
- The sitemap (`dist/sitemap.xml`) and `robots.txt` are unchanged from the
  pre-CRM build — diff them against the previous deploy if in doubt.
