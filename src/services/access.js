'use strict';
const { getSetting } = require('../settings');
const { all } = require('../db');

const TIERS = ['free', 'vip', 'premium'];
const rank = (t) => Math.max(0, TIERS.indexOf(t));

/** What the current user may see/do. Admins and the "Unlock Everything" switch bypass tiers. */
function featuresFor(user) {
  const tier = user ? user.effective_tier : 'free';
  const unlockSwitch = !!getSetting('unlock_everything');
  const unlocked = unlockSwitch || !!user?.is_admin;
  const tf = getSetting('tier_features');
  const base = unlocked
    ? { high_confidence: true, value_bets: true, bet_machine: true, bet_machine_max_legs: 12, combos: Object.keys(getSetting('combos')) }
    : (tf[tier] || tf.free);
  return {
    tier, unlocked, unlock_everything: unlockSwitch,
    picks_limit: unlocked || tier !== 'free' ? null : getSetting('free_daily_picks'),
    high_confidence: !!base.high_confidence, value_bets: !!base.value_bets,
    bet_machine: !!base.bet_machine, bet_machine_max_legs: base.bet_machine_max_legs || 0,
    combos: base.combos || [],
  };
}
let catCache = { at: 0, rows: [] };
function categories() {
  if (Date.now() - catCache.at > 5000) catCache = { at: Date.now(), rows: all('SELECT * FROM prediction_categories ORDER BY sort_order') };
  return catCache.rows;
}
function resetCategoryCache() { catCache.at = 0; }
function categoryAccess(features) {
  const out = {};
  for (const c of categories()) out[c.key] = { enabled: !!c.enabled, locked: !features.unlocked && rank(features.tier) < rank(c.min_tier), label: c.label, min_tier: c.min_tier };
  return out;
}
module.exports = { featuresFor, categories, categoryAccess, resetCategoryCache, TIERS, rank };
