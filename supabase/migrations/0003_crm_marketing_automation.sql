-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 1: RESOURCES, EMAIL, CONSENT, AUTOMATION
-- Sections 11-15, 32, 38-42, 44-45, 53, 55, 64-69.
-- =============================================================================

do $$ begin create type email_status as enum (
  'queued','sending','sent','delivered','bounced','failed','suppressed');
exception when duplicate_object then null; end $$;

do $$ begin create type email_class as enum ('transactional','marketing');
exception when duplicate_object then null; end $$;

do $$ begin create type automation_run_status as enum (
  'active','waiting','completed','stopped','failed');
exception when duplicate_object then null; end $$;

do $$ begin create type job_status as enum ('pending','running','done','failed','cancelled');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- TAGS  (section 55)
-- -----------------------------------------------------------------------------
create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  label       text not null,
  category    text,
  auto        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists contact_tags (
  contact_id  uuid not null references contacts(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  applied_by  uuid references crm_users(id) on delete set null,
  automatic   boolean not null default false,
  created_at  timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

-- -----------------------------------------------------------------------------
-- RESOURCE LIBRARY  (sections 12-15)
-- -----------------------------------------------------------------------------
create table if not exists resources (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  title         text not null,
  description   text,
  format        text not null check (format in
                ('pdf','guide','checklist','article','video','worksheet','calculator','link','landing_page')),
  url           text,
  storage_path  text,
  interest      crm_interest,
  active        boolean not null default true,
  -- false until the actual file or page exists, so automations never promise a
  -- resource that has not been produced yet
  published     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint resources_has_target check (url is not null or storage_path is not null or not published)
);

create table if not exists resource_tags (
  resource_id uuid not null references resources(id) on delete cascade,
  tag_id      uuid not null references tags(id) on delete cascade,
  primary key (resource_id, tag_id)
);

create table if not exists contact_resources (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references contacts(id) on delete cascade,
  resource_id   uuid not null references resources(id) on delete cascade,
  sent_at       timestamptz,
  first_opened_at timestamptz,
  downloaded_at timestamptz,
  source        text,
  created_at    timestamptz not null default now()
);
create index if not exists contact_resources_contact_idx on contact_resources (contact_id, created_at desc);

-- -----------------------------------------------------------------------------
-- CONSENT  (sections 65-67)
-- Wording is stored verbatim. CASL requires proving what was agreed to.
-- -----------------------------------------------------------------------------
create table if not exists consents (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  kind            consent_kind not null,
  basis           consent_basis not null,
  granted         boolean not null,
  wording         text not null,
  source          text not null,
  evidence_url    text,
  ip_address      inet,
  user_agent      text,
  granted_at      timestamptz,
  expires_at      timestamptz,
  withdrawn_at    timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists consents_contact_idx on consents (contact_id, kind, created_at desc);

-- Current state per contact per kind, so the sender does not replay history.
create or replace view contact_consent_state as
select distinct on (contact_id, kind)
  contact_id, kind, basis, granted, granted_at, expires_at, withdrawn_at
from consents
order by contact_id, kind, created_at desc;

create table if not exists email_suppressions (
  email       citext primary key,
  reason      text not null check (reason in ('unsubscribed','bounced','complaint','manual')),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- EMAIL  (sections 38-40, 53, 70)
-- -----------------------------------------------------------------------------
create table if not exists email_templates (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  name          text not null,
  category      text,
  interest      crm_interest,
  class         email_class not null default 'transactional',
  subject       text not null,
  preheader     text,
  body_markdown text not null,
  active        boolean not null default true,
  updated_by    uuid references crm_users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists emails (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete set null,
  template_id     uuid references email_templates(id) on delete set null,
  automation_run_id uuid,
  to_email        citext not null,
  subject         text not null,
  body_html       text,
  body_text       text,
  class           email_class not null default 'transactional',
  status          email_status not null default 'queued',
  provider        text,
  provider_message_id text,
  requires_review boolean not null default false,
  approved_by     uuid references crm_users(id) on delete set null,
  approved_at     timestamptz,
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists emails_contact_idx on emails (contact_id, created_at desc);
create index if not exists emails_due_idx on emails (scheduled_for) where status = 'queued';
create unique index if not exists emails_provider_uniq
  on emails (provider, provider_message_id) where provider_message_id is not null;

-- Opens are unreliable under modern privacy protection (section 53). They are
-- recorded, but replies and clicks are what scoring leans on.
create table if not exists email_events (
  id            uuid primary key default gen_random_uuid(),
  email_id      uuid not null references emails(id) on delete cascade,
  event         text not null check (event in
                ('delivered','bounced','opened','clicked','replied','unsubscribed','complained')),
  occurred_at   timestamptz not null default now(),
  url           text,
  provider_payload jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists email_events_email_idx on email_events (email_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- LEAD SCORING  (section 32: transparent and admin-editable, never opaque)
-- -----------------------------------------------------------------------------
create table if not exists lead_scoring_rules (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  label       text not null,
  interest    crm_interest,
  points      integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists contact_score_events (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  rule_id     uuid references lead_scoring_rules(id) on delete set null,
  rule_key    text not null,
  points      integer not null,
  reason      text,
  created_at  timestamptz not null default now(),
  unique (contact_id, rule_key)
);
create index if not exists score_events_contact_idx on contact_score_events (contact_id);

-- -----------------------------------------------------------------------------
-- AUTOMATION  (sections 41-42, 64, 69)
-- -----------------------------------------------------------------------------
create table if not exists automations (
  id            uuid primary key default gen_random_uuid(),
  key           text unique not null,
  name          text not null,
  interest      crm_interest,
  trigger_type  text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  active        boolean not null default false,
  -- a contact may not be enrolled twice in the same automation at once
  allow_reentry boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists automation_steps (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  position      integer not null,
  step_type     text not null check (step_type in
                ('condition','delay','email','sms','task','stage_change','tag','notify','webhook','stop')),
  config        jsonb not null default '{}'::jsonb,
  on_true_position  integer,
  on_false_position integer,
  created_at    timestamptz not null default now(),
  unique (automation_id, position)
);

create table if not exists automation_runs (
  id              uuid primary key default gen_random_uuid(),
  automation_id   uuid not null references automations(id) on delete cascade,
  contact_id      uuid not null references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  status          automation_run_status not null default 'active',
  current_position integer not null default 0,
  resume_at       timestamptz,
  stopped_reason  text,
  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists automation_runs_due_idx on automation_runs (resume_at)
  where status in ('active','waiting');
-- section 42: one live run per automation per contact unless re-entry is allowed
create unique index if not exists automation_runs_single_active
  on automation_runs (automation_id, contact_id) where status in ('active','waiting');

create table if not exists automation_run_steps (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references automation_runs(id) on delete cascade,
  step_id           uuid references automation_steps(id) on delete set null,
  position          integer not null,
  result            text,
  detail            text,
  email_id          uuid references emails(id) on delete set null,
  error             text,
  executed_at       timestamptz not null default now(),
  unique (run_id, position)
);

-- -----------------------------------------------------------------------------
-- PERSISTENT JOB QUEUE  (section 69: survives a restart, never a browser timer)
-- -----------------------------------------------------------------------------
create table if not exists job_queue (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  run_after     timestamptz not null default now(),
  status        job_status not null default 'pending',
  attempts      integer not null default 0,
  max_attempts  integer not null default 5,
  locked_at     timestamptz,
  locked_by     text,
  last_error    text,
  -- idempotency: the same logical job may only be queued once
  dedupe_key    text unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists job_queue_due_idx on job_queue (run_after)
  where status = 'pending';

-- -----------------------------------------------------------------------------
-- PARTNERS AND REFERRALS  (sections 44-45)
-- -----------------------------------------------------------------------------
create table if not exists partners (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  company     text,
  category    text not null,
  email       citext,
  phone       text,
  notes       text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists referrals (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  direction       text not null check (direction in ('inbound','outbound')),
  partner_id      uuid references partners(id) on delete set null,
  referrer_contact_id uuid references contacts(id) on delete set null,
  source_label    text,
  note            text,
  referred_at     timestamptz not null default now(),
  created_by      uuid references crm_users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists referrals_contact_idx on referrals (contact_id);

-- -----------------------------------------------------------------------------
-- AUDIT  (sections 64-65)
-- -----------------------------------------------------------------------------
create table if not exists audit_events (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references crm_users(id) on delete set null,
  actor_label   text,
  action        text not null,
  entity_table  text not null,
  entity_id     uuid,
  before        jsonb,
  after         jsonb,
  ip_address    inet,
  created_at    timestamptz not null default now()
);
create index if not exists audit_entity_idx on audit_events (entity_table, entity_id, created_at desc);
