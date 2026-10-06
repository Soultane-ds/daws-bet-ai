'use strict';
/**
 * DAWS BET AI statistical model.
 *
 * Expected goals for each side come from attack/defence strength (venue-specific
 * where there is enough data, shrunk toward league averages), adjusted for recent
 * form, xG (if supplied), head-to-head scoring, table position and injuries, then
 * gently pulled toward bookmaker consensus. A Dixon-Coles score grid converts the
 * expected goals into probabilities for every supported market.
 *
 * Nothing here invents data: a missing input is skipped and lowers the data-quality
 * score; with too little data no prediction is produced at all.
 */
const { scoreMatrix, sumWhere, poissonOver } = require('./poisson');
const { clamp, round } = require('../util');
const { levelFor, CATEGORY_OF, RISK_OF_LEVEL, pickText } = require('./labels');

const MODEL_VERSION = 'poisson-dc-1.0';
const PRIOR = { home: 1.45, away: 1.15, firstHalfShare: 0.45 };
const MARKET_WEIGHT = 0.3;

const shrink = (obs, n, prior, k) => (obs == null ? prior : (obs * n + prior * k) / (n + k));
function wavg(list, f) {
  let s = 0, w = 0, wt = 1;
  for (const x of list) { const v = f(x); if (v != null) { s += v * wt; w += wt; } wt *= 0.85; }
  return w ? s / w : null;
}
const key = (m, s, l) => `${m}|${s}|${Number(l || 0)}`;

function venueAvg(s, k, side) { return s?.[k]?.[side] ?? s?.[k]?.total ?? null; }
function venueN(s, side) { return s?.played?.[side] ?? s?.played?.total ?? 0; }

function formMultipliers(list, seasonGF, seasonGA) {
  if (!list || list.length < 4) return { att: 1, def: 1, used: false };
  const recent = list.slice(0, 8);
  const rGF = wavg(recent, (m) => m.gf), rGA = wavg(recent, (m) => m.ga);
  return {
    att: seasonGF > 0.2 && rGF != null ? clamp(1 + 0.3 * (rGF / seasonGF - 1), 0.88, 1.12) : 1,
    def: seasonGA > 0.2 && rGA != null ? clamp(1 + 0.3 * (rGA / seasonGA - 1), 0.88, 1.12) : 1,
    used: true, rGF, rGA,
  };
}

function dataQuality(ctx, used) {
  const hs = ctx.homeStats, as = ctx.awayStats;
  const n = Math.min(hs?.played?.total || 0, as?.played?.total || 0);
  let q = 0.35 * Math.min(1, n / 10);
  const fh = ctx.homeForm?.length || 0, fa = ctx.awayForm?.length || 0;
  q += 0.15 * (Math.min(fh, 5) + Math.min(fa, 5)) / 10;
  q += 0.10 * Math.min(1, (ctx.h2h?.length || 0) / 4);
  if (ctx.league && ctx.standing) q += 0.10;
  if (ctx.market?.p1x2) q += 0.20;
  if (ctx.lineups) q += 0.05;
  if (used.xg) q += 0.05;
  return round(clamp(q, 0, 1), 2);
}

function matrixStats(lh, la) {
  const M = scoreMatrix(lh, la, { max: 8 });
  return {
    diff: sumWhere(M, (h, a) => h > a) - sumWhere(M, (h, a) => h < a),
    over25: sumWhere(M, (h, a) => h + a > 2),
  };
}
function bisect(fn, target, lo, hi, increasing = true) {
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const v = fn(mid);
    if ((v < target) === increasing) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Step 1: expected goals. Returns null when stats are insufficient. */
function expectedGoals(ctx) {
  const hs = ctx.homeStats, as = ctx.awayStats;
  if (!hs || !as) return null;
  const hasGoals = (s) => venueAvg(s, 'gf_avg', 'home') != null && venueAvg(s, 'ga_avg', 'home') != null;
  if (!hasGoals(hs) || !hasGoals(as)) return null;

  const leagueHome = ctx.league?.home ?? PRIOR.home;
  const leagueAway = ctx.league?.away ?? PRIOR.away;
  const nH = venueN(hs, 'home'), nA = venueN(as, 'away');
  const attH = shrink(venueAvg(hs, 'gf_avg', 'home'), nH, leagueHome, 5);
  const defH = shrink(venueAvg(hs, 'ga_avg', 'home'), nH, leagueAway, 5);
  const attA = shrink(venueAvg(as, 'gf_avg', 'away'), nA, leagueAway, 5);
  const defA = shrink(venueAvg(as, 'ga_avg', 'away'), nA, leagueHome, 5);

  let lh = (attH * defA) / leagueHome;
  let la = (attA * defH) / leagueAway;
  const factors = { base: { lh: round(lh), la: round(la), attH: round(attH), defH: round(defH), attA: round(attA), defA: round(defA), leagueHome: round(leagueHome), leagueAway: round(leagueAway), nH, nA, leagueDerived: !!ctx.league } };
  const used = { form: false, xg: false, h2h: false, rank: false, injuries: false, market: false };

  const fH = formMultipliers(ctx.homeForm, hs.gf_avg?.total ?? attH, hs.ga_avg?.total ?? defH);
  const fA = formMultipliers(ctx.awayForm, as.gf_avg?.total ?? attA, as.ga_avg?.total ?? defA);
  if (fH.used || fA.used) {
    lh *= fH.att * fA.def; la *= fA.att * fH.def; used.form = true;
    factors.form = { homeGF: fH.rGF != null ? round(fH.rGF) : null, homeGA: fH.rGA != null ? round(fH.rGA) : null, awayGF: fA.rGF != null ? round(fA.rGF) : null, awayGA: fA.rGA != null ? round(fA.rGA) : null };
  }

  if (hs.xg_for_avg != null && hs.xg_against_avg != null && as.xg_for_avg != null && as.xg_against_avg != null) {
    const xh = (hs.xg_for_avg + as.xg_against_avg) / 2, xa = (as.xg_for_avg + hs.xg_against_avg) / 2;
    lh = 0.65 * lh + 0.35 * xh; la = 0.65 * la + 0.35 * xa; used.xg = true;
    factors.xg = { home: round(xh), away: round(xa) };
  }

  const h2h = (ctx.h2h || []).filter((x) => x.hg != null && x.ag != null);
  if (h2h.length >= 3) {
    const avg = h2h.reduce((s, x) => s + x.hg + x.ag, 0) / h2h.length;
    const ratio = clamp(avg / (lh + la), 0.8, 1.25);
    const sc = 1 + 0.05 * (ratio - 1);
    lh *= sc; la *= sc; used.h2h = true;
    factors.h2h = { n: h2h.length, avgGoals: round(avg) };
  }

  if (ctx.standing?.size > 4 && ctx.standing.homeRank && ctx.standing.awayRank) {
    const d = clamp((ctx.standing.awayRank - ctx.standing.homeRank) / (ctx.standing.size - 1), -1, 1);
    lh *= 1 + 0.04 * d; la *= 1 - 0.04 * d; used.rank = true;
    factors.rank = { home: ctx.standing.homeRank, away: ctx.standing.awayRank, size: ctx.standing.size };
  }

  const inj = ctx.injuries;
  if (inj && (inj.home || inj.away)) {
    lh *= (1 - Math.min(0.08, 0.015 * inj.home)) * (1 + Math.min(0.04, 0.005 * inj.away));
    la *= (1 - Math.min(0.08, 0.015 * inj.away)) * (1 + Math.min(0.04, 0.005 * inj.home));
    used.injuries = true; factors.injuries = { home: inj.home, away: inj.away };
  }

  lh = clamp(lh, 0.2, 4); la = clamp(la, 0.2, 4);
  return { lh, la, factors, used };
}

/** Step 2: pull expected goals toward bookmaker consensus (lightly). */
function blendWithMarket(lh, la, market, used, factors) {
  if (!market) return { lh, la };
  const w = MARKET_WEIGHT;
  if (market.pOver25 != null) {
    const target = (1 - w) * matrixStats(lh, la).over25 + w * market.pOver25;
    const s = bisect((x) => matrixStats(lh * x, la * x).over25, target, 0.6, 1.6);
    lh *= s; la *= s; used.market = true;
  }
  if (market.p1x2) {
    const target = (1 - w) * matrixStats(lh, la).diff + w * (market.p1x2['1'] - market.p1x2['2']);
    const r = bisect((x) => matrixStats(lh * Math.exp(x), la * Math.exp(-x)).diff, target, -0.7, 0.7);
    lh *= Math.exp(r); la *= Math.exp(-r); used.market = true;
  }
  factors.market = { p1x2: market.p1x2 || null, pOver25: market.pOver25 ?? null };
  return { lh: clamp(lh, 0.2, 4), la: clamp(la, 0.2, 4) };
}

function candidatesFromGrid(lh, la, ctx) {
  const M = scoreMatrix(lh, la);
  const Mh = scoreMatrix(lh * PRIOR.firstHalfShare, la * PRIOR.firstHalfShare, { max: 6 });
  const out = [];
  const add = (market, selection, line, p) => out.push({ market, selection, line, p });
  const pH = sumWhere(M, (h, a) => h > a), pD = sumWhere(M, (h, a) => h === a), pA = sumWhere(M, (h, a) => h < a);
  add('1X2', '1', 0, pH); add('1X2', 'X', 0, pD); add('1X2', '2', 0, pA);
  add('DC', '1X', 0, pH + pD); add('DC', '12', 0, pH + pA); add('DC', 'X2', 0, pD + pA);
  for (const L of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const o = sumWhere(M, (h, a) => h + a > L);
    add('OU', 'over', L, o); add('OU', 'under', L, 1 - o);
  }
  const btts = sumWhere(M, (h, a) => h > 0 && a > 0);
  add('BTTS', 'yes', 0, btts); add('BTTS', 'no', 0, 1 - btts);
  for (const L of [-1.5, -0.5, 0.5, 1.5]) {
    add('AH', 'home', L, sumWhere(M, (h, a) => h - a + L > 0));
    add('AH', 'away', L, sumWhere(M, (h, a) => a - h + L > 0));
  }
  const hH = sumWhere(Mh, (h, a) => h > a), hD = sumWhere(Mh, (h, a) => h === a), hA = sumWhere(Mh, (h, a) => h < a);
  add('HT_1X2', '1', 0, hH); add('HT_1X2', 'X', 0, hD); add('HT_1X2', '2', 0, hA);
  for (const L of [0.5, 1.5]) {
    const o = sumWhere(Mh, (h, a) => h + a > L);
    add('HT_OU', 'over', L, o); add('HT_OU', 'under', L, 1 - o);
  }
  const scores = [];
  for (let h = 0; h <= 5; h++) for (let a = 0; a <= 5; a++) scores.push({ score: `${h}-${a}`, p: M[h][a] });
  scores.sort((x, y) => y.p - x.p);
  for (const s of scores.slice(0, 5)) add('CS', s.score, 0, s.p);

  // Corners / cards only when the provider supplied per-team averages.
  const hs = ctx.homeStats, as = ctx.awayStats;
  const lam = (k) => (hs?.[k]?.for != null && hs?.[k]?.against != null && as?.[k]?.for != null && as?.[k]?.against != null)
    ? (hs[k].for + as[k].against) / 2 + (as[k].for + hs[k].against) / 2 : null;
  const lc = lam('corners');
  if (lc) for (const L of [8.5, 9.5, 10.5]) { const o = poissonOver(lc, L); add('CORNERS_OU', 'over', L, o); add('CORNERS_OU', 'under', L, 1 - o); }
  const lk = lam('cards');
  if (lk) for (const L of [3.5, 4.5, 5.5]) { const o = poissonOver(lk, L); add('CARDS_OU', 'over', L, o); add('CARDS_OU', 'under', L, 1 - o); }

  return { out, scores: scores.slice(0, 5), pH, pD, pA, btts, over25: sumWhere(M, (h, a) => h + a > 2) };
}

/**
 * Main entry point.
 * ctx: { homeStats, awayStats, homeForm, awayForm, h2h, league, standing, injuries, lineups,
 *        market: { p1x2, pOver25, implied: {key: prob}, odds: {key: {best, avg, bookmaker}} } }
 * cfg: { thresholds, minOdds, minQuality }
 */
function analyse(ctx, cfg) {
  const xg = expectedGoals(ctx);
  if (!xg) return { ok: false, reason: 'Not enough team statistics yet to produce a reliable estimate.', quality: dataQuality(ctx, {}) };
  const quality = dataQuality(ctx, xg.used);
  if (quality < (cfg.minQuality ?? 0.35)) {
    return { ok: false, reason: 'Data coverage for this match is too thin to publish a reliable estimate.', quality };
  }
  const { lh, la } = blendWithMarket(xg.lh, xg.la, ctx.market, xg.used, xg.factors);
  const grid = candidatesFromGrid(lh, la, ctx);
  const odds = ctx.market?.odds || {};
  const implied = ctx.market?.implied || {};

  const candidates = grid.out.map((c) => {
    const k = key(c.market, c.selection, c.line);
    const o = odds[k];
    const pm = implied[k];
    const penalty = pm != null ? Math.min(8, Math.max(0, c.p - pm) * 30) : 0;
    const confidence = round(clamp(c.p * 100 * (0.8 + 0.2 * quality) - penalty, 0, 99), 1);
    const level = levelFor(confidence, cfg.thresholds);
    return {
      market: c.market, selection: c.selection, line: Number(c.line || 0), category: CATEGORY_OF[c.market],
      probability: round(c.p * 100, 1), confidence, level, risk: RISK_OF_LEVEL[level],
      modelOdds: round(1 / Math.max(c.p, 0.001), 2),
      marketOdds: o ? o.best : null, bookmaker: o ? o.bookmaker : null,
      edge: o ? round(c.p * o.best - 1, 3) : null,
      marketProbability: pm != null ? round(pm * 100, 1) : null,
    };
  });
  candidates.sort((a, b) => b.confidence - a.confidence || (b.edge ?? -1) - (a.edge ?? -1));

  // Best pick: priced selections only; skip the long-shot correct-score market.
  const eligible = candidates.filter((c) => c.market !== 'CS' && c.marketOdds != null && c.marketOdds >= cfg.minOdds);
  const best = eligible[0] || null;
  // No priced selection yet (odds not published): show a clearly unpriced "lean" instead.
  const lean = best ? null : (candidates.find((c) => c.market !== 'CS' && c.modelOdds >= cfg.minOdds) || null);

  return {
    ok: true, version: MODEL_VERSION, quality,
    lambdas: { home: round(lh), away: round(la), total: round(lh + la) },
    probs: { home: round(grid.pH * 100, 1), draw: round(grid.pD * 100, 1), away: round(grid.pA * 100, 1), btts: round(grid.btts * 100, 1), over25: round(grid.over25 * 100, 1) },
    scorelines: grid.scores.map((s) => ({ score: s.score, probability: round(s.p * 100, 1) })),
    factors: xg.factors, used: xg.used,
    candidates, best, lean,
    hasOdds: Object.keys(odds).length > 0,
  };
}

module.exports = { analyse, expectedGoals, candidatesFromGrid, dataQuality, MODEL_VERSION, key, PRIOR };
