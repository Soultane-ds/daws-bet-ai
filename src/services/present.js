'use strict';
/** Shapes database rows for the API and applies tier locks on the server. */
const { all, get, inList } = require('../db');
const { levelFor, LEVEL_TEXT, RISK_OF_LEVEL, pickText } = require('../engine/labels');
const { getSetting } = require('../settings');
const { categoryAccess } = require('./access');
const { odds1x2 } = require('./odds');
const { j } = require('../util');

const HIGH_LEVELS = new Set(['very_high', 'high']);

function shapePick(row, names, features, extra = {}) {
  const th = getSetting('thresholds');
  const level = levelFor(row.confidence, th);
  const cats = extra.cats || categoryAccess(features);
  const cat = cats[row.category];
  let lockReason = null;
  if (HIGH_LEVELS.has(level) && !features.high_confidence) lockReason = 'high_confidence';
  else if (cat?.locked) lockReason = 'category';
  else if (extra.limitLocked) lockReason = 'limit';
  const base = { matchId: row.match_id, category: row.category, level, levelText: LEVEL_TEXT[level], confidence: row.confidence };
  if (lockReason) return { ...base, locked: true, lockReason, requiredTier: lockReason === 'category' ? cat.min_tier : 'vip' };
  const value = row.market_odds != null && row.edge != null && row.edge >= getSetting('min_edge') && row.confidence >= getSetting('value_min_confidence');
  return {
    ...base, locked: false,
    market: row.market, selection: row.selection, line: row.line,
    text: pickText(row.market, row.selection, row.line, names.home, names.away),
    probability: row.probability, risk: RISK_OF_LEVEL[level],
    modelOdds: row.model_odds, marketOdds: row.market_odds, bookmaker: row.bookmaker, edge: row.edge,
    priced: row.market_odds != null,
    value: value && (features.value_bets || false) ? true : false,
    valueHidden: value && !features.value_bets,
    explanation: row.explanation ? j(row.explanation) : null,
  };
}

function cardOf(m, { pick, odds, fav }) {
  return {
    id: m.id,
    competition: { id: m.competition_id, name: m.comp_name, logo: m.comp_logo, country: m.comp_country, popular: !!m.comp_popular },
    home: { id: m.home_team_id, name: m.home_name, logo: m.home_logo },
    away: { id: m.away_team_id, name: m.away_name, logo: m.away_logo },
    kickoff: m.kickoff_at, status: m.status, minute: m.minute, isTop: !!m.is_top,
    score: m.home_score == null ? null : { home: m.home_score, away: m.away_score, htHome: m.ht_home, htAway: m.ht_away },
    odds: odds || null, pick: pick || null, favorite: !!fav, manual: m.source === 'manual',
  };
}

/** Attach 1X2 odds, best pick and favourite flag to a list of match rows. */
function decorateMatches(rows, user, features) {
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  const o = odds1x2(ids);
  const picks = {};
  for (const p of all(`SELECT * FROM predictions WHERE is_best=1 AND match_id IN (${inList(ids)})`, ...ids)) picks[p.match_id] = p;
  const favs = new Set(user ? all(`SELECT ref_id FROM favorites WHERE user_id=? AND kind='match' AND ref_id IN (${inList(ids)})`, user.id, ...ids).map((f) => f.ref_id) : []);
  const cats = categoryAccess(features);
  return rows.map((m) => cardOf(m, {
    odds: o[m.id] || null,
    pick: picks[m.id] ? shapePick(picks[m.id], { home: m.home_name, away: m.away_name }, features, { cats }) : null,
    fav: favs.has(m.id),
  }));
}

function favoriteTeamIds(user) {
  return user ? all("SELECT ref_id FROM favorites WHERE user_id=? AND kind='team'", user.id).map((f) => f.ref_id) : [];
}

module.exports = { shapePick, cardOf, decorateMatches, favoriteTeamIds };
