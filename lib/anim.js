// Animated explainers for the pitch deck: how one Trust Score is built, and credibility weighting.
// Each animation is a pure function of time, draw(ctx, t), on a 1136 x 460 logical canvas. The same
// code plays live in deck.html, prints its final frame to PDF, and records to MP4 (record-anims.mjs).
// All insurers here are fictional (A-K, X); all numbers are illustrative.
(() => {
  const W = 1136; const H = 460;
  const K = {
    bg: '#0f2747', panel: 'rgba(255,255,255,0.04)', grid: 'rgba(255,255,255,0.08)', text: '#e8eef6', muted: '#8ea0b8',
    sky: '#7fb2ff', skyDeep: '#3f7ad8', gold: '#f0b43c', ok: '#3ccf91', warn: '#ff8a5c', teal: '#5fd4c4', grey: '#5d6f88',
  };
  const F = { d: '"Chakra Petch","IBM Plex Sans Thai",sans-serif', b: '"IBM Plex Sans Thai",system-ui,sans-serif', m: '"IBM Plex Mono",monospace' };

  // ------------------------------------------------------------ helpers
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const seg = (t, a, b) => ease(clamp((t - a) / (b - a)));
  const lerp = (a, b, p) => a + (b - a) * p;
  const fmt = (x, d = 1) => x.toFixed(d);
  function text(ctx, s, x, y, { size = 16, font = F.b, weight = 400, color = K.text, align = 'left', base = 'alphabetic', alpha = 1 } = {}) {
    if (alpha <= 0) return;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color;
    ctx.textAlign = align; ctx.textBaseline = base; ctx.fillText(s, x, y); ctx.restore();
  }
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
  function glow(ctx, x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function background(ctx) {
    ctx.fillStyle = K.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, W * 0.8);
    g.addColorStop(0, 'rgba(63,122,216,0.18)'); g.addColorStop(1, 'rgba(15,39,71,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  /** Caption strip at the bottom; crossfades between captions by time. */
  function captions(ctx, t, list) {
    for (const [a, b, th, en] of list) {
      const al = Math.min(seg(t, a, a + 0.5), 1 - seg(t, b - 0.4, b));
      text(ctx, th, 0, H - 26, { size: 19, weight: 600, alpha: al });
      text(ctx, en, 0, H - 4, { size: 14, color: K.muted, alpha: al });
    }
  }
  /** Smooth pseudo-noise in [-1, 1]. */
  const noise = (seed, t) => 0.6 * Math.sin(t * 2.3 + seed) + 0.3 * Math.sin(t * 5.1 + seed * 1.7) + 0.1 * Math.sin(t * 11.7 + seed * 2.9);
  /** Point on a quadratic curve. */
  const qpt = (p0, c, p1, u) => [(1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0], (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1]];

  // ------------------------------------------------------------ shared method (same as public/lib/scoring.js)
  const M_PRIOR = 30; // m: reviews' worth of weight given to the market average
  const SAT_W = 0.7;

  // ============================================================ 1. Scoring pipeline (one fictional insurer X, 120 reviews)
  const ASPECTS = [ // code, Thai label, mean satisfaction 1-5, importance weight (from survey)
    ['A1', 'เบี้ยคุ้มค่า', 3.6, 0.12], ['A2', 'ส่วนลด/โปรโมชัน', 3.4, 0.10],
    ['B1', 'ความครอบคลุม', 4.0, 0.13], ['B2', 'บริการฉุกเฉิน', 4.1, 0.12],
    ['C1', 'ชื่อเสียง', 4.0, 0.11], ['C2', 'คุณภาพคำแนะนำ', 3.8, 0.10],
    ['D1', 'ความเป็นธรรมในการเคลม', 3.6, 0.17], ['D2', 'อู่และเครือข่ายซ่อม', 3.9, 0.15],
  ];
  const N_X = 120; const PROMO = 48; const DETRA = 25; const MARKET = 64.0;
  const SAT5 = ASPECTS.reduce((s, a) => s + a[2] * a[3], 0);
  const SAT100 = ((SAT5 - 1) / 4) * 100;
  const NPS = ((PROMO - DETRA) / N_X) * 100;
  const NPS100 = (NPS + 100) / 2;
  const RAW = SAT_W * SAT100 + (1 - SAT_W) * NPS100;
  const Z_X = N_X / (N_X + M_PRIOR);
  const TRUST = Z_X * RAW + (1 - Z_X) * MARKET;

  const P = { // layout
    rowY: (i) => 34 + i * 44, barX: 200, barW: 180,
    sat: [570, 112], satR: 74, waffle: [462, 262], dot: 13,
    raw: [818, 214], rawR: 58, mkt: [818, 372], trust: [1030, 214], trustR: 74,
  };
  const barEnd = (i) => P.barX + ((ASPECTS[i][2] - 1) / 4) * P.barW;

  function gauge(ctx, [x, y], r, frac, color, label, value, sub, alpha) {
    ctx.save(); ctx.globalAlpha = alpha; ctx.lineCap = 'round';
    ctx.lineWidth = 12; ctx.strokeStyle = K.grid; ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
    if (frac > 0) { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * frac); ctx.stroke(); }
    ctx.restore();
    text(ctx, value, x, y + 8, { size: 34, font: F.d, weight: 700, align: 'center', alpha });
    text(ctx, label, x, y + r + 4, { size: 15, weight: 600, align: 'center', color, alpha });
    text(ctx, sub, x, y + r + 24, { size: 13, font: F.m, align: 'center', color: K.muted, alpha });
  }
  function ribbon(ctx, p0, c, p1, width, color, prog, t, alpha = 1) {
    if (prog <= 0) return;
    ctx.save(); ctx.globalAlpha = alpha * 0.35; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(...p0);
    for (let u = 0; u <= prog + 1e-9; u += 0.02) ctx.lineTo(...qpt(p0, c, p1, Math.min(u, prog)));
    ctx.stroke();
    // flowing highlights along the ribbon
    ctx.globalAlpha = alpha * 0.9; ctx.lineWidth = Math.max(2, width * 0.35); ctx.setLineDash([10, 18]); ctx.lineDashOffset = -t * 60;
    ctx.beginPath(); ctx.moveTo(...p0);
    for (let u = 0; u <= prog + 1e-9; u += 0.02) ctx.lineTo(...qpt(p0, c, p1, Math.min(u, prog)));
    ctx.stroke(); ctx.restore();
  }

  function drawScoring(ctx, t) {
    background(ctx);
    // --- 8 aspect bars (0-2.5 s), importance weights (2.5-4 s)
    text(ctx, 'ความพึงพอใจ 8 ด้าน (1–5)', 0, 14, { size: 14, color: K.muted, alpha: seg(t, 0, 0.6) });
    text(ctx, 'น้ำหนัก', P.barX + P.barW + 66, 14, { size: 14, color: K.gold, align: 'right', alpha: seg(t, 2.5, 3.2) });
    ASPECTS.forEach(([code, label, mean, w], i) => {
      const y = P.rowY(i); const g = seg(t, 0.2 + i * 0.12, 1.4 + i * 0.12);
      const thick = 6 + w * 70;
      text(ctx, code, 0, y + 5, { size: 14, font: F.m, color: K.sky, alpha: g });
      text(ctx, label, 30, y + 5, { size: 14, alpha: g });
      rrect(ctx, P.barX, y - thick / 2, P.barW, thick, thick / 2); ctx.fillStyle = K.grid; ctx.globalAlpha = g; ctx.fill(); ctx.globalAlpha = 1;
      const len = ((mean - 1) / 4) * P.barW * g;
      const grad = ctx.createLinearGradient(P.barX, 0, P.barX + P.barW, 0); grad.addColorStop(0, K.skyDeep); grad.addColorStop(1, K.sky);
      if (len > 0) { rrect(ctx, P.barX, y - thick / 2, len, thick, thick / 2); ctx.fillStyle = grad; ctx.fill(); }
      text(ctx, fmt(mean * g || 0), P.barX + P.barW + 8, y + 5, { size: 13, font: F.m, alpha: g });
      text(ctx, `×${Math.round(w * 100)}%`, P.barX + P.barW + 66, y + 5, { size: 13, font: F.m, color: K.gold, align: 'right', alpha: seg(t, 2.5 + i * 0.08, 3.1 + i * 0.08) });
    });
    // --- particles: each aspect pours into the satisfaction gauge in proportion to its weight (4-7 s)
    const satFill = seg(t, 4.2, 7.0);
    ASPECTS.forEach(([, , , w], i) => {
      const p0 = [barEnd(i) + 4, P.rowY(i)]; const p1 = [P.sat[0] - P.satR * 0.6, P.sat[1] + 10];
      const c = [lerp(p0[0], p1[0], 0.55), lerp(p0[1], p1[1], 0.1) - 30];
      const count = Math.round(w * 60);
      for (let k = 0; k < count; k++) {
        const start = 4 + (k / count) * 2.4 + i * 0.03;
        const u = clamp((t - start) / 0.9);
        if (u <= 0 || u >= 1) continue;
        const [px, py] = qpt(p0, c, p1, ease(u));
        ctx.globalAlpha = Math.sin(u * Math.PI); ctx.fillStyle = k % 3 ? K.sky : K.gold;
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
      }
    });
    const satA = seg(t, 3.8, 4.4);
    glow(ctx, ...P.sat, 110, K.skyDeep, 0.35 * satA);
    gauge(ctx, P.sat, P.satR, (SAT100 / 100) * satFill, K.sky, 'ความพึงพอใจ · Satisfaction', fmt(SAT100 * satFill), `(${fmt(SAT5, 2)} − 1) ÷ 4 × 100`, satA);

    // --- NPS waffle: 120 reviewers sorted into promoters / passives / detractors (5-8.5 s)
    const wa = seg(t, 5.0, 5.6); const sortP = seg(t, 6.2, 7.6);
    text(ctx, `NPS · ${N_X} รีวิว`, P.waffle[0], P.waffle[1] - 14, { size: 14, color: K.muted, alpha: wa });
    for (let k = 0; k < N_X; k++) {
      // deterministic shuffle for the "before" order
      const shuffled = (k * 47) % N_X;
      const cls = k < PROMO ? K.ok : k >= N_X - DETRA ? K.warn : K.grey;
      const appear = seg(t, 5.0 + (shuffled / N_X) * 0.8, 5.3 + (shuffled / N_X) * 0.8);
      if (appear <= 0) continue;
      const pos = Math.round(lerp(shuffled, k, sortP));
      const x = P.waffle[0] + (pos % 20) * (P.dot - 1) + P.dot / 2; const y = P.waffle[1] + Math.floor(pos / 20) * (P.dot - 1) + P.dot / 2;
      ctx.globalAlpha = appear; ctx.fillStyle = cls; ctx.beginPath(); ctx.arc(x, y, (P.dot / 2 - 1.5) * (0.6 + 0.4 * appear), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    }
    const npsA = seg(t, 7.4, 8.2);
    const wy = P.waffle[1] + 6 * (P.dot - 1) + 22;
    text(ctx, `แนะนำ ${fmt((PROMO / N_X) * 100)}%`, P.waffle[0], wy, { size: 13, color: K.ok, alpha: npsA });
    text(ctx, `ไม่แนะนำ ${fmt((DETRA / N_X) * 100)}%`, P.waffle[0] + 238, wy, { size: 13, color: K.warn, align: 'right', alpha: npsA });
    text(ctx, `NPS ${NPS >= 0 ? '+' : ''}${fmt(NPS)}  →  ${fmt(NPS100)} /100`, P.waffle[0] + 119, wy + 24, { size: 16, font: F.m, weight: 500, align: 'center', alpha: npsA });

    // --- merge 70 / 30 into the raw score (8.5-11 s)
    const mp = seg(t, 8.5, 10.0);
    ribbon(ctx, [P.sat[0] + P.satR + 8, P.sat[1]], [700, P.sat[1]], [P.raw[0] - P.rawR, P.raw[1] - 10], 26, K.sky, mp, t);
    ribbon(ctx, [P.waffle[0] + 250, P.waffle[1] + 40], [720, P.waffle[1] + 40], [P.raw[0] - P.rawR, P.raw[1] + 14], 11, K.ok, mp, t);
    text(ctx, '70%', 700, P.sat[1] - 18, { size: 14, font: F.m, color: K.sky, align: 'center', alpha: seg(t, 9.0, 9.5) });
    text(ctx, '30%', 716, P.waffle[1] + 28, { size: 14, font: F.m, color: K.ok, align: 'center', alpha: seg(t, 9.0, 9.5) });
    const rawA = seg(t, 9.4, 10.0); const rawC = seg(t, 9.6, 11.0);
    glow(ctx, ...P.raw, 90, K.skyDeep, 0.4 * rawA);
    ctx.save(); ctx.globalAlpha = rawA; ctx.fillStyle = '#16365f'; ctx.strokeStyle = K.sky; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(...P.raw, P.rawR, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    text(ctx, fmt(RAW * rawC), P.raw[0], P.raw[1] + 11, { size: 32, font: F.d, weight: 700, align: 'center', alpha: rawA });
    text(ctx, 'คะแนนดิบ · Raw', P.raw[0], P.raw[1] - P.rawR - 12, { size: 15, weight: 600, align: 'center', color: K.sky, alpha: rawA });

    // --- credibility: blend with the market average by Z = n / (n + m) (11-15 s)
    const cA = seg(t, 11.0, 11.6); const cp = seg(t, 11.6, 13.0);
    ctx.save(); ctx.globalAlpha = cA; ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.strokeStyle = K.muted; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.arc(...P.mkt, 40, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    text(ctx, fmt(MARKET), P.mkt[0], P.mkt[1] + 8, { size: 22, font: F.d, weight: 700, align: 'center', alpha: cA });
    text(ctx, 'ค่าเฉลี่ยตลาด · Market', P.mkt[0], P.mkt[1] + 64, { size: 13, align: 'center', color: K.muted, alpha: cA });
    ribbon(ctx, [P.raw[0] + P.rawR, P.raw[1]], [930, P.raw[1]], [P.trust[0] - P.trustR, P.trust[1]], 30 * Z_X, K.gold, cp, t);
    ribbon(ctx, [P.mkt[0] + 40, P.mkt[1]], [940, P.mkt[1]], [P.trust[0] - P.trustR * 0.7, P.trust[1] + 50], 30 * (1 - Z_X), K.muted, cp, t);
    text(ctx, `Z = ${N_X} ÷ (${N_X} + ${M_PRIOR}) = ${fmt(Z_X, 2)}`, 924, 52, { size: 15, font: F.m, color: K.gold, align: 'center', alpha: seg(t, 11.8, 12.4) });
    text(ctx, `${Math.round(Z_X * 100)}%`, 922, P.raw[1] - 14, { size: 14, font: F.m, color: K.gold, align: 'center', alpha: seg(t, 12.2, 12.6) });
    text(ctx, `${Math.round((1 - Z_X) * 100)}%`, 928, P.mkt[1] - 26, { size: 14, font: F.m, color: K.muted, align: 'center', alpha: seg(t, 12.2, 12.6) });

    const tA = seg(t, 12.6, 13.2); const tC = seg(t, 12.8, 14.4);
    const pulse = t > 14.4 ? 0.5 + 0.5 * Math.sin((t - 14.4) * 3) : 0;
    glow(ctx, ...P.trust, 130 + pulse * 14, K.gold, (0.35 + 0.15 * pulse) * tA);
    ctx.save(); ctx.globalAlpha = tA; ctx.fillStyle = '#1f3557'; ctx.beginPath(); ctx.arc(...P.trust, P.trustR, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = K.gold; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(...P.trust, P.trustR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (TRUST / 100) * tC); ctx.stroke(); ctx.restore();
    text(ctx, fmt(TRUST * tC), P.trust[0], P.trust[1] + 14, { size: 42, font: F.d, weight: 700, align: 'center', alpha: tA });
    text(ctx, 'Trust Score', P.trust[0], P.trust[1] - P.trustR - 14, { size: 18, font: F.d, weight: 700, align: 'center', color: K.gold, alpha: tA });
    text(ctx, `บริษัทสมมติ X · ${N_X} รีวิว`, P.trust[0], P.trust[1] + P.trustR + 26, { size: 13, align: 'center', color: K.muted, alpha: tA });

    captions(ctx, t, [
      [0, 4.0, 'ลูกค้าให้คะแนน 8 ด้าน ด้านที่คนให้ความสำคัญมากได้น้ำหนักมาก', 'Customers rate 8 aspects; the ones people care about most weigh most (survey weights)'],
      [4.0, 8.4, 'รวมเป็นความพึงพอใจ และนับว่าลูกค้าจะแนะนำต่อหรือไม่ (NPS)', 'Combined into satisfaction, plus whether customers would recommend (NPS)'],
      [8.4, 11.2, `คะแนนดิบ = 70% × ${fmt(SAT100)} + 30% × ${fmt(NPS100)} = ${fmt(RAW)}`, 'Raw score: 70% satisfaction + 30% NPS (a proposal the team can adjust)'],
      [11.2, 99, `Trust Score = ${fmt(Z_X, 2)} × ${fmt(RAW)} + ${fmt(1 - Z_X, 2)} × ${fmt(MARKET)} = ${fmt(TRUST)}`, 'Credibility weighting: the more reviews, the more the score is the insurer’s own'],
    ]);
  }

  // ============================================================ 2. Credibility weighting across 12 fictional insurers
  // [letter, reviews n, raw score]; the raw scores average exactly 64.0 (the market prior).
  const FIRMS = [
    ['A', 1900, 71.0], ['B', 1200, 68.9], ['C', 800, 67.2], ['D', 560, 65.9], ['E', 400, 64.3], ['F', 290, 61.8],
    ['G', 210, 60.0], ['H', 160, 57.7], ['X', 120, 66.9], ['I', 60, 55.5], ['L', 12, 28.8], ['K', 3, 100.0],
  ].map(([id, n, raw], i) => ({ id, n, raw, seed: i * 1.913 + 0.4 }));
  const PRIOR = FIRMS.reduce((s, f) => s + f.raw, 0) / FIRMS.length;
  for (const f of FIRMS) { f.z = f.n / (f.n + M_PRIOR); f.trust = f.z * f.raw + (1 - f.z) * PRIOR; }
  const rankBy = (key) => { const r = {}; [...FIRMS].sort((a, b) => b[key] - a[key]).forEach((f, i) => { r[f.id] = i; }); return r; };
  const RANK_RAW = rankBy('raw'); const RANK_TRUST = rankBy('trust');
  const SIGMA = 18; // illustrative spread of a single review's score (0-100)
  const PL = { x0: 56, x1: 700, y0: 30, y1: 380, s0: 20, s1: 105, l1: 3.4 };
  const sx = (s) => PL.x0 + ((s - PL.s0) / (PL.s1 - PL.s0)) * (PL.x1 - PL.x0);
  const sy = (n) => PL.y1 - (Math.log10(n) / PL.l1) * (PL.y1 - PL.y0);
  const colorOf = (f) => (f.id === 'K' ? K.warn : f.id === 'L' ? K.teal : f.id === 'X' ? K.gold : K.sky);
  const orbR = (n) => 5 + 2 * Math.log10(n);

  /** Orb state at time t: reviews arrive (2-7 s), credibility halos (7-10 s), shrink to Trust Score (10-14 s). */
  function orbAt(f, t) {
    const p = seg(t, 2.0, 7.0); const q = seg(t, 10.2, 13.6);
    const n = Math.max(1, f.n ** p);
    const jitter = noise(f.seed, t * 1.6) * (SIGMA * 1.4 / Math.sqrt(n)) * (1 - p) ** 0.5;
    return { x: sx(lerp(f.raw + jitter, f.trust, q)), y: sy(n), n, q };
  }

  function drawCredibility(ctx, t) {
    background(ctx);
    const axA = seg(t, 0, 0.8);
    // grid + axes
    ctx.save(); ctx.globalAlpha = axA; ctx.strokeStyle = K.grid; ctx.lineWidth = 1;
    for (const s of [20, 40, 60, 80, 100]) { ctx.beginPath(); ctx.moveTo(sx(s), PL.y0); ctx.lineTo(sx(s), PL.y1); ctx.stroke(); }
    for (const n of [1, 10, 100, 1000]) { ctx.beginPath(); ctx.moveTo(PL.x0, sy(n)); ctx.lineTo(PL.x1, sy(n)); ctx.stroke(); }
    ctx.restore();
    for (const s of [40, 60, 80, 100]) text(ctx, String(s), sx(s), PL.y1 + 18, { size: 12, font: F.m, color: K.muted, align: 'center', alpha: axA });
    for (const n of [1, 10, 100, 1000]) text(ctx, n.toLocaleString('en-US'), PL.x0 - 8, sy(n) + 4, { size: 12, font: F.m, color: K.muted, align: 'right', alpha: axA });
    text(ctx, 'จำนวนรีวิว (log) · Reviews', PL.x0 - 50, PL.y0 - 14, { size: 13, color: K.muted, alpha: axA });
    text(ctx, 'คะแนน · Score', PL.x0, PL.y1 + 18, { size: 13, color: K.muted, alpha: axA });

    // funnel: where an average insurer's score could land by chance (95%), drawn bottom-up
    const fp = seg(t, 0.4, 2.2);
    const nTop = 10 ** (PL.l1 * fp);
    ctx.save(); ctx.beginPath();
    const steps = 60; const pts = [];
    for (let k = 0; k <= steps; k++) { const n = 10 ** ((k / steps) * Math.log10(nTop)); pts.push([n, 1.96 * SIGMA / Math.sqrt(n)]); }
    pts.forEach(([n, h], k) => { const x = sx(Math.min(PL.s1, PRIOR + h)); const y = sy(n); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    [...pts].reverse().forEach(([n, h]) => ctx.lineTo(sx(Math.max(PL.s0, PRIOR - h)), sy(n)));
    ctx.closePath();
    const fg = ctx.createLinearGradient(0, PL.y1, 0, PL.y0); fg.addColorStop(0, 'rgba(127,178,255,0.22)'); fg.addColorStop(1, 'rgba(127,178,255,0.05)');
    ctx.fillStyle = fg; ctx.globalAlpha = axA; ctx.fill(); ctx.strokeStyle = 'rgba(127,178,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    // market average line
    ctx.save(); ctx.globalAlpha = axA; ctx.strokeStyle = K.muted; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(sx(PRIOR), PL.y0 - 6); ctx.lineTo(sx(PRIOR), PL.y1); ctx.stroke(); ctx.restore();
    text(ctx, `ค่าเฉลี่ยตลาด ${fmt(PRIOR)}`, sx(PRIOR) + 6, PL.y0 - 10, { size: 12, font: F.m, color: K.muted, alpha: axA });
    text(ctx, 'ช่วงที่คะแนนแกว่งได้โดยบังเอิญ (95%)', sx(PRIOR) - 150, sy(1.6), { size: 12, color: '#a9c8ff', alpha: seg(t, 1.6, 2.4) * (1 - seg(t, 6.5, 7.2)) });

    // orbs, with motion trails while reviews arrive
    const orbsA = seg(t, 1.8, 2.3);
    for (const f of FIRMS) {
      const o = orbAt(f, t); const r = orbR(o.n); const col = colorOf(f);
      if (t > 2 && t < 7.4) {
        for (let k = 8; k >= 1; k--) {
          const pv = orbAt(f, t - k * 0.05);
          ctx.globalAlpha = orbsA * 0.05 * (9 - k); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pv.x, pv.y, orbR(pv.n) * 0.7, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (o.q > 0) { // ghost at the raw score + arrow to the Trust Score
        const gx = sx(f.raw);
        ctx.save(); ctx.globalAlpha = 0.55 * orbsA; ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(gx, o.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(gx, o.y); ctx.lineTo(o.x, o.y); ctx.stroke(); ctx.restore();
      }
      glow(ctx, o.x, o.y, r * 3, col, 0.25 * orbsA);
      ctx.save(); ctx.globalAlpha = orbsA; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      text(ctx, f.id, o.x, o.y + 4, { size: Math.max(9, r), font: F.d, weight: 700, color: K.bg, align: 'center', alpha: orbsA });
      // credibility halo: ring filled to Z
      const hz = seg(t, 7.2 + (f.n < 100 ? 0.6 : 0), 9.0 + (f.n < 100 ? 0.6 : 0));
      if (hz > 0) {
        ctx.save(); ctx.globalAlpha = 0.9; ctx.strokeStyle = K.gold; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(o.x, o.y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f.z * hz); ctx.stroke(); ctx.restore();
      }
    }
    // callouts for K (few perfect reviews), L (few poor reviews) and X (the worked example)
    const call = (id, dx, dy, th, en, a0, a1) => {
      const f = FIRMS.find((g) => g.id === id); const o = orbAt(f, t); const a = Math.min(seg(t, a0, a0 + 0.5), 1 - seg(t, a1, a1 + 0.5));
      if (a <= 0) return;
      ctx.save(); ctx.globalAlpha = a * 0.6; ctx.strokeStyle = colorOf(f); ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + dx * 0.8, o.y + dy * 0.8); ctx.stroke(); ctx.restore();
      text(ctx, th, o.x + dx, o.y + dy, { size: 13, weight: 600, color: colorOf(f), align: dx < 0 ? 'right' : 'left', alpha: a });
      text(ctx, en, o.x + dx, o.y + dy + 16, { size: 12, font: F.m, color: K.muted, align: dx < 0 ? 'right' : 'left', alpha: a });
    };
    call('K', -30, 34, `K: ${FIRMS.find((f) => f.id === 'K').n} รีวิว ได้เต็ม 100`, 'only 3 reviews, all perfect', 6.6, 9.6);
    call('L', 30, 34, 'L: 12 รีวิว คะแนนต่ำ', '12 reviews, low score', 6.8, 9.6);
    const kz = FIRMS.find((f) => f.id === 'K'); const az = FIRMS.find((f) => f.id === 'A');
    call('K', -30, 34, `Z = 3 ÷ 33 = ${fmt(kz.z, 2)}`, 'barely trusted yet', 9.8, 99);
    call('A', 40, -2, `Z = ${fmt(az.z, 2)}`, `${az.n.toLocaleString('en-US')} reviews`, 8.2, 99);
    call('L', 30, 34, `L: ${fmt(FIRMS.find((f) => f.id === 'L').trust)}`, 'not punished for a small sample', 13.4, 99);

    // ranking panel: raw order (5-10 s) re-sorts into Trust Score order (10.2-13.6 s)
    const RX = 760; const rowH = 29; const ry = (i) => 52 + i * rowH;
    const pA = seg(t, 4.6, 5.4); const q = seg(t, 10.2, 13.6);
    ctx.save(); ctx.globalAlpha = pA; ctx.fillStyle = K.panel; rrect(ctx, RX - 12, 4, W - RX + 12, 404, 12); ctx.fill(); ctx.restore();
    text(ctx, 'อันดับจากคะแนนดิบ · Raw ranking', RX, 32, { size: 15, weight: 600, color: K.warn, alpha: pA * (1 - q) });
    text(ctx, 'อันดับจาก Trust Score', RX, 32, { size: 15, weight: 600, color: K.gold, alpha: pA * q });
    for (const f of FIRMS) {
      const pos = lerp(RANK_RAW[f.id], RANK_TRUST[f.id], q); const y = ry(pos);
      const score = lerp(f.raw, f.trust, q); const col = colorOf(f);
      const hi = f.id === 'K' || f.id === 'L' || f.id === 'X';
      if (hi) { ctx.save(); ctx.globalAlpha = pA * 0.12; ctx.fillStyle = col; rrect(ctx, RX - 6, y - 10, W - RX - 6, rowH - 4, 6); ctx.fill(); ctx.restore(); }
      text(ctx, `#${Math.round(pos) + 1}`, RX + 18, y + 9, { size: 13, font: F.m, color: K.muted, align: 'right', alpha: pA });
      ctx.save(); ctx.globalAlpha = pA; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(RX + 36, y + 4, 9, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      text(ctx, f.id, RX + 36, y + 9, { size: 12, font: F.d, weight: 700, color: K.bg, align: 'center', alpha: pA });
      text(ctx, f.n.toLocaleString('en-US'), RX + 92, y + 9, { size: 12, font: F.m, color: K.muted, align: 'right', alpha: pA });
      const bx = RX + 146; const bw = W - bx - 52;
      ctx.save(); ctx.globalAlpha = pA * 0.9; ctx.fillStyle = col; rrect(ctx, bx, y, Math.max(2, (score / 100) * bw), 8, 4); ctx.fill(); ctx.restore();
      text(ctx, fmt(score), W - 6, y + 9, { size: 13, font: F.m, align: 'right', alpha: pA });
    }
    text(ctx, 'รีวิว', RX + 92, 52 + 12 * rowH + 8, { size: 11, color: K.muted, align: 'right', alpha: pA });
    // rank change badges at the end
    const bA = seg(t, 13.6, 14.2);
    for (const id of ['K', 'L']) {
      const d = RANK_RAW[id] - RANK_TRUST[id]; if (!d) continue;
      text(ctx, `${d > 0 ? '▲' : '▼'}${Math.abs(d)}`, RX + 104, ry(RANK_TRUST[id]) + 9, { size: 11, font: F.m, color: d > 0 ? K.ok : K.warn, alpha: bA });
    }

    captions(ctx, t, [
      [0, 2.2, 'บริษัทสมมติ 12 แห่ง: ยิ่งรีวิวน้อย คะแนนยิ่งแกว่งได้มากโดยบังเอิญ', '12 fictional insurers: the fewer the reviews, the more a score can swing by chance'],
      [2.2, 7.2, 'รีวิวเข้ามาเรื่อยๆ ... คะแนนดิบนิ่งขึ้นเมื่อรีวิวมากขึ้น', 'As reviews arrive, raw scores settle down'],
      [7.2, 10.2, 'Z = n ÷ (n + m) : ความน่าเชื่อถือของคะแนน ตามจำนวนรีวิว (m = 30)', 'Credibility Z grows with the number of reviews (m = 30)'],
      [10.2, 99, 'Trust Score = Z × คะแนนดิบ + (1 − Z) × ค่าเฉลี่ยตลาด  ·  Bühlmann credibility', 'The same credibility principle actuaries use to set premiums: K falls #1 → #3, A leads'],
    ]);
  }

  // ============================================================ 3. Hierarchical Bayesian model (proposed for production)
  // Same 12 fictional insurers. Normal-normal approximation of the model, so every curve is real arithmetic:
  //   prior  quality_i ~ N(market, tau^2), tau = sigma / sqrt(k)   (k = 30 reproduces Bühlmann's m)
  //   data   mean of n_i reviews ~ N(quality_i + case-mix effect, sigma^2 / n_i)
  //   posterior mean = (n * adjusted + k * market) / (n + k), posterior sd = sigma / sqrt(n + k)
  const KB = M_PRIOR; const BETA = 12; // points a 100% claimant customer base costs (illustrative)
  const SHARE = { A: 0.22, B: 0.30, C: 0.18, D: 0.41, E: 0.25, F: 0.28, G: 0.20, H: 0.35, X: 0.26, I: 0.15, L: 0.38, K: 0 }; // claimant share
  const SHARE_MEAN = Object.values(SHARE).reduce((s, v) => s + v, 0) / 12;
  const HB = FIRMS.map((f) => {
    const delta = BETA * (SHARE[f.id] - SHARE_MEAN);
    const post = (f.n * (f.raw + delta) + KB * PRIOR) / (f.n + KB); const sd = SIGMA / Math.sqrt(f.n + KB);
    const lo = post - 1.645 * sd; const hi = post + 1.645 * sd;
    return { ...f, share: SHARE[f.id], delta, post, sd, lo, hi, band: lo > PRIOR ? 'above' : hi < PRIOR ? 'below' : 'near' };
  }).sort((a, b) => b.post - a.post);
  // rank probabilities by simulation (seeded, so every run draws the same picture)
  const RANKP = (() => {
    let s = 20261014; const rnd = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let x = Math.imul(s ^ (s >>> 15), 1 | s); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const P = HB.map(() => new Array(12).fill(0)); const N = 4000;
    for (let d = 0; d < N; d++) {
      const draws = HB.map((h, i) => [h.post + h.sd * gauss(), i]).sort((a, b) => b[0] - a[0]);
      draws.forEach(([, i], r) => { P[i][r] += 1 / N; });
    }
    return P;
  })();
  const BANDC = { above: K.ok, near: K.muted, below: K.warn };
  const BANDT = { above: '▲ สูงกว่า', near: '● ใกล้เคียง', below: '▼ ต่ำกว่า' };
  const HP = { x0: 64, x1: 690, s0: 45, s1: 80, row0: 62, rowH: 29.5 };
  const hx = (s) => HP.x0 + ((s - HP.s0) / (HP.s1 - HP.s0)) * (HP.x1 - HP.x0);
  const pdf = (x, m, sd) => Math.exp(-0.5 * ((x - m) / sd) ** 2) / (sd * Math.sqrt(2 * Math.PI));
  const hDisp = (p) => 56 * Math.sqrt(p / 0.97); // display height (square-root scale so wide curves stay visible)

  /** Posterior of one insurer at time t: reviews arrive (2-9 s), case-mix adjustment (9.6-12 s). */
  function hbAt(h, t) {
    const p = seg(t, 2.0, 9.0); const q = seg(t, 9.6, 12.0);
    const n = (h.n + 1) ** p - 1;
    const obs = h.raw + noise(h.seed, t * 1.6) * (SIGMA * 1.4 / Math.sqrt(Math.max(1, n))) * (1 - p) ** 0.5 + q * h.delta;
    return { n, mean: (n * obs + KB * PRIOR) / (n + KB), sd: SIGMA / Math.sqrt(n + KB), q };
  }

  function drawBayes(ctx, t) {
    background(ctx);
    const axA = seg(t, 0, 0.8);
    // axes
    ctx.save(); ctx.globalAlpha = axA; ctx.strokeStyle = K.grid;
    for (const s of [50, 60, 70, 80]) { ctx.beginPath(); ctx.moveTo(hx(s), 18); ctx.lineTo(hx(s), HP.row0 + 11 * HP.rowH + 6); ctx.stroke(); }
    ctx.restore();
    for (const s of [50, 60, 70, 80]) text(ctx, String(s), hx(s), HP.row0 + 11 * HP.rowH + 24, { size: 12, font: F.m, color: K.muted, align: 'center', alpha: axA });
    text(ctx, 'Trust Score', HP.x0, HP.row0 + 11 * HP.rowH + 24, { size: 12, color: K.muted, alpha: axA });
    ctx.save(); ctx.globalAlpha = axA; ctx.strokeStyle = K.muted; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(hx(PRIOR), 18); ctx.lineTo(hx(PRIOR), HP.row0 + 11 * HP.rowH + 6); ctx.stroke(); ctx.restore();
    text(ctx, `ตลาด ${fmt(PRIOR)}`, hx(PRIOR) + 6, 14, { size: 12, font: F.m, color: K.muted, alpha: axA });

    const ciA = seg(t, 13.0, 14.5); // credible-interval phase
    // ridgeline: one posterior curve per insurer, drawn top row first so lower rows overlap
    HB.forEach((h, i) => {
      const base = HP.row0 + i * HP.rowH; const st = hbAt(h, t); const col = colorOf(h);
      const rowA = seg(t, 0.3 + i * 0.05, 1.0 + i * 0.05);
      text(ctx, h.id, 8, base - 2, { size: 14, font: F.d, weight: 700, color: col, alpha: rowA });
      text(ctx, Math.round(st.n).toLocaleString('en-US'), 54, base - 2, { size: 11, font: F.m, color: K.muted, align: 'right', alpha: rowA });
      ctx.beginPath(); ctx.moveTo(hx(HP.s0), base);
      for (let s = HP.s0; s <= HP.s1 + 1e-9; s += 0.2) ctx.lineTo(hx(s), base - hDisp(pdf(s, st.mean, st.sd)) * rowA);
      ctx.lineTo(hx(HP.s1), base); ctx.closePath();
      const g = ctx.createLinearGradient(0, base - 56, 0, base); g.addColorStop(0, col); g.addColorStop(1, 'rgba(15,39,71,0.2)');
      ctx.save(); ctx.globalAlpha = (0.55 - 0.35 * ciA) * rowA; ctx.fillStyle = g; ctx.fill(); ctx.globalAlpha = (1 - 0.6 * ciA) * rowA; ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
      // case-mix: ghost of the unadjusted mean and an arrow to the adjusted one
      if (st.q > 0 && Math.abs(h.delta) > 0.8 && h.n > 50) {
        const a = st.q * (1 - ciA);
        const x0 = hx(st.mean - (st.q * h.delta * st.n) / (st.n + KB)); const x1 = hx(st.mean);
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = K.gold; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, base + 5); ctx.lineTo(x1, base + 5); ctx.stroke();
        ctx.fillStyle = K.gold; ctx.beginPath(); const d = Math.sign(x1 - x0) * 6; ctx.moveTo(x1, base + 5); ctx.lineTo(x1 - d, base + 1); ctx.lineTo(x1 - d, base + 9); ctx.fill(); ctx.restore();
      }
      // 90% credible interval + posterior mean
      if (ciA > 0) {
        const lo = hx(st.mean - 1.645 * st.sd * seg(t, 13.2 + i * 0.08, 14.4 + i * 0.08)); const hi = hx(st.mean + 1.645 * st.sd * seg(t, 13.2 + i * 0.08, 14.4 + i * 0.08));
        ctx.save(); ctx.globalAlpha = ciA; ctx.strokeStyle = BANDC[h.band]; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(lo, base - 6); ctx.lineTo(hi, base - 6); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hx(st.mean), base - 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    });
    // reviews raining into each row
    HB.forEach((h, i) => {
      const base = HP.row0 + i * HP.rowH; const P = Math.round(3 + 6 * Math.log10(h.n));
      for (let k = 0; k < P; k++) {
        const ts = 2.1 + (k / P) * 6.2 + 0.3 * ((Math.sin(k * 12.9898 + i * 78.233) * 43758.5453) % 1 + 1) % 1;
        const u = clamp((t - ts) / 0.7); if (u <= 0 || u >= 1) continue;
        const x = hx(clamp(h.raw + noise(h.seed + k, k) * SIGMA * 0.45, HP.s0 + 1, HP.s1 - 1));
        ctx.save(); ctx.globalAlpha = Math.sin(u * Math.PI) * 0.9; ctx.fillStyle = colorOf(h);
        ctx.beginPath(); ctx.arc(x, base - 40 + 40 * ease(u), 2.4, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    });

    // right panel: claimant share (9-13 s), then rank probabilities (16-24 s)
    const RX = 742; const cmA = Math.min(seg(t, 9.2, 9.8), 1 - seg(t, 13.0, 13.6));
    if (cmA > 0) {
      text(ctx, 'สัดส่วนลูกค้าที่เคยเคลม · Claimant share', RX, 22, { size: 14, weight: 600, color: K.gold, alpha: cmA });
      HB.forEach((h, i) => {
        const y = HP.row0 + i * HP.rowH - 10;
        ctx.save(); ctx.globalAlpha = cmA * 0.85; ctx.fillStyle = K.grid; rrect(ctx, RX, y - 5, 220, 9, 4); ctx.fill();
        ctx.fillStyle = K.gold; rrect(ctx, RX, y - 5, Math.max(2, h.share * 400 * seg(t, 9.4, 10.6)), 9, 4); ctx.fill(); ctx.restore();
        text(ctx, `${Math.round(h.share * 100)}%`, RX + 230, y + 4, { size: 12, font: F.m, alpha: cmA });
        text(ctx, `${h.delta >= 0 ? '+' : '−'}${fmt(Math.abs(h.delta))}`, W - 6, y + 4, { size: 12, font: F.m, color: h.delta >= 0 ? K.ok : K.warn, align: 'right', alpha: cmA * seg(t, 10.4, 11.0) });
      });
      text(ctx, 'ปรับคะแนน', W - 6, 22, { size: 12, color: K.muted, align: 'right', alpha: cmA });
    }
    const rpA = seg(t, 15.8, 16.4);
    if (rpA > 0) {
      const cx0 = 832; const cw = 25;
      text(ctx, 'ความน่าจะเป็นของอันดับ · P(rank)', cx0, 16, { size: 14, weight: 600, color: K.gold, alpha: rpA });
      for (let r = 0; r < 12; r++) text(ctx, String(r + 1), cx0 + r * cw + cw / 2, 35, { size: 10, font: F.m, color: K.muted, align: 'center', alpha: rpA });
      HB.forEach((h, i) => {
        const y = HP.row0 + i * HP.rowH - 22;
        for (let r = 0; r < 12; r++) {
          const wipe = seg(t, 16.0 + r * 0.16, 16.6 + r * 0.16); const p = RANKP[i][r];
          ctx.save(); ctx.globalAlpha = wipe * (0.06 + 0.94 * p ** 0.6); ctx.fillStyle = K.gold; rrect(ctx, cx0 + r * cw + 1, y, cw - 2, HP.rowH - 4, 3); ctx.fill(); ctx.restore();
          if (p >= 0.25) text(ctx, String(Math.round(p * 100)), cx0 + r * cw + cw / 2, y + 17, { size: 10, font: F.m, weight: 500, color: K.bg, align: 'center', alpha: wipe });
        }
        // band chip
        const bA = seg(t, 19.0 + i * 0.06, 19.6 + i * 0.06);
        text(ctx, BANDT[h.band], RX - 30, y + 17, { size: 12, weight: 600, color: BANDC[h.band], alpha: bA });
      });
    }
    // callouts
    const kRow = HB.findIndex((h) => h.id === 'K'); const kH = HB[kRow];
    const kA = seg(t, 14.6, 15.2) * (1 - seg(t, 18.4, 18.9));
    text(ctx, `K: 3 รีวิว ช่วง 90% = ${fmt(kH.lo)}–${fmt(kH.hi)} → ยังสรุปไม่ได้`, hx(kH.hi) + 10, HP.row0 + kRow * HP.rowH - 2, { size: 12, weight: 600, color: K.warn, alpha: kA });

    captions(ctx, t, [
      [0, 2.0, 'ก่อนมีรีวิว: ทุกบริษัทเริ่มจากค่าเฉลี่ยตลาด (prior)', 'Before any reviews, every insurer starts from the market prior'],
      [2.0, 9.4, 'แต่ละรีวิวปรับความเชื่อ (posterior): ยิ่งรีวิวมาก ยิ่งแคบและแม่นขึ้น', 'Each review updates the posterior: more reviews, narrower and sharper'],
      [9.4, 13.0, 'ปรับตามลักษณะลูกค้า (case-mix): บริษัทที่ลูกค้าเคยเคลมมาก ไม่เสียเปรียบ', 'Case-mix adjustment: insurers whose customers claim more are not penalised'],
      [13.0, 15.8, 'ช่วงความเชื่อมั่น 90%: รู้ว่าแตกต่างจากตลาดจริง หรือแค่บังเอิญ', '90% credible intervals: a real difference from the market, or just chance?'],
      [15.8, 99, 'ประกาศเป็นกลุ่ม สูงกว่า / ใกล้เคียง / ต่ำกว่าตลาด แทนอันดับที่แม่นเกินจริง', 'Publish bands (above / near / below market), not falsely precise ranks'],
    ]);
  }

  window.ANIMS = {
    W, H,
    scoring: { dur: 17, draw: drawScoring, numbers: { SAT5, SAT100, NPS, NPS100, RAW, Z: Z_X, TRUST, MARKET } },
    credibility: { dur: 18, draw: drawCredibility, numbers: { PRIOR, firms: FIRMS } },
    bayes: { dur: 22, draw: drawBayes, numbers: { HB, RANKP } },
  };
  /** Fonts the canvas uses; await before drawing so text renders in the right face. */
  window.ANIMS.fontsReady = () => Promise.all([
    '700 20px "Chakra Petch"', '400 20px "IBM Plex Sans Thai"', '600 20px "IBM Plex Sans Thai"', '500 20px "IBM Plex Mono"',
  ].map((f) => document.fonts.load(f, 'กขAa0'))).catch(() => {});
})();
