-- =============================================================================
-- KAYLIN SMITH REAL ESTATE - SUPABASE SCHEMA
-- Run in the Supabase SQL editor, or: supabase db push
--
-- Design notes
--  * The site is public and unauthenticated. Every lead table therefore allows
--    anonymous INSERT only. No anonymous SELECT anywhere: a public site that can
--    read its own leads table is a data breach waiting to happen.
--  * Marketing consent is stored separately from the enquiry itself, with the
--    timestamp and the exact wording shown at the time. CASL requires you to be
--    able to prove what someone consented to, not merely that they did.
--  * The properties table matches data/properties.json field for field, so an
--    authorized IDX/DDF feed can populate it without a schema change.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
do $$ begin
  create type listing_status as enum ('For Sale','For Lease','Sold','Leased','Suspended','Terminated','Coming Soon');
exception when duplicate_object then null; end $$;

do $$ begin
  create type listing_kind as enum ('sale','lease');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lead_kind as enum (
    'contact','showing_request','valuation','consultation','property_enquiry',
    'newsletter','listing_alert','guide_download','neighbourhood_alert');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- CONTENT: neighbourhoods
-- -----------------------------------------------------------------------------
create table if not exists neighbourhoods (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,
  name            text not null,
  city            text not null,
  tagline         text,
  intro           text,
  lifestyle       text,
  housing_types   text[] default '{}',
  housing_note    text,
  parks           text[] default '{}',
  landmarks       text[] default '{}',
  transportation  text[] default '{}',
  schools_note    text,
  market_data     jsonb  default '{}'::jsonb,
  kaylin_commentary text,
  featured        boolean not null default false,
  sort_order      int     not null default 0,
  hero_image_url  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- LISTINGS: normalized property model (section 30)
-- -----------------------------------------------------------------------------
create table if not exists properties (
  id                    uuid primary key default gen_random_uuid(),
  external_id           text unique,               -- feed's own key
  mls_number            text unique,
  is_demo               boolean not null default false,

  status                listing_status not null default 'For Sale',
  listing_type          listing_kind   not null default 'sale',
  price                 numeric(12,2) not null check (price >= 0),
  price_qualifier       text,

  unit                  text,
  street_number         text,
  street_name           text,
  city                  text not null,
  province              text not null default 'ON',
  postal_code           text,
  country               text not null default 'Canada',

  latitude              numeric(9,6),
  longitude             numeric(9,6),
  neighbourhood_id      uuid references neighbourhoods(id) on delete set null,
  neighbourhood_slug    text,

  property_type         text,
  style                 text,
  bedrooms              int check (bedrooms >= 0),
  bathrooms             int check (bathrooms >= 0),
  square_footage        int check (square_footage >= 0),
  square_footage_source text,
  lot_frontage_ft       numeric(7,2),
  lot_depth_ft          numeric(7,2),
  parking_total         int default 0,
  garage_spaces         int default 0,
  year_built_range      text,

  maintenance_fee_monthly numeric(10,2),
  property_tax_annual     numeric(12,2),
  property_tax_year       int,

  description           text,
  features              text[] default '{}',
  amenities             text[] default '{}',
  rooms                 jsonb  default '[]'::jsonb,
  images                jsonb  default '[]'::jsonb,
  open_houses           jsonb  default '[]'::jsonb,
  investment            jsonb,

  days_on_market        int default 0,
  listing_brokerage     text,
  listing_agent         text,
  sold_price            numeric(12,2),
  sold_date             date,

  featured              boolean not null default false,
  published             boolean not null default true,

  feed_source           text,
  feed_synced_at        timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists properties_status_idx    on properties (status) where published;
create index if not exists properties_price_idx     on properties (price);
create index if not exists properties_nb_idx        on properties (neighbourhood_slug);
create index if not exists properties_type_idx      on properties (property_type);
create index if not exists properties_beds_idx      on properties (bedrooms);
create index if not exists properties_geo_idx       on properties (latitude, longitude);
create index if not exists properties_featured_idx  on properties (featured) where featured;

-- -----------------------------------------------------------------------------
-- CONTENT: articles, market reports, testimonials, stats, social proof
-- -----------------------------------------------------------------------------
create table if not exists articles (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  title         text not null,
  category      text not null,
  excerpt       text,
  body          jsonb not null default '[]'::jsonb,
  hero_image_url text,
  read_minutes  int,
  published_at  date,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  byline_approved boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists market_reports (
  id              uuid primary key default gen_random_uuid(),
  slug            text unique not null,          -- e.g. markham/august-2026
  city            text not null,
  period_label    text not null,
  period_start    date,
  period_end      date,
  data_status     text not null default 'awaiting_data'
                    check (data_status in ('awaiting_data','published')),
  source          text,
  source_url      text,
  metrics         jsonb default '{}'::jsonb,
  by_property_type jsonb default '[]'::jsonb,
  commentary      text,
  featured        boolean not null default false,
  created_at      timestamptz not null default now()
);

create table if not exists testimonials (
  id              uuid primary key default gen_random_uuid(),
  quote           text not null,
  attribution     text not null,
  transaction_type text,
  location        text,
  source          text,                          -- e.g. Google, direct
  source_url      text,
  photo_url       text,
  consent_on_file boolean not null default false,
  published       boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
-- A testimonial may only publish once consent is recorded.
alter table testimonials drop constraint if exists testimonials_consent_required;
alter table testimonials add constraint testimonials_consent_required
  check (published = false or consent_on_file = true);

create table if not exists site_stats (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  value       numeric,
  prefix      text default '',
  suffix      text default '',
  label       text not null,
  verified    boolean not null default false,
  sort_order  int not null default 0,
  updated_at  timestamptz not null default now()
);
-- An unverified statistic must not carry a value that could be rendered.
alter table site_stats drop constraint if exists site_stats_verified_required;
alter table site_stats add constraint site_stats_verified_required
  check (value is null or verified = true);

create table if not exists social_proof (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('award','media','certification','association','community')),
  name        text not null,
  note        text,
  year        int,
  url         text,
  verified    boolean not null default false,
  sort_order  int not null default 0
);

create table if not exists guides (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  subtitle    text,
  audience    text,
  chapters    text[] default '{}',
  file_url    text,
  lead_source text not null,
  published   boolean not null default true
);

-- -----------------------------------------------------------------------------
-- LEADS
-- -----------------------------------------------------------------------------
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  kind          lead_kind not null default 'contact',
  name          text,
  email         text,
  phone         text,
  message       text,
  interest      text,
  preferred_contact text,
  payload       jsonb default '{}'::jsonb,        -- form-specific answers
  context       jsonb default '{}'::jsonb,        -- source, page, referrer, utm
  property_id   uuid references properties(id) on delete set null,
  property_mls  text,
  neighbourhood_slug text,
  source        text,
  status        text not null default 'new'
                  check (status in ('new','contacted','qualified','archived','spam')),
  created_at    timestamptz not null default now()
);
create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_kind_idx    on leads (kind);
create index if not exists leads_status_idx  on leads (status);

create table if not exists showing_requests (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references properties(id) on delete set null,
  property_mls  text,
  property_address text,
  name          text not null,
  email         text not null,
  phone         text,
  preferred_date date,
  preferred_time text,
  message       text,
  context       jsonb default '{}'::jsonb,
  status        text not null default 'new',
  created_at    timestamptz not null default now()
);

create table if not exists valuation_requests (
  id            uuid primary key default gen_random_uuid(),
  address       text not null,
  unit          text,
  city          text,
  postal_code   text,
  property_type text,
  bedrooms      text,
  bathrooms     text,
  condition     text,
  timeline      text,
  name          text not null,
  email         text not null,
  phone         text,
  notes         text,
  context       jsonb default '{}'::jsonb,
  status        text not null default 'new',
  created_at    timestamptz not null default now()
);

create table if not exists consultation_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  topic         text,
  situation     text,
  timeline      text,
  context       jsonb default '{}'::jsonb,
  status        text not null default 'new',
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- CONSENT (CASL / PIPEDA). Section 42.
-- Marketing consent is never implied by a transactional enquiry.
-- -----------------------------------------------------------------------------
create table if not exists marketing_consent (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  granted         boolean not null,
  consent_text    text not null,          -- exact wording shown at the time
  source          text,                   -- which form
  page_path       text,
  ip_hint         text,
  granted_at      timestamptz not null default now(),
  withdrawn_at    timestamptz
);
create index if not exists marketing_consent_email_idx on marketing_consent (lower(email));

create table if not exists newsletter_subscribers (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  name            text,
  neighbourhoods  text[] default '{}',
  confirmed       boolean not null default false,   -- double opt-in
  confirm_token   uuid default gen_random_uuid(),
  consent_text    text not null,
  context         jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unsubscribed_at timestamptz
);
create unique index if not exists newsletter_email_uniq on newsletter_subscribers (lower(email))
  where unsubscribed_at is null;

create table if not exists listing_alerts (
  id              uuid primary key default gen_random_uuid(),
  email           text not null,
  criteria        jsonb not null default '{}'::jsonb,
  neighbourhood_slug text,
  confirmed       boolean not null default false,
  consent_text    text not null,
  context         jsonb default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  cancelled_at    timestamptz
);

create table if not exists guide_downloads (
  id            uuid primary key default gen_random_uuid(),
  guide_slug    text not null,
  name          text,
  email         text not null,
  context       jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- ANALYTICS (optional server-side mirror of section 41 events)
-- -----------------------------------------------------------------------------
create table if not exists analytics_events (
  id          bigserial primary key,
  event       text not null,
  params      jsonb default '{}'::jsonb,
  page_path   text,
  session_hint text,
  created_at  timestamptz not null default now()
);
create index if not exists analytics_events_evt_idx on analytics_events (event, created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at triggers
-- -----------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['neighbourhoods','properties','articles'] loop
    execute format(
      'drop trigger if exists %I on %I; create trigger %I before update on %I
       for each row execute function set_updated_at();',
      t || '_set_updated_at', t, t || '_set_updated_at', t);
  end loop;
end $$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table neighbourhoods         enable row level security;
alter table properties             enable row level security;
alter table articles               enable row level security;
alter table market_reports         enable row level security;
alter table testimonials           enable row level security;
alter table site_stats             enable row level security;
alter table social_proof           enable row level security;
alter table guides                 enable row level security;
alter table leads                  enable row level security;
alter table showing_requests       enable row level security;
alter table valuation_requests     enable row level security;
alter table consultation_requests  enable row level security;
alter table marketing_consent      enable row level security;
alter table newsletter_subscribers enable row level security;
alter table listing_alerts         enable row level security;
alter table guide_downloads        enable row level security;
alter table analytics_events       enable row level security;

-- Public content: anonymous read of published rows only.
drop policy if exists "public read neighbourhoods" on neighbourhoods;
create policy "public read neighbourhoods" on neighbourhoods for select to anon, authenticated using (true);

drop policy if exists "public read published properties" on properties;
create policy "public read published properties" on properties for select to anon, authenticated using (published);

drop policy if exists "public read published articles" on articles;
create policy "public read published articles" on articles for select to anon, authenticated
  using (status = 'published' and byline_approved);

drop policy if exists "public read market reports" on market_reports;
create policy "public read market reports" on market_reports for select to anon, authenticated using (true);

drop policy if exists "public read published testimonials" on testimonials;
create policy "public read published testimonials" on testimonials for select to anon, authenticated
  using (published and consent_on_file);

drop policy if exists "public read verified stats" on site_stats;
create policy "public read verified stats" on site_stats for select to anon, authenticated using (verified);

drop policy if exists "public read verified social proof" on social_proof;
create policy "public read verified social proof" on social_proof for select to anon, authenticated using (verified);

drop policy if exists "public read guides" on guides;
create policy "public read guides" on guides for select to anon, authenticated using (published);

-- Lead capture: anonymous INSERT only. No anonymous SELECT, UPDATE or DELETE.
do $$
declare t text;
begin
  foreach t in array array['leads','showing_requests','valuation_requests','consultation_requests',
                           'marketing_consent','newsletter_subscribers','listing_alerts',
                           'guide_downloads','analytics_events'] loop
    execute format('drop policy if exists "anon insert %1$s" on %1$I;', t);
    execute format('create policy "anon insert %1$s" on %1$I for insert to anon, authenticated with check (true);', t);
  end loop;
end $$;

-- Reading leads requires the service role, which bypasses RLS. Deliberately
-- no anon SELECT policy exists on any lead table.

-- =============================================================================
-- SEED: statistics keys, deliberately unverified and valueless.
-- =============================================================================
insert into site_stats (key, label, prefix, suffix, sort_order, verified, value) values
  ('career_sales',     'Career Sales',             '$', 'M+', 1, false, null),
  ('clients',          'Clients Represented',      '',  '+',  2, false, null),
  ('years_experience', 'Years Experience',         '',  '',   3, false, null),
  ('communities',      'Communities Served',       '',  '',   4, false, null),
  ('referral_rate',    'Referral & Repeat Clients','',  '%',  5, false, null)
on conflict (key) do nothing;


-- =============================================================================
-- ADDITIONS: referrals, business and events consulting, email notification
-- =============================================================================

-- Trusted professionals directory. Empty until Kaylin confirms who is in her
-- circle AND that each has agreed to be listed publicly. `published` is gated on
-- consent for the same reason testimonials are.
create table if not exists professionals (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  business_name text,
  trade         text not null,
  areas_served  text[] default '{}',
  phone         text,
  email         text,
  website       text,
  note          text,
  consent_to_list boolean not null default false,
  published     boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
alter table professionals drop constraint if exists professionals_consent_required;
alter table professionals add constraint professionals_consent_required
  check (published = false or consent_to_list = true);

-- A client asking to be connected to one or more trades.
create table if not exists referral_requests (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  trades        text[] not null default '{}',
  other_trade   text,
  area          text,
  timeline      text,
  details       text,
  preferred_contact text,
  context       jsonb default '{}'::jsonb,
  status        text not null default 'new'
                  check (status in ('new','introduced','closed','spam')),
  created_at    timestamptz not null default now()
);
create index if not exists referral_requests_created_idx on referral_requests (created_at desc);

-- Business and events consulting enquiries. Kept separate from real estate leads
-- because it is a distinct practice with a different intake.
create table if not exists business_enquiries (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  organisation  text,
  enquiry_type  text,               -- business, event, both
  event_type    text,
  event_date    date,
  guest_count   text,
  budget_range  text,
  situation     text not null,
  timeline      text,
  context       jsonb default '{}'::jsonb,
  status        text not null default 'new',
  created_at    timestamptz not null default now()
);
create index if not exists business_enquiries_created_idx on business_enquiries (created_at desc);

alter table professionals       enable row level security;
alter table referral_requests   enable row level security;
alter table business_enquiries  enable row level security;

drop policy if exists "public read listed professionals" on professionals;
create policy "public read listed professionals" on professionals for select to anon, authenticated
  using (published and consent_to_list);

do $$
declare t text;
begin
  foreach t in array array['referral_requests','business_enquiries'] loop
    execute format('drop policy if exists "anon insert %1$s" on %1$I;', t);
    execute format('create policy "anon insert %1$s" on %1$I for insert to anon, authenticated with check (true);', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- EMAIL NOTIFICATION
--
-- Every new lead should reach Kaylin without her opening a dashboard. The row is
-- the record; the email is the alert. This calls the `notify-lead` edge function
-- asynchronously via pg_net, so a failure to send can never roll back the insert
-- and lose the lead. That trade is deliberate: a lead saved without an email is
-- recoverable, a lead lost is not.
--
-- SETUP (all three steps are required before any email is sent):
--   1. supabase functions deploy notify-lead
--   2. supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_TO=info@kaylinsmith.com \
--        NOTIFY_FROM="Kaylin Smith Website <website@yourdomain.com>"
--   3. select set_config('app.settings.project_url','https://<ref>.supabase.co', false);
--      and store the service role key in Vault, then set app.settings.service_key.
--      Alternatively configure a Database Webhook in the dashboard on INSERT for
--      each table below and point it at the function, which avoids storing keys here.
-- -----------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function notify_new_lead() returns trigger
language plpgsql security definer as $$
declare
  fn_url  text := current_setting('app.settings.project_url', true) || '/functions/v1/notify-lead';
  svc_key text := current_setting('app.settings.service_key', true);
begin
  if fn_url is null or svc_key is null or fn_url = '/functions/v1/notify-lead' then
    return new;   -- not configured yet: insert still succeeds, silently
  end if;
  perform extensions.net_http_post(
    url     := fn_url,
    headers := jsonb_build_object('Content-Type','application/json',
                                  'Authorization','Bearer ' || svc_key),
    body    := jsonb_build_object('table', tg_table_name, 'record', to_jsonb(new)),
    timeout_milliseconds := 4000
  );
  return new;
exception when others then
  return new;     -- never block the insert on a notification failure
end $$;

do $$
declare t text;
begin
  foreach t in array array['leads','showing_requests','valuation_requests',
                           'consultation_requests','referral_requests','business_enquiries',
                           'newsletter_subscribers','listing_alerts','guide_downloads'] loop
    execute format('drop trigger if exists %1$s_notify on %1$I;', t);
    execute format('create trigger %1$s_notify after insert on %1$I
                    for each row execute function notify_new_lead();', t);
  end loop;
end $$;
