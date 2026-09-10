/**
 * APPLY OUTCOME  —  CRM phase 6 (sections 22, 23, 24, 74)
 *
 * Kaylin picks one outcome after a consultation. This executes everything that
 * follows: the stage move, the sequence, the tasks, the tags and the recap
 * draft. One request, one click in the interface.
 *
 * The decision of what an outcome means lives in _shared/outcomes.ts and is
 * tested in Node. This file only carries the plan out.
 *
 * A recap is queued with requires_review = true and is never sent by this
 * function. Section 24 asks for human review before consequential messages,
 * and section 61 forbids inventing what was discussed on a call.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { planOutcome, type Outcome, type OutcomeConfig } from "../_shared/outcomes.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set" }),
      { status: 503, headers: { "content-type": "application/json" } });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const { appointment_id, contact_id, outcome, lost_reason, call_notes, user_id } = body ?? {};
  if (!contact_id || !outcome) {
    return new Response(JSON.stringify({ error: "contact_id and outcome are required" }),
      { status: 400, headers: { "content-type": "application/json" } });
  }

  const [{ data: cfg }, { data: opp }, { data: contact }] = await Promise.all([
    db.from("consultation_outcomes").select("*").eq("outcome", outcome).maybeSingle(),
    db.from("opportunities").select("id,interest").eq("contact_id", contact_id)
      .eq("is_open", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("contacts").select("id,email").eq("id", contact_id).maybeSingle(),
  ]);
  if (!contact) {
    return new Response(JSON.stringify({ error: "contact not found" }),
      { status: 404, headers: { "content-type": "application/json" } });
  }

  const plan = planOutcome(outcome as Outcome, (cfg ?? undefined) as OutcomeConfig | undefined, {
    interest: (opp?.interest ?? null) as any,
    hasOpportunity: !!opp,
    lostReason: lost_reason ?? null,
    callNotes: call_notes ?? null,
  });

  // Section 74. The refusal is returned, not worked around.
  if (plan.errors.length) {
    return new Response(JSON.stringify({ ok: false, errors: plan.errors }),
      { status: 422, headers: { "content-type": "application/json" } });
  }

  const done: string[] = [];

  if (call_notes && String(call_notes).trim()) {
    await db.from("notes").insert({
      contact_id, opportunity_id: opp?.id ?? null, author_id: user_id ?? null,
      body: `Call notes\n\n${call_notes}`,
    });
    done.push("notes_saved");
  }

  // Stop whatever sequence they were in before starting a new one, so a
  // nurture drip cannot keep running underneath a live deal (section 42).
  if (plan.haltExisting) {
    await db.rpc("crm_pause_automations", {
      p_contact: contact_id, p_reason: `outcome:${outcome}`,
    });
    done.push("existing_sequences_stopped");
  }

  if (plan.stage && opp) {
    const { data: o } = await db.from("opportunities")
      .select("pipeline_id").eq("id", opp.id).single();
    const { data: stage } = await db.from("pipeline_stages")
      .select("id,probability,is_lost,is_won").eq("pipeline_id", o!.pipeline_id)
      .eq("key", plan.stage).maybeSingle();
    if (stage) {
      const patch: Record<string, unknown> = {
        stage_id: stage.id, probability: stage.probability,
      };
      if (plan.closes) {
        patch.is_open = false;
        patch.closed_at = new Date().toISOString();
        if (plan.closes === "lost") patch.lost_reason = lost_reason;
      }
      await db.from("opportunities").update(patch).eq("id", opp.id);
      done.push(`stage:${plan.stage}`);
    }
  }

  if (plan.lifecycle) {
    await db.from("contacts").update({ lifecycle: plan.lifecycle }).eq("id", contact_id);
    done.push(`lifecycle:${plan.lifecycle}`);
  }

  for (const tagKey of plan.tags) {
    const { data: tag } = await db.from("tags").select("id").eq("key", tagKey).maybeSingle();
    if (tag) {
      await db.from("contact_tags").upsert(
        { contact_id, tag_id: tag.id, automatic: true },
        { onConflict: "contact_id,tag_id", ignoreDuplicates: true });
    }
  }
  if (plan.tags.length) done.push(`tags:${plan.tags.join(",")}`);

  for (const t of plan.tasks) {
    await db.from("tasks").insert({
      contact_id, opportunity_id: opp?.id ?? null, assignee_id: user_id ?? null,
      title: t.title, detail: t.detail ?? null,
      due_at: t.dueInMs ? new Date(Date.now() + t.dueInMs).toISOString() : null,
    });
  }
  if (plan.tasks.length) done.push(`tasks:${plan.tasks.length}`);

  if (plan.draft && contact.email) {
    const { data: tpl } = await db.from("email_templates")
      .select("id,subject,class").eq("key", plan.draft.template).maybeSingle();
    if (tpl) {
      await db.from("emails").insert({
        contact_id, template_id: tpl.id, to_email: contact.email,
        subject: tpl.subject, class: tpl.class,
        status: "queued", requires_review: true,
      });
      done.push("recap_drafted_for_review");
    }
  }

  if (plan.enroll) {
    await db.rpc("crm_enroll", {
      p_contact: contact_id, p_automation_key: plan.enroll,
      p_opportunity: opp?.id ?? null,
    });
    done.push(`enrolled:${plan.enroll}`);
  }

  if (appointment_id) {
    await db.from("appointments").update({
      outcome, outcome_note: call_notes ?? null,
      status: "completed", completed_at: new Date().toISOString(),
    }).eq("id", appointment_id);
    done.push("appointment_closed");
  }

  await db.from("activity_events").insert({
    contact_id, opportunity_id: opp?.id ?? null, kind: "consultation_outcome",
    summary: `Outcome: ${cfg?.label ?? outcome}`, actor_user_id: user_id ?? null,
    meta: { outcome, applied: done, lost_reason: lost_reason ?? null },
  });

  return new Response(JSON.stringify({ ok: true, outcome, applied: done }),
    { headers: { "content-type": "application/json" } });
});
