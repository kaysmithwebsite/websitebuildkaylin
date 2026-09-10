-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 2: INQUIRY CAPTURE
--
-- The public site writes here and nowhere else. This is the only CRM-adjacent
-- table the anon key may touch, and it may only INSERT. The ingest function
-- reads these rows with the service role and promotes them into contacts,
-- profiles, opportunities, tags and score events.
--
-- Keeping capture separate from the CRM means a hostile submission can create
-- a row in a quarantine table and nothing else. It cannot reach a contact
-- record, a score, or anyone else's data.
-- =============================================================================

do $$ begin create type inquiry_state as enum ('received','processed','failed','spam');
exception when duplicate_object then null; end $$;

create table if not exists crm_inquiries (
  id                uuid primary key default gen_random_uuid(),

  -- exactly what the form posted, before any interpretation
  path              text,
  first_name        text,
  last_name         text,
  email             citext,
  phone             text,
  message           text,

  re_intent            text,
  re_timeline          text,
  re_location          text,
  re_budget            text,
  re_property_type     text,
  re_seller_address    text,
  re_selling_timeline  text,
  re_has_realtor       text,
  re_pre_approved      text,

  biz_name          text,
  biz_website       text,
  biz_stage         text,
  biz_challenge     text,
  biz_revenue       text,
  biz_urgency       text,
  other_detail      text,

  consent_contact           boolean not null default false,
  consent_marketing         boolean not null default false,
  consent_marketing_text    text,

  -- assets/js/forms.js posts its capture context as one nested object. It is
  -- stored exactly as sent; the ingest function is what flattens attribution
  -- into the queryable columns on contacts. Capture stays raw, the CRM is
  -- normalized.
  context           jsonb,
  state             inquiry_state not null default 'received',
  processed_at      timestamptz,
  contact_id        uuid references contacts(id) on delete set null,
  error             text,
  created_at        timestamptz not null default now(),

  -- a submission with neither an email nor a phone cannot be replied to
  constraint crm_inquiries_reachable check (email is not null or phone is not null)
);

create index if not exists crm_inquiries_unprocessed_idx
  on crm_inquiries (created_at) where state = 'received';
create index if not exists crm_inquiries_email_idx on crm_inquiries (email);

alter table crm_inquiries enable row level security;

-- Anonymous visitors may submit. They may not read back, not even their own row.
drop policy if exists crm_inquiries_anon_insert on crm_inquiries;
create policy crm_inquiries_anon_insert on crm_inquiries
  for insert to anon, authenticated with check (true);

drop policy if exists crm_inquiries_staff_read on crm_inquiries;
create policy crm_inquiries_staff_read on crm_inquiries
  for select using (crm_is_staff());

drop policy if exists crm_inquiries_staff_update on crm_inquiries;
create policy crm_inquiries_staff_update on crm_inquiries
  for update using (crm_can_write());
