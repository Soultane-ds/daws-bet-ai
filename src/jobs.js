'use strict';
const cfg = require('./config');
const { get } = require('./db');
const football = require('./services/football');
const predictions = require('./services/predictions');
const notif = require('./services/notifications');
const { purgeExpired } = require('./services/cache');

function liveExpected() {
  const now = Date.now();
  return !!get("SELECT 1 AS x FROM matches WHERE status='live' OR (status='scheduled' AND kickoff_at BETWEEN ? AND ?) LIMIT 1", new Date(now - 20 * 60000).toISOString(), new Date(now + 5 * 60000).toISOString());
}
function start() {
  if (!cfg.jobsEnabled) return;
  let busy = false;
  const cycle = async () => {
    if (busy) return; busy = true;
    try {
      const now = Date.now();
      await football.syncWindow(new Date(now).toISOString(), new Date(now + 2 * 86400000).toISOString());
      await football.refreshOverdue();
      await predictions.analyseUpcoming();
      predictions.settleMatches();
      notif.notifyKickoffs();
      purgeExpired();
    } catch (e) { console.error('[jobs] cycle failed:', e.message); }
    finally { busy = false; }
  };
  setTimeout(cycle, 5000).unref();
  setInterval(cycle, 10 * 60000).unref();
  setInterval(async () => {
    try { if (liveExpected()) { await football.syncLive(); predictions.settleMatches(); } } catch (e) { console.error('[jobs] live failed:', e.message); }
  }, 60000).unref();
}
module.exports = { start };
