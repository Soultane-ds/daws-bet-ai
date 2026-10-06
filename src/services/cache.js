'use strict';
// Persistent response cache with in-flight de-duplication and stale-on-error fallback.
const { get, run } = require('../db');
const { j } = require('../util');

const inflight = new Map();

async function cachedMeta(key, ttlSec, fn, { force = false } = {}) {
  const row = get('SELECT payload, expires_at FROM api_cache WHERE key=?', key);
  const now = Date.now();
  if (row && !force && row.expires_at > now) return { value: j(row.payload), fresh: false, stale: false };
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const value = await fn();
      run('INSERT OR REPLACE INTO api_cache(key,payload,expires_at) VALUES(?,?,?)', key, JSON.stringify(value), Date.now() + ttlSec * 1000);
      return { value, fresh: true, stale: false };
    } catch (e) {
      if (row) return { value: j(row.payload), fresh: false, stale: true, error: e.message };
      throw e;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}
const cached = async (key, ttl, fn, opts) => (await cachedMeta(key, ttl, fn, opts)).value;
function purgeExpired() { run('DELETE FROM api_cache WHERE expires_at < ?', Date.now() - 2 * 86400000); }

module.exports = { cachedMeta, cached, purgeExpired };
