// OIC Insurer Index prototype: single-page app (hash routes), no build step, no dependencies.
import { STRINGS } from './i18n.js';
import {
  ASPECTS, ASPECT_CODES, SHORT_ASPECT, GROUPS, INSURERS, POLICY_CLASSES, CHANNELS, REGIONS, CLAIM_TYPES, PROVINCES, PRODUCT_LINES, PRODUCT_REQUIRED,
} from './lib/catalog.js';
import { importanceWeights, aspectMeans, weightedSatisfaction, npsBreakdown, trustScores, scoreReviews, meanOf, MIN_REVIEWS_PRIOR } from './lib/scoring.js';
import { bayesScores, scoreToStars, CASE_MIX_LABELS, HALF_LIFE_DAYS } from './lib/bayes.js';
import { verifyPolicy } from './lib/verify.js';
import { track, trackView } from './lib/track.js';
import {
  reviewPoints, balance, charCount, COMMENT_MIN_CHARS, POINT_RULES, CREDIT_RULES, TIERS,
  reviewCredits, creditsInWindow, tierFor, withMultiplier,
} from './lib/points.js';

// ---------------------------------------------------------------- state
const LS_KEY = 'oic-index-demo-v2';
const app = document.getElementById('app');
let seed, simSeed, policies, weights;
let realSurvey = null; // public/data/survey-real.json, written by scripts/import-survey.mjs (local only)
let surveyAgg = null; // public/data/survey-aggregate.json: aggregates of the real survey, safe to publish
let mode = readLS('oic-mode') === 'survey' ? 'survey' : 'sim';
let model = readLS('oic-model') === 'buhl' ? 'buhl' : 'bayes';
let lang = readLS('oic-lang') || 'th';
const filters = { cls: '', region: '', channel: '', source: '', claimed: false };
const prodFilters = { cls: '', insurer: '', sort: 'score' };
const listState = { sort: 'new', comments: false, claims: false, shown: 10 };
let flow = newFlow();
let trendInsurer = null;
let resetArmed = false;
let lastRoute = null;
let portalTab = 'reviews';
let editingProduct = null;

const EXAMPLE_LEDGER = [
  { date: '2025-11-02', points: 150, credits: 50, example: true, th: 'รีวิวกรมธรรม์ปีที่แล้ว', en: "Review of last year's policy" },
  { date: '2026-01-15', points: 20, credits: 8, example: true, th: 'มีคนกดว่ารีวิวมีประโยชน์ 4 ครั้ง', en: '4 helpful votes on your review' },
];
let local = migrate(readLS(LS_KEY, true)) || freshLocal();
function freshLocal() {
  return { myReviews: [], ledger: EXAMPLE_LEDGER.map((e) => ({ ...e })), helpful: [], replies: {}, appeals: [], productEdits: {}, newProducts: [], surveyDone: false, drawEntries: 0 };
}
function migrate(l) { return l ? { ...freshLocal(), ...l } : null; }

function readLS(key, json = false) {
  try { const v = localStorage.getItem(key); return json ? JSON.parse(v) : v; } catch { return null; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* storage blocked: demo still works for this session */ }
}
const saveLocal = () => { writeLS(LS_KEY, local); memo.clear(); };

// ---------------------------------------------------------------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function t(key, vars = {}) {
  const s = STRINGS[key]?.[lang] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
const L = (obj) => (obj ? obj[lang] ?? obj.en ?? '' : '');
const fmt = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : Number(n).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const signed = (n, d = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), d);
const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));
const INS = byId(INSURERS);
const CLS = byId(POLICY_CLASSES);
const CH = byId(CHANNELS);
const REG = byId(REGIONS);
const CT = byId(CLAIM_TYPES);
const LINE = byId(PRODUCT_LINES);
const ASP = Object.fromEntries(ASPECTS.map((a) => [a.code, a]));
const todayBkk = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok' }).format(new Date());
const addDays = (iso, d) => new Date(Date.parse(iso) + d * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
function fmtDate(iso) {
  return new Date(`${iso}T00:00:00+07:00`).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' });
}
function stars(v) {
  const full = Math.round(v ?? 0);
  return `<span class="stars" aria-label="${fmt(v)} / 5">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
}
const thb = (n) => (n === null || n === undefined ? '–' : `฿${fmt(n, 0)}`);

// products: seed listings plus edits and additions made in the insurer portal (this browser only)
function productList() {
  return [...simSeed.products.map((p) => ({ ...p, ...(local.productEdits[p.id] || {}) })), ...local.newProducts];
}
const productById = (id) => productList().find((p) => p.id === id);
const missingFields = (p) => PRODUCT_REQUIRED.filter((f) => p[f] === null || p[f] === undefined || p[f] === '' || (Array.isArray(p[f]) && !p[f].length));
const lineName = (p) => (LINE[p.line] ? L(LINE[p.line]) : L(CLS[p.cls]));

const myReviews = () => (mode === 'sim' ? local.myReviews : []);
// reviews the OIC removed after upholding an insurer's appeal (this browser only)
const hiddenIds = () => new Set(local.appeals.filter((a) => a.status === 'upheld').map((a) => a.reviewId));
const visibleApp = () => { const h = hiddenIds(); return h.size ? seed.appReviews.filter((r) => !h.has(r.id)) : seed.appReviews; };
const allReviews = () => [...seed.surveyResponses, ...visibleApp(), ...myReviews()];
const textReviews = () => [...visibleApp(), ...myReviews()];
const reviewedSet = () => new Set([...simSeed.appReviews, ...local.myReviews].map((r) => r.policy_no));
const reviewOverall = (r) => weightedSatisfaction(r.sat, weights);
const ledgerBalance = () => balance(local.ledger);
const replyOf = (r) => (local.replies[r.id] ? { ...local.replies[r.id], mine: true } : r.reply);

function filterReviews(rs, f) {
  return rs.filter((r) => (!f.cls || r.cls === f.cls) && (!f.region || r.region === f.region)
    && (!f.channel || r.channel === f.channel) && (!f.source || r.source === f.source) && (!f.claimed || r.claimed));
}
function options(list, selected, allLabel, label = L) {
  return `${allLabel === null ? '' : `<option value="">${esc(allLabel)}</option>`}${list.map((x) => `<option value="${x.id}"${x.id === selected ? ' selected' : ''}>${esc(label(x))}</option>`).join('')}`;
}

// ---------------------------------------------------------------- scores (memoised per dataset, filter and model)
const memo = new Map();
/**
 * Scores for insurers or products. Returns { rows, mu, k, sigma2, tau2, beta, buhl } where each row has
 * { unit, post, lo, hi, band, count, rank, pTop, rankP, means, nps }. In "buhl" mode intervals and bands are null.
 */
function scores(kind, rs, { useModel = model } = {}) {
  // saveLocal() and applyMode() clear the cache, so the key only has to tell apart filters and models
  const key = `${kind}|${useModel}|${rs.length}|${rs[0]?.id}|${rs.at(-1)?.id}`;
  if (memo.has(key)) return memo.get(key);
  const units = kind === 'insurer' ? INSURERS : productList();
  const unitOf = kind === 'insurer' ? (r) => r.insurer : (r) => r.product;
  const pool = kind === 'insurer' ? rs : rs.filter((r) => r.product);
  let res;
  if (useModel === 'buhl') {
    const tr = trustScores(units, pool.map((r) => ({ ...r, insurer: unitOf(r) })), weights);
    res = { rows: tr.rows.map((r) => ({ unit: r.insurer, post: r.trust, count: r.n, rank: r.rank, lo: null, hi: null, band: null })), mu: tr.prior, k: MIN_REVIEWS_PRIOR, buhl: true };
  } else {
    res = bayesScores(units, pool, weights, { unitOf, asOf: seed.meta.as_of });
  }
  // per-unit aspect means and NPS for display
  const groups = new Map(units.map((u) => [u.id, []]));
  for (const r of pool) groups.get(unitOf(r))?.push(r);
  for (const row of res.rows) {
    const g = groups.get(row.unit.id) || [];
    row.means = aspectMeans(g);
    row.nps = npsBreakdown(g.map((r) => r.nps));
    row.count = g.length;
  }
  res.byId = Object.fromEntries(res.rows.map((r) => [r.unit.id, r]));
  memo.set(key, res);
  return res;
}

// ---------------------------------------------------------------- small components
const BAND_ICON = { above: '▲', near: '●', below: '▼' };
const bandChip = (band) => (band ? `<span class="band ${band}" data-tip="${esc(t(`band_${band}_tip`))}">${BAND_ICON[band]} ${t(`band_${band}`)}</span>` : '');
/** Interval strip: market tick, 90% interval, posterior mean. Scale lo..hi (score points). */
function ciStrip(row, mu, [s0, s1] = [40, 80]) {
  if (row.lo === null || row.lo === undefined) return `<div class="meter"><i style="width:${row.post}%"></i></div>`;
  const x = (v) => Math.max(0, Math.min(100, ((v - s0) / (s1 - s0)) * 100));
  const tip = t('ci_tip', { lo: fmt(row.lo), hi: fmt(row.hi), mu: fmt(mu), p: fmt((row.pTop ?? 0) * 100, 0) });
  return `<div class="ci" data-tip="${esc(tip)}" role="img" aria-label="${esc(tip)}"><span class="track"></span><span class="mk" style="left:${x(mu)}%"></span>
    <span class="ci-seg ${row.band}" style="left:${x(row.lo)}%;width:${x(row.hi) - x(row.lo)}%"></span><span class="pt" style="left:${x(row.post)}%"></span></div>`;
}
const tierBadge = (credits) => { const { tier } = tierFor(credits ?? 0); return tier.id === 'member' ? '' : `<span class="tb ${tier.id}" data-tip="${esc(t('tier_badge_tip'))}">${t(`tier_${tier.id}`)}</span>`; };
const scoreRange = (rows) => {
  const vals = rows.filter((r) => r.post !== null).flatMap((r) => [r.lo ?? r.post, r.hi ?? r.post]);
  return [Math.floor(Math.min(...vals) / 5) * 5 - 2, Math.ceil(Math.max(...vals) / 5) * 5 + 2];
};

// ---------------------------------------------------------------- page chrome: title band, footer, preferences
const ICON = {
  products: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/></svg>',
  review: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  oic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
};
/** Navy title band above the page content. crumbs = [[label, href?], ...] after "Home". */
function setBand({ title, sub = '', crumbs = [], kick = '' }) {
  const cr = crumbs.length ? `<nav class="crumbs" aria-label="Breadcrumb"><a href="#/">${t('crumb_home')}</a>${crumbs.map(([l, h]) => ` <span aria-hidden="true">›</span> ${h ? `<a href="${h}">${esc(l)}</a>` : `<span>${esc(l)}</span>`}`).join('')}</nav>` : '';
  document.getElementById('band').innerHTML = `<section class="pageband"><div class="pageband-in">${cr}${kick ? `<span class="kick">${kick}</span>` : ''}<h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div></section>`;
}
function renderFooter() {
  const links = [['#/', 'nav_rank'], ['#/products', 'nav_products'], ['#/review', 'nav_review'], ['#/wallet', 'nav_wallet'], ['#/portal', 'nav_portal'], ['#/oic', 'nav_oic'], ['#/method', 'nav_method']];
  document.getElementById('foot').innerHTML = `<div class="foot-in">
    <div class="foot-brand"><b>${t('brand')}</b><span>${t('foot_about')}</span></div>
    <div><h4>${t('foot_menu')}</h4><ul>${links.map(([h, k]) => `<li><a href="${h}">${t(k)}</a></li>`).join('')}</ul></div>
    <div><h4>${t('foot_data')}</h4><p>${t('foot_data_text')}</p></div></div>
    <div class="foot-bottom"><span>${t('foot_copy')}</span><span>${t('foot_version', { d: fmtDate(seed.meta.as_of) })}</span></div>`;
}
/** Text size (s / m / l) and light / dark choice, remembered in this browser. */
function applyPrefs() {
  const root = document.documentElement;
  const size = readLS('oic-size') || 'm';
  root.dataset.size = size;
  document.querySelectorAll('#sizer [data-size]').forEach((b) => b.classList.toggle('on', b.dataset.size === size));
  const theme = readLS('oic-theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  const shown = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.querySelectorAll('#themer [data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === shown));
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    simSeed = await (await fetch('data/seed.json')).json();
  } catch {
    app.innerHTML = '<p class="err">Could not load data/seed.json. Run <code>npm run generate</code>, then <code>npm start</code>, and open the address it prints.</p>';
    return;
  }
  try {
    const res = await fetch('data/survey-real.json');
    if (res.ok) realSurvey = await res.json();
  } catch { /* no imported survey yet */ }
  try {
    const res = await fetch('data/survey-aggregate.json');
    if (res.ok) surveyAgg = await res.json();
  } catch { /* no imported survey yet */ }
  policies = new Map(simSeed.policies.map((p) => [p.policy_no, p]));
  applyMode();
  document.getElementById('lang').addEventListener('click', () => {
    lang = lang === 'th' ? 'en' : 'th';
    writeLS('oic-lang', lang);
    track(`lang-${lang}`);
    render();
  });
  window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); trackView(); });
  document.querySelectorAll('#sizer [data-size]').forEach((b) => b.addEventListener('click', () => { writeLS('oic-size', b.dataset.size); applyPrefs(); }));
  document.querySelectorAll('#themer [data-theme-set]').forEach((b) => b.addEventListener('click', () => { writeLS('oic-theme', b.dataset.themeSet); applyPrefs(); }));
  applyPrefs();
  setupTooltip();
  render();
}

// "sim": simulated survey + simulated verified app reviews (default)
// "survey": real imported survey answers only; app reviews hidden so real and simulated data never mix
function applyMode() {
  if (mode === 'survey' && !realSurvey) mode = 'sim';
  seed = mode === 'survey' ? { ...simSeed, surveyResponses: realSurvey.responses, appReviews: [] } : simSeed;
  weights = mode === 'sim' && surveyAgg ? { ...surveyAgg.weights } : importanceWeights(seed.surveyResponses);
  memo.clear();
}

function modeSelect() {
  if (!realSurvey) return '';
  return `<label>${t('f_mode')}<select id="f-mode">
    <option value="sim"${mode === 'sim' ? ' selected' : ''}>${t('mode_sim')}</option>
    <option value="survey"${mode === 'survey' ? ' selected' : ''}>${t('mode_survey', { n: fmt(realSurvey.responses.length, 0) })}</option></select></label>`;
}
function modelSelect() {
  return `<label>${t('f_model')}<select id="f-model">
    <option value="bayes"${model === 'bayes' ? ' selected' : ''}>${t('model_bayes')}</option>
    <option value="buhl"${model === 'buhl' ? ' selected' : ''}>${t('model_buhl')}</option></select></label>`;
}
function bindSelects(rerender) {
  document.getElementById('f-mode')?.addEventListener('change', (e) => { mode = e.target.value; writeLS('oic-mode', mode); applyMode(); rerender(); });
  document.getElementById('f-model')?.addEventListener('change', (e) => { model = e.target.value; writeLS('oic-model', model); rerender(); });
}

function renderChrome(route) {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.getElementById('lang').textContent = lang === 'th' ? 'EN' : 'ไทย';
  document.querySelector('.disclaimer').textContent = mode === 'survey'
    ? t('disclaimer_real', { n: fmt(realSurvey.responses.length, 0), d: realSurvey.meta.date_range?.join(' – ') ?? '' })
    : t('disclaimer');
  document.querySelector('.disclaimer').classList.toggle('real', mode === 'survey');
  document.getElementById('nav-balance').textContent = fmt(ledgerBalance(), 0);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === route));
  document.title = `${t('brand')} · ${t('brand_sub')}`;
  renderFooter();
}

function render() {
  const [route, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const navRoute = { insurer: '', product: 'products' }[route] ?? (route || '');
  renderChrome(navRoute);
  if (route === 'review' && lastRoute !== 'review' && flow.step === 3) flow = newFlow(); // start fresh after a finished review
  lastRoute = route;
  if (route === 'insurer' && INS[arg]) viewInsurer(arg);
  else if (route === 'product' && productById(arg)) viewProduct(arg);
  else if (route === 'products') viewProducts();
  else if (route === 'review') viewReview();
  else if (route === 'wallet') viewWallet();
  else if (route === 'portal') viewPortal(INS[arg] ? arg : INSURERS[0].id);
  else if (route === 'oic') viewOic();
  else if (route === 'method') viewMethod();
  else viewHome();
}

// ---------------------------------------------------------------- home: insurer rankings
// Factual notices about the prototype itself (not news about any insurer).
const NOTICES = [
  { date: '2026-10-14', th: 'เปิดต้นแบบรุ่นที่ 2: ผลิตภัณฑ์ที่ขึ้นทะเบียน คะแนนแบบ Bayesian ระดับสมาชิก และระบบสำหรับบริษัทประกัน', en: 'Prototype version 2: listed products, Bayesian scores, member tiers and the insurer portal' },
  { date: '2026-10-14', th: 'แบบสอบถามผู้ใช้รถเสร็จสิ้น: ตอบ 673 คน ใช้วิเคราะห์ได้ 423 คน น้ำหนักคะแนนและระดับของข้อมูลจำลองมาจากแบบสอบถามนี้', en: 'Car-owner survey complete: 673 responses, 423 usable; score weights and simulated data levels come from it' },
  { date: '2026-10-13', th: 'ข้อมูลทั้งหมดในเว็บไซต์นี้เป็นข้อมูลจำลอง ชื่อบริษัทและผลิตภัณฑ์เป็นชื่อสมมติ', en: 'All data on this site is simulated; insurer and product names are fictional' },
];
function bestWorst(row, market) {
  const diffs = ASPECT_CODES.filter((c) => row.means[c] !== null && market[c] !== null).map((c) => [c, row.means[c] - market[c]]);
  diffs.sort((a, b) => b[1] - a[1]);
  return [diffs[0], diffs.at(-1)];
}

function viewHome() {
  const rs = filterReviews(allReviews(), filters);
  const res = scores('insurer', rs);
  const market = aspectMeans(rs);
  const isFiltered = Object.values(filters).some(Boolean);
  const range = scoreRange(res.rows);
  const list = res.rows.map((row) => {
    const ins = row.unit;
    if (row.post === null) {
      return `<div class="rank-item"><div class="rank-no">–</div><div class="rank-name"><h3>${esc(L(ins))}</h3><span class="muted small">${t('no_data')}</span></div></div>`;
    }
    const [best, worst] = bestWorst(row, market);
    const nProducts = productList().filter((p) => p.insurer === ins.id).length;
    return `<a class="rank-item" href="#/insurer/${ins.id}">
      <div class="rank-no">${row.rank}</div>
      <div class="rank-name">
        <h3>${esc(L(ins))} ${bandChip(row.band)}</h3>
        <div class="rank-meta">
          <span>${fmt(row.count, 0)} ${t('reviews_n')}</span><span>·</span><span>${fmt(nProducts, 0)} ${t('products_n')}</span><span>·</span><span>NPS ${signed(row.nps.nps, 0)}</span>
          ${best && best[1] > 0.05 ? `<span class="chip good">▲ ${t('best')}: ${esc(L(ASP[best[0]]))}</span>` : ''}
          ${worst && worst[1] < -0.05 ? `<span class="chip bad">▼ ${t('weakest')}: ${esc(L(ASP[worst[0]]))}</span>` : ''}
        </div>
      </div>
      <div class="rank-score">
        <div class="score-line">${stars(scoreToStars(row.post))}<span class="score-big">${fmt(row.post)}</span><span class="muted small">/100</span></div>
        ${ciStrip(row, res.mu, range)}
        ${row.pTop !== undefined ? `<span class="muted small" style="text-align:right">${t('p_rank1', { p: fmt(row.pTop * 100, 0) })}</span>` : ''}
      </div>
    </a>`;
  }).join('');

  document.getElementById('band').innerHTML = `<section class="pageband hero"><div class="pageband-in">
      <div class="hero-left"><span class="kick">${t('hero_kick')}</span><h1>${t('hero_title')}</h1><p class="sub">${t('hero_sub')}</p></div>
      <div class="hero-stats stats">
        <div class="stat"><b>${INSURERS.length}</b><span>${t('stat_insurers')}</span></div>
        <div class="stat"><b>${fmt(productList().length, 0)}</b><span>${t('stat_products')}</span></div>
        <div class="stat"><b>${fmt(textReviews().length, 0)}</b><span>${t('stat_verified')}</span></div>
        <div class="stat"><b>${fmt(seed.policies.length, 0)}</b><span>${t('stat_register')}</span></div>
      </div></div></section>`;
  app.innerHTML = `
    <div class="quick">
      <a href="#/products"><span class="qi">${ICON.products}</span><span><b>${t('quick_products')}</b><small>${t('quick_products_d')}</small></span></a>
      <a href="#/review"><span class="qi">${ICON.review}</span><span><b>${t('quick_review')}</b><small>${t('quick_review_d')}</small></span></a>
      <a href="#/oic"><span class="qi">${ICON.oic}</span><span><b>${t('quick_oic')}</b><small>${t('quick_oic_d')}</small></span></a>
    </div>
    <section class="section">
      <h2>${t('home_title')}</h2>
      <p class="muted small">${model === 'bayes' ? t('home_sub_bayes') : t('home_sub')}</p>
    </section>
    <nav class="tabs"><a class="on" href="#/">${t('tab_insurers')}</a><a href="#/products">${t('tab_products')}</a></nav>
    <div class="filters">
      <label>${t('f_class')}<select id="f-cls">${options(POLICY_CLASSES, filters.cls, t('all'))}</select></label>
      <label>${t('f_region')}<select id="f-region">${options(REGIONS, filters.region, t('all'))}</select></label>
      <label>${t('f_channel')}<select id="f-channel">${options(CHANNELS, filters.channel, t('all'))}</select></label>
      <label>${t('f_source')}<select id="f-source">${options([{ id: 'app', th: STRINGS.src_app.th, en: STRINGS.src_app.en }, { id: 'survey', th: STRINGS.src_survey.th, en: STRINGS.src_survey.en }], filters.source, t('all'))}</select></label>
      ${modelSelect()}${modeSelect()}
      <label class="check"><input type="checkbox" id="f-claimed"${filters.claimed ? ' checked' : ''}> ${t('f_claimed')}</label>
      ${isFiltered ? `<span class="chip warn">${t('filtered_note')} · n = ${fmt(rs.length, 0)}</span>` : ''}
    </div>
    ${model === 'bayes' ? `<div class="legend small"><span>${bandChip('above')} ${bandChip('near')} ${bandChip('below')}</span><span>${t('legend_ci')}</span></div>` : ''}
    <div class="rank-list">${list}</div>
    <div class="home-info">
      <section class="card section">
        <h2>${t('how_title')}</h2>
        <ol class="howto">${[1, 2, 3, 4].map((i) => `<li><b>${t(`how_${i}`)}</b><span>${t(`how_${i}_d`)}</span></li>`).join('')}</ol>
        <a class="small" href="#/method">${t('how_more')} →</a>
      </section>
      <section class="card section">
        <h2>${t('notice_title')}</h2>
        <ul class="notices">${NOTICES.map((n) => `<li><time>${fmtDate(n.date)}</time><span>${esc(L(n))}</span></li>`).join('')}</ul>
      </section>
    </div>`;
  for (const [id, key] of [['f-cls', 'cls'], ['f-region', 'region'], ['f-channel', 'channel'], ['f-source', 'source']]) {
    document.getElementById(id).addEventListener('change', (e) => { filters[key] = e.target.value; viewHome(); });
  }
  bindSelects(viewHome);
  document.getElementById('f-claimed').addEventListener('change', (e) => { filters.claimed = e.target.checked; viewHome(); });
}

// ---------------------------------------------------------------- products ranking
function viewProducts() {
  setBand({ title: t('products_title'), sub: t('products_sub'), crumbs: [[t('nav_products')]] });
  const res = scores('product', allReviews());
  let rows = res.rows.filter((r) => (!prodFilters.cls || r.unit.cls === prodFilters.cls) && (!prodFilters.insurer || r.unit.insurer === prodFilters.insurer));
  const sorters = {
    score: (a, b) => (b.post ?? -1) - (a.post ?? -1),
    premium: (a, b) => (a.unit.premium_thb ?? 1e9) - (b.unit.premium_thb ?? 1e9),
    reviews: (a, b) => b.count - a.count,
  };
  rows = [...rows].sort(sorters[prodFilters.sort]);
  const range = scoreRange(res.rows);
  app.innerHTML = `
    <nav class="tabs"><a href="#/">${t('tab_insurers')}</a><a class="on" href="#/products">${t('tab_products')}</a></nav>
    <div class="filters">
      <label>${t('f_class')}<select id="p-cls">${options(POLICY_CLASSES, prodFilters.cls, t('all'))}</select></label>
      <label>${t('f_insurer')}<select id="p-ins">${options(INSURERS, prodFilters.insurer, t('all'))}</select></label>
      <label>${t('f_sort')}<select id="p-sort">${['score', 'premium', 'reviews'].map((k) => `<option value="${k}"${prodFilters.sort === k ? ' selected' : ''}>${t(`psort_${k}`)}</option>`).join('')}</select></label>
      ${modelSelect()}
      <span class="chip">${fmt(rows.length, 0)} ${t('products_n')}</span>
    </div>
    <div class="rank-list">${rows.map((row) => {
      const p = row.unit; const miss = missingFields(p);
      return `<a class="rank-item" href="#/product/${p.id}">
        <div class="rank-no small">${row.rank ?? '–'}</div>
        <div class="rank-name">
          <h3>${esc(p.name)} ${bandChip(row.band)}</h3>
          <div class="rank-meta"><span>${esc(L(INS[p.insurer]))}</span><span>·</span><span>${esc(L(CLS[p.cls]))}</span><span>·</span><span>${t('premium_from', { v: thb(p.premium_thb) })}</span><span>·</span><span>${fmt(row.count, 0)} ${t('reviews_n')}</span>
            ${p.ev_battery ? `<span class="chip good">EV</span>` : ''}${miss.length ? `<span class="chip bad">${t('listing_incomplete')}</span>` : ''}</div>
        </div>
        <div class="rank-score">${row.post === null ? `<span class="muted small">${t('no_reviews_yet')}</span>` : `
          <div class="score-line">${stars(scoreToStars(row.post))}<span class="score-big">${fmt(row.post)}</span></div>${ciStrip(row, res.mu, range)}`}</div>
      </a>`;
    }).join('')}</div>`;
  document.getElementById('p-cls').addEventListener('change', (e) => { prodFilters.cls = e.target.value; viewProducts(); });
  document.getElementById('p-ins').addEventListener('change', (e) => { prodFilters.insurer = e.target.value; viewProducts(); });
  document.getElementById('p-sort').addEventListener('change', (e) => { prodFilters.sort = e.target.value; viewProducts(); });
  bindSelects(viewProducts);
}

// ---------------------------------------------------------------- insurer page
function aspectBars(means, market, marketLabel = t('market_avg')) {
  let lastGroup = '';
  return ASPECTS.map((a) => {
    const v = means[a.code];
    const m = market[a.code];
    const head = a.group !== lastGroup ? `<div class="grp-head mono small muted" style="margin-top:6px">${a.group} · ${esc(L(GROUPS[a.group]))}</div>` : '';
    lastGroup = a.group;
    const pct = (x) => ((x - 1) / 4) * 100;
    const tip = `${L(a)}: ${fmt(v, 2)} / 5 · ${marketLabel} ${fmt(m, 2)} · ${t('weight')} ${fmt(weights[a.code] * 100, 1)}%`;
    return `${head}<div class="hist-row" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) 92px" data-tip="${esc(tip)}">
      <span class="small">${esc(L(a))}</span>
      <span class="meter" style="height:12px;position:relative;overflow:visible">
        <i style="width:${v === null ? 0 : pct(v)}%;border-radius:0 4px 4px 0;background:var(--series-1)"></i>
        ${m === null ? '' : `<b style="position:absolute;left:${pct(m)}%;top:-3px;bottom:-3px;width:2px;background:var(--ink)"></b>`}
      </span>
      <span class="small num" style="text-align:right"><b>${fmt(v, 2)}</b> <span class="muted">${fmt(weights[a.code] * 100, 0)}%</span></span>
    </div>`;
  }).join('');
}

// ---------------------------------------------------------------- 8-aspect card: radar (default) or bars
let aspectView = readLS('oic-aspect-view') === 'bars' ? 'bars' : 'radar';
const RADAR_MIN = 2; const RADAR_MAX = 5; // ratings are 1-5; scores cluster high, so the centre is 2
const GROUP_VAR = { A: '--grp-a', B: '--grp-b', C: '--grp-c', D: '--grp-d' };

/** Radar chart as SVG. Axes clockwise from the top in catalog order; scale RADAR_MIN..RADAR_MAX. */
function radarSvg(means, market, marketLabel) {
  const W = 480; const H = 410; const cx = 240; const cy = 205; const R = 132; const LR = 150;
  const n = ASPECTS.length;
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const rad = (v) => (R * (Math.min(RADAR_MAX, Math.max(RADAR_MIN, v)) - RADAR_MIN)) / (RADAR_MAX - RADAR_MIN);
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const poly = (vals) => ASPECTS.map((a, i) => pt(i, rad(vals[a.code] ?? RADAR_MIN)).map((v) => v.toFixed(1)).join(',')).join(' ');
  let g = `<svg class="chart radar" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('radar_aria'))}">`;
  // group sectors (each group spans its two axes)
  for (let k = 0; k < n; k += 2) {
    const a0 = ang(k) - Math.PI / n; const a1 = ang(k + 1) + Math.PI / n; const rr = R + 6;
    g += `<path d="M${cx},${cy}L${(cx + rr * Math.cos(a0)).toFixed(1)},${(cy + rr * Math.sin(a0)).toFixed(1)}A${rr},${rr} 0 0 1 ${(cx + rr * Math.cos(a1)).toFixed(1)},${(cy + rr * Math.sin(a1)).toFixed(1)}Z" fill="var(${GROUP_VAR[ASPECTS[k].group]})" fill-opacity=".09"/>`;
  }
  // rings and spokes
  for (let v = RADAR_MIN; v <= RADAR_MAX; v += 1) {
    g += `<polygon class="ring" points="${ASPECTS.map((_, i) => pt(i, rad(v)).map((x) => x.toFixed(1)).join(',')).join(' ')}" fill="none"/>`;
    if (v > RADAR_MIN) g += `<text class="ring-lbl" x="${cx + 4}" y="${(cy - rad(v) + 11).toFixed(1)}">${v}</text>`;
  }
  ASPECTS.forEach((a, i) => {
    const [x, y] = pt(i, R);
    g += `<line class="spoke" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="var(${GROUP_VAR[a.group]})"/>`;
  });
  // comparison (dashed, no fill) then this unit (solid, light fill)
  g += `<polygon class="radar-avg" points="${poly(market)}"/>`;
  g += `<polygon class="radar-unit" points="${poly(means)}"/>`;
  // labels: code + short name, anchored away from the centre
  ASPECTS.forEach((a, i) => {
    const [x, y] = pt(i, LR); const c = Math.cos(ang(i)); const sn = Math.sin(ang(i));
    const anchor = c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle';
    const dy = sn < -0.9 ? -14 : sn > 0.9 ? 6 : -4;
    g += `<text class="radar-lbl" x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}"><tspan class="code">${a.code}</tspan><tspan x="${x.toFixed(1)}" dy="1.15em">${esc(L(SHORT_ASPECT[a.code]))}</tspan></text>`;
  });
  // vertices with large touch targets
  ASPECTS.forEach((a, i) => {
    const v = means[a.code];
    if (v === null || v === undefined) return;
    const [x, y] = pt(i, rad(v));
    const tip = `${a.code} ${L(a)} · ${fmt(v, 2)} / 5 · ${marketLabel} ${fmt(market[a.code], 2)} · ${t('weight')} ${fmt(weights[a.code] * 100, 1)}%`;
    g += `<g data-tip="${esc(tip)}" tabindex="0" role="img" aria-label="${esc(tip)}"><circle class="hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14"/><circle class="radar-pt" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4.5"/></g>`;
  });
  return `${g}</svg>`;
}

/** Compact list under the radar: groups A-D, each aspect with score, comparison and weight. */
function radarList(means, market, marketLabel) {
  return `<div class="radar-list">${Object.keys(GROUPS).map((grp) => `<div class="rl-group">
    <div class="rl-head"><span class="rl-gname"><i style="background:var(${GROUP_VAR[grp]})"></i>${grp} · ${esc(L(GROUPS[grp]))}</span><span>${t('rl_score')}</span><span>${t('rl_avg')}</span><span>${t('weight')}</span></div>
    ${ASPECTS.filter((a) => a.group === grp).map((a) => `<div class="rl-row" data-tip="${esc(`${a.code} ${L(a)}`)}"><span class="rl-name"><b>${a.code}</b> ${esc(L(SHORT_ASPECT[a.code]))}</span>
      <span class="num"><b>${fmt(means[a.code], 2)}</b></span><span class="num muted">${fmt(market[a.code], 2)}</span><span class="num muted">${fmt(weights[a.code] * 100, 0)}%</span></div>`).join('')}
  </div>`).join('')}</div>`;
}

/** Hidden table: the same numbers for screen readers. */
function aspectTable(means, market, unitLabel, marketLabel) {
  return `<table class="sr-only"><caption>${esc(t('aspects_title'))}: ${esc(unitLabel)}</caption><thead><tr><th>${t('aspect')}</th><th>${esc(unitLabel)}</th><th>${esc(marketLabel)}</th><th>${t('weight')}</th></tr></thead>
    <tbody>${ASPECTS.map((a) => `<tr><td>${a.code} ${esc(L(a))}</td><td>${fmt(means[a.code], 2)}</td><td>${fmt(market[a.code], 2)}</td><td>${fmt(weights[a.code] * 100, 1)}%</td></tr>`).join('')}</tbody></table>`;
}

function renderAspectCard({ means, market, marketLabel, unitLabel, empty = false }) {
  const box = document.getElementById('aspect-card');
  if (!box) return;
  const seg = `<div class="seg view-seg" role="group" aria-label="${esc(t('view_label'))}">${['radar', 'bars'].map((v) => `<button type="button" data-view="${v}" class="${aspectView === v ? 'on' : ''}" aria-pressed="${aspectView === v}">${t(`view_${v}`)}</button>`).join('')}</div>`;
  const legend = `<div class="legend"><span><i></i>${esc(unitLabel)}</span><span><i class="${aspectView === 'radar' ? 'dash' : 'tick'}"></i>${esc(marketLabel)}</span></div>`;
  const body = empty ? `<p class="muted">${t('no_reviews_yet')}</p>`
    : aspectView === 'radar'
      ? `<p class="muted small">${t('radar_note', { min: RADAR_MIN })}</p><div class="radar-wrap">${radarSvg(means, market, marketLabel)}</div>${legend}${radarList(means, market, marketLabel)}`
      : `<p class="muted small">${t('bars_note')}</p><div class="hist">${aspectBars(means, market, marketLabel)}</div>${legend}`;
  box.innerHTML = `<div class="row between"><h2>${t('aspects_title')}</h2>${empty ? '' : seg}</div>${body}${empty ? '' : aspectTable(means, market, unitLabel, marketLabel)}`;
  box.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => {
    aspectView = b.dataset.view; writeLS('oic-aspect-view', aspectView);
    track(`view-${aspectView}`);
    renderAspectCard({ means, market, marketLabel, unitLabel, empty });
  }));
}

function npsStack(b) {
  return `<div class="stack" role="img" aria-label="NPS ${fmt(b.nps, 0)}">
      <span class="det" style="width:${b.detractors}%" data-tip="${esc(t('detractors'))}: ${fmt(b.detractors, 0)}%"></span>
      <span class="pas" style="width:${b.passives}%" data-tip="${esc(t('passives'))}: ${fmt(b.passives, 0)}%"></span>
      <span class="pro" style="width:${b.promoters}%" data-tip="${esc(t('promoters'))}: ${fmt(b.promoters, 0)}%"></span>
    </div>
    <div class="legend"><span><i class="sq det"></i>${t('detractors')} ${fmt(b.detractors, 0)}%</span><span><i class="sq pas"></i>${t('passives')} ${fmt(b.passives, 0)}%</span><span><i class="sq pro"></i>${t('promoters')} ${fmt(b.promoters, 0)}%</span></div>`;
}

/** Score block used on insurer and product pages. */
function scoreBlock(row, res, rowsCount) {
  if (row.post === null) return `<div class="ins-score"><span class="muted">${t('no_reviews_yet')}</span></div>`;
  return `<div class="ins-score">
    <span class="muted small">Trust Score</span>
    <span><span class="score-big">${fmt(row.post)}</span><span class="muted"> /100</span></span>
    ${stars(scoreToStars(row.post))}
    ${row.lo !== null && row.lo !== undefined ? `<span class="small muted">${t('ci90', { lo: fmt(row.lo), hi: fmt(row.hi) })}</span>${bandChip(row.band)}` : ''}
    <span class="small muted">${t('rank_of', { r: row.rank, n: rowsCount })}${row.pTop !== undefined ? ` · ${t('p_rank1', { p: fmt(row.pTop * 100, 0) })}` : ''}</span>
  </div>`;
}

function viewInsurer(id) {
  const ins = INS[id];
  const all = allReviews();
  const res = scores('insurer', all);
  const row = res.byId[id];
  const market = aspectMeans(all);
  const mine = all.filter((r) => r.insurer === id);
  const nApp = mine.filter((r) => r.source === 'app').length;
  const dist = [5, 4, 3, 2, 1].map((s) => [s, mine.filter((r) => Math.round(reviewOverall(r)) === s).length]);
  const maxDist = Math.max(...dist.map((d) => d[1]), 1);
  const pres = scores('product', all);
  const prods = productList().filter((p) => p.insurer === id);
  const ranked = res.rows.filter((r) => r.post !== null).length;
  setBand({ title: esc(L(ins)), sub: t('insurer_band_sub'), crumbs: [[t('nav_rank'), '#/'], [L(ins)]] });

  app.innerHTML = `
    <div class="ins-head">
      <div class="section" style="gap:6px">
        <p class="muted">${esc(lang === 'th' ? ins.en : ins.th)} · <span class="chip warn">${t('fictional')}</span></p>
        <div class="row small muted">
          <span>${fmt(nApp, 0)} ${t('src_app')}</span><span>·</span>
          <span>${fmt(mine.length - nApp, 0)} ${t('src_survey')}</span>
          ${row.z !== undefined ? `<span>·</span><span data-tip="${esc(t('z_tip'))}">${t('credibility_z', { z: fmt(row.z, 2) })}</span>` : ''}
        </div>
        <a class="btn" href="#/review" style="width:fit-content;margin-top:6px">${t('write_for')}</a>
      </div>
      ${scoreBlock(row, res, ranked)}
    </div>
    <section class="card section">
      <h2>${t('ins_products_title')}</h2>
      <div class="tablebox"><table><thead><tr><th>${t('product')}</th><th>${t('f_class')}</th><th class="r">${t('premium_year')}</th><th class="r">${t('reviews_n')}</th><th class="r">Trust Score</th><th>${t('band')}</th></tr></thead>
      <tbody>${prods.map((p) => { const pr = pres.byId[p.id]; return `<tr><td><a href="#/product/${p.id}">${esc(p.name)}</a>${missingFields(p).length ? ` <span class="chip bad">${t('listing_incomplete')}</span>` : ''}</td><td>${esc(L(CLS[p.cls]))}</td><td class="r num">${thb(p.premium_thb)}</td><td class="r num">${fmt(pr?.count ?? 0, 0)}</td><td class="r num"><b>${fmt(pr?.post)}</b></td><td>${bandChip(pr?.band)}</td></tr>`; }).join('')}</tbody></table></div>
    </section>
    <div class="grid2">
      <section class="card section aspect-card" id="aspect-card"></section>
      <div class="section">
        <div class="card section">
          <div class="row between"><h2>${t('nps_title')}</h2><span class="score-big num">${signed(row.nps.nps, 0)}</span></div>
          ${npsStack(row.nps)}
        </div>
        ${row.rankP ? `<div class="card section"><h2>${t('rankp_title')}</h2><p class="muted small">${t('rankp_note')}</p>${rankPBars(row.rankP)}</div>` : ''}
        <div class="card section">
          <h2>${t('dist_title')}</h2>
          <div class="hist">${dist.map(([s, n]) => `<div class="hist-row" data-tip="${s}★: ${fmt(n, 0)} (${fmt((n / mine.length) * 100, 0)}%)"><span class="num">${s} ★</span><span class="meter"><i style="width:${(n / maxDist) * 100}%"></i></span><span class="num small muted" style="text-align:right">${fmt(n, 0)}</span></div>`).join('')}</div>
        </div>
      </div>
    </div>
    ${reviewSection()}`;
  renderAspectCard({ means: row.means, market, marketLabel: t('market_avg'), unitLabel: L(ins) });
  bindReviewSection((r) => r.insurer === id);
}

function rankPBars(P) {
  const max = Math.max(...P);
  return `<div class="rankp">${P.map((p, r) => `<div data-tip="${esc(t('rankp_cell', { r: r + 1, p: fmt(p * 100, 1) }))}"><span style="height:${Math.max(2, (p / max) * 100)}%"></span><b>${r + 1}</b></div>`).join('')}</div>`;
}

function reviewSection() {
  return `<section class="card section" id="reviews">
      <div class="row between">
        <h2>${t('reviews_title')}</h2>
        <div class="row">
          <select id="r-sort" aria-label="Sort">${['new', 'helpful', 'low', 'high'].map((k) => `<option value="${k}"${listState.sort === k ? ' selected' : ''}>${t(`sort_${k}`)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" id="r-comments"${listState.comments ? ' checked' : ''}> ${t('only_comments')}</label>
          <label class="check"><input type="checkbox" id="r-claims"${listState.claims ? ' checked' : ''}> ${t('only_claims')}</label>
        </div>
      </div>
      <div id="review-list"></div>
    </section>`;
}
function bindReviewSection(pred) {
  const rerenderList = () => renderReviewList(pred);
  document.getElementById('r-sort').addEventListener('change', (e) => { listState.sort = e.target.value; listState.shown = 10; rerenderList(); });
  document.getElementById('r-comments').addEventListener('change', (e) => { listState.comments = e.target.checked; listState.shown = 10; rerenderList(); });
  document.getElementById('r-claims').addEventListener('change', (e) => { listState.claims = e.target.checked; listState.shown = 10; rerenderList(); });
  rerenderList();
}

function helpfulCount(r) { return (r.helpful || 0) + (local.helpful.includes(r.id) ? 1 : 0); }
function myCredits() { return creditsInWindow(local.ledger, todayBkk()); }

function reviewHtml(r) {
  const overall = reviewOverall(r);
  const voted = local.helpful.includes(r.id);
  const prod = r.product ? productById(r.product) : null;
  const reply = replyOf(r);
  return `<article class="review">
      <div class="who">
        ${stars(overall)}<b class="num">${fmt(overall)}</b>
        <span>${esc(r.mine ? t('your_review') : r.reviewer)}</span>
        ${tierBadge(r.mine ? myCredits() : r.reviewer_credits)}
        <span class="badge-v">✓ ${t('verified')}</span>
        ${r.mine ? `<span class="badge-me">${t('your_review')}</span>` : ''}
        <span class="muted">${fmtDate(r.date)}</span>
      </div>
      <div class="aspects">
        ${prod ? `<a class="chip" href="#/product/${prod.id}">${esc(prod.name)}</a>` : `<span class="chip">${esc(L(CLS[r.cls]))}</span>`}
        <span class="chip">${esc(L(CH[r.channel]))}</span><span class="chip">${esc(L(REG[r.region]))}</span>
        ${r.claimed ? `<span class="chip">${t('claimed_tag')}${r.claimType ? `: ${esc(L(CT[r.claimType]))}` : ''}</span>` : ''}
        ${r.photo ? `<span class="chip">📷 ${t('evidence')}</span>` : ''}
        <span class="chip">NPS ${r.nps}/10</span>
      </div>
      ${r.comment ? `<p class="text">${esc(r.comment.text)}</p>` : ''}
      ${reply ? `<div class="reply"><b>${t('insurer_reply', { ins: L(INS[r.insurer]) })}</b><span class="muted small">${fmtDate(reply.date)}</span><span>${esc(reply.text ?? L(reply))}</span></div>` : ''}
      <details><summary>${t('aspects_title')}</summary>
        <div class="aspects" style="margin-top:6px">${ASPECTS.map((a) => `<span class="chip">${a.code} ${r.sat[a.code] === null ? t('na') : `${r.sat[a.code]}★`}</span>`).join('')}</div>
      </details>
      ${r.mine ? '' : `<div><button class="helpful-btn${voted ? ' on' : ''}" data-helpful="${r.id}" type="button">👍 ${t('helpful')} · ${helpfulCount(r)}</button></div>`}
    </article>`;
}

function renderReviewList(pred) {
  let rs = textReviews().filter(pred);
  if (listState.comments) rs = rs.filter((r) => r.comment);
  if (listState.claims) rs = rs.filter((r) => r.claimed);
  const sorters = {
    new: (a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || b.date.localeCompare(a.date),
    helpful: (a, b) => helpfulCount(b) - helpfulCount(a),
    low: (a, b) => reviewOverall(a) - reviewOverall(b),
    high: (a, b) => reviewOverall(b) - reviewOverall(a),
  };
  rs.sort(sorters[listState.sort]);
  const box = document.getElementById('review-list');
  box.innerHTML = rs.slice(0, listState.shown).map(reviewHtml).join('')
    + (rs.length > listState.shown ? `<div style="padding-top:12px"><button class="btn ghost small" id="more" type="button">${t('show_more')} (${fmt(rs.length - listState.shown, 0)})</button></div>` : '')
    + (rs.length ? '' : `<p class="muted">${t('no_data')}</p>`);
  box.querySelectorAll('[data-helpful]').forEach((b) => b.addEventListener('click', () => {
    const rid = b.dataset.helpful;
    local.helpful = local.helpful.includes(rid) ? local.helpful.filter((x) => x !== rid) : [...local.helpful, rid];
    saveLocal();
    renderReviewList(pred);
  }));
  document.getElementById('more')?.addEventListener('click', () => { listState.shown += 10; renderReviewList(pred); });
}

// ---------------------------------------------------------------- product page
function viewProduct(id) {
  const p = productById(id);
  const all = allReviews();
  const res = scores('product', all);
  const row = res.byId[id];
  const classMarket = aspectMeans(all.filter((r) => r.cls === p.cls));
  const miss = missingFields(p);
  const ranked = res.rows.filter((r) => r.post !== null).length;
  const yes = (b) => (b ? `<span class="chip good">✓ ${t('yes')}</span>` : `<span class="chip">✗ ${t('no')}</span>`);
  const chans = (p.claim_channel || []).map((c) => t(`claim_ch_${c}`)).join(' · ');
  setBand({ title: esc(p.name), sub: `${esc(L(INS[p.insurer]))} · ${esc(L(CLS[p.cls]))}`, crumbs: [[t('nav_products'), '#/products'], [L(INS[p.insurer]), `#/insurer/${p.insurer}`], [p.name]] });
  app.innerHTML = `
    <div class="ins-head">
      <div class="section" style="gap:6px">
        <p class="muted">${esc(lineName(p))} · ${esc(L(CLS[p.cls]))}</p>
        ${miss.length ? `<p class="err small">${t('listing_missing', { f: miss.map((f) => t(`req_${f}`)).join(', ') })}</p>` : `<span class="chip good" style="width:fit-content">✓ ${t('listing_complete')}</span>`}
      </div>
      ${scoreBlock(row, res, ranked)}
    </div>
    <div class="grid2">
      <section class="card section">
        <h2>${t('product_facts')}</h2>
        <div class="feat">
          <b>${t('premium_year')}</b><span>${thb(p.premium_thb)} <span class="muted small">${t('premium_note')}</span></span>
          <b>${t('req_deductible_thb')}</b><span>${p.deductible_thb === null || p.deductible_thb === undefined ? `<span class="chip bad">${t('not_provided')}</span>` : thb(p.deductible_thb)}</span>
          <b>${t('roadside')}</b><span>${yes(p.roadside_24h)}</span>
          <b>${t('flood')}</b><span>${yes(p.flood)}</span>
          <b>${t('ev_battery')}</b><span>${yes(p.ev_battery)}</span>
          <b>${t('req_claim_channel')}</b><span>${chans || `<span class="chip bad">${t('not_provided')}</span>`}</span>
          <b>${t('req_exclusions')}</b><span>${p.exclusions ? esc(L(p.exclusions)) : `<span class="chip bad">${t('not_provided')}</span>`}</span>
          <b>${t('listed_on')}</b><span>${fmtDate(p.listed_at)} · ${t('updated_on')} ${fmtDate(p.updated_at)}</span>
        </div>
        <p class="muted small">${t('listing_rule')}</p>
      </section>
      <section class="card section aspect-card" id="aspect-card"></section>
    </div>
    ${reviewSection()}`;
  renderAspectCard({ means: row.means, market: classMarket, marketLabel: t('class_avg_of', { c: L(CLS[p.cls]) }), unitLabel: p.name, empty: !row.count });
  bindReviewSection((r) => r.product === id);
}

// ---------------------------------------------------------------- review flow
function newFlow() {
  return { step: 1, input: { policyNo: '', plate: '', province: 'กรุงเทพมหานคร', nationalId: '', consent: false }, error: null, policy: null,
    sat: Object.fromEntries(ASPECT_CODES.map((c) => [c, undefined])), nps: null, claimed: null, claimType: '', channel: '', region: '',
    comment: '', photo: false, earned: null, credits: null, tierBefore: null, reviewId: null, missing: false };
}

function viewReview() {
  setBand({ title: t('review_title'), sub: t('review_sub'), crumbs: [[t('nav_review')]] });
  const steps = [t('step_verify'), t('step_rate'), t('step_done')].map((s, i) => `<span class="${i + 1 === flow.step ? 'on' : i + 1 < flow.step ? 'done' : ''}">${i + 1}. ${s}</span>`).join('');
  app.innerHTML = `<div class="steps">${steps}</div><div id="flow"></div>`;
  if (flow.step === 1) stepVerify();
  else if (flow.step === 2) stepRate();
  else stepDone();
}

function stepVerify() {
  const f = flow.input;
  const box = document.getElementById('flow');
  box.innerHTML = `<div class="layout-side">
    <form class="card form" id="vform" novalidate>
      <h2>${t('verify_title')}</h2>
      <p class="muted small">${t('verify_sub')}</p>
      <label class="field"><span>${t('policy_no')}</span><input type="text" id="v-policy" autocomplete="off" placeholder="AUR-26-0012345" value="${esc(f.policyNo)}"></label>
      <div class="grid2" style="gap:12px">
        <label class="field"><span>${t('plate')}</span><input type="text" id="v-plate" autocomplete="off" placeholder="1กข 1234" value="${esc(f.plate)}"></label>
        <label class="field"><span>${t('province')}</span><select id="v-province">${PROVINCES.map((p) => `<option${p === f.province ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>${t('national_id')}</span><input type="text" id="v-id" inputmode="numeric" autocomplete="off" placeholder="x-xxxx-xxxxx-xx-x" value="${esc(f.nationalId)}"></label>
      <label class="check" style="align-items:flex-start"><input type="checkbox" id="v-consent"${f.consent ? ' checked' : ''} style="margin-top:5px"> <span>${t('consent')}</span></label>
      ${flow.error ? `<p class="err" role="alert">${t(`err_${flow.error}`)}</p>` : ''}
      <div><button class="btn" type="submit" id="v-submit">${t('verify_btn')}</button></div>
    </form>
    <aside class="card section">
      <h3>${t('demo_title')}</h3>
      <p class="muted small">${t('demo_sub')}</p>
      <div class="demo-acc">${seed.demoAccounts.map((d, i) => `<div class="demo-row">
        <div><b>${esc(L(INS[d.insurer]))}</b> · ${esc(productById(d.product)?.name ?? '')} <span class="chip ${d.expect === 'ok' ? 'good' : 'bad'}">${t(`expect_${d.expect}`)}</span><br>
        <code>${d.policy_no} · ${d.plate} ${d.province} · ${d.national_id}</code></div>
        <button class="btn ghost small" type="button" data-demo="${i}">${t('use')}</button></div>`).join('')}</div>
    </aside></div>`;
  const read = () => {
    f.policyNo = document.getElementById('v-policy').value;
    f.plate = document.getElementById('v-plate').value;
    f.province = document.getElementById('v-province').value;
    f.nationalId = document.getElementById('v-id').value;
    f.consent = document.getElementById('v-consent').checked;
  };
  box.querySelectorAll('[data-demo]').forEach((b) => b.addEventListener('click', () => {
    const d = seed.demoAccounts[Number(b.dataset.demo)];
    Object.assign(f, { policyNo: d.policy_no, plate: d.plate, province: d.province, nationalId: d.national_id.replace(/^(\d)(\d{4})(\d{5})(\d{2})(\d)$/, '$1-$2-$3-$4-$5'), consent: true });
    flow.error = null;
    stepVerify();
  }));
  document.getElementById('vform').addEventListener('submit', async (e) => {
    e.preventDefault();
    read();
    if (!f.consent) { flow.error = 'consent'; stepVerify(); return; }
    const btn = document.getElementById('v-submit');
    btn.disabled = true; btn.textContent = t('checking');
    const res = await verifyPolicy(f, policies, reviewedSet(), todayBkk());
    if (!res.ok) { flow.error = res.reason; stepVerify(); return; }
    flow.error = null;
    track('policy-verified');
    flow.policy = res.policy;
    flow.step = 2;
    viewReview();
  });
}

function earnPreview() {
  const { tier } = tierFor(myCredits(), { memberDays: memberDays() });
  const p = reviewPoints({ verified: true, comment: flow.comment, hasPhoto: flow.photo });
  const c = reviewCredits({ verified: true, comment: flow.comment, hasPhoto: flow.photo, claimed: flow.claimed });
  const total = withMultiplier(p.total, tier);
  const has = new Set(p.lines.map((l) => l.key));
  const line = (key, pts) => `<div class="earn-line${has.has(key) ? '' : ' off'}"><span>${t(`p_${key}`)}</span><span class="mono">+${pts}</span></div>`;
  return `<span class="small">${t('you_earn')}</span>
    <span class="total">${total} ${t('pts')}</span>
    ${line('verifiedReview', POINT_RULES.verifiedReview)}${line('comment', POINT_RULES.comment)}${line('photo', POINT_RULES.photo)}
    ${tier.mult > 1 ? `<div class="earn-line"><span>${t('tier_bonus', { tier: t(`tier_${tier.id}`), m: tier.mult })}</span><span class="mono">+${total - p.total}</span></div>` : ''}
    <div class="earn-line" style="border-top:1px solid var(--line);padding-top:6px"><span>${t('status_credits')}</span><span class="mono">+${c.total}</span></div>
    ${flow.claimed && !flow.photo ? `<p class="small muted">${t('credit_hint_evidence', { n: CREDIT_RULES.claimEvidence })}</p>` : ''}
    <p class="small" style="color:var(--gold-ink)"><b>${t('same_points')}</b></p>`;
}

function stepRate() {
  const p = flow.policy;
  const prod = productById(p.product);
  const box = document.getElementById('flow');
  if (!flow.claimed) flow.sat.D1 = flow.claimed === false ? null : flow.sat.D1;
  const starRow = (a) => {
    const v = flow.sat[a.code];
    const lockedNA = a.code === 'D1' && flow.claimed === false;
    return `<div class="rate-row"><span><span class="code">${a.code}</span>${esc(L(a))}</span>
      <span class="starpick" data-asp="${a.code}">
        ${[1, 2, 3, 4, 5].map((s) => `<button type="button" data-s="${s}" class="${v && s <= v ? 'on' : ''}" aria-label="${s}"${lockedNA ? ' disabled' : ''}>★</button>`).join('')}
        ${a.code === 'D1' ? `<span class="na${v === null ? ' on' : ''}">${t('na')}</span>` : ''}
      </span></div>`;
  };
  const remaining = Math.max(0, COMMENT_MIN_CHARS - charCount(flow.comment));
  box.innerHTML = `<div class="layout-side">
    <div class="card form">
      <p class="okmsg">✓ ${t('verified_ok', { ins: L(INS[p.insurer]), cls: prod ? prod.name : L(CLS[p.cls]), end: fmtDate(p.end) })}</p>
      <h2>${t('rate_title')}</h2>
      <div class="field"><span>${t('claimed_q')}</span>
        <div class="seg" id="claimed"><button type="button" data-v="yes" class="${flow.claimed === true ? 'on' : ''}">${t('yes')}</button><button type="button" data-v="no" class="${flow.claimed === false ? 'on' : ''}">${t('no')}</button></div></div>
      ${flow.claimed ? `<label class="field"><span>${t('claim_type')}</span><select id="claim-type">${options(CLAIM_TYPES, flow.claimType, '–')}</select></label>` : ''}
      <p class="muted small">${t('rate_sub')}</p>
      <div>${ASPECTS.map(starRow).join('')}</div>
      <div class="field"><span>${t('nps_q')}</span>
        <div class="npspick" id="nps">${[...Array(11).keys()].map((n) => `<button type="button" data-n="${n}" class="${flow.nps === n ? 'on' : ''}">${n}</button>`).join('')}</div>
        <div class="row between small muted"><span>0 · ${t('nps_lo')}</span><span>10 · ${t('nps_hi')}</span></div></div>
      <div class="grid2" style="gap:12px">
        <label class="field"><span>${t('f_channel')}</span><select id="r-channel">${options(CHANNELS, flow.channel, '–')}</select></label>
        <label class="field"><span>${t('f_region')}</span><select id="r-region">${options(REGIONS, flow.region, '–')}</select></label>
      </div>
      <label class="field"><span>${t('comment')}</span><textarea id="r-comment" rows="4" placeholder="${esc(t('comment_ph'))}">${esc(flow.comment)}</textarea>
        <span class="small muted" id="c-hint">${remaining ? t('comment_hint', { n: remaining }) : t('comment_ok')}</span></label>
      <label class="check"><input type="checkbox" id="r-photo"${flow.photo ? ' checked' : ''}> ${t('photo')}</label>
      ${flow.missing ? `<p class="err" role="alert">${t('need_all')}</p>` : ''}
      <div><button class="btn" type="button" id="r-submit">${t('submit')}</button></div>
    </div>
    <aside class="earn-box" id="earn">${earnPreview()}</aside></div>`;

  box.querySelectorAll('#claimed button').forEach((b) => b.addEventListener('click', () => {
    flow.claimed = b.dataset.v === 'yes';
    flow.sat.D1 = flow.claimed ? undefined : null;
    if (!flow.claimed) flow.claimType = '';
    stepRate();
  }));
  document.getElementById('claim-type')?.addEventListener('change', (e) => { flow.claimType = e.target.value; });
  box.querySelectorAll('.starpick').forEach((sp) => sp.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    flow.sat[sp.dataset.asp] = Number(b.dataset.s);
    sp.querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.s) <= flow.sat[sp.dataset.asp]));
  })));
  box.querySelectorAll('#nps button').forEach((b) => b.addEventListener('click', () => {
    flow.nps = Number(b.dataset.n);
    box.querySelectorAll('#nps button').forEach((x) => x.classList.toggle('on', x === b));
  }));
  document.getElementById('r-channel').addEventListener('change', (e) => { flow.channel = e.target.value; });
  document.getElementById('r-region').addEventListener('change', (e) => { flow.region = e.target.value; });
  document.getElementById('r-comment').addEventListener('input', (e) => {
    flow.comment = e.target.value;
    const rem = Math.max(0, COMMENT_MIN_CHARS - charCount(flow.comment));
    document.getElementById('c-hint').textContent = rem ? t('comment_hint', { n: rem }) : t('comment_ok');
    document.getElementById('earn').innerHTML = earnPreview();
  });
  document.getElementById('r-photo').addEventListener('change', (e) => { flow.photo = e.target.checked; document.getElementById('earn').innerHTML = earnPreview(); });
  document.getElementById('r-submit').addEventListener('click', submitReview);
}

function memberDays() {
  const first = local.ledger.map((e) => e.date).sort()[0];
  return first ? daysBetween(first, todayBkk()) : 0;
}

function submitReview() {
  const ratingsDone = ASPECT_CODES.every((c) => flow.sat[c] !== undefined) && flow.nps !== null && flow.claimed !== null;
  if (!ratingsDone) { flow.missing = true; stepRate(); return; }
  track('review-submitted');
  const p = flow.policy;
  const date = todayBkk();
  const text = flow.comment.trim();
  const before = tierFor(myCredits(), { memberDays: memberDays() }).tier;
  const review = {
    id: `ME-${Date.now()}`, source: 'app', verified: true, mine: true, insurer: p.insurer, product: p.product, date, cls: p.cls,
    channel: flow.channel || 'online', region: flow.region || 'bkk', claimed: flow.claimed, claimType: flow.claimType || null,
    sat: { ...flow.sat }, nps: flow.nps, comment: text ? { lang, text } : null, reviewer: '', policy_no: p.policy_no, helpful: 0, photo: flow.photo,
  };
  const base = reviewPoints({ verified: true, comment: text, hasPhoto: flow.photo });
  const credits = reviewCredits({ verified: true, comment: text, hasPhoto: flow.photo, claimed: flow.claimed });
  const total = withMultiplier(base.total, before);
  const lines = [...base.lines, ...(total > base.total ? [{ key: 'tierBonus', points: total - base.total }] : [])];
  local.myReviews.push(review);
  local.ledger.push({ date, points: total, credits: credits.total, th: `รีวิว ${productById(p.product)?.name ?? INS[p.insurer].th} (${p.policy_no})`, en: `Review of ${productById(p.product)?.name ?? INS[p.insurer].en} (${p.policy_no})`, lines });
  saveLocal();
  Object.assign(flow, { step: 3, earned: { total, lines }, credits, tierBefore: before.id, reviewId: review.id, missing: false });
  viewReview();
}

function stepDone() {
  const ins = INS[flow.policy.insurer];
  const now = tierFor(myCredits(), { memberDays: memberDays() });
  const up = now.tier.id !== flow.tierBefore;
  document.getElementById('flow').innerHTML = `<div class="card section" style="max-width:600px">
    <h2>${t('done_title')}</h2>
    <p>${t('done_sub')}</p>
    ${up ? `<div class="tiercard t-${now.tier.id} small-card"><span class="tn">${t(`tier_${now.tier.id}`)}</span><b>${t('tier_up', { tier: t(`tier_${now.tier.id}`) })}</b><span>${t('tier_up_sub', { m: now.tier.mult })}</span></div>` : ''}
    <div class="earn-box" style="position:static">
      <span class="total">+${flow.earned.total} ${t('pts')}</span>
      ${flow.earned.lines.map((l) => `<div class="earn-line"><span>${t(`p_${l.key}`)}</span><span class="mono">+${l.points}</span></div>`).join('')}
      <div class="earn-line" style="border-top:1px solid var(--line);padding-top:6px"><span>${t('status_credits')}</span><span class="mono">+${flow.credits.total}</span></div>
    </div>
    <div class="row">
      <a class="btn" href="#/product/${flow.policy.product}" id="see">${t('see_review')}</a>
      <a class="btn ghost" href="#/wallet">${t('go_wallet')}</a>
      <button class="btn ghost" type="button" id="again">${t('another')}</button>
    </div></div>`;
  document.getElementById('see').addEventListener('click', () => { listState.sort = 'new'; listState.comments = false; listState.claims = false; });
  document.getElementById('again').addEventListener('click', () => { flow = newFlow(); viewReview(); });
  renderChrome('review');
}

// ---------------------------------------------------------------- wallet: tiers and rewards
const REWARDS = [
  { id: 'r_fuel', cost: 1000 }, { id: 'r_toll', cost: 1000 }, { id: 'r_wash', cost: 800 }, { id: 'r_check', cost: 1500 },
  { id: 'r_kit', cost: 2000 }, { id: 'r_course', cost: 3000 }, { id: 'r_dashcam', cost: 0, minTier: 'gold' }, { id: 'r_donate', cost: 100 },
];
const TIER_PERKS = {
  member: ['perk_member_1'],
  copper: ['perk_copper_1', 'perk_copper_2', 'perk_copper_3'],
  silver: ['perk_silver_1', 'perk_silver_2', 'perk_silver_3'],
  gold: ['perk_gold_1', 'perk_gold_2', 'perk_gold_3'],
  platinum: ['perk_plat_1', 'perk_plat_2', 'perk_plat_3', 'perk_plat_4'],
};
const tierIndex = (id) => TIERS.findIndex((x) => x.id === id);

function viewWallet(message = '') {
  const bal = ledgerBalance();
  const credits = myCredits();
  const { tier, next, toNext } = tierFor(credits, { memberDays: memberDays() });
  const prog = next ? ((credits - tier.min) / (next.min - tier.min)) * 100 : 100;
  const hist = [...local.ledger].reverse();
  setBand({ title: t('wallet_title'), sub: t('wallet_sub'), crumbs: [[t('nav_wallet')]] });
  app.innerHTML = `
    <div class="grid2">
      <div class="tiercard t-${tier.id}">
        <span class="tt">${t('tier_label')}</span>
        <span class="tn">${t(`tier_${tier.id}`)}</span>
        <span>${t('credits_now', { c: fmt(credits, 0) })} · ${t('multiplier', { m: tier.mult })}</span>
        <div class="progress" role="progressbar" aria-valuenow="${Math.round(prog)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100, prog)}%"></i></div>
        <span class="small">${next ? t('to_next', { n: fmt(toNext, 0), tier: t(`tier_${next.id}`) }) : t('top_tier')}${next?.id === 'platinum' ? ` · ${t('plat_rule')}` : ''}</span>
        <ul>${TIER_PERKS[tier.id].map((k) => `<li>${t(k)}</li>`).join('')}</ul>
      </div>
      <div class="card section">
        <span class="muted small">${t('balance')}</span>
        <span class="balance">${fmt(bal, 0)} <span style="font-size:1.1rem">${t('pts')}</span></span>
        <span class="muted">${t('worth', { v: fmt(bal * 0.1, 0) })}</span>
        ${message ? `<p class="okmsg">${esc(message)}</p>` : ''}
        <p class="small" style="color:var(--gold-ink)">${t('points_neutral')}</p>
        ${local.surveyDone ? '' : `<button class="btn ghost small" id="survey" type="button" style="width:fit-content">${t('do_survey', { p: 50, c: CREDIT_RULES.oicSurvey })}</button>`}
      </div>
    </div>
    <section class="section">
      <h2>${t('tiers_title')}</h2>
      <div class="tierrow">${TIERS.filter((x) => x.id !== 'member').map((x) => `<div class="tiercard t-${x.id} mini${x.id === tier.id ? ' current' : ''}">
        <span class="tn">${t(`tier_${x.id}`)}</span><span class="tt">${t('credits_min', { c: x.min })} · ×${x.mult}</span>
        <ul>${TIER_PERKS[x.id].map((k) => `<li>${t(k)}</li>`).join('')}</ul></div>`).join('')}</div>
      <p class="muted small">${t('tiers_note')}</p>
    </section>
    <div class="grid2">
      <section class="card section">
        <h3>${t('how_earn')}</h3>
        <div class="earn-line"><span>${t('p_verifiedReview')}</span><span class="mono">+${POINT_RULES.verifiedReview} · ${CREDIT_RULES.verifiedReview} cr</span></div>
        <div class="earn-line"><span>${t('p_comment')}</span><span class="mono">+${POINT_RULES.comment} · ${CREDIT_RULES.comment} cr</span></div>
        <div class="earn-line"><span>${t('p_photo')}</span><span class="mono">+${POINT_RULES.photo}</span></div>
        <div class="earn-line"><span>${t('c_claimEvidence')}</span><span class="mono">${CREDIT_RULES.claimEvidence} cr</span></div>
        <div class="earn-line"><span>${t('rule_helpful')}</span><span class="mono">+${POINT_RULES.helpfulVote} · ${CREDIT_RULES.helpfulVote} cr</span></div>
        <div class="earn-line"><span>${t('c_oicSurvey')}</span><span class="mono">+50 · ${CREDIT_RULES.oicSurvey} cr</span></div>
        <p class="muted small">${t('cr_note')}</p>
      </section>
      <section class="card section">
        <h3>${t('history')}</h3>
        <div class="tablebox"><table><thead><tr><th>${t('date')}</th><th>${t('item')}</th><th class="r">${t('pts')}</th><th class="r">cr</th></tr></thead>
        <tbody>${hist.map((e) => `<tr><td class="num">${fmtDate(e.date)}</td><td>${e.example ? `<span class="chip">${t('example')}</span> ` : ''}${esc(e[lang])}</td><td class="r num mono">${e.points > 0 ? '+' : e.points < 0 ? '−' : ''}${fmt(Math.abs(e.points), 0)}</td><td class="r num mono">${e.credits ? `+${e.credits}` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div><button class="btn ghost small" type="button" id="reset">${resetArmed ? t('reset_confirm') : t('reset_demo')}</button></div>
      </section>
    </div>
    <section class="section">
      <h2>${t('rewards')}</h2>
      <p class="muted small">${t('rewards_sub')}</p>
      <div class="rewards">
        ${REWARDS.map((r) => {
          const locked = r.minTier && tierIndex(tier.id) < tierIndex(r.minTier);
          const short = !locked && bal < r.cost;
          const label = locked ? t('needs_tier', { tier: t(`tier_${r.minTier}`) }) : short ? t('not_enough') : r.id === 'r_dashcam' ? t('enter_draw') : t('redeem');
          return `<div class="card reward${locked ? ' locked' : ''}"><b>${t(r.id)}</b><span class="muted small">${t(`${r.id}_d`)}</span>
            <span class="cost">${r.cost ? `${fmt(r.cost, 0)} ${t('pts')}` : r.minTier ? t('tier_and_up', { tier: t(`tier_${r.minTier}`) }) : ''}${r.id === 'r_donate' ? ` ${t('or_more')}` : ''}</span>
            <button class="btn small" type="button" data-redeem="${r.id}"${locked || short ? ' disabled' : ''}>${label}</button></div>`;
        }).join('')}
      </div>
    </section>`;
  app.querySelectorAll('[data-redeem]').forEach((b) => b.addEventListener('click', () => {
    const r = REWARDS.find((x) => x.id === b.dataset.redeem);
    if (ledgerBalance() < r.cost) return;
    const code = `DEMO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    if (r.id === 'r_dashcam') { local.drawEntries += 1; local.ledger.push({ date: todayBkk(), points: 0, th: `สิทธิ์จับรางวัลกล้องติดรถยนต์ · ${code}`, en: `Dash-cam draw entry · ${code}` }); }
    else local.ledger.push({ date: todayBkk(), points: -r.cost, th: `แลก${STRINGS[r.id].th} · ${code}`, en: `Redeemed ${STRINGS[r.id].en} · ${code}` });
    saveLocal();
    renderChrome('wallet');
    viewWallet(t(r.id === 'r_dashcam' ? 'entered' : 'redeemed', { c: code }));
  }));
  document.getElementById('survey')?.addEventListener('click', () => {
    local.surveyDone = true;
    local.ledger.push({ date: todayBkk(), points: 50, credits: CREDIT_RULES.oicSurvey, th: 'ร่วมแบบสำรวจผู้บริโภคของ คปภ.', en: 'Took part in an OIC consumer survey' });
    saveLocal(); renderChrome('wallet'); viewWallet();
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (!resetArmed) { resetArmed = true; viewWallet(); return; }
    resetArmed = false;
    local = freshLocal();
    saveLocal();
    flow = newFlow();
    renderChrome('wallet');
    viewWallet();
  });
}

// ---------------------------------------------------------------- insurer portal (simulated)
function viewPortal(id) {
  const ins = INS[id];
  const res = scores('insurer', allReviews());
  const row = res.byId[id];
  const prods = productList().filter((p) => p.insurer === id);
  const critical = textReviews().filter((r) => r.insurer === id && (r.critical || (r.mine && r.comment && reviewOverall(r) <= 2.6)));
  const open = critical.filter((r) => !replyOf(r)).sort((a, b) => b.date.localeCompare(a.date));
  const replied = critical.length - open.length;
  const appeals = local.appeals.filter((a) => a.insurer === id);
  setBand({ title: t('portal_title'), sub: t('portal_sub'), crumbs: [[t('nav_portal')]] });
  const tab = (k, label) => `<button type="button" data-tab="${k}" class="${portalTab === k ? 'on' : ''}">${label}</button>`;
  app.innerHTML = `
    <section class="section">
      <div class="filters"><label>${t('portal_as')}<select id="as">${options(INSURERS, id, null)}</select></label><span class="chip warn">${t('portal_sim')}</span></div>
    </section>
    <div class="card stats">
      <div class="stat"><b>${fmt(row.post)}</b><span>Trust Score ${row.band ? `· ${t(`band_${row.band}`)}` : ''}</span></div>
      <div class="stat"><b>${fmt(prods.length, 0)}</b><span>${t('stat_products')} (${fmt(prods.filter((p) => missingFields(p).length).length, 0)} ${t('incomplete')})</span></div>
      <div class="stat"><b>${critical.length ? fmt((replied / critical.length) * 100, 0) : '–'}%</b><span>${t('reply_rate')}</span></div>
      <div class="stat"><b>${fmt(appeals.filter((a) => a.status === 'pending').length, 0)}</b><span>${t('appeals_open')}</span></div>
    </div>
    <div class="card section rules"><b>${t('portal_rules_title')}</b><span class="small">${t('portal_rules')}</span></div>
    <nav class="tabs">${tab('reviews', `${t('tab_to_reply')} (${fmt(open.length, 0)})`)}${tab('products', t('tab_listings'))}${tab('appeals', t('tab_appeals'))}</nav>
    <div id="ptab"></div>`;
  document.getElementById('as').addEventListener('change', (e) => { location.hash = `#/portal/${e.target.value}`; });
  app.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', () => { portalTab = a.dataset.tab; viewPortal(id); }));
  const box = document.getElementById('ptab');
  if (portalTab === 'products') portalProducts(box, id, prods);
  else if (portalTab === 'appeals') box.innerHTML = appeals.length ? `<div class="card">${appeals.map((a) => `<div class="alert"><span class="sev ${a.status === 'pending' ? 'serious' : a.status === 'upheld' ? 'critical' : ''}" style="${a.status === 'rejected' ? 'background:var(--grid);color:var(--ink-2)' : ''}">${t(`appeal_${a.status}`)}</span><span>${fmtDate(a.date)} · ${t(`reason_${a.reason}`)} · ${esc(a.reviewId)}</span></div>`).join('')}</div>` : `<p class="muted">${t('no_appeals')}</p>`;
  else portalReviews(box, id, open);
}

function portalReviews(box, id, open) {
  box.innerHTML = open.length ? open.slice(0, 15).map((r) => `<div class="card section">${reviewHtml(r)}
    <label class="field"><span>${t('reply_label')}</span><textarea rows="3" data-reply="${r.id}" placeholder="${esc(t('reply_ph'))}"></textarea></label>
    <div class="row"><button class="btn small" type="button" data-send="${r.id}">${t('reply_send')}</button>
      <select data-reason="${r.id}" aria-label="${esc(t('appeal_reason'))}">${['not_customer', 'personal_data', 'abusive', 'false_info'].map((k) => `<option value="${k}">${t(`reason_${k}`)}</option>`).join('')}</select>
      <button class="btn ghost small" type="button" data-appeal="${r.id}">${t('appeal_btn')}</button></div></div>`).join('') : `<p class="muted">${t('all_replied')}</p>`;
  box.querySelectorAll('[data-send]').forEach((b) => b.addEventListener('click', () => {
    const text = box.querySelector(`[data-reply="${b.dataset.send}"]`).value.trim();
    if (charCount(text) < 10) return;
    local.replies[b.dataset.send] = { date: todayBkk(), text };
    saveLocal(); viewPortal(id);
  }));
  box.querySelectorAll('[data-appeal]').forEach((b) => b.addEventListener('click', () => {
    if (local.appeals.some((a) => a.reviewId === b.dataset.appeal)) return;
    local.appeals.push({ id: `AP-${Date.now()}`, reviewId: b.dataset.appeal, insurer: id, reason: box.querySelector(`[data-reason="${b.dataset.appeal}"]`).value, date: todayBkk(), status: 'pending' });
    saveLocal(); b.disabled = true; b.textContent = t('appeal_sent');
  }));
}

function portalProducts(box, id, prods) {
  const editRow = (p) => `<tr><td colspan="6"><form class="form pform" data-pid="${p.id}">
      <div class="grid3" style="gap:10px">
        <label class="field"><span>${t('premium_year')} (THB)</span><input type="text" inputmode="numeric" name="premium_thb" value="${p.premium_thb ?? ''}"></label>
        <label class="field"><span>${t('req_deductible_thb')} (THB)</span><input type="text" inputmode="numeric" name="deductible_thb" value="${p.deductible_thb ?? ''}"></label>
        <label class="field"><span>${t('req_claim_channel')}</span><input type="text" name="claim_channel" value="${(p.claim_channel || []).join(', ')}" placeholder="app, hotline, line"></label>
      </div>
      <label class="field"><span>${t('req_exclusions')} (${lang === 'th' ? 'ไทย' : 'Thai'})</span><textarea rows="2" name="exclusions">${esc(p.exclusions?.th ?? '')}</textarea></label>
      <div class="row"><button class="btn small" type="submit">${t('save_listing')}</button><button class="btn ghost small" type="button" data-cancel>${t('cancel')}</button></div></form></td></tr>`;
  box.innerHTML = `<div class="card section">
    <div class="tablebox"><table><thead><tr><th>${t('product')}</th><th>${t('f_class')}</th><th class="r">${t('premium_year')}</th><th>${t('listing_status')}</th><th>${t('updated_on')}</th><th></th></tr></thead>
    <tbody>${prods.map((p) => { const miss = missingFields(p); const stale = daysBetween(p.updated_at, seed.meta.as_of) > 365;
      return `<tr><td><a href="#/product/${p.id}">${esc(p.name)}</a></td><td>${esc(L(CLS[p.cls]))}</td><td class="r num">${thb(p.premium_thb)}</td>
        <td>${miss.length ? `<span class="chip bad">${t('missing_n', { n: miss.length })}</span>` : stale ? `<span class="chip warn">${t('stale')}</span>` : `<span class="chip good">✓ ${t('complete')}</span>`}</td>
        <td class="num">${fmtDate(p.updated_at)}</td><td><button class="btn ghost small" type="button" data-edit="${p.id}">${t('edit')}</button></td></tr>${editingProduct === p.id ? editRow(p) : ''}`; }).join('')}</tbody></table></div>
    <details><summary>${t('add_product')}</summary>
      <form class="form" id="newprod" style="margin-top:10px">
        <div class="grid3" style="gap:10px">
          <label class="field"><span>${t('product_line')}</span><select name="line">${PRODUCT_LINES.map((l) => `<option value="${l.id}">${esc(l.name)} · ${esc(L(CLS[l.cls]))}</option>`).join('')}</select></label>
          <label class="field"><span>${t('product_name')}</span><input type="text" name="name" value="${esc(INS[id].short)} " required></label>
          <label class="field"><span>${t('premium_year')} (THB)</span><input type="text" inputmode="numeric" name="premium_thb"></label>
        </div>
        <div><button class="btn small" type="submit">${t('add_product_btn')}</button></div>
      </form></details>
    <p class="muted small">${t('listing_rule')}</p></div>`;
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { editingProduct = editingProduct === b.dataset.edit ? null : b.dataset.edit; viewPortal(id); }));
  box.querySelector('[data-cancel]')?.addEventListener('click', () => { editingProduct = null; viewPortal(id); });
  const num = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(/[^\d.]/g, '')));
  box.querySelector('.pform')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const pid = e.target.dataset.pid;
    const excl = String(fd.get('exclusions')).trim();
    const edit = {
      premium_thb: num(fd.get('premium_thb')), deductible_thb: num(fd.get('deductible_thb')),
      claim_channel: String(fd.get('claim_channel')).split(',').map((s) => s.trim()).filter(Boolean),
      exclusions: excl ? { th: excl, en: excl } : null, updated_at: todayBkk(),
    };
    const isNew = local.newProducts.find((p) => p.id === pid);
    if (isNew) Object.assign(isNew, edit); else local.productEdits[pid] = edit;
    editingProduct = null; saveLocal(); viewPortal(id);
  });
  document.getElementById('newprod').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target); const line = LINE[fd.get('line')];
    local.newProducts.push({ id: `${id}-new${local.newProducts.length + 1}`, insurer: id, line: line.id, cls: line.cls, name: String(fd.get('name')).trim() || `${INS[id].short} ${line.name}`,
      premium_thb: num(fd.get('premium_thb')), deductible_thb: null, roadside_24h: false, flood: false, ev_battery: line.id === 'ev', exclusions: null, claim_channel: [],
      listed_at: todayBkk(), updated_at: todayBkk(), added: true });
    saveLocal(); viewPortal(id);
  });
}

// ---------------------------------------------------------------- OIC dashboard
function monthKey(iso) { return iso.slice(0, 7); }
function lastMonths(asOf, n) {
  const [y, m] = asOf.split('-').map(Number);
  return [...Array(n).keys()].map((i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

function computeAlerts(asOf, market) {
  const alerts = [];
  const cut = addDays(asOf, -90);
  const from = addDays(asOf, -365);
  for (const ins of INSURERS) {
    const rs = textReviews().filter((r) => r.insurer === ins.id && r.sat.D1 !== null);
    const recent = rs.filter((r) => r.date >= cut);
    const before = rs.filter((r) => r.date < cut && r.date >= from);
    if (recent.length >= 15 && before.length >= 15) {
      const now = meanOf(recent, (r) => r.sat.D1);
      const prev = meanOf(before, (r) => r.sat.D1);
      if (prev - now >= 0.5) {
        alerts.push({ sev: prev - now >= 0.8 ? 'critical' : 'serious', score: prev - now + 10,
          text: t('alert_drop', { ins: L(ins), now: fmt(now, 2), before: fmt(prev, 2), d: signed(now - prev, 2) }), ins: ins.id });
      }
    }
  }
  const lows = [];
  for (const ins of INSURERS) {
    const means = aspectMeans(allReviews().filter((r) => r.insurer === ins.id));
    for (const c of ASPECT_CODES) {
      const d = means[c] - market[c];
      if (d <= -0.3) lows.push({ sev: 'serious', score: -d, text: t('alert_low', { ins: L(ins), asp: `${c} ${L(ASP[c])}`, d: fmt(-d, 2) }), ins: ins.id });
    }
  }
  lows.sort((a, b) => b.score - a.score);
  return [...alerts.sort((a, b) => b.score - a.score), ...lows.slice(0, 4)];
}

function gapScatter(imp, sat) {
  const W = 560, H = 330, pl = 46, pr = 20, pt = 16, pb = 42;
  const xs = ASPECT_CODES.map((c) => imp[c]);
  const ys = ASPECT_CODES.map((c) => sat[c]);
  const x0 = Math.floor((Math.min(...xs) - 0.15) * 10) / 10, x1 = Math.ceil((Math.max(...xs) + 0.15) * 10) / 10;
  const y0 = Math.floor((Math.min(...ys) - 0.15) * 10) / 10, y1 = Math.ceil((Math.max(...ys) + 0.15) * 10) / 10;
  const X = (v) => pl + ((v - x0) / (x1 - x0)) * (W - pl - pr);
  const Y = (v) => H - pb - ((v - y0) / (y1 - y0)) * (H - pt - pb);
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  const ticks = (a, b) => { const out = []; for (let v = Math.ceil(a * 5) / 5; v <= b + 1e-9; v += 0.2) out.push(Math.round(v * 10) / 10); return out; };
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('gap_title'))}">`;
  s += `<rect class="quad" x="${X(mx)}" y="${Y(my)}" width="${X(x1) - X(mx)}" height="${Y(y0) - Y(my)}"/>`;
  s += `<text class="quad-lbl" x="${X(x1) - 6}" y="${Y(y0) - 8}" text-anchor="end">${esc(t('fix_first'))}</text>`;
  s += `<text class="quad-lbl" x="${X(x1) - 6}" y="${Y(y1) + 14}" text-anchor="end" style="fill:var(--ok)">${esc(t('keep_up'))}</text>`;
  for (const v of ticks(y0, y1)) s += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  for (const v of ticks(x0, x1)) s += `<text x="${X(v)}" y="${H - pb + 16}" text-anchor="middle">${v.toFixed(1)}</text>`;
  s += `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
  s += `<line class="axis" x1="${X(mx)}" x2="${X(mx)}" y1="${pt}" y2="${H - pb}" stroke-dasharray="3 3"/><line class="axis" x1="${pl}" x2="${W - pr}" y1="${Y(my)}" y2="${Y(my)}" stroke-dasharray="3 3"/>`;
  s += `<text x="${(pl + W - pr) / 2}" y="${H - 6}" text-anchor="middle">${esc(t('importance'))} →</text>`;
  s += `<text x="12" y="${(pt + H - pb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(pt + H - pb) / 2})">${esc(t('satisfaction'))} →</text>`;
  for (const c of ASPECT_CODES) {
    const hot = imp[c] > mx && sat[c] < my;
    const tip = `${c} ${L(ASP[c])} · ${t('importance')} ${fmt(imp[c], 2)} · ${t('satisfaction')} ${fmt(sat[c], 2)}`;
    s += `<g data-tip="${esc(tip)}"><circle class="hit" cx="${X(imp[c])}" cy="${Y(sat[c])}" r="16"/><circle class="dot${hot ? ' hot' : ''}" cx="${X(imp[c])}" cy="${Y(sat[c])}" r="6"/>
      <text class="val" x="${X(imp[c]) + 10}" y="${Y(sat[c]) + 4}">${c}</text></g>`;
  }
  return `${s}</svg>`;
}

function trendChart(months, series, market) {
  const W = 560, H = 240, pl = 36, pr = 16, pt = 14, pb = 30;
  const vals = [...series, ...market].filter((v) => v !== null);
  if (!vals.length) return `<p class="muted">${t('no_data')}</p>`;
  const y0 = Math.max(1, Math.floor(Math.min(...vals) * 2) / 2 - 0.5);
  const y1 = Math.min(5, Math.ceil(Math.max(...vals) * 2) / 2 + 0.5);
  const X = (i) => pl + (i / (months.length - 1)) * (W - pl - pr);
  const Y = (v) => H - pb - ((v - y0) / (y1 - y0)) * (H - pt - pb);
  const path = (arr) => arr.map((v, i) => (v === null ? null : `${X(i)},${Y(v)}`)).reduce((acc, p) => {
    if (p === null) { acc.push([]); } else { acc.at(-1).push(p); }
    return acc;
  }, [[]]).filter((seg) => seg.length > 1).map((seg) => `M${seg.join('L')}`).join('');
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('trend_title'))}">`;
  for (let v = y0; v <= y1 + 1e-9; v += 0.5) s += `<line class="gridline" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${pl - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}</text>`;
  months.forEach((m, i) => { if (i % 2 === (months.length - 1) % 2) s += `<text x="${X(i)}" y="${H - 10}" text-anchor="middle">${m.slice(2).replace('-', '/')}</text>`; });
  s += `<line class="axis" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
  s += `<path class="line market" d="${path(market)}"/><path class="line" d="${path(series)}"/>`;
  const lastI = series.findLastIndex((v) => v !== null);
  months.forEach((m, i) => {
    const tip = `${m} · ${fmt(series[i], 2)} · ${t('market_avg')} ${fmt(market[i], 2)}`;
    s += `<g data-tip="${esc(tip)}"><rect class="hit" x="${X(i) - 14}" y="${pt}" width="28" height="${H - pt - pb}"/>${series[i] === null ? '' : `<circle class="dot" cx="${X(i)}" cy="${Y(series[i])}" r="${i === lastI ? 5 : 3}"/>`}</g>`;
  });
  if (lastI >= 0) s += `<text class="val" x="${X(lastI) - 8}" y="${Y(series[lastI]) - 10}" text-anchor="end">${fmt(series[lastI], 2)}</text>`;
  return `${s}</svg>`;
}

/** Caterpillar chart: each insurer's 90% interval against the market mean, coloured by band. */
function bandChart(res) {
  const rows = res.rows.filter((r) => r.post !== null);
  const [s0, s1] = scoreRange(rows);
  const W = 560, rh = 24, pl = 150, pr = 46, pt = 22, H = pt + rows.length * rh + 26;
  const X = (v) => pl + ((v - s0) / (s1 - s0)) * (W - pl - pr);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('band_chart_title'))}">`;
  for (let v = Math.ceil(s0 / 5) * 5; v <= s1; v += 5) s += `<line class="gridline" x1="${X(v)}" x2="${X(v)}" y1="${pt - 6}" y2="${H - 22}"/><text x="${X(v)}" y="${H - 8}" text-anchor="middle">${v}</text>`;
  s += `<line class="axis" x1="${X(res.mu)}" x2="${X(res.mu)}" y1="${pt - 12}" y2="${H - 22}" stroke-dasharray="4 3"/><text x="${X(res.mu)}" y="${pt - 14}" text-anchor="middle">${esc(t('market_avg'))} ${fmt(res.mu)}</text>`;
  rows.forEach((r, i) => {
    const y = pt + i * rh + rh / 2;
    const col = r.band === 'above' ? 'var(--ok)' : r.band === 'below' ? 'var(--div-neg)' : 'var(--market)';
    const tip = `${L(r.unit)} · ${fmt(r.post)} (${fmt(r.lo)}–${fmt(r.hi)}) · ${t(`band_${r.band}`)} · ${t('p_rank1', { p: fmt(r.pTop * 100, 0) })}`;
    s += `<g data-tip="${esc(tip)}"><rect class="hit" x="0" y="${y - rh / 2}" width="${W}" height="${rh}"/>
      <text class="lbl" x="${pl - 10}" y="${y + 4}" text-anchor="end">${esc(L(r.unit))}</text>
      <line x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="6" stroke-linecap="round"/>
      <circle cx="${X(r.post)}" cy="${y}" r="4.5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>
      <text class="val" x="${W - pr + 8}" y="${y + 4}">${fmt(r.post)}</text></g>`;
  });
  return `${s}</svg>`;
}

function viewOic() {
  setBand({ title: t('oic_title'), sub: t('oic_sub'), crumbs: [[t('nav_oic')]] });
  const asOf = seed.meta.as_of;
  const all = allReviews();
  const res = scores('insurer', all, { useModel: 'bayes' });
  const market = aspectMeans(all);
  const imp = Object.fromEntries(ASPECT_CODES.map((c) => [c, meanOf(seed.surveyResponses, (r) => r.imp[c])]));
  const npsAll = npsBreakdown(all.map((r) => r.nps));
  const claimShare = (all.filter((r) => r.claimed).length / all.length) * 100;
  const alerts = computeAlerts(asOf, market);
  if (!trendInsurer) trendInsurer = alerts.find((a) => a.sev === 'critical' || a.text.includes('D1'))?.ins || res.rows[0].unit.id;
  const months = lastMonths(asOf, 12);
  const monthly = (rs) => months.map((m) => { const xs = rs.filter((r) => monthKey(r.date) === m && r.sat.D1 !== null); return xs.length >= 5 ? meanOf(xs, (r) => r.sat.D1) : null; });
  const trendS = monthly(textReviews().filter((r) => r.insurer === trendInsurer));
  const trendM = monthly(textReviews());
  const chRows = CHANNELS.map((ch) => ({ ch, ...scoreReviews(all.filter((r) => r.channel === ch.id), weights) })).sort((a, b) => b.raw - a.raw);
  const heatColor = (d) => {
    const k = Math.min(Math.abs(d) / 0.5, 1) * 75;
    return `background:color-mix(in srgb, ${d >= 0 ? 'var(--div-pos)' : 'var(--div-neg)'} ${k.toFixed(0)}%, var(--div-mid))${k > 45 ? ';color:#fff' : ''}`;
  };
  const counts = { above: 0, near: 0, below: 0 }; res.rows.forEach((r) => { if (r.band) counts[r.band] += 1; });
  // listing compliance and responsiveness per insurer
  const compliance = INSURERS.map((ins) => {
    const ps = productList().filter((p) => p.insurer === ins.id);
    const missing = ps.reduce((s, p) => s + missingFields(p).length, 0);
    const last = ps.map((p) => p.updated_at).sort().at(-1);
    const stale = daysBetween(last, asOf) > 365;
    const crit = textReviews().filter((r) => r.insurer === ins.id && r.critical);
    const rep = crit.filter((r) => replyOf(r));
    const days = rep.map((r) => daysBetween(r.date, replyOf(r).date)).sort((a, b) => a - b);
    return { ins, n: ps.length, missing, last, stale, replyRate: crit.length ? rep.length / crit.length : null, medDays: days.length ? days[Math.floor(days.length / 2)] : null };
  });
  const pendingAppeals = local.appeals.filter((a) => a.status === 'pending');

  app.innerHTML = `
    <div class="card stats" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
      <div class="stat"><b>${fmt(res.mu)}</b><span>${t('k_market')}</span></div>
      <div class="stat"><b><span style="color:var(--ok)">${counts.above}</span> · ${counts.near} · <span style="color:var(--div-neg)">${counts.below}</span></b><span>${t('k_bands')}</span></div>
      <div class="stat"><b>${signed(npsAll.nps, 0)}</b><span>${t('k_nps')}</span></div>
      <div class="stat"><b>${fmt(textReviews().length, 0)}</b><span>${t('stat_verified')}</span></div>
      <div class="stat"><b>${fmt(compliance.filter((c) => c.missing || c.stale).length, 0)}</b><span>${t('k_listing_issues')}</span></div>
      <div class="stat"><b>${fmt(claimShare, 0)}%</b><span>${t('k_claim')}</span></div>
    </div>
    <section class="card section">
      <h2>${t('alerts')}</h2>
      ${alerts.length ? alerts.map((a) => `<div class="alert"><span class="sev ${a.sev}">${a.sev === 'critical' ? '▲▲' : '▲'} ${t(a.sev)}</span><a href="#/insurer/${a.ins}" style="color:inherit">${esc(a.text)}</a></div>`).join('') : `<p class="muted">${t('no_alerts')}</p>`}
    </section>
    <div class="grid2">
      <section class="card section">
        <h2>${t('band_chart_title')}</h2><p class="muted small">${t('band_chart_note')}</p>
        ${bandChart(res)}
        <div class="legend"><span>${bandChip('above')}</span><span>${bandChip('near')}</span><span>${bandChip('below')}</span></div>
      </section>
      <section class="card section">
        <h2>${t('model_params')}</h2><p class="muted small">${t('model_params_note')}</p>
        <div class="prov">
          <b>σ</b><span>${fmt(Math.sqrt(res.sigma2), 1)} ${t('sigma_d')}</span>
          <b>τ</b><span>${fmt(Math.sqrt(res.tau2), 2)} ${t('tau_d')}</span>
          <b>k = σ²/τ²</b><span>${fmt(res.k, 1)} ${t('k_d', { m: MIN_REVIEWS_PRIOR })}</span>
          <b>μ</b><span>${fmt(res.mu, 1)} ${t('mu_d')}</span>
          <b>${t('half_life')}</b><span>${HALF_LIFE_DAYS} ${t('days')}</span>
        </div>
        <h3 style="margin-top:6px">${t('casemix_title')}</h3>
        <div class="tablebox"><table><tbody>${CASE_MIX_LABELS.map((l, i) => `<tr><td>${t(`cm_${l}`)}</td><td class="r num">${signed(res.beta[i], 2)}</td></tr>`).join('')}</tbody></table></div>
        <p class="muted small">${t('casemix_note')}</p>
      </section>
    </div>
    <section class="card section">
      <h2>${t('compliance_title')}</h2><p class="muted small">${t('compliance_note')}</p>
      <div class="tablebox"><table><thead><tr><th>${t('f_insurer')}</th><th class="r">${t('stat_products')}</th><th class="r">${t('missing_fields')}</th><th>${t('updated_on')}</th><th class="r">${t('reply_rate')}</th><th class="r">${t('reply_days')}</th><th>${t('listing_status')}</th></tr></thead>
      <tbody>${compliance.map((c) => `<tr><td><a href="#/portal/${c.ins.id}">${esc(L(c.ins))}</a></td><td class="r num">${c.n}</td><td class="r num">${c.missing}</td><td class="num">${fmtDate(c.last)}</td>
        <td class="r num">${c.replyRate === null ? '–' : `${fmt(c.replyRate * 100, 0)}%`}</td><td class="r num">${c.medDays ?? '–'}</td>
        <td>${c.missing ? `<span class="chip bad">${t('missing_n', { n: c.missing })}</span>` : c.stale ? `<span class="chip warn">${t('stale')}</span>` : `<span class="chip good">✓ ${t('complete')}</span>`}</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card section">
      <h2>${t('appeals_title')} (${fmt(pendingAppeals.length, 0)})</h2>
      ${local.appeals.length ? local.appeals.map((a) => `<div class="alert"><span class="sev ${a.status === 'pending' ? 'serious' : 'critical'}" style="${a.status === 'rejected' ? 'background:var(--grid);color:var(--ink-2)' : ''}">${t(`appeal_${a.status}`)}</span>
        <span>${esc(L(INS[a.insurer]))} · ${t(`reason_${a.reason}`)} · ${esc(a.reviewId)} · ${fmtDate(a.date)}
        ${a.status === 'pending' ? `<span class="row" style="margin-top:4px"><button class="btn small" data-decide="upheld" data-ap="${a.id}" type="button">${t('uphold')}</button><button class="btn ghost small" data-decide="rejected" data-ap="${a.id}" type="button">${t('reject')}</button></span>` : ''}</span></div>`).join('') : `<p class="muted">${t('no_appeals_oic')}</p>`}
    </section>
    <div class="grid2">
      <section class="card section">
        <h2>${t('gap_title')}</h2><p class="muted small">${t('gap_note')}</p>
        ${gapScatter(imp, market)}
        <details><summary>${t('table_view')}</summary><div class="tablebox"><table><thead><tr><th>${t('aspect')}</th><th class="r">${t('importance')}</th><th class="r">${t('satisfaction')}</th></tr></thead>
        <tbody>${ASPECTS.map((a) => `<tr><td>${a.code} ${esc(L(a))}</td><td class="r num">${fmt(imp[a.code], 2)}</td><td class="r num">${fmt(market[a.code], 2)}</td></tr>`).join('')}</tbody></table></div></details>
      </section>
      <section class="card section">
        <div class="row between"><h2>${t('trend_title')}</h2>
          <select id="trend-ins" aria-label="Insurer">${INSURERS.map((i) => `<option value="${i.id}"${i.id === trendInsurer ? ' selected' : ''}>${esc(L(i))}</option>`).join('')}</select></div>
        <p class="muted small">${t('trend_metric')}</p>
        ${trendChart(months, trendS, trendM)}
        <div class="legend"><span><i></i>${esc(L(INS[trendInsurer]))}</span><span><i class="market"></i>${t('market_avg')}</span></div>
        <details><summary>${t('table_view')}</summary><div class="tablebox"><table><thead><tr><th>Month</th><th class="r">${esc(L(INS[trendInsurer]))}</th><th class="r">${t('market_avg')}</th></tr></thead>
        <tbody>${months.map((m, i) => `<tr><td class="num">${m}</td><td class="r num">${fmt(trendS[i], 2)}</td><td class="r num">${fmt(trendM[i], 2)}</td></tr>`).join('')}</tbody></table></div></details>
      </section>
    </div>
    <section class="card section">
      <h2>${t('heat_title')}</h2><p class="muted small">${t('heat_note')}</p>
      <div class="tablebox"><table class="heat"><thead><tr><th></th><th>Trust</th>${ASPECT_CODES.map((c) => `<th data-tip="${esc(L(ASP[c]))}">${c}</th>`).join('')}</tr></thead>
      <tbody>${res.rows.map((r) => `<tr><td class="name"><a href="#/insurer/${r.unit.id}">${esc(L(r.unit))}</a></td><td><b>${fmt(r.post)}</b></td>${ASPECT_CODES.map((c) => {
        const d = r.means[c] - market[c];
        return `<td style="${heatColor(d)}" data-tip="${esc(`${L(r.unit)} · ${c} ${L(ASP[c])}: ${fmt(r.means[c], 2)} vs ${fmt(market[c], 2)}`)}">${signed(d, 2)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
    </section>
    <div class="grid2">
      <section class="card section">
        <h2>${t('channel_title')}</h2><p class="muted small">${t('channel_note')}</p>
        <div class="hist">${chRows.map((r) => `<div class="hist-row" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 44px" data-tip="${esc(L(r.ch))}: ${fmt(r.raw)} · n = ${fmt(r.n, 0)}"><span class="small">${esc(L(r.ch))}</span><span class="meter"><i style="width:${r.raw}%;background:var(--series-1)"></i></span><span class="num small" style="text-align:right">${fmt(r.raw)}</span></div>`).join('')}</div>
      </section>
      <section class="card section">
        <h2>${t('provenance')}</h2>
        <div class="prov">
          <b>Source</b><span>${esc(seed.meta.source)} (seed ${seed.meta.seed})</span>
          <b>As of</b><span>${seed.meta.as_of}</span>
          <b>Generated</b><span>${esc(seed.meta.generated_at)} (Asia/Bangkok)</span>
          <b>Model</b><span>${t('model_bayes')} · k = ${fmt(res.k, 1)}</span>
          <b>Note</b><span>${esc(lang === 'th' ? seed.meta.disclaimer_th : seed.meta.disclaimer_en)}</span>
        </div>
      </section>
    </div>`;
  document.getElementById('trend-ins').addEventListener('change', (e) => { trendInsurer = e.target.value; viewOic(); });
  app.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => {
    const a = local.appeals.find((x) => x.id === b.dataset.ap);
    a.status = b.dataset.decide; saveLocal(); viewOic();
  }));
}

// ---------------------------------------------------------------- method
let animLoop = null;
function viewMethod() {
  setBand({ title: t('method_title'), sub: t('method_sub'), crumbs: [[t('nav_method')]] });
  const imp = mode === 'sim' && surveyAgg ? surveyAgg.importance_mean : Object.fromEntries(ASPECT_CODES.map((c) => [c, meanOf(seed.surveyResponses, (r) => r.imp[c])]));
  const res = scores('insurer', allReviews(), { useModel: 'bayes' });
  const th = lang === 'th';
  const anims = [['scoring', 'anim_scoring'], ['credibility', 'anim_credibility'], ['bayes', 'anim_bayes']];
  app.innerHTML = `
    ${window.ANIMS ? `<section class="section"><h2>${t('anim_title')}</h2>
      <div class="animtabs">${anims.map(([k, label], i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-anim="${k}">${t(label)}</button>`).join('')}<button type="button" id="anim-replay">↻ ${t('replay')}</button></div>
      <div class="animbox"><canvas id="anim" aria-label="${esc(t('anim_title'))}"></canvas></div>
      <p class="muted small">${t('anim_note')}</p></section>` : ''}
    <div class="card section">
      <h2>${t('model_steps_title')}</h2>
      <ol style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:8px">
        <li>${t('m1')}</li><li>${t('m2')}</li><li>${t('m3', { b: signed(res.beta[0], 2) })}</li><li>${t('m4', { h: HALF_LIFE_DAYS })}</li>
        <li>${t('m5', { s: fmt(Math.sqrt(res.sigma2), 1), tau: fmt(Math.sqrt(res.tau2), 2), k: fmt(res.k, 1) })}</li><li>${t('m6')}</li>
      </ol>
      <p class="small muted">${t('m_prod')}</p>
    </div>
    <section class="card section">
      <h2>${t('weights_title', { n: fmt(mode === 'sim' && surveyAgg ? surveyAgg.responses_used : seed.surveyResponses.length, 0) })}</h2>
      ${mode === 'sim' && surveyAgg ? `<p class="okmsg small">${t('survey_source', { total: fmt(surveyAgg.responses_total, 0), used: fmt(surveyAgg.responses_used, 0), d1: fmtDate(surveyAgg.date_range[0]), d2: fmtDate(surveyAgg.date_range[1]) })}</p>` : ''}
      <div class="tablebox"><table><thead><tr><th>${t('group')}</th><th>${t('aspect')}</th><th class="r">${t('mean_imp')}</th><th class="r">${t('weight')}</th></tr></thead>
      <tbody>${ASPECTS.map((a) => `<tr><td>${a.group} · ${esc(L(GROUPS[a.group]))}</td><td>${a.code} ${esc(L(a))}</td><td class="r num">${fmt(imp[a.code], 2)}</td><td class="r num">${fmt(weights[a.code] * 100, 1)}%</td></tr>`).join('')}</tbody></table></div>
    </section>
    <section class="card section">
      <h2>${th ? 'ข้อจำกัดและสมมติฐานที่มีผลต่อผลลัพธ์' : 'Limits and assumptions that affect results'}</h2>
      <ul style="margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:6px">
        <li>${th ? 'ข้อมูลทั้งหมดเป็นข้อมูลสมมติจากสคริปต์ ชื่อบริษัทและผลิตภัณฑ์เป็นชื่อสมมติ' : 'All data is generated by a script. Insurer and product names are fictional.'}</li>
        <li>${th ? 'สัดส่วน 70/30, ครึ่งชีวิต 365 วัน และตัวแปร case-mix เป็นข้อเสนอ ยังไม่ได้ตกลงกับ คปภ. การเปลี่ยนค่าเหล่านี้เปลี่ยนอันดับได้' : 'The 70/30 split, the 365-day half-life and the case-mix variables are proposals, not agreed with the OIC. Changing them can change the ranking.'}</li>
        <li>${th ? 'ต้นแบบใช้สูตรปิด (empirical Bayes) ระบบจริงใช้โมเดลลำดับขั้นเต็มรูปแบบ (ordinal + นิสัยผู้รีวิว + แนวโน้มเวลา)' : 'The prototype uses a closed-form empirical-Bayes approximation; production fits the full model (ordinal ratings, reviewer generosity, time trend).'}</li>
        <li>${th ? 'ผู้ตอบแบบสอบถามไม่ได้ผ่านการยืนยันกรมธรรม์ ใช้เป็นน้ำหนักและคะแนนตั้งต้น' : 'Survey respondents are not policy-verified. Their answers set the weights and a baseline.'}</li>
        <li>${th ? 'ในต้นแบบ การยืนยันทำในเบราว์เซอร์ด้วย salt ที่เปิดเผย ระบบจริงต้องตรวจที่ คปภ./บริษัทประกัน และตอบแค่ "ตรง/ไม่ตรง" (PDPA)' : 'In the prototype the check runs in the browser with a public salt. A real system checks at the OIC/insurer and returns only match / no match (PDPA).'}</li>
      </ul>
    </section>`;
  startAnim('scoring');
  app.querySelectorAll('[data-anim]').forEach((b) => b.addEventListener('click', () => {
    app.querySelectorAll('[data-anim]').forEach((x) => x.classList.toggle('on', x === b)); startAnim(b.dataset.anim);
  }));
  document.getElementById('anim-replay')?.addEventListener('click', () => startAnim(animLoop?.name ?? 'scoring'));
}
function startAnim(name) {
  const cv = document.getElementById('anim');
  if (!cv || !window.ANIMS) return;
  const RES = 2; cv.width = ANIMS.W * RES; cv.height = ANIMS.H * RES;
  const ctx = cv.getContext('2d');
  const start = performance.now();
  const me = { name };
  animLoop = me;
  ANIMS.fontsReady().then(() => {
    const step = () => {
      if (animLoop !== me || !document.body.contains(cv)) return;
      ctx.setTransform(RES, 0, 0, RES, 0, 0); ANIMS[name].draw(ctx, (performance.now() - start) / 1000);
      requestAnimationFrame(step);
    };
    step();
  });
}

// ---------------------------------------------------------------- tooltip
function setupTooltip() {
  const tip = document.getElementById('tip');
  const show = (el, x, y) => {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 12)}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) show(el, e.clientX, e.clientY); else tip.hidden = true;
  });
  document.addEventListener('pointerleave', () => { tip.hidden = true; });
  // phones: tap a point to show its tooltip, tap elsewhere to hide
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el && e.pointerType !== 'mouse') show(el, e.clientX, e.clientY); else if (!el) tip.hidden = true;
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-tip]');
    if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); }
  });
  document.addEventListener('focusout', () => { tip.hidden = true; });
}

boot();
