/**
 * Deterministic lead scoring. AI (lib/ai-brief.ts) may EXPLAIN a score; it
 * never sets one. Each rule fires at most once per lead — callers persist
 * one row per (lead_id, rule_key) in lead_score_events, and the unique index
 * on that pair (db/schema.ts) is what actually prevents a replayed webhook
 * from inflating a score, not this module.
 */

export interface ScoreEvent {
  ruleKey: string;
  points: number;
  reason: string;
}

/** Facts pulled from a normalized submission — see lib/validation.ts. */
export interface RealEstateScoringFacts {
  requestedConsultation: boolean;
  timelineDays: number | null;      // null = unknown/not asked
  mortgagePreApproved: boolean;
  hasNoAgent: boolean;
  isSellerValuationRequest: boolean;
}

export interface BusinessScoringFacts {
  requestedConsultation: boolean;
  supportNeededWithinDays: number | null;
  hasSpecificChallenge: boolean;
  isEstablishedCompany: boolean;
}

const REAL_ESTATE_RULES = {
  consultation: { points: 30, reason: "Requested a consultation" },
  timelineUnder90: { points: 25, reason: "Timeline is 90 days or less" },
  mortgagePreApproved: { points: 10, reason: "Mortgage pre-approved" },
  noAgent: { points: 10, reason: "Not currently represented by an agent" },
  sellerValuation: { points: 20, reason: "Requested a seller valuation" },
} as const;

const BUSINESS_RULES = {
  consultation: { points: 30, reason: "Requested a consultation" },
  supportUnder30: { points: 25, reason: "Needs support within 30 days" },
  specificChallenge: { points: 15, reason: "Named a specific business challenge" },
  establishedCompany: { points: 10, reason: "Established company" },
} as const;

/** Shared post-ingest events, applied by whatever records them (reply
 *  detection, booking webhook) rather than at ingest time. */
export const POST_INGEST_RULES = {
  replyReceived: { points: 20, reason: "Replied to an email" },
  appointmentBooked: { points: 40, reason: "Booked an appointment" },
} as const;

export function scoreRealEstateLead(facts: RealEstateScoringFacts): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const push = (ruleKey: string, rule: { points: number; reason: string }) =>
    events.push({ ruleKey, points: rule.points, reason: rule.reason });

  if (facts.requestedConsultation) push("re_consultation", REAL_ESTATE_RULES.consultation);
  if (facts.timelineDays !== null && facts.timelineDays <= 90) {
    push("re_timeline_under_90", REAL_ESTATE_RULES.timelineUnder90);
  }
  if (facts.mortgagePreApproved) push("re_mortgage_pre_approved", REAL_ESTATE_RULES.mortgagePreApproved);
  if (facts.hasNoAgent) push("re_no_agent", REAL_ESTATE_RULES.noAgent);
  if (facts.isSellerValuationRequest) push("re_seller_valuation", REAL_ESTATE_RULES.sellerValuation);

  return events;
}

export function scoreBusinessLead(facts: BusinessScoringFacts): ScoreEvent[] {
  const events: ScoreEvent[] = [];
  const push = (ruleKey: string, rule: { points: number; reason: string }) =>
    events.push({ ruleKey, points: rule.points, reason: rule.reason });

  if (facts.requestedConsultation) push("biz_consultation", BUSINESS_RULES.consultation);
  if (facts.supportNeededWithinDays !== null && facts.supportNeededWithinDays <= 30) {
    push("biz_support_under_30", BUSINESS_RULES.supportUnder30);
  }
  if (facts.hasSpecificChallenge) push("biz_specific_challenge", BUSINESS_RULES.specificChallenge);
  if (facts.isEstablishedCompany) push("biz_established_company", BUSINESS_RULES.establishedCompany);

  return events;
}

/** Sum of fired events, normalized into 0-100. A single lead cannot realistically
 *  clear ~95 raw points across the defined rules, but this clamps regardless
 *  so a future rule addition can never push a displayed score past 100. */
export function normalizeScore(events: { points: number }[]): number {
  const raw = events.reduce((sum, e) => sum + e.points, 0);
  return Math.max(0, Math.min(100, raw));
}

export function temperatureFor(score: number): "hot" | "warm" | "cold" {
  if (score >= 60) return "hot";
  if (score >= 30) return "warm";
  return "cold";
}
