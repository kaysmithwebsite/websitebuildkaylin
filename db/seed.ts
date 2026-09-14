#!/usr/bin/env node
/**
 * Idempotent seed: brands, pipelines, pipeline stages, form_routes, tags,
 * and the automation workflow/step shells. Safe to re-run — every insert is
 * ON CONFLICT DO NOTHING against a natural key (slug, or pipeline+slug, or
 * form_name+match_lead_type).
 *
 * Run with: npm run db:seed   (needs NETLIFY_DATABASE_URL — see DATABASE.md;
 * this only runs inside `netlify dev` or a deployed Netlify Function today).
 */
import { db, schema } from "./index.ts";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Seeding brands...");
  await db.insert(schema.brands).values([
    {
      slug: "real_estate",
      name: "Kaylin Smith Real Estate",
      businessLine: "real_estate",
      senderName: "Kaylin Smith",
      senderEmail: "info@kaylinsmith.com",
      notifyEmail: "info@kaylinsmith.com",
      bookingUrl: "https://calendly.com/kaylinsmithrealestate",
    },
    {
      slug: "consulting",
      name: "Kay Smith Consulting Group",
      businessLine: "business_consulting",
      senderName: "Kay Smith Consulting Group",
      senderEmail: "kaysmithconsultinggroup@gmail.com",
      notifyEmail: "kaysmithconsultinggroup@gmail.com",
      // No separate consulting booking link supplied yet — falls back to
      // the contact form until one exists (mirrors data/site.json:booking).
      bookingUrl: null,
    },
  ]).onConflictDoNothing({ target: schema.brands.slug });

  const realEstateBrand = (await db.select().from(schema.brands).where(eq(schema.brands.slug, "real_estate")))[0];
  const consultingBrand = (await db.select().from(schema.brands).where(eq(schema.brands.slug, "consulting")))[0];
  if (!realEstateBrand || !consultingBrand) throw new Error("brand seed failed to read back");

  console.log("Seeding pipelines...");
  await db.insert(schema.pipelines).values([
    { slug: "real_estate", name: "Real Estate", brandId: realEstateBrand.id },
    { slug: "business_consulting", name: "Business Consulting", brandId: consultingBrand.id },
  ]).onConflictDoNothing({ target: schema.pipelines.slug });

  const realEstatePipeline = (await db.select().from(schema.pipelines).where(eq(schema.pipelines.slug, "real_estate")))[0];
  const consultingPipeline = (await db.select().from(schema.pipelines).where(eq(schema.pipelines.slug, "business_consulting")))[0];
  if (!realEstatePipeline || !consultingPipeline) throw new Error("pipeline seed failed to read back");

  console.log("Seeding pipeline stages...");
  const REAL_ESTATE_STAGES = [
    "New Lead", "Attempting Contact", "Contacted", "Consultation / Discovery",
    "Active Buyer", "Active Seller", "Showing / Search", "Offer / Negotiation",
    "Under Contract", "Closed", "Long-Term Nurture", "Lost",
  ];
  const BUSINESS_STAGES = [
    "New Lead", "Attempting Contact", "Contacted", "Discovery", "Proposal",
    "Decision", "Active Client", "Completed", "Long-Term Nurture", "Lost",
  ];
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const stageRows = [
    ...REAL_ESTATE_STAGES.map((name, i) => ({
      pipelineId: realEstatePipeline.id, slug: slugify(name), name, position: i + 1,
      isWon: name === "Closed", isLost: name === "Lost",
    })),
    ...BUSINESS_STAGES.map((name, i) => ({
      pipelineId: consultingPipeline.id, slug: slugify(name), name, position: i + 1,
      isWon: name === "Completed", isLost: name === "Lost",
    })),
  ];
  await db.insert(schema.pipelineStages).values(stageRows)
    .onConflictDoNothing({ target: [schema.pipelineStages.pipelineId, schema.pipelineStages.slug] });

  console.log("Seeding form_routes...");
  const RE_EMAIL = "info@kaylinsmith.com";
  const BIZ_EMAIL = "kaysmithconsultinggroup@gmail.com";

  type RouteSeed = {
    formName: string; matchLeadType: string;
    businessLine: "real_estate" | "business_consulting";
    leadType: (typeof schema.leadTypeEnum.enumValues)[number];
    pipelineSlug: string; notifyEmail: string;
  };

  const dedicatedRealEstate: [string, (typeof schema.leadTypeEnum.enumValues)[number]][] = [
    ["real-estate-buyer", "buyer"],
    ["real-estate-seller", "seller"],
    ["real-estate-investor", "investor"],
    ["real-estate-home-valuation", "home_valuation"],
    ["real-estate-consultation", "consultation"],
  ];
  const dedicatedBusiness: [string, (typeof schema.leadTypeEnum.enumValues)[number]][] = [
    ["business-consultation", "consultation"],
    ["business-strategy", "strategy"],
    ["business-operations", "operations"],
    ["business-crm-automation", "crm_automation"],
  ];

  // Both dedicated lists include "consultation" as a lead_type (real estate's
  // own general consultation, and business's). That's fine for a fixed-route
  // form (matchLeadType is "" there, disambiguated by form_name alone), but
  // a branching form like general-contact or chatbot-intake — where the
  // *visitor's own selection* is the match key — would seed two rows with
  // the identical matchLeadType "consultation", violating the (form_name,
  // match_lead_type) unique index and silently losing one of them to
  // onConflictDoNothing. Disambiguate the match key by business line
  // whenever the underlying lead_type could mean either; every other
  // lead_type is already unique across the two lists and passes through
  // unchanged. This key is purely a routing lookup value — the leadType
  // actually stored on the resulting lead is unaffected.
  function matchKeyFor(
    businessLine: "real_estate" | "business_consulting",
    leadType: (typeof schema.leadTypeEnum.enumValues)[number],
  ): string {
    if (leadType === "consultation") {
      return businessLine === "real_estate" ? "real_estate_consultation" : "business_consultation";
    }
    return leadType;
  }

  /** A branching form (general-contact, chatbot-intake) resolves entirely
   *  from the visitor's own explicit selection — never guessed. */
  function branchRoutes(formName: string): RouteSeed[] {
    return [
      ...dedicatedRealEstate.map(([, leadType]) => ({
        formName, matchLeadType: matchKeyFor("real_estate", leadType), businessLine: "real_estate" as const,
        leadType, pipelineSlug: "real_estate", notifyEmail: RE_EMAIL,
      })),
      ...dedicatedBusiness.map(([, leadType]) => ({
        formName, matchLeadType: matchKeyFor("business_consulting", leadType), businessLine: "business_consulting" as const,
        leadType, pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL,
      })),
    ];
  }

  const routes: RouteSeed[] = [
    ...dedicatedRealEstate.map(([formName, leadType]) => ({
      formName, matchLeadType: "", businessLine: "real_estate" as const,
      leadType, pipelineSlug: "real_estate", notifyEmail: RE_EMAIL,
    })),
    ...dedicatedBusiness.map(([formName, leadType]) => ({
      formName, matchLeadType: "", businessLine: "business_consulting" as const,
      leadType, pipelineSlug: "business_consulting", notifyEmail: BIZ_EMAIL,
    })),
    ...branchRoutes("general-contact"),
    // chatbot-intake: the floating website chatbot's own lead form. Same
    // branching shape as general-contact — the widget sets lead_type
    // explicitly from what the visitor actually said/selected, never guessed
    // server-side. See CHATBOT.md.
    ...branchRoutes("chatbot-intake"),
  ];

  await db.insert(schema.formRoutes).values(routes)
    .onConflictDoNothing({ target: [schema.formRoutes.formName, schema.formRoutes.matchLeadType] });

  console.log("Seeding tags...");
  await db.insert(schema.tags).values([
    { key: "buyer", label: "Buyer" },
    { key: "seller", label: "Seller" },
    { key: "investor", label: "Investor" },
    { key: "home_valuation", label: "Home Valuation" },
    { key: "consultation", label: "Consultation" },
    { key: "strategy", label: "Strategy" },
    { key: "operations", label: "Operations" },
    { key: "crm_automation", label: "CRM & Automation" },
    { key: "hot_lead", label: "Hot Lead" },
    { key: "review_required", label: "Needs Manual Routing" },
  ]).onConflictDoNothing({ target: schema.tags.key });

  console.log("Seeding automation workflow shells...");
  // Step sequences per Phase 9 of the master prompt. The runner that
  // advances these (a scheduled Netlify Function) is NOT built yet — see
  // IMPLEMENTATION_STATUS.md. Seeding them now means submission-created.mts
  // can enroll a contact into the right workflow today; the run will simply
  // sit at position 0 until the runner exists.
  const workflowSeeds = [
    {
      key: "real_estate_buyer", name: "Real Estate — Buyer Inquiry", brandId: realEstateBrand.id,
      steps: [
        { stepType: "email" as const, config: { templateKey: "re_buyer_ack" } },
        { stepType: "notify" as const, config: { to: RE_EMAIL } },
        { stepType: "task" as const, config: { title: "Call new buyer lead", dueInHours: 1 } },
        { stepType: "wait" as const, config: { hours: 48 } },
        { stepType: "email" as const, config: { templateKey: "re_buyer_followup_1" } },
        { stepType: "wait" as const, config: { hours: 72 } },
        { stepType: "email" as const, config: { templateKey: "re_buyer_followup_2" } },
      ],
    },
    {
      key: "real_estate_seller", name: "Real Estate — Seller / Valuation Inquiry", brandId: realEstateBrand.id,
      steps: [
        { stepType: "email" as const, config: { templateKey: "re_seller_ack" } },
        { stepType: "notify" as const, config: { to: RE_EMAIL } },
        { stepType: "task" as const, config: { title: "Call new seller lead", dueInHours: 1 } },
        { stepType: "wait" as const, config: { hours: 48 } },
        { stepType: "email" as const, config: { templateKey: "re_seller_followup_1" } },
      ],
    },
    {
      key: "business_consulting", name: "Business Consulting Inquiry", brandId: consultingBrand.id,
      steps: [
        { stepType: "email" as const, config: { templateKey: "biz_consulting_ack" } },
        { stepType: "notify" as const, config: { to: BIZ_EMAIL } },
        { stepType: "task" as const, config: { title: "Call new consulting lead", dueInHours: 4 } },
        { stepType: "wait" as const, config: { hours: 48 } },
        { stepType: "email" as const, config: { templateKey: "biz_consulting_followup_1" } },
      ],
    },
  ];

  for (const wf of workflowSeeds) {
    await db.insert(schema.automationWorkflows)
      .values({ key: wf.key, name: wf.name, brandId: wf.brandId })
      .onConflictDoNothing({ target: schema.automationWorkflows.key });
    const [row] = await db.select().from(schema.automationWorkflows).where(eq(schema.automationWorkflows.key, wf.key));
    if (!row) throw new Error(`workflow seed failed to read back: ${wf.key}`);
    await db.insert(schema.automationSteps).values(
      wf.steps.map((s, i) => ({ workflowId: row.id, position: i + 1, stepType: s.stepType, config: s.config })),
    ).onConflictDoNothing({ target: [schema.automationSteps.workflowId, schema.automationSteps.position] });
  }

  console.log("Seed complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
