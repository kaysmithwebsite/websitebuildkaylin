-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 1: SECURITY, TRIGGERS, SEED
--
-- Security posture: the anon key that ships in the public website may INSERT
-- into the existing capture tables and nothing else. It cannot read, write or
-- even see any table in this CRM. Every CRM policy requires an authenticated
-- staff row in crm_users. Section 65.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at
-- -----------------------------------------------------------------------------
create or replace function crm_set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'crm_users','organizations','contacts','real_estate_profiles','business_profiles',
    'pipelines','opportunities','appointment_types','appointments','notes','tasks',
    'resources','email_templates','emails','lead_scoring_rules','automations',
    'automation_runs','job_queue','partners']
  loop
    execute format(
      'drop trigger if exists set_updated_at on %I;
       create trigger set_updated_at before update on %I
       for each row execute function crm_set_updated_at();', t, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'crm_users','organizations','contacts','contact_interests','real_estate_profiles',
    'business_profiles','pipelines','pipeline_stages','opportunities',
    'opportunity_stage_history','appointment_types','appointments','calls','notes','tasks',
    'activity_events','documents','tags','contact_tags','resources','resource_tags',
    'contact_resources','consents','email_suppressions','email_templates','emails',
    'email_events','lead_scoring_rules','contact_score_events','automations',
    'automation_steps','automation_runs','automation_run_steps','job_queue','partners',
    'referrals','audit_events']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists crm_staff_read on %I;', t);
    execute format('create policy crm_staff_read on %I for select using (crm_is_staff());', t);
    execute format('drop policy if exists crm_staff_write on %I;', t);
    execute format('create policy crm_staff_write on %I for insert with check (crm_can_write());', t);
    execute format('drop policy if exists crm_staff_update on %I;', t);
    execute format('create policy crm_staff_update on %I for update using (crm_can_write());', t);
  end loop;
end $$;

-- NOTE: crm_users is subject to the same insert policy, so the FIRST owner must
-- be created with the service role key (or straight from the SQL editor), not
-- through the API. After that, owners can add colleagues normally.

-- Deletion is restricted to owners. Everything else is soft state.
do $$
declare t text;
begin
  foreach t in array array['contacts','opportunities','notes','tasks','documents','partners']
  loop
    execute format('drop policy if exists crm_owner_delete on %I;', t);
    execute format($f$create policy crm_owner_delete on %I for delete using (
      exists (select 1 from crm_users u where u.id = auth.uid() and u.active and u.role = 'owner'));$f$, t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- TIMELINE FEED
-- Detail rows write their own timeline entry, so nothing can happen to a
-- contact without appearing on the record. Section 37.
-- -----------------------------------------------------------------------------
create or replace function crm_log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_summary text;
  v_kind    text;
  v_opp     uuid;
begin
  v_kind := tg_argv[0];
  v_opp  := case when to_jsonb(new) ? 'opportunity_id'
                 then (to_jsonb(new) ->> 'opportunity_id')::uuid else null end;
  -- Read through to_jsonb rather than new.<field>: this one function is bound
  -- to five different tables, and a direct field reference would resolve at
  -- runtime against a row that may not have that column.
  v_summary := case v_kind
    when 'call'        then 'Call: '         || coalesce(to_jsonb(new) ->> 'outcome', 'logged')
    when 'note'        then 'Note added'
    when 'task'        then 'Task: '         || coalesce(to_jsonb(new) ->> 'title', 'created')
    when 'appointment' then 'Consultation '  || coalesce(to_jsonb(new) ->> 'status', 'booked')
    when 'email'       then 'Email: '        || coalesce(to_jsonb(new) ->> 'subject', 'queued')
    else v_kind end;
  insert into activity_events (contact_id, opportunity_id, kind, summary, ref_table, ref_id, occurred_at)
  values (new.contact_id, v_opp, v_kind, v_summary, tg_table_name, new.id, now());
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('calls','call'), ('notes','note'), ('tasks','task'),
      ('appointments','appointment'), ('emails','email')) as t(tbl, kind)
  loop
    execute format(
      'drop trigger if exists log_activity on %I;
       create trigger log_activity after insert on %I
       for each row when (new.contact_id is not null)
       execute function crm_log_activity(%L);', r.tbl, r.tbl, r.kind);
  end loop;
end $$;

-- Stage moves are history, not an overwritten column.
create or replace function crm_log_stage_change() returns trigger
language plpgsql as $$ begin
  if new.stage_id is distinct from old.stage_id then
    insert into opportunity_stage_history (opportunity_id, from_stage_id, to_stage_id)
    values (new.id, old.stage_id, new.stage_id);
  end if;
  return new;
end $$;
drop trigger if exists log_stage_change on opportunities;
create trigger log_stage_change after update on opportunities
for each row execute function crm_log_stage_change();

-- Lead score is the sum of its recorded events, so it is always explainable.
create or replace function crm_recalc_lead_score() returns trigger
language plpgsql as $$ begin
  update contacts set lead_score = coalesce(
    (select sum(points) from contact_score_events where contact_id = new.contact_id), 0)
  where id = new.contact_id;
  return new;
end $$;
drop trigger if exists recalc_lead_score on contact_score_events;
create trigger recalc_lead_score after insert or update or delete on contact_score_events
for each row execute function crm_recalc_lead_score();

-- -----------------------------------------------------------------------------
-- SEED: PIPELINES  (section 34, verbatim stage lists)
-- -----------------------------------------------------------------------------
insert into pipelines (key, name, interest) values
  ('real_estate','Real Estate','real_estate'),
  ('consulting','Business Consulting','business_consulting')
on conflict (key) do nothing;

insert into pipeline_stages (pipeline_id, key, name, position, is_won, is_lost, probability)
select p.id, s.key, s.name, s.pos, s.won, s.lost, s.prob
from pipelines p, (values
  ('new_inquiry','New Inquiry',1,false,false,5),
  ('attempted_contact','Attempted Contact',2,false,false,10),
  ('connected','Connected',3,false,false,20),
  ('consultation_booked','Consultation Booked',4,false,false,35),
  ('consultation_complete','Consultation Complete',5,false,false,45),
  ('qualified_buyer','Qualified Buyer',6,false,false,55),
  ('qualified_seller','Qualified Seller',7,false,false,55),
  ('active_buyer','Active Buyer',8,false,false,65),
  ('listing_preparation','Listing Preparation',9,false,false,70),
  ('listed','Listed',10,false,false,80),
  ('conditional','Conditional',11,false,false,90),
  ('closed','Closed',12,true,false,100),
  ('long_term_nurture','Long-Term Nurture',13,false,false,5),
  ('lost','Lost',14,false,true,0)
) as s(key,name,pos,won,lost,prob)
where p.key = 'real_estate'
on conflict (pipeline_id, key) do nothing;

insert into pipeline_stages (pipeline_id, key, name, position, is_won, is_lost, probability)
select p.id, s.key, s.name, s.pos, s.won, s.lost, s.prob
from pipelines p, (values
  ('new_inquiry','New Inquiry',1,false,false,5),
  ('contacted','Contacted',2,false,false,12),
  ('consultation_booked','Consultation Booked',3,false,false,30),
  ('discovery_complete','Discovery Complete',4,false,false,40),
  ('qualified_opportunity','Qualified Opportunity',5,false,false,50),
  ('proposal_preparation','Proposal Preparation',6,false,false,60),
  ('proposal_sent','Proposal Sent',7,false,false,70),
  ('negotiation','Negotiation',8,false,false,80),
  ('engaged','Engaged',9,false,false,90),
  ('active_client','Active Client',10,true,false,100),
  ('project_complete','Project Complete',11,true,false,100),
  ('retainer_nurture','Retainer / Nurture',12,false,false,20),
  ('lost','Lost',13,false,true,0)
) as s(key,name,pos,won,lost,prob)
where p.key = 'consulting'
on conflict (pipeline_id, key) do nothing;

-- -----------------------------------------------------------------------------
-- SEED: SCORING RULES  (section 32, editable afterwards in the admin)
-- -----------------------------------------------------------------------------
insert into lead_scoring_rules (key, label, interest, points) values
  ('re_consultation_booked','Consultation booked','real_estate',20),
  ('re_timeline_under_90','Timeline under 90 days','real_estate',20),
  ('re_financing_ready','Financing prepared','real_estate',15),
  ('re_budget_specified','Budget specified','real_estate',10),
  ('re_seller_address','Seller address supplied','real_estate',10),
  ('re_repeat_engagement','Repeat website engagement','real_estate',10),
  ('re_resource_downloaded','Resource downloaded','real_estate',5),
  ('biz_consultation_booked','Consultation booked','business_consulting',20),
  ('biz_immediate_problem','Immediate problem','business_consulting',15),
  ('biz_established','Established business','business_consulting',15),
  ('biz_revenue_supplied','Revenue supplied','business_consulting',10),
  ('biz_clear_project','Clear project need','business_consulting',10),
  ('biz_repeat_engagement','Repeat engagement','business_consulting',10),
  ('biz_resource_downloaded','Resource downloaded','business_consulting',5)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- SEED: TAGS  (section 55)
-- -----------------------------------------------------------------------------
insert into tags (key, label, category, auto) values
  ('real_estate','Real Estate','interest',true),
  ('buyer','Buyer','real_estate',true),
  ('seller','Seller','real_estate',true),
  ('investor','Investor','real_estate',true),
  ('first_time_buyer','First-Time Buyer','real_estate',true),
  ('pre_construction','Pre-Construction','real_estate',true),
  ('relocation','Relocation','real_estate',true),
  ('durham','Durham','location',false),
  ('toronto','Toronto','location',false),
  ('gta','GTA','location',false),
  ('business','Business','interest',true),
  ('startup','Startup','business',true),
  ('strategy','Strategy','business',true),
  ('growth','Growth','business',true),
  ('operations','Operations','business',true),
  ('marketing','Marketing','business',true),
  ('established_business','Established Business','business',true),
  ('founder','Founder','business',false),
  ('hot','Hot','engagement',true),
  ('warm','Warm','engagement',true),
  ('nurture','Nurture','engagement',true),
  ('referral','Referral','engagement',false),
  ('past_client','Past Client','engagement',false),
  ('vip','VIP','engagement',false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- SEED: CONSULTATION TYPES  (section 16)
-- -----------------------------------------------------------------------------
insert into appointment_types (key, name, kind, duration_minutes, what_we_cover, best_for, how_to_prepare) values
  ('real_estate_strategy','Real Estate Strategy Call','real_estate_consult',30,
   'Your goals, your timeline, the area you are looking at, and where financing stands. We finish with a clear next step.',
   'Anyone buying, selling or investing in Markham, Toronto or the wider GTA, including people still deciding whether to move at all.',
   'Bring your timeline and any constraints that are fixed rather than assumed. Nothing else is required.'),
  ('business_strategy','Business Strategy Consultation','business_consult',45,
   'Where the business is now, the problem you most want solved, and whether this is work Kaylin is the right person for.',
   'Founders and owners at any stage, from an idea through to an established business that has stalled.',
   'Have a rough sense of your revenue range and the one problem you would most like off your desk.')
on conflict (key) do nothing;
