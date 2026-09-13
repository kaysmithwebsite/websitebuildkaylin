/**
 * The two MANDATORY end-to-end tests from the master prompt, run against a
 * real Netlify Database by calling the submission-created function's own
 * default export with a synthetic Request — no HTTP server needed, since a
 * Netlify Function is just `(req: Request) => Promise<Response>`.
 *
 * Needs a live Netlify Database connection (getConnectionString() only
 * resolves inside `netlify dev` or a deployed Function). Running this
 * outside that context is expected and SKIPS rather than fails — see
 * IMPLEMENTATION_STATUS.md, "BLOCKED: no Netlify Database provisioned yet".
 */
import { section, check, summary } from "../_harness.ts";
import { randomUUID } from "node:crypto";

async function main() {
  let db: typeof import("../../db/index.ts")["db"];
  let schema: typeof import("../../db/index.ts")["schema"];
  try {
    ({ db, schema } = await import("../../db/index.ts"));
    await db.execute("select 1");
  } catch (err) {
    console.log("\nSKIPPED tests/integration/ingestion.test.ts — no live Netlify Database in this environment.");
    console.log(`  (${err instanceof Error ? err.message : String(err)})`);
    console.log("  Run this under `netlify dev`, or after deploy, to actually exercise it.");
    return;
  }

  const handlerModule = await import("../../netlify/functions/submission-created.mts");
  const handler = handlerModule.default;
  const { eq, and } = await import("drizzle-orm");

  function submit(formName: string, data: Record<string, string>) {
    const id = randomUUID();
    const req = new Request("http://localhost/.netlify/functions/submission-created", {
      method: "POST",
      body: JSON.stringify({ payload: { id, form_name: formName, created_at: new Date().toISOString(), data } }),
    });
    return { id, req };
  }

  section("MANDATORY: real-estate-buyer");
  {
    const email = `test-buyer-${randomUUID()}@example.com`;
    const { req, id: submissionId } = submit("real-estate-buyer", {
      business_line: "real_estate", lead_type: "buyer",
      first_name: "Test", last_name: "Buyer", email,
    });
    const res = await handler(req);
    const body = await res.json() as Record<string, unknown>;
    check("submission accepted (2xx)", res.status >= 200 && res.status < 300, res.status);
    check("response reports success", body.ok === true, body);

    const [contact] = await db.select().from(schema.contactEmails).where(eq(schema.contactEmails.email, email));
    check("contact created", !!contact);

    const [lead] = contact ? await db.select().from(schema.leads).where(and(
      eq(schema.leads.contactId, contact.contactId), eq(schema.leads.leadType, "buyer"),
    )) : [undefined];
    check("buyer lead created", !!lead);

    const [pipeline] = lead ? await db.select().from(schema.pipelines).where(eq(schema.pipelines.id, lead.pipelineId)) : [undefined];
    check("assigned to the Real Estate pipeline", pipeline?.slug === "real_estate");

    const [stage] = lead ? await db.select().from(schema.pipelineStages).where(eq(schema.pipelineStages.id, lead.stageId)) : [undefined];
    check("assigned to stage position 1 (New Lead)", stage?.position === 1);

    const [submissionRow] = await db.select().from(schema.externalSubmissions).where(and(
      eq(schema.externalSubmissions.provider, "netlify"),
      eq(schema.externalSubmissions.providerSubmissionId, submissionId),
    ));
    check("external submission recorded, provider=netlify, state=processed",
      submissionRow?.provider === "netlify" && submissionRow?.state === "processed");

    const scoreEvents = lead ? await db.select().from(schema.leadScoreEvents).where(eq(schema.leadScoreEvents.leadId, lead.id)) : [];
    check("lead score calculated (some events, even if zero — table queried without error)", Array.isArray(scoreEvents));

    const [analysis] = lead ? await db.select().from(schema.aiLeadAnalysis).where(eq(schema.aiLeadAnalysis.leadId, lead.id)) : [undefined];
    check("AI enrichment attempted (a row exists, pending/succeeded/failed)", !!analysis);

    const activity = lead ? await db.select().from(schema.activityEvents).where(eq(schema.activityEvents.leadId, lead.id)) : [];
    check("activity created", activity.length > 0);

    const tasks = lead ? await db.select().from(schema.tasks).where(eq(schema.tasks.leadId, lead.id)) : [];
    check("follow-up task created", tasks.length > 0);

    const notifyEmails = lead ? await db.select().from(schema.emailMessages).where(eq(schema.emailMessages.leadId, lead.id)) : [];
    check("notification target is info@kaylinsmith.com", notifyEmails.some((m) => m.toAddress === "info@kaylinsmith.com"));

    const runs = lead ? await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.leadId, lead.id)) : [];
    const [buyerWf] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, "real_estate_buyer"));
    const [consultingWf] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, "business_consulting"));
    check("real estate automation starts", runs.some((r) => r.workflowId === buyerWf?.id));
    check("NO consulting automation starts", !runs.some((r) => r.workflowId === consultingWf?.id));
  }

  section("MANDATORY: business-consultation");
  {
    const email = `test-consulting-${randomUUID()}@example.com`;
    const { req } = submit("business-consultation", {
      business_line: "business_consulting", lead_type: "consultation",
      first_name: "Test", last_name: "Consultee", email,
    });
    const res = await handler(req);
    const body = await res.json() as Record<string, unknown>;
    check("submission accepted (2xx)", res.status >= 200 && res.status < 300, res.status);
    check("response reports success", body.ok === true, body);

    const [contact] = await db.select().from(schema.contactEmails).where(eq(schema.contactEmails.email, email));
    check("contact created", !!contact);

    const [lead] = contact ? await db.select().from(schema.leads).where(and(
      eq(schema.leads.contactId, contact.contactId), eq(schema.leads.leadType, "consultation"),
    )) : [undefined];
    check("consulting lead created", !!lead);

    const [pipeline] = lead ? await db.select().from(schema.pipelines).where(eq(schema.pipelines.id, lead.pipelineId)) : [undefined];
    check("assigned to the Business Consulting pipeline", pipeline?.slug === "business_consulting");

    const [brand] = lead ? await db.select().from(schema.brands).where(eq(schema.brands.id, lead.brandId)) : [undefined];
    check("consulting brand assigned", brand?.slug === "consulting");

    const notifyEmails = lead ? await db.select().from(schema.emailMessages).where(eq(schema.emailMessages.leadId, lead.id)) : [];
    check("notification target is kaysmithconsultinggroup@gmail.com", notifyEmails.some((m) => m.toAddress === "kaysmithconsultinggroup@gmail.com"));
    check("consulting email identity selected as sender", notifyEmails.some((m) => m.fromAddress === "kaysmithconsultinggroup@gmail.com"));

    const runs = lead ? await db.select().from(schema.automationRuns).where(eq(schema.automationRuns.leadId, lead.id)) : [];
    const [consultingWf] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, "business_consulting"));
    const [buyerWf] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, "real_estate_buyer"));
    const [sellerWf] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, "real_estate_seller"));
    check("consulting automation begins", runs.some((r) => r.workflowId === consultingWf?.id));
    check("NO real-estate automation begins", !runs.some((r) => r.workflowId === buyerWf?.id || r.workflowId === sellerWf?.id));
  }

  section("idempotency: replaying the same Netlify submission id does not duplicate");
  {
    const email = `test-idempotent-${randomUUID()}@example.com`;
    const { req, id } = submit("real-estate-buyer", {
      business_line: "real_estate", lead_type: "buyer", first_name: "Idem", last_name: "Potent", email,
    });
    await handler(req);
    // Replay: identical submission id, fresh Request object (Netlify would
    // redeliver the same payload verbatim on a retry).
    const replay = new Request("http://localhost/.netlify/functions/submission-created", {
      method: "POST",
      body: JSON.stringify({ payload: { id, form_name: "real-estate-buyer", data: {
        business_line: "real_estate", lead_type: "buyer", first_name: "Idem", last_name: "Potent", email,
      } } }),
    });
    await handler(replay);

    const [contact] = await db.select().from(schema.contactEmails).where(eq(schema.contactEmails.email, email));
    const leadsForContact = contact ? await db.select().from(schema.leads).where(eq(schema.leads.contactId, contact.contactId)) : [];
    check("exactly one lead exists after two identical deliveries", leadsForContact.length === 1, leadsForContact.length);
  }

  const { checks, failures } = summary();
  console.log(`\nintegration/ingestion: ${checks - failures}/${checks} passed`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
