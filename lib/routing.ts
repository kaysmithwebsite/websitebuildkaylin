/**
 * Form -> CRM routing. Pure function over the seeded form_routes table (see
 * db/seed.ts) — no database access here, so it is directly unit-testable.
 *
 * Rule: AI never determines routing when explicit form data already
 * determines it. An unmatched (form_name, lead_type) combination is NEVER
 * guessed — it comes back unmatched, and the caller records a
 * rejected_submissions row (reason "unknown_form" | "unknown_lead_type")
 * instead of creating a lead. That queue IS the "requires manual routing"
 * item on the Needs Attention screen.
 */

export interface FormRoute {
  id: string;
  formName: string;
  /** "" = fixed-route form (ignores the submission's own lead_type). A real
   *  value = this row only applies to a "general-contact"-style branch whose
   *  submitted lead_type matches. See db/schema.ts for why this is "" and
   *  not null. */
  matchLeadType: string;
  businessLine: "real_estate" | "business_consulting";
  leadType: string;
  pipelineSlug: string;
  notifyEmail: string;
  active: boolean;
}

export type RouteResolution =
  | { matched: true; route: FormRoute }
  | { matched: false; reason: "unknown_form" | "unknown_lead_type" };

export function resolveRoute(
  formName: string,
  submittedLeadType: string | null,
  routes: FormRoute[],
): RouteResolution {
  const candidates = routes.filter((r) => r.active && r.formName === formName);
  if (candidates.length === 0) return { matched: false, reason: "unknown_form" };

  // A fixed-route form (real-estate-buyer, business-strategy, ...) has
  // exactly one row with match_lead_type = ""; it ignores whatever the form
  // itself may have sent as lead_type.
  const fixed = candidates.find((r) => r.matchLeadType === "");
  if (fixed) return { matched: true, route: fixed };

  // A branching form (general-contact) requires the visitor's own explicit
  // selection to match one of the seeded lead types.
  const branch = candidates.find((r) => r.matchLeadType === (submittedLeadType ?? ""));
  if (branch) return { matched: true, route: branch };

  return { matched: false, reason: "unknown_lead_type" };
}
