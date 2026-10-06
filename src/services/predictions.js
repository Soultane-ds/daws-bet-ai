'use strict';
const { all, get, run, tx } = require('../db');
const football = require('./football');
const budget = require('./budget');
const { analyse } = require('../engine/model');
const { explain } = require('../engine/explain');
const { evaluate } = require('../engine/settle');
const { levelFor, CATEGORY_OF } = require('../engine/labels');
const { getSetting } = require('../settings');
const { HttpError, j, isoNow } = require('../util');

const inflight = new Map();
const modelCfg = () => ({ thresholds: getSetting('thresholds'), minOdds: getSetting('min_odds'), minQuality: getSetting('min_data_quality') });

function readStored(matchId) {
  const r = get("SELECT payload, updated_at FROM match_extras WHERE match_id=? AND kind='analysis'", matchId);
  return r ? { ...j(r.payload), computedAt: r.updated_at } : null;
}

function persist(m, a) {
  const names = { home: m.home_name, away: m.away_name };
  const now = isoNow();
  const top = a.candidates.filter((c) => c.market !== 'CS').slice(0, 24);
  const cs = a.candidates.find((c) => c.market === 'CS');
  if (cs) top.push(cs);
  const pick = a.best || a.lean;
  if (pick && !top.some((c) => c === pick)) top.push(pick);
  tx(() => {
    run('DELETE FROM predictions WHERE match_id=?', m.id);
    for (const c of top) {
      const isBest = c === pick ? 1 : 0;
      run('INSERT OR REPLACE INTO predictions(match_id,market,selection,line,category,probability,confidence,model_odds,market_odds,bookmaker,edge,is_best,explanation,model_version,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        m.id, c.market, c.selection, c.line, c.category, c.probability, c.confidence, c.modelOdds, c.marketOdds, c.bookmaker, c.edge, isBest,
        isBest ? JSON.stringify(explain(a, c, names)) : null, a.version, now);
    }
    run("INSERT OR REPLACE INTO match_extras(match_id,kind,payload,updated_at) VALUES(?,?,?,?)", m.id, 'analysis', JSON.stringify(a), now);
  });
  if (a.best && new Date(m.kickoff_at) > new Date()) recordSystemPick(m, a.best);
}

/** One tracked pick per match so accuracy can be measured honestly over time. */
function recordSystemPick(m, c) {
  const level = levelFor(c.confidence, getSetting('thresholds'));
  const cur = get('SELECT id, result FROM prediction_history WHERE user_id IS NULL AND match_id=?', m.id);
  if (cur && cur.result !== 'pending') return;
  if (cur) run('UPDATE prediction_history SET market=?, selection=?, line=?, probability=?, confidence=?, level=?, odds=?, created_at=? WHERE id=?', c.market, c.selection, c.line, c.probability, c.confidence, level, c.marketOdds, isoNow(), cur.id);
  else run('INSERT INTO prediction_history(user_id,match_id,market,selection,line,probability,confidence,level,odds,created_at) VALUES(NULL,?,?,?,?,?,?,?,?,?)', m.id, c.market, c.selection, c.line, c.probability, c.confidence, level, c.marketOdds, isoNow());
}

/** Compute (or return cached) analysis for a match. */
async function analyseMatch(matchId, { force = false } = {}) {
  const m = football.getMatchRow(matchId);
  if (!m) throw new HttpError(404, 'Match not found.');
  const stored = readStored(matchId);
  if (['finished', 'cancelled', 'postponed', 'suspended'].includes(m.status)) return { match: m, analysis: stored };
  const ttlMs = getSetting('analysis_ttl_minutes') * 60000;
  if (!force && stored && Date.now() - new Date(stored.computedAt) < ttlMs) return { match: m, analysis: stored };
  if (m.status === 'live' && stored) return { match: m, analysis: stored }; // keep the pre-match estimate while the game is on
  if (inflight.has(matchId)) return inflight.get(matchId);
  const p = (async () => {
    try {
      const { ctx, warnings } = await football.loadContext(m, { force });
      if (m.status === 'live') ctx.market = null; // live odds describe the current state, not the pre-match picture
      const a = analyse(ctx, modelCfg());
      a.warnings = warnings;
      a.hasLineups = !!ctx.lineups;
      a.names = { home: m.home_name, away: m.away_name };
      a.computedAt = isoNow();
      if (a.ok) persist(m, a);
      else { run('DELETE FROM predictions WHERE match_id=?', m.id); run("INSERT OR REPLACE INTO match_extras(match_id,kind,payload,updated_at) VALUES(?,?,?,?)", m.id, 'analysis', JSON.stringify(a), isoNow()); }
      return { match: m, analysis: a, ctx };
    } finally { inflight.delete(matchId); }
  })();
  inflight.set(matchId, p);
  return p;
}

/** Background batch: analyse upcoming matches, nearest kickoff first, within the batch limit. */
async function analyseUpcoming() {
  const horizon = new Date(Date.now() + getSetting('analysis_horizon_hours') * 3600000).toISOString();
  const ttlCut = new Date(Date.now() - getSetting('analysis_ttl_minutes') * 60000).toISOString();
  const scope = getSetting('analysis_scope') === 'all' ? '' : 'AND c.popular=1';
  const rows = all(`SELECT m.id FROM matches m JOIN competitions c ON c.id=m.competition_id
    LEFT JOIN match_extras x ON x.match_id=m.id AND x.kind='analysis'
    WHERE m.status='scheduled' AND m.hidden=0 AND c.enabled=1 ${scope} AND m.kickoff_at > ? AND m.kickoff_at < ?
      AND (x.updated_at IS NULL OR x.updated_at < ?)
    ORDER BY m.kickoff_at LIMIT ?`, isoNow(), horizon, ttlCut, getSetting('analysis_batch'));
  let done = 0;
  for (const r of rows) {
    if (budget.used() >= budget.limit()) break;
    try { await analyseMatch(r.id); done++; }
    catch (e) { if (e.code === 'budget' || e.code === 'not_configured') break; }
  }
  return done;
}

function settleMatches() {
  const rows = all(`SELECT h.id, h.market, h.selection, h.line, m.status, m.kickoff_at, m.home_score, m.away_score, m.ht_home, m.ht_away
    FROM prediction_history h JOIN matches m ON m.id=h.match_id
    WHERE h.result='pending' AND (m.status IN ('finished','cancelled') OR (m.status='postponed' AND m.kickoff_at < ?))`, new Date(Date.now() - 7 * 86400000).toISOString());
  let n = 0;
  for (const r of rows) {
    const res = r.status === 'finished' ? evaluate(r.market, r.selection, r.line, { h: r.home_score, a: r.away_score, hth: r.ht_home, hta: r.ht_away }) : 'void';
    if (res) { run('UPDATE prediction_history SET result=?, settled_at=? WHERE id=?', res, isoNow(), r.id); n++; }
  }
  return n;
}

function performance() {
  const settled = all("SELECT * FROM prediction_history WHERE user_id IS NULL AND result IN ('won','lost')");
  const group = (rows, keyFn) => {
    const g = {};
    for (const r of rows) {
      const k = keyFn(r); const o = (g[k] ||= { key: k, picks: 0, won: 0, avgProbability: 0, units: 0, priced: 0 });
      o.picks++; o.won += r.result === 'won' ? 1 : 0; o.avgProbability += r.probability;
      if (r.odds) { o.priced++; o.units += r.result === 'won' ? r.odds - 1 : -1; }
    }
    return Object.values(g).map((o) => ({ key: o.key, picks: o.picks, won: o.won, hitRate: Math.round((o.won / o.picks) * 1000) / 10, avgPredicted: Math.round((o.avgProbability / o.picks) * 10) / 10, roi: o.priced ? Math.round((o.units / o.priced) * 1000) / 10 : null }));
  };
  const total = group(settled, () => 'all')[0] || null;
  return {
    overall: total,
    pending: get("SELECT COUNT(*) AS n FROM prediction_history WHERE user_id IS NULL AND result='pending'").n,
    voided: get("SELECT COUNT(*) AS n FROM prediction_history WHERE user_id IS NULL AND result='void'").n,
    byLevel: group(settled, (r) => r.level),
    byMarket: group(settled, (r) => r.market),
    note: 'Hit rate compares settled AI picks with the average probability the model gave them. A large gap means the model needs recalibrating. ROI assumes a flat 1-unit stake at the best odds seen when the pick was made.',
  };
}

module.exports = { analyseMatch, analyseUpcoming, settleMatches, performance, readStored, modelCfg, CATEGORY_OF };
