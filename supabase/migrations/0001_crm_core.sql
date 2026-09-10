-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 1: CORE DATA MODEL
--
-- Additive. The existing capture tables in schema.sql (leads,
-- business_enquiries, referral_requests and the rest) keep working exactly as
-- they do today; 0004 backfills them into this model and points the triggers
-- here. Nothing in this file drops or alters an existing table.
--
-- Design rules this file follows
--  * One person is one row in contacts. A contact may hold BOTH a real estate
--    and a consulting interest, so interest is a separate table rather than a
--    column on the contact. Section 2 requires this explicitly.
--  * No CRM data is readable by the anon key. Anonymous traffic may INSERT a
--    lead and nothing else. Every SELECT requires an authenticated staff user.
--  * Consent is recorded with its exact wording and timestamp, because CASL
--    requires proving what someone agreed to, not merely that they did.
--  * Nothing is stored as a giant JSON blob where it belongs in a column.
--    jsonb appears only for genuinely open-ended payloads (form snapshots,
--    provider webhooks, automation step configuration).
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- ENUMS
-- -----------------------------------------------------------------------------
do $$ begin create type crm_interest as enum ('real_estate','business_consulting');
exception when duplicate_object then null; end $$;

do $$ begin create type crm_lifecycle as enum (
  'discovery','inquiry','qualification','responded','resource_delivered',
  'consultation_booked','consultation_complete','active_opportunity','client',
  'service_delivery','nurture','referral','lost');
exception when duplicate_object then null; end $$;

do $$ begin create type crm_temperature as enum ('hot','warm','nurture','cold');
exception when duplicate_object then null; end $$;

do $$ begin create type re_intent as enum (
  'buy','sell','buy_and_sell','invest','rent','relocate','pre_construction',
  'commercial','first_time_buyer','general','undecided');
exception when duplicate_object then null; end $$;

do $$ begin create type re_timeline as enum (
  'immediately','within_30_days','1_3_months','3_6_months','6_12_months','researching');
exception when duplicate_object then null; end $$;

do $$ begin create type re_budget as enum (
  'under_500k','500k_750k','750k_1m','1m_1_5m','1_5m_2m','2m_plus','unsure');
exception when duplicate_object then null; end $$;

do $$ begin create type biz_stage as enum (
  'idea','pre_launch','new_business','growing','established','scaling',
  'restructuring','unsure');
exception when duplicate_object then null; end $$;

do $$ begin create type biz_challenge as enum (
  'strategy','growth','marketing','branding','sales','systems','operations',
  'financing','business_model','expansion','real_estate','leadership','other');
exception when duplicate_object then null; end $$;

do $$ begin create type biz_revenue as enum (
  'pre_revenue','under_100k','100k_250k','250k_500k','500k_1m','1m_5m','5m_plus','undisclosed');
exception when duplicate_object then null; end $$;

do $$ begin create type biz_urgency as enum ('now','within_30_days','1_3_months','exploring');
exception when duplicate_object then null; end $$;

do $$ begin create type consent_kind as enum (
  'service','real_estate_insights','business_insights','events','market_updates','all_marketing');
exception when duplicate_object then null; end $$;

do $$ begin create type consent_basis as enum ('express','implied','withdrawn','none');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- STAFF
-- Mirrors auth.users. Role drives every RLS policy below.
-- -----------------------------------------------------------------------------
create table if not exists crm_users (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null,
  email         citext unique not null,
  role          text not null default 'agent'
                check (role in ('owner','agent','assistant','readonly')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function crm_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_users u where u.id = auth.uid() and u.active);
$$;

create or replace function crm_can_write() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_users u
                 where u.id = auth.uid() and u.active and u.role <> 'readonly');
$$;

-- -----------------------------------------------------------------------------
-- ORGANIZATIONS
-- -----------------------------------------------------------------------------
create table if not exists organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  website       text,
  industry      text,
  city          text,
  province      text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists organizations_name_idx on organizations (lower(name));

-- -----------------------------------------------------------------------------
-- CONTACTS
-- email is citext and unique so deduplication is enforced by the database
-- rather than hoped for in application code (section 7).
-- -----------------------------------------------------------------------------
create table if not exists contacts (
  id                uuid primary key default gen_random_uuid(),
  first_name        text,
  last_name         text,
  email             citext unique,
  phone             text,
  phone_normalized  text generated always as
                    (nullif(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), '')) stored,
  organization_id   uuid references organizations(id) on delete set null,
  job_title         text,
  city              text,
  province          text,
  country           text default 'CA',
  birthday          date,

  lifecycle         crm_lifecycle not null default 'inquiry',
  temperature       crm_temperature not null default 'warm',
  lead_score        integer not null default 0,
  owner_id          uuid references crm_users(id) on delete set null,

  -- original attribution, never overwritten once set (section 7)
  source            text,
  source_detail     text,
  landing_page      text,
  referrer          text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,

  do_not_contact    boolean not null default false,
  next_action       text,
  next_action_at    timestamptz,
  last_contacted_at timestamptz,
  first_seen_at     timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint contacts_identifiable check (email is not null or phone_normalized is not null)
);
create index if not exists contacts_phone_idx       on contacts (phone_normalized);
create index if not exists contacts_owner_idx       on contacts (owner_id);
create index if not exists contacts_lifecycle_idx   on contacts (lifecycle);
create index if not exists contacts_temperature_idx on contacts (temperature);
create index if not exists contacts_next_action_idx on contacts (next_action_at)
  where next_action_at is not null;
create index if not exists contacts_name_idx on contacts
  (lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'')));

-- -----------------------------------------------------------------------------
-- INTERESTS  (section 2: a person may be in both funnels at once)
-- -----------------------------------------------------------------------------
create table if not exists contact_interests (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  interest      crm_interest not null,
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (contact_id, interest)
);
create index if not exists contact_interests_contact_idx on contact_interests (contact_id);

-- -----------------------------------------------------------------------------
-- REAL ESTATE PROFILE  (section 4)
-- -----------------------------------------------------------------------------
create table if not exists real_estate_profiles (
  contact_id            uuid primary key references contacts(id) on delete cascade,
  intent                re_intent,
  timeline              re_timeline,
  budget_band           re_budget,
  preferred_location    text,
  property_type         text,
  seller_address        text,
  seller_neighbourhood  text,
  selling_timeline      re_timeline,
  pre_approved          boolean,
  has_realtor           boolean,
  success_looks_like    text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- BUSINESS PROFILE  (section 5)
-- -----------------------------------------------------------------------------
create table if not exists business_profiles (
  contact_id        uuid primary key references contacts(id) on delete cascade,
  organization_id   uuid references organizations(id) on delete set null,
  business_name     text,
  website           text,
  industry          text,
  stage             biz_stage,
  primary_challenge biz_challenge,
  revenue_band      biz_revenue,
  urgency           biz_urgency,
  biggest_problem   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
