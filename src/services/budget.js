'use strict';
// Hard daily cap on provider requests so a busy day can never exceed the plan quota.
const cfg = require('../config');
const { rawGet, rawSet } = require('../settings');
const { dayKey } = require('../util');

const k = () => `api_usage:${dayKey()}`;
function used() { return rawGet(k()) || 0; }
function consume() {
  const u = used();
  if (u >= cfg.apiDailyLimit) {
    const { ProviderError } = require('../providers');
    throw new ProviderError(`Daily provider request limit reached (${cfg.apiDailyLimit}). Data will refresh tomorrow or raise API_DAILY_LIMIT.`, { code: 'budget' });
  }
  rawSet(k(), u + 1);
}
module.exports = { used, consume, limit: () => cfg.apiDailyLimit };
