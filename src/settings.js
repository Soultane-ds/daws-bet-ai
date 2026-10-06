'use strict';
const { all, get, run } = require('./db');
const cfg = require('./config');
const { j } = require('./util');

const DEFAULTS = {
  app_name: 'DAWS BET AI',
  thresholds: { very_high: 95, high: 90, good: 80, medium: 70 },
  min_odds: 1.2,
  min_edge: 0.03,
  value_min_confidence: 70,
  unlock_everything: !cfg.isProd,
  free_daily_picks: 5,
  tier_features: {
    free: { high_confidence: false, value_bets: false, bet_machine: false, bet_machine_max_legs: 0, combos: ['safe'] },
    vip: { high_confidence: true, value_bets: true, bet_machine: true, bet_machine_max_legs: 6, combos: ['safe', 'balanced', 'high_odds'] },
    premium: { high_confidence: true, value_bets: true, bet_machine: true, bet_machine_max_legs: 12, combos: ['safe', 'balanced', 'high_odds', 'vip'] },
  },
  combos: {
    safe: { label: 'Safe Combination', legs: 3, minConfidence: 80, strategy: 'confidence' },
    balanced: { label: 'Balanced Combination', legs: 4, minConfidence: 72, strategy: 'target', targetOdds: 5 },
    high_odds: { label: 'High Odds Combination', legs: 5, minConfidence: 70, strategy: 'target', targetOdds: 12 },
    vip: { label: 'VIP Combination', legs: 4, minConfidence: 75, strategy: 'value' },
  },
  cache_ttl: { fixtures_today: 3600, fixtures_other: 21600, live: 120, odds: 900, odds_live: 120, team: 21600, h2h: 86400, standings: 21600, lineups: 1800, stats: 300 },
  analysis_ttl_minutes: 20,
  analysis_batch: 20,
  analysis_horizon_hours: 36,
  analysis_scope: 'popular', // popular | all
  min_data_quality: 0.35,
  live_poll_seconds: 120,
  disclaimer: 'DAWS BET AI provides statistical probability estimates for information and entertainment only. No prediction is guaranteed and past performance does not predict future results. Betting involves risk and can lead to losses; never stake money you cannot afford to lose. 18+ only. If gambling is a problem, seek free, confidential help from a local support organisation.',
  maintenance: false,
};

let cache = null;
function load() {
  cache = {};
  for (const r of all('SELECT key, value FROM settings')) cache[r.key] = j(r.value);
}
function getSetting(key) {
  if (!cache) load();
  const d = DEFAULTS[key];
  const v = cache[key];
  if (v === undefined || v === null) return d;
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof v === 'object') return { ...d, ...v };
  return v;
}
function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  load();
}
function allSettings() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = getSetting(k);
  return out;
}
// Raw key/value store for internal counters (not user-editable settings)
const rawGet = (key) => { const r = get('SELECT value FROM settings WHERE key=?', key); return r ? j(r.value) : null; };
const rawSet = (key, value) => run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));

module.exports = { DEFAULTS, getSetting, setSetting, allSettings, rawGet, rawSet };
