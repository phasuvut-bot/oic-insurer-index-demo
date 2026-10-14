// Trust Score calculation. Pure functions, shared by the browser app and the tests.
//
// Method (proposal, to be agreed by the team; see README "Trust Score method"):
//   1. Weights   w_i = mean importance of aspect i (survey) / sum of mean importances
//   2. Satisfaction (1-5) = sum_i w_i * mean satisfaction of aspect i
//      Satisfaction (0-100) = (Satisfaction - 1) / 4 * 100
//   3. NPS = % promoters (9-10) - % detractors (0-6), range -100..100
//      NPS (0-100) = (NPS + 100) / 2
//   4. Raw = SAT_WEIGHT * Satisfaction(0-100) + (1 - SAT_WEIGHT) * NPS(0-100)
//   5. Trust Score = Z * Raw + (1 - Z) * market average, Z = n / (n + m)   (Bühlmann credibility weighting)

import { ASPECT_CODES } from './catalog.js';

export const SAT_WEIGHT = 0.7;
export const MIN_REVIEWS_PRIOR = 30; // m in step 5

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Mean of one numeric field across records, ignoring null/undefined. */
export function meanOf(records, get) {
  return mean(records.map(get).filter((v) => v !== null && v !== undefined));
}

/** Step 1: importance weights from survey responses that carry `imp`. Sum to 1. */
export function importanceWeights(responses) {
  const withImp = responses.filter((r) => r.imp);
  const means = Object.fromEntries(ASPECT_CODES.map((c) => [c, meanOf(withImp, (r) => r.imp[c])]));
  const total = ASPECT_CODES.reduce((s, c) => s + (means[c] ?? 0), 0);
  if (!total) return Object.fromEntries(ASPECT_CODES.map((c) => [c, 1 / ASPECT_CODES.length]));
  return Object.fromEntries(ASPECT_CODES.map((c) => [c, (means[c] ?? 0) / total]));
}

/** Mean satisfaction per aspect (1-5), skipping "not applicable" (null) answers. */
export function aspectMeans(reviews) {
  return Object.fromEntries(ASPECT_CODES.map((c) => [c, meanOf(reviews, (r) => r.sat[c])]));
}

/**
 * Step 2: importance-weighted satisfaction on the 1-5 scale.
 * Aspects with no answers are dropped and the remaining weights re-normalised.
 */
export function weightedSatisfaction(means, weights) {
  let num = 0;
  let den = 0;
  for (const c of ASPECT_CODES) {
    if (means[c] === null || means[c] === undefined) continue;
    num += weights[c] * means[c];
    den += weights[c];
  }
  return den ? num / den : null;
}

/** Map a 1-5 score onto 0-100. */
export const fiveToHundred = (s) => ((s - 1) / 4) * 100;

/** Step 3: Net Promoter Score from 0-10 answers. Returns { nps, promoters, passives, detractors } in %. */
export function npsBreakdown(scores) {
  const xs = scores.filter((s) => s !== null && s !== undefined);
  if (!xs.length) return { nps: null, promoters: 0, passives: 0, detractors: 0, n: 0 };
  const promoters = (xs.filter((s) => s >= 9).length / xs.length) * 100;
  const detractors = (xs.filter((s) => s <= 6).length / xs.length) * 100;
  return { nps: promoters - detractors, promoters, passives: 100 - promoters - detractors, detractors, n: xs.length };
}

export const npsToHundred = (nps) => (nps + 100) / 2;

/** Step 4. */
export const rawScore = (sat100, nps100, satWeight = SAT_WEIGHT) => satWeight * sat100 + (1 - satWeight) * nps100;

/** Step 5: shrink toward the market average when there are few reviews. */
export const bayesianScore = (raw, n, prior, m = MIN_REVIEWS_PRIOR) => (n * raw + m * prior) / (n + m);

/** Steps 2-4 for one set of reviews. */
export function scoreReviews(reviews, weights) {
  const means = aspectMeans(reviews);
  const sat = weightedSatisfaction(means, weights);
  const npsB = npsBreakdown(reviews.map((r) => r.nps));
  if (sat === null || npsB.nps === null) return { n: reviews.length, means, sat: null, sat100: null, nps: npsB, raw: null };
  const sat100 = fiveToHundred(sat);
  return { n: reviews.length, means, sat, sat100, nps: npsB, raw: rawScore(sat100, npsToHundred(npsB.nps)) };
}

/**
 * Full Trust Score for every insurer. Market average = mean Raw across insurers that have reviews.
 * Returns rows sorted best first, each with `rank`.
 */
export function trustScores(insurers, reviews, weights, m = MIN_REVIEWS_PRIOR) {
  const byInsurer = new Map(insurers.map((i) => [i.id, []]));
  for (const r of reviews) byInsurer.get(r.insurer)?.push(r);
  const rows = insurers.map((ins) => ({ insurer: ins, ...scoreReviews(byInsurer.get(ins.id), weights) }));
  const prior = mean(rows.filter((r) => r.raw !== null).map((r) => r.raw));
  for (const row of rows) row.trust = row.raw === null ? null : bayesianScore(row.raw, row.n, prior, m);
  rows.sort((a, b) => (b.trust ?? -1) - (a.trust ?? -1));
  rows.forEach((row, i) => { row.rank = row.trust === null ? null : i + 1; });
  return { rows, prior };
}

/** Star rating (1-5, half steps) that the rankings list shows next to a 0-100 Trust Score. */
export const trustToStars = (trust) => Math.round(((trust / 100) * 4 + 1) * 2) / 2;
