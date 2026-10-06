'use strict';
const { all, run, tx } = require('../db');
const { getProvider } = require('../providers');
const { cachedMeta } = require('./cache');
const { getSetting } = require('../settings');
const { MARKET_NAMES } = require('../engine/labels');

const key = (m, s, l) => `${m}|${s}|${Number(l || 0)}`;
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

async function refreshOdds(m, { force = false } = {}) {
  if (!m.provider_id) return { fresh: false };
  const ttl = getSetting('cache_ttl');
  const r = await cachedMeta(`odds:${m.provider_id}`, m.status === 'live' ? ttl.odds_live : ttl.odds, () => getProvider().getOdds({ fixtureId: m.provider_id }), { force });
  if (r.fresh) {
    const now = new Date().toISOString();
    tx(() => {
      run('DELETE FROM odds WHERE match_id=?', m.id);
      for (const o of r.value) run('INSERT OR REPLACE INTO odds(match_id,bookmaker,market,selection,line,price,fetched_at) VALUES(?,?,?,?,?,?,?)', m.id, o.bookmaker, o.market, o.selection, o.line || 0, o.price, now);
    });
  }
  return r;
}

function demargin(prices) {
  const inv = prices.map((p) => 1 / p);
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}

/** Aggregate stored bookmaker prices into best/avg per selection plus de-margined implied probabilities. */
function marketView(matchId) {
  const rows = all('SELECT bookmaker, market, selection, line, price FROM odds WHERE match_id=?', matchId);
  if (!rows.length) return null;
  const groups = new Map();
  for (const r of rows) {
    const k = key(r.market, r.selection, r.line);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const odds = {};
  for (const [k, list] of groups) {
    const med = median(list.map((x) => x.price));
    const sane = list.length >= 3 ? list.filter((x) => x.price <= med * 1.4) : list; // ignore stray outlier prices
    const top = sane.reduce((a, b) => (b.price > a.price ? b : a));
    odds[k] = { best: top.price, bookmaker: top.bookmaker, avg: list.reduce((s, x) => s + x.price, 0) / list.length, n: list.length };
  }
  const implied = {};
  const pair = (market, a, b, line = 0) => {
    const x = odds[key(market, a, line)], y = odds[key(market, b, line)];
    if (!x || !y) return;
    const [pa, pb] = demargin([x.avg, y.avg]);
    implied[key(market, a, line)] = pa; implied[key(market, b, line)] = pb;
  };
  const lines = new Set(rows.filter((r) => r.market === 'OU').map((r) => r.line));
  for (const L of lines) pair('OU', 'over', 'under', L);
  pair('BTTS', 'yes', 'no');
  let p1x2 = null;
  const o1 = odds[key('1X2', '1', 0)], oX = odds[key('1X2', 'X', 0)], o2 = odds[key('1X2', '2', 0)];
  if (o1 && oX && o2) {
    const [a, b, c] = demargin([o1.avg, oX.avg, o2.avg]);
    p1x2 = { '1': a, X: b, '2': c };
    implied[key('1X2', '1', 0)] = a; implied[key('1X2', 'X', 0)] = b; implied[key('1X2', '2', 0)] = c;
  }
  return { odds, implied, p1x2, pOver25: implied[key('OU', 'over', 2.5)] ?? null };
}

const MARKET_ORDER = ['1X2', 'DC', 'OU', 'BTTS', 'AH', 'HT_1X2', 'HT_OU', 'CORNERS_OU', 'CARDS_OU', 'CS'];
/** Odds grouped for display. */
function oddsByMarket(matchId) {
  const view = marketView(matchId);
  if (!view) return [];
  const groups = {};
  for (const [k, v] of Object.entries(view.odds)) {
    const [market, selection, line] = k.split('|');
    (groups[market] ||= []).push({ selection, line: Number(line), best: v.best, bookmaker: v.bookmaker, avg: Math.round(v.avg * 100) / 100, bookmakers: v.n });
  }
  return MARKET_ORDER.filter((m) => groups[m]).map((m) => ({
    market: m, name: MARKET_NAMES[m],
    items: groups[m].sort((a, b) => a.line - b.line || a.selection.localeCompare(b.selection)).slice(0, m === 'CS' ? 12 : 40),
  }));
}

function odds1x2(matchIds) {
  if (!matchIds.length) return {};
  const rows = all(`SELECT match_id, selection, MAX(price) AS best FROM odds WHERE market='1X2' AND match_id IN (${matchIds.map(() => '?').join(',')}) GROUP BY match_id, selection`, ...matchIds);
  const out = {};
  for (const r of rows) (out[r.match_id] ||= {})[r.selection] = r.best;
  return out;
}

module.exports = { refreshOdds, marketView, oddsByMarket, odds1x2, key };
