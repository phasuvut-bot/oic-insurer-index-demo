// Empirical-Bayes Trust Score: the prototype's closed-form approximation of the hierarchical Bayesian model
// proposed for production (see pitch appendix). Pure functions, shared by the browser app and the tests.
//
// Method (proposal, to be agreed with the OIC):
//   1. Review score y_r (0-100) = 0.7 x satisfaction_r + 0.3 x recommend_r
//        satisfaction_r = importance-weighted mean of the answered aspects, mapped (S - 1) / 4 x 100
//        recommend_r    = 100 promoter (9-10), 50 passive (7-8), 0 detractor (0-6); its mean is (NPS + 100) / 2
//   2. Case-mix: y*_r = y_r - (x_r - x_market) . beta, beta fitted WITHIN insurers (so it cannot absorb quality)
//        x_r = [made a claim, policy-class dummies vs Class 1 garage]
//   3. Recency: weight w_r = 0.5 ^ (age_days / half-life); effective n = (sum w)^2 / sum w^2
//   4. Bühlmann-Straub: sigma^2 = pooled within-unit variance, tau^2 = between-unit variance, k = sigma^2 / tau^2
//        Z_i = n_i / (n_i + k); mu = sum Z_i ybar_i / sum Z_i
//        posterior mean = Z_i ybar_i + (1 - Z_i) mu, posterior sd = sqrt(sigma^2 / (n_i + k))   (normal-normal)
//   5. 90% interval = mean +- 1.645 sd; band = above / near / below mu; rank probabilities by simulation
// The full production model adds ordinal (cumulative-logit) ratings, a reviewer-generosity effect and a time trend.

import { ASPECT_CODES } from './catalog.js';

export const SAT_SHARE = 0.7;
export const HALF_LIFE_DAYS = 365;
export const Z90 = 1.645;
export const CASE_MIX_CLASSES = ['1-dealer', '2plus', '3plus', '2', '3']; // baseline: 1-garage
export const CASE_MIX_LABELS = ['claimed', ...CASE_MIX_CLASSES.map((c) => `cls_${c}`)];

/** Recommend points: promoter 100, passive 50, detractor 0. */
export const npsPoint = (n) => (n >= 9 ? 100 : n <= 6 ? 0 : 50);

/** Step 1: one review's 0-100 score. Aspects answered "not applicable" (null) are skipped and weights re-normalised. */
export function reviewScore(r, weights) {
  let num = 0; let den = 0;
  for (const c of ASPECT_CODES) {
    const v = r.sat?.[c];
    if (v === null || v === undefined) continue;
    num += weights[c] * v; den += weights[c];
  }
  if (!den || r.nps === null || r.nps === undefined) return null;
  return SAT_SHARE * (((num / den) - 1) / 4) * 100 + (1 - SAT_SHARE) * npsPoint(r.nps);
}

/** Step 2 features. */
export const caseMixFeatures = (r) => [r.claimed ? 1 : 0, ...CASE_MIX_CLASSES.map((c) => (r.cls === c ? 1 : 0))];

/** Solve A x = b (small dense system) by Gaussian elimination with partial pivoting. */
export function solve(A, b) {
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) throw new Error('singular system');
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Step 2: within-group least squares. obs = [{ g, y, x: number[] }]. Each variable is centred on its group mean,
 * so beta measures differences between customers of the SAME insurer. A small ridge keeps constant columns solvable.
 */
export function fitWithin(obs, ridge = 1e-3) {
  if (!obs.length) return [];
  const p = obs[0].x.length;
  const groups = new Map();
  for (const o of obs) { if (!groups.has(o.g)) groups.set(o.g, []); groups.get(o.g).push(o); }
  const XtX = [...Array(p)].map(() => new Array(p).fill(0)); const Xty = new Array(p).fill(0);
  for (const rows of groups.values()) {
    const my = rows.reduce((s, o) => s + o.y, 0) / rows.length;
    const mx = [...Array(p)].map((_, j) => rows.reduce((s, o) => s + o.x[j], 0) / rows.length);
    for (const o of rows) {
      const dx = o.x.map((v, j) => v - mx[j]); const dy = o.y - my;
      for (let a = 0; a < p; a++) { Xty[a] += dx[a] * dy; for (let b = 0; b < p; b++) XtX[a][b] += dx[a] * dx[b]; }
    }
  }
  for (let a = 0; a < p; a++) XtX[a][a] += ridge * obs.length;
  return solve(XtX, Xty);
}

/** Step 3. */
export const recencyWeight = (ageDays, halfLife = HALF_LIFE_DAYS) => (Number.isFinite(halfLife) ? 0.5 ** (Math.max(0, ageDays) / halfLife) : 1);
export const effectiveN = (ws) => { const s = ws.reduce((a, w) => a + w, 0); const s2 = ws.reduce((a, w) => a + w * w, 0); return s2 ? (s * s) / s2 : 0; };

/**
 * Step 4: Bühlmann-Straub credibility. groups = [{ id, n, mean, s2 }] (n may be an effective n; s2 = within variance).
 * Returns { sigma2, tau2, k, mu, rows: [{ id, z, post, sd }] }.
 */
export function buhlmannStraub(groups, { kFixed = null } = {}) {
  const gs = groups.filter((g) => g.n > 0);
  const dfW = gs.reduce((s, g) => s + Math.max(g.n - 1, 0), 0);
  const sigma2 = dfW > 0 ? gs.reduce((s, g) => s + Math.max(g.n - 1, 0) * g.s2, 0) / dfW : 0;
  const N = gs.reduce((s, g) => s + g.n, 0);
  const ybar = gs.reduce((s, g) => s + g.n * g.mean, 0) / N;
  const between = gs.reduce((s, g) => s + g.n * (g.mean - ybar) ** 2, 0);
  const denom = N - gs.reduce((s, g) => s + g.n * g.n, 0) / N;
  let tau2 = denom > 0 ? (between - (gs.length - 1) * sigma2) / denom : 0;
  const K_MAX = 500; // if units look identical, cap the pooling instead of dividing by ~0
  if (!(tau2 > sigma2 / K_MAX)) tau2 = sigma2 / K_MAX;
  const k = kFixed ?? sigma2 / tau2;
  const zs = gs.map((g) => g.n / (g.n + k));
  const mu = gs.reduce((s, g, i) => s + zs[i] * g.mean, 0) / zs.reduce((s, z) => s + z, 0);
  const rows = gs.map((g, i) => ({ id: g.id, z: zs[i], post: zs[i] * g.mean + (1 - zs[i]) * mu, sd: Math.sqrt(sigma2 / (g.n + k)) }));
  return { sigma2, tau2: kFixed ? sigma2 / kFixed : tau2, k, mu, rows };
}

/** Step 5. */
export const bandOf = (lo, hi, mu) => (lo > mu ? 'above' : hi < mu ? 'below' : 'near');

/** Seeded uniform generator (mulberry32). */
export function prng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}
/** P[i][r] = probability unit i has rank r (0 = best) when each score ~ N(post, sd). Seeded, so stable between renders. */
export function rankProbabilities(units, draws = 2000, seed = 20261014) {
  const rnd = prng(seed); const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const P = units.map(() => new Array(units.length).fill(0));
  for (let d = 0; d < draws; d++) {
    const xs = units.map((u, i) => [u.post + u.sd * gauss(), i]).sort((a, b) => b[0] - a[0]);
    xs.forEach(([, i], r) => { P[i][r] += 1 / draws; });
  }
  return P;
}

const dayDiff = (a, b) => (Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * Full pipeline. units = [{ id, ... }]; unitOf(review) -> unit id; reviews carry { insurer, date, sat, nps, claimed, cls }.
 * Case-mix is always fitted within insurers. Returns rows sorted best first, plus the fitted parameters.
 */
export function bayesScores(units, reviews, weights, { unitOf = (r) => r.insurer, asOf, halfLife = HALF_LIFE_DAYS, kFixed = null, caseMix = true, draws = 2000 } = {}) {
  const obs = [];
  for (const r of reviews) {
    const y = reviewScore(r, weights);
    if (y === null) continue;
    obs.push({ r, g: r.insurer, u: unitOf(r), y, x: caseMixFeatures(r), w: asOf ? recencyWeight(dayDiff(asOf, r.date), halfLife) : 1 });
  }
  const beta = caseMix && obs.length > 2 ? fitWithin(obs) : CASE_MIX_LABELS.map(() => 0);
  const xbar = CASE_MIX_LABELS.map((_, j) => obs.reduce((s, o) => s + o.x[j], 0) / (obs.length || 1));
  for (const o of obs) o.ya = o.y - o.x.reduce((s, v, j) => s + (v - xbar[j]) * beta[j], 0);

  const byUnit = new Map(units.map((u) => [u.id, []]));
  for (const o of obs) byUnit.get(o.u)?.push(o);
  const groups = units.map((u) => {
    const os = byUnit.get(u.id); const ws = os.map((o) => o.w); const sw = ws.reduce((a, w) => a + w, 0);
    if (!os.length || !sw) return { id: u.id, n: 0, mean: null, s2: 0, raw: null, count: 0 };
    const n = effectiveN(ws);
    const mean = os.reduce((s, o) => s + o.w * o.ya, 0) / sw;
    const s2 = n > 1 ? (os.reduce((s, o) => s + o.w * (o.ya - mean) ** 2, 0) / sw) * (n / (n - 1)) : 0;
    const raw = os.reduce((s, o) => s + o.y, 0) / os.length;
    return { id: u.id, n, mean, s2, raw, count: os.length };
  });
  const scored = groups.filter((g) => g.n > 0);
  if (!scored.length) return { rows: units.map((u) => ({ unit: u, count: 0, post: null })), beta, sigma2: 0, tau2: 0, k: 0, mu: null };
  const bs = buhlmannStraub(scored, { kFixed });
  const post = new Map(bs.rows.map((r) => [r.id, r]));
  const rows = units.map((u) => {
    const g = groups.find((x) => x.id === u.id); const p = post.get(u.id);
    if (!p) return { unit: u, count: 0, n: 0, post: null };
    const lo = p.post - Z90 * p.sd; const hi = p.post + Z90 * p.sd;
    return { unit: u, count: g.count, n: g.n, raw: g.raw, adjMean: g.mean, z: p.z, post: p.post, sd: p.sd, lo, hi, band: bandOf(lo, hi, bs.mu) };
  });
  const ranked = rows.filter((r) => r.post !== null).sort((a, b) => b.post - a.post);
  const P = rankProbabilities(ranked, draws);
  ranked.forEach((r, i) => { r.rank = i + 1; r.rankP = P[i]; r.pTop = P[i][0]; });
  const unranked = rows.filter((r) => r.post === null);
  return { rows: [...ranked, ...unranked], beta, xbar, sigma2: bs.sigma2, tau2: bs.tau2, k: bs.k, mu: bs.mu };
}

/** 0-100 score to stars (1-5, half steps). */
export const scoreToStars = (s) => Math.round(((s / 100) * 4 + 1) * 2) / 2;
