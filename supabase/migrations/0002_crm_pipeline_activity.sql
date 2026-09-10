-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 1: PIPELINES, OPPORTUNITIES, ACTIVITY
-- Sections 34-37, 30-31, 21-25.
-- =============================================================================

do $$ begin create type task_status as enum ('open','done','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin create type call_outcome as enum (
  'scheduled','attempted','connected','voicemail','no_answer','follow_up_required');
exception when duplicate_object then null; end $$;

do $$ begin create type appointment_kind as enum ('real_estate_consult','business_consult','other');
exception when duplicate_object then null; end $$;

do $$ begin create type appointment_status as enum (
  'booked','rescheduled','cancelled','completed','no_show');
exception when duplicate_object then null; end $$;

do $$ begin create type consult_outcome as enum (
  'hot_lead','follow_up','proposal_required','buyer_representation','listing_opportunity',
  'referral_needed','consulting_opportunity','long_term_nurture','not_qualified',
  'not_ready','closed_lost','client');
exception when duplicate_object then null; end $$;

do $$ begin create type lost_reason as enum (
  'timing','budget','no_response','chose_another_realtor','chose_another_consultant',
  'not_qualified','not_ready','other');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- PIPELINES  (section 34: two of them, stages editable by the admin)
-- -----------------------------------------------------------------------------
create table if not exists pipelines (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,
  name        text not null,
  interest    crm_interest not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists pipeline_stages (
  id            uuid primary key default gen_random_uuid(),
  pipeline_id   uuid not null references pipelines(id) on delete cascade,
  key           text not null,
  name          text not null,
  position      integer not null,
  is_won        boolean not null default false,
  is_lost       boolean not null default false,
  probability   integer not null default 0 check (probability between 0 and 100),
  created_at    timestamptz not null default now(),
  unique (pipeline_id, key),
  unique (pipeline_id, position) deferrable initially deferred
);

-- -----------------------------------------------------------------------------
-- OPPORTUNITIES
-- A contact in both funnels has two opportunities, not two contact records.
-- -----------------------------------------------------------------------------
create table if not exists opportunities (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contacts(id) on delete cascade,
  pipeline_id       uuid not null references pipelines(id),
  stage_id          uuid not null references pipeline_stages(id),
  interest          crm_interest not null,
  title             text,
  value_cents       bigint,
  currency          text not null default 'CAD',
  probability       integer check (probability between 0 and 100),
  expected_close_on date,
  owner_id          uuid references crm_users(id) on delete set null,
  is_open           boolean not null default true,
  lost_reason       lost_reason,
  lost_note         text,
  closed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists opportunities_contact_idx on opportunities (contact_id);
create index if not exists opportunities_stage_idx   on opportunities (stage_id) where is_open;
create index if not exists opportunities_owner_idx   on opportunities (owner_id) where is_open;

create table if not exists opportunity_stage_history (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  from_stage_id   uuid references pipeline_stages(id),
  to_stage_id     uuid not null references pipeline_stages(id),
  changed_by      uuid references crm_users(id) on delete set null,
  changed_at      timestamptz not null default now(),
  note            text
);
create index if not exists opp_stage_history_opp_idx on opportunity_stage_history (opportunity_id, changed_at desc);

-- -----------------------------------------------------------------------------
-- APPOINTMENTS  (sections 16-20)
-- -----------------------------------------------------------------------------
create table if not exists appointment_types (
  id                uuid primary key default gen_random_uuid(),
  key               text unique not null,
  name              text not null,
  kind              appointment_kind not null,
  duration_minutes  integer not null default 30,
  description       text,
  what_we_cover     text,
  best_for          text,
  how_to_prepare    text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists appointments (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references contacts(id) on delete cascade,
  opportunity_id      uuid references opportunities(id) on delete set null,
  type_id             uuid references appointment_types(id),
  kind                appointment_kind not null,
  status              appointment_status not null default 'booked',
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  timezone            text not null default 'America/Toronto',
  location            text,
  meeting_url         text,
  -- set by the calendar adapter once the provider confirms; null until then
  provider            text,
  provider_event_id   text,
  provider_synced_at  timestamptz,
  intake_snapshot     jsonb,
  outcome             consult_outcome,
  outcome_note        text,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at)
);
create index if not exists appointments_contact_idx on appointments (contact_id, starts_at desc);
create index if not exists appointments_upcoming_idx on appointments (starts_at)
  where status = 'booked';
create unique index if not exists appointments_provider_uniq
  on appointments (provider, provider_event_id) where provider_event_id is not null;

-- -----------------------------------------------------------------------------
-- CALLS, NOTES, TASKS  (sections 30-31)
-- -----------------------------------------------------------------------------
create table if not exists calls (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  user_id         uuid references crm_users(id) on delete set null,
  direction       text not null default 'outbound' check (direction in ('inbound','outbound')),
  outcome         call_outcome not null,
  occurred_at     timestamptz not null default now(),
  duration_seconds integer,
  notes           text,
  next_action     text,
  next_action_at  timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists calls_contact_idx on calls (contact_id, occurred_at desc);

create table if not exists notes (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  author_id       uuid references crm_users(id) on delete set null,
  body            text not null,
  pinned          boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists notes_contact_idx on notes (contact_id, created_at desc);

create table if not exists tasks (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  assignee_id     uuid references crm_users(id) on delete set null,
  title           text not null,
  detail          text,
  due_at          timestamptz,
  priority        integer not null default 2 check (priority between 1 and 3),
  status          task_status not null default 'open',
  created_by_automation uuid,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tasks_open_due_idx on tasks (due_at) where status = 'open';
create index if not exists tasks_contact_idx  on tasks (contact_id, status);

-- -----------------------------------------------------------------------------
-- UNIFIED TIMELINE  (section 37)
-- One row per thing that happened, pointing at the detail row that describes it.
-- The contact record reads this single table instead of union-ing six others.
-- -----------------------------------------------------------------------------
create table if not exists activity_events (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  kind            text not null,
  summary         text not null,
  occurred_at     timestamptz not null default now(),
  actor_user_id   uuid references crm_users(id) on delete set null,
  actor_label     text,
  ref_table       text,
  ref_id          uuid,
  meta            jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists activity_contact_idx on activity_events (contact_id, occurred_at desc);
create index if not exists activity_kind_idx    on activity_events (kind, occurred_at desc);

create table if not exists documents (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid references contacts(id) on delete cascade,
  opportunity_id  uuid references opportunities(id) on delete set null,
  title           text not null,
  storage_path    text not null,
  mime_type       text,
  bytes           bigint,
  uploaded_by     uuid references crm_users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists documents_contact_idx on documents (contact_id, created_at desc);
