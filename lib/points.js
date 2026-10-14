// Reviewer points. The star rating is deliberately NOT an input: a 1-star and a
// 5-star review earn the same points, so incentives cannot bias the ratings.

export const POINT_RULES = {
  verifiedReview: 100,
  comment: 30,          // written comment of at least COMMENT_MIN_CHARS characters
  photo: 20,            // claim or repair photo attached
  helpfulVote: 5,       // per "helpful" vote received
  helpfulVoteCap: 10,   // votes counted per review
};
export const COMMENT_MIN_CHARS = 50;
export const THB_PER_POINT = 0.1; // 500 points = THB 50 (mock redemption value)

/** Character count that treats each Thai code point (incl. vowel/tone marks) as one. */
export const charCount = (s) => [...String(s ?? '').trim()].length;

/** Points for submitting one verified review. Returns { total, lines: [{ key, points }] }. */
export function reviewPoints({ verified, comment, hasPhoto }) {
  if (!verified) return { total: 0, lines: [] };
  const lines = [{ key: 'verifiedReview', points: POINT_RULES.verifiedReview }];
  if (charCount(comment) >= COMMENT_MIN_CHARS) lines.push({ key: 'comment', points: POINT_RULES.comment });
  if (hasPhoto) lines.push({ key: 'photo', points: POINT_RULES.photo });
  return { total: lines.reduce((s, l) => s + l.points, 0), lines };
}

/** Points from helpful votes on one review, capped. */
export const helpfulPoints = (votes) => Math.min(Math.max(votes, 0), POINT_RULES.helpfulVoteCap) * POINT_RULES.helpfulVote;

/** Ledger balance: sum of signed entries ({ points }), redemptions are negative. */
export const balance = (ledger) => ledger.reduce((s, e) => s + e.points, 0);

export const pointsToThb = (points) => points * THB_PER_POINT;

// ---------------------------------------------------------------- tiers (airline style)
// Status credits move a reviewer up a tier; they count over a rolling window and are separate from the points
// spent on rewards. Like points, they never depend on the star rating.
export const CREDIT_RULES = {
  verifiedReview: 40,
  claimEvidence: 30,    // review of a claim, with a claim or repair photo
  comment: 10,          // comment of at least COMMENT_MIN_CHARS characters
  helpfulVote: 2,       // per helpful vote received
  helpfulVoteCap: 10,   // votes counted per review (max 20 credits)
  oicSurvey: 20,        // taking part in an OIC consumer survey
};
export const CREDIT_WINDOW_DAYS = 730; // 24 months
export const TIERS = [ // min = status credits needed
  { id: 'member', min: 0, mult: 1 },
  { id: 'copper', min: 40, mult: 1 },
  { id: 'silver', min: 100, mult: 1.25 },
  { id: 'gold', min: 200, mult: 1.5 },
  { id: 'platinum', min: 350, mult: 2, minMemberDays: 730 },
];

/** Status credits for one verified review. Returns { total, lines: [{ key, credits }] }. */
export function reviewCredits({ verified, comment, hasPhoto, claimed }) {
  if (!verified) return { total: 0, lines: [] };
  const lines = [{ key: 'verifiedReview', credits: CREDIT_RULES.verifiedReview }];
  if (charCount(comment) >= COMMENT_MIN_CHARS) lines.push({ key: 'comment', credits: CREDIT_RULES.comment });
  if (claimed && hasPhoto) lines.push({ key: 'claimEvidence', credits: CREDIT_RULES.claimEvidence });
  return { total: lines.reduce((s, l) => s + l.credits, 0), lines };
}
export const helpfulCredits = (votes) => Math.min(Math.max(votes, 0), CREDIT_RULES.helpfulVoteCap) * CREDIT_RULES.helpfulVote;

/** Credits earned in the window ending on asOf (ledger entries carry { date, credits }). */
export function creditsInWindow(ledger, asOf, windowDays = CREDIT_WINDOW_DAYS) {
  const from = Date.parse(asOf) - windowDays * 86_400_000;
  return ledger.filter((e) => Date.parse(e.date) > from).reduce((s, e) => s + (e.credits || 0), 0);
}

/**
 * Tier for a credit total. Platinum also needs minMemberDays of membership and no moderation strikes;
 * otherwise the reviewer stays Gold. Returns { tier, next, toNext } (next = null at the top).
 */
export function tierFor(credits, { memberDays = 0, strikes = 0 } = {}) {
  let i = TIERS.findLastIndex((t) => credits >= t.min);
  if (TIERS[i].id === 'platinum' && (memberDays < TIERS[i].minMemberDays || strikes > 0)) i -= 1;
  const next = TIERS[i + 1] ?? null;
  return { tier: TIERS[i], next, toNext: next ? Math.max(0, next.min - credits) : 0 };
}

/** Reward points after the tier multiplier (rounded down to whole points). */
export const withMultiplier = (points, tier) => Math.floor(points * tier.mult);
