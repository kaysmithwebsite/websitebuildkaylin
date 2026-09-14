/**
 * Deterministic intent detection — pure functions, no Claude call, so the
 * widget can react to obvious signals (show the lead form, flag for
 * escalation) even before the model responds, and so these rules are
 * directly unit-testable rather than hoping the model always behaves.
 * Claude's own system prompt (see system-prompt.ts) carries the same
 * escalation rules for cases these patterns miss.
 */

const LEAD_INTENT_PATTERNS: RegExp[] = [
  /\b(get|how do i) started\b/i,
  /\bhow do i (register|sign ?up|apply)\b/i,
  /\bi (want|need|would like) to (start|register|sign ?up|apply)\b/i,
  /\bi('?m| am) (interested in|ready to) (buy|sell|invest|work)/i,
  /\bi need (services|help|a realtor|an agent|a consultant)\b/i,
  /\bcan (someone|you|somebody) call me\b/i,
  /\bbook a (consultation|call|meeting|appointment)\b/i,
  /\bi('?d| would) like to (join|work with|hire|talk to)\b/i,
  /\bi want to (buy|sell|invest)\b/i,
  /\bi need help (buying|selling|with my business)\b/i,
  /\brepresent me\b/i,
  /\b(hire|retain) (you|kaylin|the team)\b/i,
  /\blet'?s (talk|connect|work together)\b/i,
  /\bcontact (me|us)\b/i,
];

export function detectLeadIntent(message: string): boolean {
  return LEAD_INTENT_PATTERNS.some((re) => re.test(message));
}

export interface EscalationMatch {
  escalate: boolean;
  reason?: string;
}

const ESCALATION_PATTERNS: { reason: string; patterns: RegExp[] }[] = [
  {
    reason: "specific_pricing",
    patterns: [
      /\bhow much (do you|does it|will it) (charge|cost)\b/i,
      /\byour (commission|fee|rate|price)\b/i,
      /\bwhat('?s| is) (your|the) (commission|fee|price|rate)\b/i,
      /\b(what|how much) do you charge\b/i,
    ],
  },
  {
    reason: "specific_valuation",
    patterns: [
      /\bwhat('?s| is) my (house|home|property) worth\b/i,
      /\b(value|valuation|appraise|appraisal) of my (house|home|property)\b/i,
    ],
  },
  {
    reason: "specific_availability",
    patterns: [
      /\bare you (free|available)\b/i,
      /\bwhat time (are you|is kaylin)\b/i,
      /\bavailable (tomorrow|today|this week|next week)\b/i,
    ],
  },
  {
    reason: "legal_tax_financial_advice",
    patterns: [
      /\b(legal|tax|accounting|financial) advice\b/i,
      /\bis this legal\b/i,
      /\bshould i sue\b/i,
    ],
  },
  {
    reason: "complaint_or_dispute",
    patterns: [
      /\b(complaint|complain|unhappy|dissatisfied|disappointed)\b/i,
      /\b(dispute|refund|reimburse)\b/i,
      /\bthis is (unacceptable|ridiculous)\b/i,
    ],
  },
  {
    reason: "funding_program_guarantee",
    patterns: [
      /\bdo i qualify for\b/i,
      /\bam i eligible for\b/i,
      /\bwill i get (the|a) rebate\b/i,
      /\bguarantee.*(rebate|program|funding|grant)\b/i,
    ],
  },
];

/** Checked first, deterministically, before Claude ever sees the message. */
export function detectEscalation(message: string): EscalationMatch {
  for (const group of ESCALATION_PATTERNS) {
    if (group.patterns.some((re) => re.test(message))) {
      return { escalate: true, reason: group.reason };
    }
  }
  return { escalate: false };
}
