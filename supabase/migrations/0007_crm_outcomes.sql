-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 6: POST-CONSULTATION
-- Sections 22-26, 31, 74, 75.
--
-- One outcome chosen after a call drives the stage move, the sequence, the
-- tasks and the tags. The mapping lives here as data so Kaylin can change what
-- an outcome does without a developer (section 82); the meaning of the mapping
-- lives in _shared/outcomes.ts and is tested in Node.
-- =============================================================================

create table if not exists consultation_outcomes (
  outcome            consult_outcome primary key,
  label              text not null,
  position           integer not null,
  stage_real_estate  text,
  stage_consulting   text,
  enroll             text,
  draft_template     text,
  tags               jsonb not null default '[]'::jsonb,
  tasks              jsonb not null default '[]'::jsonb,
  closes             text check (closes in ('won','lost')),
  requires_reason    boolean not null default false,
  halt_existing      boolean not null default true,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table consultation_outcomes enable row level security;
drop policy if exists crm_staff_read on consultation_outcomes;
create policy crm_staff_read on consultation_outcomes for select using (crm_is_staff());
drop policy if exists crm_staff_update on consultation_outcomes;
create policy crm_staff_update on consultation_outcomes for update using (crm_can_write());

drop trigger if exists set_updated_at on consultation_outcomes;
create trigger set_updated_at before update on consultation_outcomes
for each row execute function crm_set_updated_at();

-- -----------------------------------------------------------------------------
-- RECAP AND FOLLOW-UP TEMPLATES
-- The recap templates are drafted for review, never sent automatically.
-- -----------------------------------------------------------------------------
insert into email_templates (key, name, category, interest, class, subject, preheader, body_markdown) values
('re_post_consult','Post-consultation recap (real estate)','Post Consultation','real_estate','transactional',
 'Following up on our conversation',
 'What we agreed and what happens next.',
 E'Hi {{first_name}},\n\nGood to speak with you today.\n\nFrom our conversation, the priorities are:\n\n{{priorities}}\n\nNext steps:\n\n{{next_steps}}\n\n{{resource_links}}\n\nAnything I have misread here, tell me and I will correct it.\n\n{{cta}}\n\nKaylin'),

('biz_post_consult','Post-consultation recap (consulting)','Post Consultation','business_consulting','transactional',
 'Recap and next steps',
 'What we covered and what I would do first.',
 E'Hi {{first_name}},\n\nThanks for the conversation today.\n\nWhat I heard:\n\n{{priorities}}\n\nWhere I think the leverage is:\n\n{{recommendations}}\n\nNext steps:\n\n{{next_steps}}\n\n{{cta}}\n\nKaylin'),

('re_hot_d3','Hot lead day 3','Hot Lead Follow-Up','real_estate','transactional',
 'Picking up where we left off',
 'The two things worth deciding this week.',
 E'Hi {{first_name}},\n\nFollowing on from our call. The two decisions worth making this week are the ones we talked about, and I can help with either.\n\n{{cta}}\n\nKaylin'),

('re_hot_d7','Hot lead day 7','Hot Lead Follow-Up','real_estate','transactional',
 'Where things stand',
 'A short update and a question.',
 E'Hi {{first_name}},\n\nChecking in a week on. Has anything changed on your side, or shall we keep to the plan we discussed?\n\n{{cta}}\n\nKaylin'),

('re_hot_d14','Hot lead day 14','Hot Lead Follow-Up','real_estate','marketing',
 'Two weeks on',
 'No pressure, just keeping the thread open.',
 E'Hi {{first_name}},\n\nStill here whenever you want to move. If the timing has shifted, tell me and I will stop chasing and keep you on the market updates instead.\n\n{{cta}}\n\nKaylin'),

('proposal_follow_up','Proposal follow-up','Proposal Follow-Up','business_consulting','transactional',
 'The proposal I sent',
 'Any questions before you decide?',
 E'Hi {{first_name}},\n\nChecking whether the proposal raised any questions. Happy to walk through the scope or adjust it if the shape is not quite right.\n\n{{cta}}\n\nKaylin')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- HOT LEAD CADENCE  (section 26: day 1, 3, 7, 14, 30)
-- -----------------------------------------------------------------------------
insert into automations (key, name, interest, trigger_type, trigger_config, active) values
('re_hot_followup','09 Hot Lead Follow-Up','real_estate','outcome_selected','{"outcome":["hot_lead"]}',true),
('proposal_followup','08 Proposal Follow-Up','business_consulting','outcome_selected','{"outcome":["proposal_required"]}',true)
on conflict (key) do nothing;

do $$
declare a uuid;
begin
  select id into a from automations where key = 're_hot_followup';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'task',  '{"title":"Personal follow-up call","due_in":{"days":1}}', null, null),
    (a, 2,'delay', '{"days":3}', null, null),
    (a, 3,'email', '{"template":"re_hot_d3"}', null, null),
    (a, 4,'delay', '{"days":4}', null, null),
    (a, 5,'email', '{"template":"re_hot_d7"}', null, null),
    (a, 6,'delay', '{"days":7}', null, null),
    (a, 7,'email', '{"template":"re_hot_d14"}', null, null),
    (a, 8,'delay', '{"days":16}', null, null),
    (a, 9,'stage_change','{"stage":"long_term_nurture"}', null, null),
    (a,10,'tag',   '{"tag":"nurture"}', null, null),
    (a,11,'stop',  '{}', null, null)
  on conflict (automation_id, position) do nothing;

  select id into a from automations where key = 'proposal_followup';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'task',  '{"title":"Send the proposal","due_in":{"days":2}}', null, null),
    (a, 2,'delay', '{"days":3}', null, null),
    (a, 3,'email', '{"template":"proposal_follow_up"}', null, null),
    (a, 4,'delay', '{"days":4}', null, null),
    (a, 5,'task',  '{"title":"Call about the proposal","due_in":{"hours":4}}', null, null),
    (a, 6,'stop',  '{}', null, null)
  on conflict (automation_id, position) do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- OUTCOME MAPPING  (section 22, all twelve)
-- -----------------------------------------------------------------------------
insert into consultation_outcomes
  (outcome, label, position, stage_real_estate, stage_consulting, enroll, draft_template, tags, tasks, closes, requires_reason) values
('hot_lead','Hot Lead',1,'consultation_complete','discovery_complete','re_hot_followup','re_post_consult',
 '["hot"]','[{"title":"Personal follow-up within 24 hours","due_in":{"days":1}}]',null,false),

('follow_up','Follow Up',2,'consultation_complete','discovery_complete',null,'re_post_consult',
 '[]','[{"title":"Follow up","due_in":{"days":3}}]',null,false),

('proposal_required','Proposal Required',3,null,'proposal_preparation','proposal_followup','biz_post_consult',
 '[]','[{"title":"Prepare and send the proposal","due_in":{"days":2}}]',null,false),

('buyer_representation','Buyer Representation',4,'qualified_buyer',null,null,'re_post_consult',
 '["buyer"]','[{"title":"Confirm financing and pre-approval","due_in":{"days":2}},{"title":"Send representation agreement","due_in":{"days":1}}]',null,false),

('listing_opportunity','Listing Opportunity',5,'listing_preparation',null,null,'re_post_consult',
 '["seller"]','[{"title":"Prepare comparative market analysis","due_in":{"days":2}},{"title":"Book the listing appointment","due_in":{"days":3}}]',null,false),

('referral_needed','Needs Mortgage or Partner Referral',6,'connected','contacted',null,null,
 '[]','[{"title":"Make the introduction and log the referral","due_in":{"days":1}}]',null,false),

('consulting_opportunity','Business Consulting Opportunity',7,null,'qualified_opportunity',null,'biz_post_consult',
 '["business"]','[{"title":"Draft recommendations","due_in":{"days":3}}]',null,false),

('long_term_nurture','Long-Term Nurture',8,'long_term_nurture','retainer_nurture',null,null,
 '["nurture"]','[]',null,false),

('not_qualified','Not Qualified',9,'lost','lost',null,null,
 '[]','[]','lost',true),

('not_ready','Not Ready',10,'long_term_nurture','retainer_nurture',null,null,
 '["nurture"]','[{"title":"Revisit in 90 days","due_in":{"days":90}}]',null,false),

('closed_lost','Closed / Lost',11,'lost','lost',null,null,
 '[]','[]','lost',true),

('client','Client',12,'active_buyer','active_client',null,null,
 '["past_client"]','[{"title":"Start client onboarding","due_in":{"days":1}}]',null,false)
on conflict (outcome) do nothing;

-- -----------------------------------------------------------------------------
-- NEEDS ATTENTION  (section 75)
-- A view rather than a flag column: nothing has to remember to set it, and it
-- cannot drift out of date.
-- -----------------------------------------------------------------------------
create or replace view crm_needs_attention as
with last_activity as (
  select contact_id, max(occurred_at) as at
    from activity_events group by contact_id
),
open_tasks as (
  select contact_id, count(*) as n from tasks where status = 'open' group by contact_id
),
last_appt as (
  select contact_id, max(completed_at) as completed_at
    from appointments where status = 'completed' group by contact_id
)
select
  c.id                             as contact_id,
  c.first_name, c.last_name, c.email,
  c.temperature, c.lifecycle, c.lead_score, c.owner_id,
  o.id                             as opportunity_id,
  ps.key                           as stage_key,
  la.at                            as last_activity_at,
  round(extract(epoch from (now() - coalesce(la.at, c.created_at))) / 3600)::int
                                   as hours_since_activity,
  coalesce(ot.n, 0)                as open_tasks,
  case
    when c.temperature = 'hot'
     and coalesce(la.at, c.created_at) < now() - interval '48 hours'
      then 'Hot lead with no activity for 48 hours'
    when ap.completed_at is not null
     and coalesce(ot.n, 0) = 0 and c.next_action_at is null
      then 'Consultation completed with no follow-up'
    when ps.key = 'proposal_sent' and coalesce(ot.n, 0) = 0
      then 'Proposal sent with no next task'
    when o.id is not null and ps.key <> 'new_inquiry'
     and coalesce(ot.n, 0) = 0 and c.next_action_at is null
      then 'Qualified opportunity with no next action'
    when c.temperature = 'warm'
     and coalesce(la.at, c.created_at) < now() - interval '14 days'
      then 'Warm lead untouched for two weeks'
  end                              as reason
from contacts c
left join opportunities   o  on o.contact_id = c.id and o.is_open
left join pipeline_stages ps on ps.id = o.stage_id
left join last_activity   la on la.contact_id = c.id
left join open_tasks      ot on ot.contact_id = c.id
left join last_appt       ap on ap.contact_id = c.id
where c.lifecycle not in ('client','lost')
  and c.do_not_contact = false;

-- Section 74: closing an opportunity as lost without a reason is refused at
-- the database, not merely discouraged in the interface.
create or replace function crm_guard_lost_reason() returns trigger
language plpgsql as $$ begin
  if new.is_open = false and old.is_open = true then
    if exists (select 1 from pipeline_stages s
                where s.id = new.stage_id and s.is_lost)
       and new.lost_reason is null then
      raise exception 'a lost opportunity requires lost_reason (section 74)';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_lost_reason on opportunities;
create trigger guard_lost_reason before update on opportunities
for each row execute function crm_guard_lost_reason();
