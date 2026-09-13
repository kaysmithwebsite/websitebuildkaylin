import { section, check, summary } from "./_harness.ts";
import {
  scoreRealEstateLead, scoreBusinessLead, normalizeScore, temperatureFor,
} from "../lib/scoring.ts";

section("scoreRealEstateLead — point values match the spec");
{
  const events = scoreRealEstateLead({
    requestedConsultation: true, timelineDays: 30, mortgagePreApproved: true,
    hasNoAgent: true, isSellerValuationRequest: true,
  });
  const byKey = Object.fromEntries(events.map((e) => [e.ruleKey, e.points]));
  check("consultation +30", byKey.re_consultation === 30);
  check("timeline <= 90 days +25", byKey.re_timeline_under_90 === 25);
  check("mortgage pre-approved +10", byKey.re_mortgage_pre_approved === 10);
  check("no agent +10", byKey.re_no_agent === 10);
  check("seller valuation +20", byKey.re_seller_valuation === 20);
  check("total = 95", events.reduce((s, e) => s + e.points, 0) === 95);
}
check("timeline > 90 days does not score", scoreRealEstateLead({
  requestedConsultation: false, timelineDays: 180, mortgagePreApproved: false,
  hasNoAgent: false, isSellerValuationRequest: false,
}).length === 0);
check("unknown timeline (null) does not score", scoreRealEstateLead({
  requestedConsultation: false, timelineDays: null, mortgagePreApproved: false,
  hasNoAgent: false, isSellerValuationRequest: false,
}).length === 0);

section("scoreBusinessLead — point values match the spec");
{
  const events = scoreBusinessLead({
    requestedConsultation: true, supportNeededWithinDays: 14,
    hasSpecificChallenge: true, isEstablishedCompany: true,
  });
  const byKey = Object.fromEntries(events.map((e) => [e.ruleKey, e.points]));
  check("consultation +30", byKey.biz_consultation === 30);
  check("support <= 30 days +25", byKey.biz_support_under_30 === 25);
  check("specific challenge +15", byKey.biz_specific_challenge === 15);
  check("established company +10", byKey.biz_established_company === 10);
  check("total = 80", events.reduce((s, e) => s + e.points, 0) === 80);
}

section("normalizeScore / temperatureFor");
check("clamps at 100", normalizeScore([{ points: 60 }, { points: 60 }]) === 100);
check("clamps at 0 (no negative points exist, but floor holds)", normalizeScore([]) === 0);
check("hot >= 60", temperatureFor(60) === "hot" && temperatureFor(95) === "hot");
check("warm 30-59", temperatureFor(30) === "warm" && temperatureFor(59) === "warm");
check("cold < 30", temperatureFor(29) === "cold" && temperatureFor(0) === "cold");

// A reply (+20) after an appointment booking (+40) on top of a baseline
// consultation (+30) should read hot without needing every rule to fire.
check("reply + booking + consultation composes to hot", (() => {
  const score = normalizeScore([{ points: 30 }, { points: 20 }, { points: 40 }]);
  return temperatureFor(score) === "hot";
})());

const { checks, failures } = summary();
console.log(`\nscoring: ${checks - failures}/${checks} passed`);
if (failures > 0) process.exitCode = 1;
