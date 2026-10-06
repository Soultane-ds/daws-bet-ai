'use strict';
const { route } = require('../http');
const cfg = require('../config');
const auth = require('../auth');
const { all, get, run, inList } = require('../db');
const { getSetting, rawGet } = require('../settings');
const { HttpError, dayKey, isoNow } = require('../util');
const football = require('../services/football');
const predictions = require('../services/predictions');
const odds = require('../services/odds');
const acc = require('../services/accumulators');
const notif = require('../services/notifications');
const budget = require('../services/budget');
const { featuresFor, categories, categoryAccess } = require('../services/access');
const { shapePick, decorateMatches, favoriteTeamIds } = require('../services/present');
const { explain } = require('../engine/explain');
const { LEVEL_TEXT, pickText } = require('../engine/labels');
const { getProvider } = require('../providers');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function windowOf(q) {
  const date = DATE_RE.test(q.date || '') ? q.date : dayKey();
  const tz = Math.max(-840, Math.min(840, parseInt(q.tz, 10) || 0));
  return { date, ...football.windowFor(date, tz) };
}
const page = (q, d = 1) => Math.max(1, parseInt(q, 10) || d);
const lim = (q, d, max) => Math.min(max, Math.max(1, parseInt(q, 10) || d));

/* ---------------- config ---------------- */
route('GET', '/api/config', async ({ user }) => ({
  appName: getSetting('app_name'),
  thresholds: getSetting('thresholds'),
  levels: LEVEL_TEXT,
  disclaimer: getSetting('disclaimer'),
  googleClientId: cfg.googleClientId || null,
  providerConfigured: !!getProvider().configured,
  minOdds: getSetting('min_odds'),
  tiers: getSetting('tier_features'),
  freePicks: getSetting('free_daily_picks'),
  features: featuresFor(user),
  categories: categories().filter((c) => c.enabled).map((c) => ({ key: c.key, label: c.label, min_tier: c.min_tier })),
  user: user ? auth.publicUser(user) : null,
  unread: user ? notif.unreadCount(user.id) : 0,
  maintenance: !!getSetting('maintenance'),
}));

/* ---------------- auth ---------------- */
const rl = (ip, what = 'auth') => auth.rateLimit(`${what}:${ip}`, 20, 15 * 60000);
route('POST', '/api/auth/register', async ({ body, ip }) => {
  rl(ip);
  const u = auth.register(body);
  notif.notify({ userId: u.id, title: 'Welcome to DAWS BET AI', body: 'Tap any match to see the model\'s probability breakdown. Every figure is an estimate, never a guarantee.', kind: 'info' });
  return { token: auth.signToken(u.id), user: auth.publicUser(u), features: featuresFor(u) };
});
route('POST', '/api/auth/login', async ({ body, ip }) => {
  rl(ip);
  const u = auth.login(body);
  return { token: auth.signToken(u.id), user: auth.publicUser(u), features: featuresFor(u) };
});
route('POST', '/api/auth/google', async ({ body, ip }) => {
  rl(ip);
  const u = await auth.googleLogin(String(body.credential || ''));
  return { token: auth.signToken(u.id), user: auth.publicUser(u), features: featuresFor(u) };
});
route('GET', '/api/me', async ({ user }) => ({ user: auth.publicUser(user), features: featuresFor(user), unread: notif.unreadCount(user.id) }), 'user');
route('PATCH', '/api/me', async ({ user, body }) => {
  const name = String(body.name || '').trim().slice(0, 60);
  if (!name) throw new HttpError(400, 'Enter a display name.');
  run('UPDATE users SET name=? WHERE id=?', name, user.id);
  return { user: auth.publicUser(auth.loadUser(user.id)) };
}, 'user');
route('POST', '/api/me/password', async ({ user, body }) => {
  if (user.password_hash && !auth.verifyPassword(String(body.current || ''), user.password_hash)) throw new HttpError(400, 'Current password is incorrect.');
  if (String(body.next || '').length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  run('UPDATE users SET password_hash=? WHERE id=?', auth.hashPassword(body.next), user.id);
  return { ok: true };
}, 'user');

/* ---------------- shared query helpers ---------------- */
async function ensureWindow(from, to) {
  const errors = await football.syncWindow(from, to);
  return [...new Set(errors)];
}
const warnPayload = (errors) => (errors.length ? { warnings: errors, providerConfigured: !!getProvider().configured } : {});

/** Best pick per match inside a window, with filters. */
function pickRows({ from, to, type = 'all', category, competitionId, minConfidence = 0, includeLive = false }) {
  const th = getSetting('thresholds');
  const statuses = includeLive ? "('scheduled','live')" : "('scheduled')";
  const where = [`m.status IN ${statuses}`, 'm.hidden=0', 'c.enabled=1', 'pc.enabled=1', 'p.confidence >= ?'];
  const params = [minConfidence];
  if (from) { where.push('m.kickoff_at >= ?'); params.push(from); }
  if (to) { where.push('m.kickoff_at < ?'); params.push(to); }
  if (competitionId) { where.push('m.competition_id=?'); params.push(competitionId); }
  if (category) { where.push('p.category=?'); params.push(category); }
  let rows;
  const base = `SELECT p.*, m.kickoff_at, m.competition_id, c.name AS comp_name, th.name AS home_name, ta.name AS away_name
    FROM predictions p JOIN matches m ON m.id=p.match_id JOIN competitions c ON c.id=m.competition_id
    JOIN teams th ON th.id=m.home_team_id JOIN teams ta ON ta.id=m.away_team_id JOIN prediction_categories pc ON pc.key=p.category`;
  if (type === 'value') {
    where.push('p.market_odds IS NOT NULL', 'p.edge >= ?', 'p.confidence >= ?');
    params.push(getSetting('min_edge'), getSetting('value_min_confidence'));
    rows = all(`${base} WHERE ${where.join(' AND ')} ORDER BY p.edge DESC`, ...params);
    const seen = new Set(); rows = rows.filter((r) => (seen.has(r.match_id) ? false : seen.add(r.match_id)));
  } else {
    where.push('p.is_best=1');
    if (type === 'high') { where.push('p.confidence >= ?'); params.push(th.high); }
    rows = all(`${base} WHERE ${where.join(' AND ')} ORDER BY p.confidence DESC, p.edge DESC`, ...params);
  }
  return rows;
}
function shapeRows(rows, features, { offset = 0 } = {}) {
  const cats = categoryAccess(features);
  return rows.map((r, i) => ({
    ...shapePick(r, { home: r.home_name, away: r.away_name }, features, { cats, limitLocked: features.picks_limit != null && offset + i >= features.picks_limit }),
    matchLabel: `${r.home_name} v ${r.away_name}`, home: r.home_name, away: r.away_name, competition: r.comp_name, kickoff: r.kickoff_at,
  }));
}

/* ---------------- home ---------------- */
route('GET', '/api/home', async ({ query, user }) => {
  const w = windowOf(query), features = featuresFor(user);
  const horizon = new Date(new Date(w.to).getTime() + 2 * 86400000).toISOString();
  const errors = await ensureWindow(w.from, horizon);
  await football.syncLive();
  const dec = (rows) => decorateMatches(rows, user, features);
  const live = dec(football.listMatches({ status: 'live', pageSize: 10 }).rows);
  const today = football.listMatches({ from: w.from, to: w.to, pageSize: 12 });
  const upcoming = football.listMatches({ from: w.to, to: horizon, status: 'scheduled', pageSize: 8 });
  const top = football.listMatches({ from: w.from, to: w.to, top: 1, pageSize: 6 });
  const rows = pickRows({ from: w.from, to: w.to });
  const topRows = rows.slice(0, 8);
  const comps = all(`SELECT c.id, c.name, c.logo, c.country, COUNT(m.id) AS matches FROM competitions c
    LEFT JOIN matches m ON m.competition_id=c.id AND m.hidden=0 AND m.kickoff_at >= ? AND m.kickoff_at < ?
    WHERE c.popular=1 AND c.enabled=1 GROUP BY c.id ORDER BY matches DESC, c.sort_order, c.name LIMIT 12`, w.from, w.to);
  const nowIso = isoNow();
  const banners = all('SELECT id,title,body,link FROM banners WHERE active=1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?) ORDER BY sort_order, id LIMIT 5', nowIso, nowIso);
  return {
    date: w.date, ...warnPayload(errors),
    live, today: { items: dec(today.rows), total: today.total }, upcoming: dec(upcoming.rows), top: dec(top.rows),
    competitions: comps,
    picks: shapeRows(topRows, features),
    highConfidence: shapeRows(pickRows({ from: w.from, to: w.to, type: 'high' }).slice(0, 6), features),
    valueBets: features.value_bets ? shapeRows(pickRows({ from: w.from, to: w.to, type: 'value' }).slice(0, 6), features) : { locked: true, count: pickRows({ from: w.from, to: w.to, type: 'value' }).length },
    combos: acc.dailyCombos({ from: w.from, to: w.to, features }),
    banners,
    favorites: user ? favoriteTeamIds(user).length + get("SELECT COUNT(*) AS n FROM favorites WHERE user_id=? AND kind='match'", user.id).n : 0,
  };
});

/* ---------------- matches ---------------- */
route('GET', '/api/matches', async ({ query, user }) => {
  const features = featuresFor(user);
  const q = String(query.q || '').trim().slice(0, 60);
  let from, to, errors = [];
  if (query.date || !q) {
    const w = windowOf(query); from = w.from; to = w.to;
    errors = await ensureWindow(from, to);
  } else {
    from = new Date(Date.now() - 2 * 86400000).toISOString(); to = new Date(Date.now() + 14 * 86400000).toISOString();
  }
  const status = ['scheduled', 'live', 'finished'].includes(query.status) ? query.status : null;
  if (status === 'live') await football.syncLive();
  const r = football.listMatches({
    from, to, status: status === 'scheduled' ? 'scheduled,postponed,cancelled,suspended' : status, q,
    competitionId: parseInt(query.competition, 10) || null, popular: query.popular === '1', top: query.top === '1',
    page: page(query.page), pageSize: lim(query.pageSize, 20, 50),
  });
  return { items: decorateMatches(r.rows, user, features), total: r.total, page: r.page, pages: r.pages, ...warnPayload(errors) };
});

route('GET', '/api/competitions', async ({ query }) => {
  const rows = all(`SELECT id, name, logo, country, popular FROM competitions WHERE enabled=1 ${query.popular === '1' ? 'AND popular=1' : ''} ORDER BY popular DESC, sort_order, name LIMIT 200`);
  return { items: rows };
});

route('GET', '/api/search', async ({ query, user }) => {
  const q = String(query.q || '').trim().slice(0, 60);
  if (q.length < 2) return { teams: [], matches: [] };
  const features = featuresFor(user), l = `%${q}%`;
  const teams = all('SELECT id, name, logo FROM teams WHERE name LIKE ? ORDER BY name LIMIT 8', l);
  const r = football.listMatches({ from: new Date(Date.now() - 2 * 86400000).toISOString(), to: new Date(Date.now() + 14 * 86400000).toISOString(), q, pageSize: 12 });
  const favs = new Set(user ? all("SELECT ref_id FROM favorites WHERE user_id=? AND kind='team'", user.id).map((f) => f.ref_id) : []);
  return { teams: teams.map((t) => ({ ...t, favorite: favs.has(t.id) })), matches: decorateMatches(r.rows, user, features) };
});

const formLetters = (list) => list.slice(0, 6).map((m) => (m.gf > m.ga ? 'W' : m.gf < m.ga ? 'L' : 'D'));

route('GET', '/api/matches/:id', async ({ params, query, user }) => {
  const id = parseInt(params.id, 10);
  const features = featuresFor(user);
  const res = await predictions.analyseMatch(id, { force: query.refresh === '1' && !!user?.is_admin });
  const m = res.match;
  const { ctx, warnings } = res.ctx ? { ctx: res.ctx, warnings: res.analysis?.warnings || [] } : await football.loadContext(m);
  const stats = await football.loadMatchStats(m);
  const card = decorateMatches([m], user, features)[0];
  const names = { home: m.home_name, away: m.away_name };

  const a = res.analysis;
  let analysis;
  if (!a) analysis = { status: m.status === 'scheduled' ? 'pending' : 'unavailable', reason: m.status === 'scheduled' ? 'Analysis has not been generated yet.' : 'No pre-match analysis was stored for this match.' };
  else if (!a.ok) analysis = { status: 'insufficient', reason: a.reason, quality: a.quality };
  else {
    const cats = categoryAccess(features);
    const enabled = a.candidates.filter((c) => cats[c.category]?.enabled);
    const toRow = (c) => ({ match_id: id, market: c.market, selection: c.selection, line: c.line, category: c.category, probability: c.probability, confidence: c.confidence, model_odds: c.modelOdds, market_odds: c.marketOdds, bookmaker: c.bookmaker, edge: c.edge, explanation: null });
    const shaped = enabled.map((c) => shapePick(toRow(c), names, features, { cats }));
    const bestSrc = enabled.find((c) => (a.best && c.market === a.best.market && c.selection === a.best.selection && c.line === a.best.line) || (!a.best && a.lean && c.market === a.lean.market && c.selection === a.lean.selection && c.line === a.lean.line));
    let best = null;
    if (bestSrc) {
      best = shapePick({ ...toRow(bestSrc), explanation: JSON.stringify(explain(a, bestSrc, names)) }, names, features, { cats });
      best.unpriced = !a.best;
    }
    const hist = get('SELECT result FROM prediction_history WHERE user_id IS NULL AND match_id=?', id);
    analysis = {
      status: 'ok', quality: a.quality, computedAt: a.computedAt, preMatch: m.status !== 'scheduled',
      lambdas: a.lambdas, probs: a.probs, scorelines: a.scorelines, factors: a.factors, used: a.used,
      best, bestResult: hist?.result || null, picks: shaped, hasOdds: a.hasOdds, hasLineups: !!ctx.lineups,
    };
  }

  const side = (list, pid) => ({ form: list.length ? formLetters(list) : [], matches: list.slice(0, 6) });
  const h2h = ctx.h2h || [];
  const h2hSummary = h2h.length ? {
    n: h2h.length,
    homeWins: h2h.filter((x) => (String(x.homeId) === String(m.home_pid) ? x.hg > x.ag : x.ag > x.hg)).length,
    awayWins: h2h.filter((x) => (String(x.homeId) === String(m.home_pid) ? x.ag > x.hg : x.hg > x.ag)).length,
    draws: h2h.filter((x) => x.hg === x.ag).length,
    avgGoals: Math.round((h2h.reduce((s, x) => s + x.hg + x.ag, 0) / h2h.length) * 100) / 100,
  } : null;

  return {
    match: card, analysis,
    odds: odds.oddsByMarket(id),
    stats,
    form: { home: side(ctx.homeForm), away: side(ctx.awayForm) },
    teamStats: { home: ctx.homeStats, away: ctx.awayStats },
    h2h: { summary: h2hSummary, items: h2h.slice(0, 6) },
    standing: ctx.standing || null,
    lineups: ctx.lineups || null,
    injuries: ctx.injuryList || [],
    warnings, statusNote: { postponed: 'This match has been postponed. Predictions are paused until it is rescheduled.', cancelled: 'This match has been cancelled.', suspended: 'This match is suspended.' }[m.status] || null,
  };
});

/* ---------------- AI picks / combos / bet machine ---------------- */
route('GET', '/api/picks', async ({ query, user }) => {
  const features = featuresFor(user), w = windowOf(query);
  const errors = await ensureWindow(w.from, w.to);
  const type = ['all', 'high', 'value'].includes(query.type) ? query.type : 'all';
  if (type === 'value' && !features.value_bets) return { locked: true, requiredTier: 'vip', items: [], total: 0, count: pickRows({ from: w.from, to: w.to, type }).length };
  const rows = pickRows({ from: w.from, to: w.to, type, category: query.category || null, competitionId: parseInt(query.competition, 10) || null, minConfidence: Math.max(0, parseFloat(query.minConfidence) || 0) });
  const size = lim(query.pageSize, 20, 50), p = page(query.page), off = (p - 1) * size;
  return { items: shapeRows(rows.slice(off, off + size), features, { offset: off }), total: rows.length, page: p, pages: Math.max(1, Math.ceil(rows.length / size)), picksLimit: features.picks_limit, ...warnPayload(errors) };
});

route('GET', '/api/combos', async ({ query, user }) => {
  const features = featuresFor(user), w = windowOf(query);
  const errors = await ensureWindow(w.from, w.to);
  return { date: w.date, items: acc.dailyCombos({ from: w.from, to: w.to, features }), ...warnPayload(errors) };
});

route('POST', '/api/bet-machine', async ({ body, user }) => {
  const features = featuresFor(user);
  if (!features.bet_machine) throw Object.assign(new HttpError(403, 'The AI Bet Machine is available on VIP and Premium plans.'), {});
  const legs = Math.round(Number(body.legs) || 0);
  if (legs < 1 || legs > features.bet_machine_max_legs) throw new HttpError(400, `Choose between 1 and ${features.bet_machine_max_legs} matches.`);
  const targetOdds = body.targetOdds ? Number(body.targetOdds) : null;
  if (targetOdds != null && (!(targetOdds >= 1.1) || targetOdds > 5000)) throw new HttpError(400, 'Target odds must be between 1.10 and 5000.');
  const minConfidence = Math.max(0, Math.min(99, Number(body.minConfidence) || 0));
  const w = windowOf(body);
  const errors = await ensureWindow(w.from, w.to);
  const validCats = new Set(categories().filter((c) => c.enabled).map((c) => c.key));
  const access = categoryAccess(features);
  const cats = (Array.isArray(body.categories) ? body.categories : []).filter((c) => validCats.has(c) && !access[c].locked);
  const candidates = acc.loadCandidates({ from: w.from, to: w.to, competitionId: parseInt(body.competitionId, 10) || null, categories: cats.length ? cats : [...validCats].filter((c) => !access[c].locked), minConfidence });
  const out = acc.build({ candidates, legs, strategy: targetOdds ? 'target' : 'confidence', targetOdds, minConfidence });
  return { ...out, date: w.date, ...warnPayload(errors) };
}, 'none');

/* ---------------- favourites ---------------- */
route('GET', '/api/favorites', async ({ user }) => {
  const features = featuresFor(user);
  const ids = all("SELECT ref_id FROM favorites WHERE user_id=? AND kind='match' ORDER BY id DESC", user.id).map((f) => f.ref_id);
  const matches = ids.length ? decorateMatches(football.listMatches({ ids, pageSize: 50 }).rows, user, features) : [];
  const teamIds = favoriteTeamIds(user);
  const teams = teamIds.map((tid) => {
    const t = get('SELECT id, name, logo FROM teams WHERE id=?', tid);
    if (!t) return null;
    const next = all(`${football.MATCH_SELECT} WHERE (m.home_team_id=? OR m.away_team_id=?) AND m.hidden=0 AND m.status IN ('scheduled','live') AND m.kickoff_at > ? ORDER BY m.kickoff_at LIMIT 1`, tid, tid, new Date(Date.now() - 3 * 3600000).toISOString());
    return { ...t, next: next.length ? decorateMatches(next, user, features)[0] : null };
  }).filter(Boolean);
  return { matches: matches.sort((a, b) => a.kickoff.localeCompare(b.kickoff)), teams };
}, 'user');
route('POST', '/api/favorites', async ({ user, body }) => {
  const kind = body.kind === 'team' ? 'team' : 'match', ref = parseInt(body.refId, 10);
  const exists = kind === 'team' ? get('SELECT 1 AS x FROM teams WHERE id=?', ref) : get('SELECT 1 AS x FROM matches WHERE id=?', ref);
  if (!exists) throw new HttpError(404, 'Not found.');
  run('INSERT OR IGNORE INTO favorites(user_id,kind,ref_id) VALUES(?,?,?)', user.id, kind, ref);
  return { ok: true };
}, 'user');
route('DELETE', '/api/favorites/:kind/:id', async ({ user, params }) => {
  run('DELETE FROM favorites WHERE user_id=? AND kind=? AND ref_id=?', user.id, params.kind === 'team' ? 'team' : 'match', parseInt(params.id, 10));
  return { ok: true };
}, 'user');

/* ---------------- history ---------------- */
route('GET', '/api/history', async ({ user, query }) => {
  const size = lim(query.pageSize, 20, 50), p = page(query.page);
  const total = get('SELECT COUNT(*) AS n FROM prediction_history WHERE user_id=?', user.id).n;
  const rows = all(`SELECT h.*, th.name AS home_name, ta.name AS away_name, m.kickoff_at, m.status, m.home_score, m.away_score
    FROM prediction_history h JOIN matches m ON m.id=h.match_id JOIN teams th ON th.id=m.home_team_id JOIN teams ta ON ta.id=m.away_team_id
    WHERE h.user_id=? ORDER BY h.id DESC LIMIT ? OFFSET ?`, user.id, size, (p - 1) * size);
  const settled = all("SELECT result FROM prediction_history WHERE user_id=? AND result IN ('won','lost')", user.id);
  return {
    items: rows.map((r) => ({ id: r.id, matchId: r.match_id, matchLabel: `${r.home_name} v ${r.away_name}`, kickoff: r.kickoff_at, status: r.status, score: r.home_score == null ? null : `${r.home_score}-${r.away_score}`, text: pickText(r.market, r.selection, r.line, r.home_name, r.away_name), probability: r.probability, confidence: r.confidence, level: r.level, odds: r.odds, result: r.result })),
    total, page: p, pages: Math.max(1, Math.ceil(total / size)),
    summary: { settled: settled.length, won: settled.filter((s) => s.result === 'won').length },
  };
}, 'user');
route('POST', '/api/history', async ({ user, body }) => {
  const matchId = parseInt(body.matchId, 10);
  const features = featuresFor(user);
  const p = get('SELECT * FROM predictions WHERE match_id=? AND market=? AND selection=? AND line=?', matchId, String(body.market), String(body.selection), Number(body.line) || 0);
  if (!p) throw new HttpError(404, 'That prediction is no longer available.');
  const m = football.getMatchRow(matchId);
  if (m.status !== 'scheduled') throw new HttpError(400, 'Only upcoming matches can be added to your history.');
  const shaped = shapePick(p, { home: m.home_name, away: m.away_name }, features);
  if (shaped.locked) throw new HttpError(403, 'Upgrade to unlock this prediction.');
  if (get('SELECT 1 AS x FROM prediction_history WHERE user_id=? AND match_id=? AND market=? AND selection=? AND line=?', user.id, matchId, p.market, p.selection, p.line)) return { ok: true, duplicate: true };
  run('INSERT INTO prediction_history(user_id,match_id,market,selection,line,probability,confidence,level,odds,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', user.id, matchId, p.market, p.selection, p.line, p.probability, p.confidence, shaped.level, p.market_odds, isoNow());
  return { ok: true };
}, 'user');

/* ---------------- notifications ---------------- */
route('GET', '/api/notifications', async ({ user }) => ({ items: notif.listFor(user.id), unread: notif.unreadCount(user.id) }), 'user');
route('POST', '/api/notifications/read', async ({ user }) => { notif.markAllRead(user.id); return { ok: true }; }, 'user');

module.exports = { pickRows, shapeRows, windowOf };
