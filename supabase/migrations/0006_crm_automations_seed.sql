-- =============================================================================
-- KAYLIN SMITH CRM - PHASE 4: AUTOMATION SEED
--
-- Only the flows whose trigger already exists are seeded. The inquiry ingest
-- from phase 2 fires all four of these today. The remaining workflows in
-- section 83 depend on booking (phase 5) and post-consultation (phase 6)
-- events; seeding them now would create automations that can never fire, which
-- is the "fake functionality" section 81 rules out. They go in with their
-- triggers.
--
-- Email copy is first person to match the About page. The branded HTML wrapper
-- is phase 3; body_markdown is the content, and the sender renders it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEMPLATES
-- -----------------------------------------------------------------------------
insert into email_templates (key, name, category, interest, class, subject, preheader, body_markdown) values
('re_buyer_welcome','Buyer inquiry acknowledgement','New Buyer Inquiry','real_estate','transactional',
 'About your move in {{location}}',
 'A few things worth knowing before we speak.',
 E'Hi {{first_name}},\n\nThank you for reaching out. I have your enquiry about buying in {{location}}, and I read every one of these myself.\n\nBefore we speak, these are the things that usually matter most at this stage:\n\n{{resource_links}}\n\nWhen you are ready, book a time that suits you and we will work through your goal, your timeline and what the market actually means for your situation.\n\n{{cta}}\n\nKaylin'),

('re_buyer_resource','Buyer day 2 resource','Buyer Follow-Up','real_estate','marketing',
 'A few things to consider before we chat',
 'Financing, budget and the order things happen in.',
 E'Hi {{first_name}},\n\nMost of the useful work happens before anyone books a showing. Three things worth settling early:\n\nWhat you can comfortably carry, which is not the same as what you can be approved for. Where financing stands, because it changes what you can act on. And which of your requirements are fixed rather than assumed.\n\n{{resource_links}}\n\nIf it would help to talk any of this through, the offer stands.\n\n{{cta}}\n\nKaylin'),

('re_buyer_checkin','Buyer day 5 check-in','Buyer Follow-Up','real_estate','marketing',
 'Still thinking about {{location}}?',
 'No pressure either way.',
 E'Hi {{first_name}},\n\nI wanted to check in. Buying is a significant decision and the timing has to be right for you, not for anyone else.\n\nIf you are still weighing it up, I am happy to answer questions with no expectation attached. And if the timing has changed, that is a perfectly good answer too.\n\n{{cta}}\n\nKaylin'),

('re_seller_welcome','Seller inquiry acknowledgement','New Seller Inquiry','real_estate','transactional',
 'About selling {{location}}',
 'Pricing, preparation and the order to do things in.',
 E'Hi {{first_name}},\n\nThank you for reaching out about selling. I have the details you sent through.\n\nSelling well is a matter of pricing, preparation, positioning and timing, and those decisions are worth making in the right order. Here is what is useful to look at first:\n\n{{resource_links}}\n\nWhen you are ready I will put together a view of what your property should do in this market.\n\n{{cta}}\n\nKaylin'),

('re_seller_checkin','Seller day 5 check-in','Seller Follow-Up','real_estate','marketing',
 'Still considering a move?',
 'Happy to give you a read on the market either way.',
 E'Hi {{first_name}},\n\nChecking in on the property you mentioned. Whether you list this season or next year, knowing what it would realistically achieve now is useful information to hold.\n\nIf you would like that read, it takes one conversation and commits you to nothing.\n\n{{cta}}\n\nKaylin'),

('re_investor_welcome','Investor inquiry acknowledgement','Investor Inquiry','real_estate','transactional',
 'About the numbers',
 'How I evaluate an investment property.',
 E'Hi {{first_name}},\n\nThank you for reaching out. I invest myself, so these conversations tend to start with the numbers rather than the finishes.\n\nWhat I would want to understand first is what the property has to return for it to be worth doing, what you are assuming about carrying costs, and how it fits alongside anything you already hold.\n\n{{resource_links}}\n\n{{cta}}\n\nKaylin'),

('biz_welcome','Consulting inquiry acknowledgement','New Consulting Inquiry','business_consulting','transactional',
 'About {{challenge}}',
 'A place to start before we speak.',
 E'Hi {{first_name}},\n\nThanks for reaching out. I have your enquiry and I can see {{challenge}} is where the pressure is right now.\n\nBefore we meet it helps to get specific about what "solved" would actually look like, and what you have already tried. That usually shortens the first conversation considerably.\n\n{{resource_links}}\n\n{{cta}}\n\nKaylin'),

('biz_framework','Consulting day 2 framework','Business Follow-Up','business_consulting','marketing',
 'A way to frame it',
 'One question that usually clarifies the problem.',
 E'Hi {{first_name}},\n\nA question I come back to with most owners: if this problem were solved in ninety days, what would be measurably different?\n\nThe answer usually reveals whether the issue is strategy, capacity or process, and those need very different responses.\n\n{{resource_links}}\n\n{{cta}}\n\nKaylin'),

('biz_invitation','Consulting day 10 invitation','Business Follow-Up','business_consulting','marketing',
 'Here when the timing is right',
 'No follow-up sequence after this one.',
 E'Hi {{first_name}},\n\nThis is the last you will hear from me automatically. If the timing is not right, that is fine and common.\n\nWhen it is, the door is open and the first conversation costs nothing.\n\n{{cta}}\n\nKaylin')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- AUTOMATIONS
-- -----------------------------------------------------------------------------
insert into automations (key, name, interest, trigger_type, trigger_config, active) values
('re_buyer_inquiry','01 New Buyer Inquiry','real_estate','inquiry_created','{"path":["buy"]}',true),
('re_seller_inquiry','02 New Seller Inquiry','real_estate','inquiry_created','{"path":["sell"]}',true),
('re_investor_inquiry','03 Investor Inquiry','real_estate','inquiry_created','{"path":["invest"]}',true),
('biz_consulting_inquiry','01 New Consulting Inquiry','business_consulting','inquiry_created','{"path":["consulting"]}',true)
on conflict (key) do nothing;

-- Section 27 cadence: instant, 2 days, 5 days, 10 days, then nurture. Every
-- sequence is stopped by a reply or a booking before any later step runs.
do $$
declare a uuid;
begin
  select id into a from automations where key = 're_buyer_inquiry';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'email',     '{"template":"re_buyer_welcome"}', null, null),
    (a, 2,'condition', '{"field":"re.timeline","op":"in","value":["immediately","within_30_days","1_3_months"]}', 3, 4),
    (a, 3,'task',      '{"title":"Call buyer within 1 business hour","due_in":{"hours":1}}', null, null),
    (a, 4,'delay',     '{"days":2}', null, null),
    (a, 5,'email',     '{"template":"re_buyer_resource"}', null, null),
    (a, 6,'delay',     '{"days":3}', null, null),
    (a, 7,'email',     '{"template":"re_buyer_checkin"}', null, null),
    (a, 8,'delay',     '{"days":5}', null, null),
    (a, 9,'stage_change','{"stage":"long_term_nurture"}', null, null),
    (a,10,'tag',       '{"tag":"nurture"}', null, null),
    (a,11,'stop',      '{}', null, null)
  on conflict (automation_id, position) do nothing;

  select id into a from automations where key = 're_seller_inquiry';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'email',     '{"template":"re_seller_welcome"}', null, null),
    (a, 2,'condition', '{"field":"re.seller_address","op":"exists"}', 3, 4),
    (a, 3,'notify',    '{"subject":"Seller with an address supplied","body":"Prepare a comparative market analysis."}', null, null),
    (a, 4,'task',      '{"title":"Prepare CMA and call seller","due_in":{"hours":4}}', null, null),
    (a, 5,'delay',     '{"days":5}', null, null),
    (a, 6,'email',     '{"template":"re_seller_checkin"}', null, null),
    (a, 7,'delay',     '{"days":5}', null, null),
    (a, 8,'stage_change','{"stage":"long_term_nurture"}', null, null),
    (a, 9,'stop',      '{}', null, null)
  on conflict (automation_id, position) do nothing;

  select id into a from automations where key = 're_investor_inquiry';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'email',     '{"template":"re_investor_welcome"}', null, null),
    (a, 2,'delay',     '{"days":2}', null, null),
    (a, 3,'email',     '{"template":"re_buyer_resource"}', null, null),
    (a, 4,'delay',     '{"days":8}', null, null),
    (a, 5,'stage_change','{"stage":"long_term_nurture"}', null, null),
    (a, 6,'stop',      '{}', null, null)
  on conflict (automation_id, position) do nothing;

  select id into a from automations where key = 'biz_consulting_inquiry';
  insert into automation_steps (automation_id, position, step_type, config, on_true_position, on_false_position) values
    (a, 1,'email',     '{"template":"biz_welcome"}', null, null),
    (a, 2,'condition', '{"field":"biz.urgency","op":"eq","value":"now"}', 3, 4),
    (a, 3,'notify',    '{"subject":"Consulting lead needs help now","body":"Same-day reply recommended."}', null, null),
    (a, 4,'delay',     '{"days":2}', null, null),
    (a, 5,'email',     '{"template":"biz_framework"}', null, null),
    (a, 6,'delay',     '{"days":8}', null, null),
    (a, 7,'email',     '{"template":"biz_invitation"}', null, null),
    (a, 8,'delay',     '{"days":5}', null, null),
    (a, 9,'stage_change','{"stage":"retainer_nurture"}', null, null),
    (a,10,'stop',      '{}', null, null)
  on conflict (automation_id, position) do nothing;
end $$;

-- -----------------------------------------------------------------------------
-- ENROLMENT
-- The partial unique index on automation_runs already prevents a second live
-- run for the same contact and automation; this just makes that a no-op rather
-- than an error the caller has to handle.
-- -----------------------------------------------------------------------------
create or replace function crm_enroll(
  p_contact uuid, p_automation_key text, p_opportunity uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare a_id uuid; r_id uuid; is_active boolean;
begin
  select id, active into a_id, is_active from automations where key = p_automation_key;
  if a_id is null or not is_active then return null; end if;

  select id into r_id from automation_runs
   where automation_id = a_id and contact_id = p_contact
     and status in ('active','waiting');
  if r_id is not null then return r_id; end if;

  insert into automation_runs (automation_id, contact_id, opportunity_id, status, current_position)
  values (a_id, p_contact, p_opportunity, 'active', 1)
  returning id into r_id;

  insert into activity_events (contact_id, opportunity_id, kind, summary, ref_table, ref_id)
  values (p_contact, p_opportunity, 'automation_enrolled',
          'Enrolled in ' || p_automation_key, 'automation_runs', r_id);
  return r_id;
end $$;

-- Pausing is a recorded event, so the reason a sequence stopped stays visible
-- on the timeline rather than being a flag someone flipped (section 64).
create or replace function crm_pause_automations(p_contact uuid, p_reason text default 'manual')
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update automation_runs set status = 'stopped', stopped_reason = p_reason,
         resume_at = null, completed_at = now()
   where contact_id = p_contact and status in ('active','waiting');
  get diagnostics n = row_count;
  insert into activity_events (contact_id, kind, summary)
  values (p_contact, 'automation_paused', 'Automations paused: ' || p_reason);
  return n;
end $$;
