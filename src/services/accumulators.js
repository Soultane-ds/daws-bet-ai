'use strict';
const { all, inList } = require('../db');
const { getSetting } = require('../settings');
const { levelFor, LEVEL_TEXT, RISK_OF_LEVEL, pickText } = require('../engine/labels');
const { round } = require('../util');

const RISK_ORDER = ['Low', 'Moderate', 'Elevated', 'High'];

/** Priced, upcoming selections that pass the filters. Only real bookmaker prices qualify. */
function loadCandidates({ from, to, competitionId, categories, minConfidence = 0, minOdds, matchIds } = {}) {
  const now = new Date().toISOString();
  const where = ["m.status='scheduled'", 'm.hidden=0', 'c.enabled=1', 'pc.enabled=1', 'p.market_odds IS NOT NULL', 'p.market_odds >= ?', 'p.confidence >= ?', 'm.kickoff_at > ?'];
  const params = [minOdds ?? getSetting('min_odds'), minConfidence, from && from > now ? from : now];
  if (to) { where.push('m.kickoff_at < ?'); params.push(to); }
  if (competitionId) { where.push('m.competition_id=?'); params.push(competitionId); }
  if (categories?.length) { where.push(`p.category IN (${inList(categories)})`); params.push(...categories); }
  if (matchIds?.length) { where.push(`m.id IN (${inList(matchIds)})`); params.push(...matchIds); }
  const rows = all(`SELECT p.*, m.kickoff_at, m.competition_id, c.name AS comp_name, th.name AS home_name, ta.name AS away_name
    FROM predictions p JOIN matches m ON m.id=p.match_id JOIN competitions c ON c.id=m.competition_id
    JOIN teams th ON th.id=m.home_team_id JOIN teams ta ON ta.id=m.away_team_id JOIN prediction_categories pc ON pc.key=p.category
    WHERE ${where.join(' AND ')}`, ...params);
  const th = getSetting('thresholds');
  return rows.map((r) => {
    const level = levelFor(r.confidence, th);
    return {
      matchId: r.match_id, market: r.market, selection: r.selection, line: r.line, category: r.category,
      text: pickText(r.market, r.selection, r.line, r.home_name, r.away_name),
      matchLabel: `${r.home_name} v ${r.away_name}`, competition: r.comp_name, kickoff: r.kickoff_at,
      odds: r.market_odds, bookmaker: r.bookmaker, probability: r.probability, confidence: r.confidence, edge: r.edge,
      level, levelText: LEVEL_TEXT[level],
    };
  });
}
/** One selection per match: the most confident, ties broken by edge. */
function bestPerMatch(cands) {
  const m = new Map();
  for (const c of cands) {
    const cur = m.get(c.matchId);
    if (!cur || c.confidence > cur.confidence || (c.confidence === cur.confidence && (c.edge ?? -1) > (cur.edge ?? -1))) m.set(c.matchId, c);
  }
  return [...m.values()];
}

function choose(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; }

function searchTarget(pool, legs, target, tolerance) {
  pool = [...pool].sort((a, b) => b.confidence - a.confidence);
  let K = Math.min(pool.length, 30);
  while (K > legs && choose(K, legs) > 300000) K--;
  pool = pool.slice(0, K);
  const lnT = Math.log(target);
  let best = null, bestKey = null;
  const stack = [];
  (function dfs(start, lnOdds, confSum) {
    if (stack.length === legs) {
      const dev = Math.abs(lnOdds - lnT);
      const within = dev <= Math.log(1 + tolerance);
      const keyv = within ? [0, -confSum] : [dev, -confSum];
      if (!bestKey || keyv[0] < bestKey[0] || (keyv[0] === bestKey[0] && keyv[1] < bestKey[1])) { bestKey = keyv; best = [...stack]; }
      return;
    }
    for (let i = start; i <= pool.length - (legs - stack.length); i++) {
      stack.push(pool[i]);
      dfs(i + 1, lnOdds + Math.log(pool[i].odds), confSum + pool[i].confidence);
      stack.pop();
    }
  })(0, 0, 0);
  return best || [];
}

function summarise(legs, extraNote) {
  if (!legs.length) return null;
  const combinedOdds = legs.reduce((p, l) => p * l.odds, 1);
  const avgConfidence = legs.reduce((s, l) => s + l.confidence, 0) / legs.length;
  const estProbability = legs.reduce((p, l) => p * (l.probability / 100), 1) * 100;
  let risk = RISK_OF_LEVEL[levelFor(avgConfidence, getSetting('thresholds'))];
  const floor = legs.length >= 6 ? 'High' : legs.length >= 4 ? 'Elevated' : legs.length >= 2 ? 'Moderate' : 'Low';
  if (RISK_ORDER.indexOf(floor) > RISK_ORDER.indexOf(risk)) risk = floor;
  return {
    legs, count: legs.length, combinedOdds: round(combinedOdds, 2), avgConfidence: round(avgConfidence, 1),
    estProbability: round(estProbability, 1), risk,
    note: extraNote || 'Estimated chance multiplies each leg and assumes the matches are independent. Every added selection lowers the chance that all of them come in.',
  };
}

/** AI Bet Machine / combination builder. */
function build({ candidates, legs, strategy = 'confidence', targetOdds, tolerance = 0.1, minConfidence = 0 }) {
  let pool = bestPerMatch(candidates.filter((c) => c.confidence >= minConfidence));
  let chosen;
  if (strategy === 'value') {
    pool = pool.filter((c) => c.edge != null && c.edge >= getSetting('min_edge')).sort((a, b) => b.edge - a.edge);
    chosen = pool.slice(0, legs);
  } else if (strategy === 'target' && targetOdds) {
    chosen = pool.length >= legs ? searchTarget(pool, legs, targetOdds, tolerance) : pool;
  } else {
    chosen = pool.sort((a, b) => b.confidence - a.confidence).slice(0, legs);
  }
  chosen.sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  const result = summarise(chosen);
  const out = { available: pool.length, requested: legs, shortfall: Math.max(0, legs - chosen.length), result };
  if (!chosen.length) out.message = 'No selections meet these filters yet. Try lowering the minimum confidence, choosing more markets, or another date.';
  else if (chosen.length < legs) out.message = `Only ${chosen.length} qualifying selection${chosen.length === 1 ? '' : 's'} available for these filters.`;
  if (result && targetOdds) {
    out.targetOdds = targetOdds;
    out.targetMet = Math.abs(Math.log(result.combinedOdds / targetOdds)) <= Math.log(1 + tolerance);
    if (!out.targetMet && chosen.length === legs) out.message = `Closest available combination is ${result.combinedOdds.toFixed(2)} against a ${targetOdds} target.`;
  }
  return out;
}

function dailyCombos({ from, to, features }) {
  const combos = getSetting('combos');
  const out = [];
  for (const [key, c] of Object.entries(combos)) {
    const allowed = features.combos.includes(key);
    const cands = loadCandidates({ from, to, minConfidence: c.minConfidence });
    const r = build({ candidates: cands, legs: c.legs, strategy: c.strategy, targetOdds: c.targetOdds, minConfidence: c.minConfidence });
    const base = { key, label: c.label, strategy: c.strategy, targetOdds: c.targetOdds || null, minConfidence: c.minConfidence, plannedLegs: c.legs };
    if (!allowed) out.push({ ...base, locked: true, available: r.result ? r.result.count : 0, requiredTier: key === 'vip' ? 'premium' : 'vip' });
    else out.push({ ...base, locked: false, message: r.message || null, ...(r.result || { legs: [], count: 0 }) });
  }
  return out;
}

module.exports = { loadCandidates, bestPerMatch, build, dailyCombos, summarise };
