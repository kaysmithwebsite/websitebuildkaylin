/**
 * CONSULTATION OUTCOMES  —  CRM phase 6 (sections 22, 23, 26, 31, 74)
 *
 * Kaylin picks one outcome after a call. This turns that single choice into
 * everything that should follow: the pipeline move, the sequence to enrol, the
 * tasks to raise, the tags, and whether a recap draft is prepared for her
 * review.
 *
 * Import-free on purpose, like the automation engine, so it runs in Deno and
 * in Node and is covered by tools_outcome_test.ts.
 *
 * The mapping itself is data, loaded from consultation_outcomes, because
 * section 82 requires Kaylin to change follow-up behaviour without a developer.
 * This file decides what a mapping *means*, not what it contains.
 */

export type Outcome =
  | "hot_lead" | "follow_up" | "proposal_required" | "buyer_representation"
  | "listing_opportunity" | "referral_needed" | "consulting_opportunity"
  | "long_term_nurture" | "not_qualified" | "not_ready" | "closed_lost" | "client";

export interface TaskSpec {
  title: string;
  due_in?: { days?: number; hours?: number; minutes?: number };
  detail?: string;
}

/** One row of consultation_outcomes. */
export interface OutcomeConfig {
  outcome: Outcome;
  label: string;
  stage_real_estate?: string | null;
  stage_consulting?: string | null;
  enroll?: string | null;
  draft_template?: string | null;
  tags?: string[];
  tasks?: TaskSpec[];
  closes?: "won" | "lost" | null;
  requires_reason?: boolean;
  /** Stop any sequence the contact is already in before starting the new one.
   *  Without this a nurture drip keeps running underneath a live deal. */
  halt_existing?: boolean;
}

export interface OutcomeContext {
  interest: "real_estate" | "business_consulting" | null;
  hasOpportunity: boolean;
  lostReason?: string | null;
  /** Call notes, if Kaylin typed any. A recap is only drafted when there is
   *  something real to base it on; section 61 forbids inventing what was said. */
  callNotes?: string | null;
}

export interface Plan {
  stage?: string;
  enroll?: string;
  haltExisting: boolean;
  tags: string[];
  tasks: { title: string; dueInMs: number | null; detail?: string }[];
  closes?: "won" | "lost";
  /** A draft is queued for review, never sent automatically (section 24). */
  draft?: { template: string; requiresReview: true };
  lifecycle?: string;
  errors: string[];
}

function dueMs(t: TaskSpec): number | null {
  if (!t.due_in) return null;
  const { days = 0, hours = 0, minutes = 0 } = t.due_in;
  return ((days * 24 + hours) * 60 + minutes) * 60_000;
}

const LIFECYCLE: Partial<Record<Outcome, string>> = {
  client: "client",
  closed_lost: "lost",
  not_qualified: "lost",
  long_term_nurture: "nurture",
  not_ready: "nurture",
  hot_lead: "active_opportunity",
  proposal_required: "active_opportunity",
  buyer_representation: "active_opportunity",
  listing_opportunity: "active_opportunity",
  consulting_opportunity: "active_opportunity",
};

export function planOutcome(
  outcome: Outcome, cfg: OutcomeConfig | undefined, ctx: OutcomeContext,
): Plan {
  const plan: Plan = { haltExisting: false, tags: [], tasks: [], errors: [] };

  if (!cfg) {
    plan.errors.push(`no configuration for outcome "${outcome}"`);
    return plan;
  }

  // Section 74: a lost opportunity must say why, so the reporting is worth
  // something. Refusing here is the whole point of the rule.
  if (cfg.requires_reason && !ctx.lostReason) {
    plan.errors.push("a reason is required before this opportunity can be closed");
    return plan;
  }

  plan.stage = ctx.interest === "business_consulting"
    ? (cfg.stage_consulting ?? undefined)
    : (cfg.stage_real_estate ?? undefined);

  if (plan.stage && !ctx.hasOpportunity) {
    plan.errors.push("no open opportunity to move");
    plan.stage = undefined;
  }

  plan.enroll = cfg.enroll ?? undefined;
  plan.haltExisting = cfg.halt_existing !== false;
  plan.tags = [...(cfg.tags ?? [])];
  plan.tasks = (cfg.tasks ?? []).map((t) => ({
    title: t.title, dueInMs: dueMs(t), detail: t.detail,
  }));
  plan.closes = cfg.closes ?? undefined;
  plan.lifecycle = LIFECYCLE[outcome];

  // A recap is only drafted from real call notes. With nothing to summarise,
  // the draft is skipped and a task asks Kaylin to write it herself rather
  // than a template inventing what was discussed.
  if (cfg.draft_template) {
    if (ctx.callNotes && ctx.callNotes.trim().length >= 20) {
      plan.draft = { template: cfg.draft_template, requiresReview: true };
    } else {
      plan.tasks.push({
        title: "Write the follow-up yourself",
        dueInMs: 4 * 3600_000,
        detail: "No call notes were recorded, so no recap was drafted.",
      });
    }
  }

  return plan;
}

/* ----------------------------------------------------------- stale leads */

export interface StaleInput {
  temperature: string;
  lifecycle: string;
  hoursSinceActivity: number;
  hasOpenTask: boolean;
  hasNextAction: boolean;
  stageKey?: string | null;
  consultationDoneNoFollowUp?: boolean;
  proposalSentNoTask?: boolean;
}

/**
 * Section 75. Returns the reason a record needs attention, or null. Kept as a
 * pure function so the thresholds are testable and visible rather than buried
 * in a query.
 */
export function staleReason(s: StaleInput): string | null {
  if (s.lifecycle === "client" || s.lifecycle === "lost") return null;
  if (s.temperature === "hot" && s.hoursSinceActivity >= 48) {
    return "Hot lead with no activity for 48 hours";
  }
  if (s.consultationDoneNoFollowUp) return "Consultation completed with no follow-up";
  if (s.proposalSentNoTask) return "Proposal sent with no next task";
  if (s.stageKey && s.stageKey !== "new_inquiry" && !s.hasNextAction && !s.hasOpenTask) {
    return "Qualified opportunity with no next action";
  }
  if (s.temperature === "warm" && s.hoursSinceActivity >= 14 * 24) {
    return "Warm lead untouched for two weeks";
  }
  return null;
}

/* --------------------------------------------------- hot lead follow-ups */

/** Section 26. Day 1, 3, 7, 14, 30. Expressed here so the cadence is one
 *  reviewable list rather than five scattered delay steps. */
export const HOT_LEAD_CADENCE_DAYS = [1, 3, 7, 14, 30] as const;

export function nextFollowUp(daysSinceOutcome: number): number | null {
  for (const d of HOT_LEAD_CADENCE_DAYS) if (d > daysSinceOutcome) return d;
  return null;
}
