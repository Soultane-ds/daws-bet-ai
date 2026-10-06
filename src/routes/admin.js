'use strict';
const { route } = require('../http');
const auth = require('../auth');
const { all, get, run, tx } = require('../db');
const { DEFAULTS, allSettings, setSetting, rawGet } = require('../settings');
const { HttpError, dayKey, isoNow } = require('../util');
const football = require('../services/football');
const predictions = require('../services/predictions');
const notif = require('../services/notifications');
const budget = require('../services/budget');
const { TIERS, resetCategoryCache } = require('../services/access');
const { getProvider } = require('../providers');
const { pickText } = require('../engine/labels');
const cfg = require('../config');

const A = 'admin';
const page = (q) => Math.max(1, parseInt(q, 10) || 1);
const size = (q, d = 25) => Math.min(100, Math.max(1, parseInt(q, 10) || d));
const pages = (total, s) => Math.max(1, Math.ceil(total / s));
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

/* ---------- overview ---------- */
route('GET', '/api/admin/overview', async () => {
  const tiers = Object.fromEntries(all('SELECT tier, COUNT(*) AS n FROM users GROUP BY tier').map((r) => [r.tier, r.n]));
  const day = dayKey();
  return {
    users: { total: get('SELECT COUNT(*) AS n FROM users').n, disabled: get('SELECT COUNT(*) AS n FROM users WHERE disabled=1').n, byTier: tiers, newThisWeek: get('SELECT COUNT(*) AS n FROM users WHERE created_at > ?', new Date(Date.now() - 7 * 86400000).toISOString()).n },
    matches: { total: get('SELECT COUNT(*) AS n FROM matches').n, today: get('SELECT COUNT(*) AS n FROM matches WHERE kickoff_at >= ? AND kickoff_at < ?', `${day}T00:00:00.000Z`, new Date(Date.parse(`${day}T00:00:00.000Z`) + 86400000).toISOString()).n, live: get("SELECT COUNT(*) AS n FROM matches WHERE status='live'").n },
    predictions: { stored: get('SELECT COUNT(*) AS n FROM predictions').n, analysedMatches: get("SELECT COUNT(*) AS n FROM match_extras WHERE kind='analysis'").n },
    performance: predictions.performance(),
    system: systemInfo(),
  };
});
function systemInfo() {
  const p = getProvider();
  return { provider: p.name, providerConfigured: !!p.configured, status: rawGet('provider_status'), apiUsedToday: budget.used(), apiDailyLimit: budget.limit(), node: process.version, env: cfg.isProd ? 'production' : 'development', googleLogin: !!cfg.googleClientId };
}
route('GET', '/api/admin/system', async () => systemInfo(), A);
route('POST', '/api/admin/sync', async ({ body }) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') ? body.date : dayKey();
  const out = { date };
  try { const r = await football.syncDate(date, { force: true }); out.fixtures = r.value.length; } catch (e) { out.error = e.message; }
  return out;
}, A);
route('POST', '/api/admin/analyse', async ({ body }) => {
  if (body.matchId) { const r = await predictions.analyseMatch(parseInt(body.matchId, 10), { force: true }); return { ok: !!r.analysis?.ok }; }
  return { analysed: await predictions.analyseUpcoming() };
}, A);

/* ---------- users ---------- */
route('GET', '/api/admin/users', async ({ query }) => {
  const s = size(query.pageSize), p = page(query.page);
  const where = ['1=1'], params = [];
  if (query.q) { where.push('(u.email LIKE ? OR u.name LIKE ?)'); params.push(`%${query.q}%`, `%${query.q}%`); }
  if (TIERS.includes(query.tier)) { where.push('u.tier=?'); params.push(query.tier); }
  if (query.disabled === '1') where.push('u.disabled=1');
  const total = get(`SELECT COUNT(*) AS n FROM users u WHERE ${where.join(' AND ')}`, ...params).n;
  const items = all(`SELECT u.id,u.email,u.name,u.tier,u.tier_expires_at,u.disabled,u.created_at,u.last_login_at,(a.user_id IS NOT NULL) AS is_admin
    FROM users u LEFT JOIN admin_users a ON a.user_id=u.id WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT ? OFFSET ?`, ...params, s, (p - 1) * s);
  return { items: items.map((u) => ({ ...u, disabled: !!u.disabled, is_admin: !!u.is_admin })), total, page: p, pages: pages(total, s) };
}, A);

route('PATCH', '/api/admin/users/:id', async ({ params, body, user }) => {
  const id = parseInt(params.id, 10);
  const target = auth.loadUser(id);
  if (!target) throw new HttpError(404, 'User not found.');
  if (body.disabled !== undefined) {
    if (id === user.id) throw new HttpError(400, 'You cannot disable your own account.');
    run('UPDATE users SET disabled=? WHERE id=?', bool(body.disabled), id);
  }
  if (body.is_admin !== undefined) {
    const on = !!bool(body.is_admin);
    if (!on && id === user.id) throw new HttpError(400, 'You cannot remove your own administrator access.');
    auth.makeAdmin(id, on);
  }
  if (body.name !== undefined) run('UPDATE users SET name=? WHERE id=?', String(body.name).trim().slice(0, 60), id);
  if (body.tier !== undefined) {
    if (!TIERS.includes(body.tier)) throw new HttpError(400, 'Unknown tier.');
    const days = body.days ? Math.min(3650, Math.max(1, parseInt(body.days, 10))) : null;
    const ends = body.tier === 'free' || !days ? null : new Date(Date.now() + days * 86400000).toISOString();
    tx(() => {
      run("UPDATE subscriptions SET status='ended', ends_at=COALESCE(ends_at, ?) WHERE user_id=? AND status='active'", isoNow(), id);
      run('UPDATE users SET tier=?, tier_expires_at=? WHERE id=?', body.tier, ends, id);
      if (body.tier !== 'free') run("INSERT INTO subscriptions(user_id,tier,status,starts_at,ends_at,note,created_by) VALUES(?,?,'active',?,?,?,?)", id, body.tier, isoNow(), ends, String(body.note || '').slice(0, 200) || null, user.id);
    });
    notif.notify({ userId: id, title: body.tier === 'free' ? 'Plan changed to Free' : `You now have ${body.tier.toUpperCase()} access`, body: ends ? `Valid until ${ends.slice(0, 10)}.` : 'No expiry date.', kind: 'plan' });
  }
  const u = auth.loadUser(id);
  return { user: { id: u.id, email: u.email, name: u.name, tier: u.tier, tier_expires_at: u.tier_expires_at, disabled: !!u.disabled, is_admin: u.is_admin } };
}, A);

route('GET', '/api/admin/users/:id/subscriptions', async ({ params }) =>
  ({ items: all('SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 50', parseInt(params.id, 10)) }), A);

/* ---------- matches ---------- */
route('GET', '/api/admin/matches', async ({ query }) => {
  const s = size(query.pageSize), p = page(query.page);
  const where = ['1=1'], params = [];
  if (query.q) { where.push('(th.name LIKE ? OR ta.name LIKE ? OR c.name LIKE ?)'); const l = `%${query.q}%`; params.push(l, l, l); }
  if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) { where.push('m.kickoff_at >= ? AND m.kickoff_at < ?'); params.push(`${query.date}T00:00:00.000Z`, new Date(Date.parse(`${query.date}T00:00:00.000Z`) + 86400000).toISOString()); }
  if (query.source === 'manual') where.push("m.source='manual'");
  const total = get(`SELECT COUNT(*) AS n ${football.MATCH_FROM} WHERE ${where.join(' AND ')}`, ...params).n;
  const items = all(`${football.MATCH_SELECT} WHERE ${where.join(' AND ')} ORDER BY m.kickoff_at DESC LIMIT ? OFFSET ?`, ...params, s, (p - 1) * s);
  return { items: items.map((m) => ({ id: m.id, competition: m.comp_name, home: m.home_name, away: m.away_name, kickoff: m.kickoff_at, status: m.status, score: m.home_score == null ? null : `${m.home_score}-${m.away_score}`, source: m.source, hidden: !!m.hidden, isTop: !!m.is_top })), total, page: p, pages: pages(total, s) };
}, A);

function ensureCompetition(name) {
  const ex = get('SELECT id FROM competitions WHERE provider_id IS NULL AND name=?', name);
  return ex ? ex.id : Number(run('INSERT INTO competitions(name,popular) VALUES(?,1)', name).lastInsertRowid);
}
function ensureTeam(name) {
  const ex = get('SELECT id FROM teams WHERE provider_id IS NULL AND name=?', name);
  return ex ? ex.id : Number(run('INSERT INTO teams(name) VALUES(?)', name).lastInsertRowid);
}
route('POST', '/api/admin/matches', async ({ body }) => {
  const comp = String(body.competition || '').trim(), home = String(body.home || '').trim(), away = String(body.away || '').trim();
  if (!comp || !home || !away) throw new HttpError(400, 'Competition, home team and away team are required.');
  if (home.toLowerCase() === away.toLowerCase()) throw new HttpError(400, 'Home and away teams must be different.');
  const ko = new Date(body.kickoff);
  if (isNaN(ko)) throw new HttpError(400, 'Enter a valid kick-off date and time.');
  const id = Number(run("INSERT INTO matches(competition_id,home_team_id,away_team_id,kickoff_at,status,source,is_top) VALUES(?,?,?,?,'scheduled','manual',?)", ensureCompetition(comp), ensureTeam(home), ensureTeam(away), ko.toISOString(), bool(body.isTop)).lastInsertRowid);
  return { id };
}, A);
route('PATCH', '/api/admin/matches/:id', async ({ params, body }) => {
  const id = parseInt(params.id, 10), m = get('SELECT * FROM matches WHERE id=?', id);
  if (!m) throw new HttpError(404, 'Match not found.');
  if (body.isTop !== undefined) run('UPDATE matches SET is_top=? WHERE id=?', bool(body.isTop), id);
  if (body.hidden !== undefined) run('UPDATE matches SET hidden=? WHERE id=?', bool(body.hidden), id);
  if (m.source === 'manual') {
    if (body.status !== undefined) {
      if (!['scheduled', 'live', 'finished', 'postponed', 'cancelled'].includes(body.status)) throw new HttpError(400, 'Unknown status.');
      run('UPDATE matches SET status=? WHERE id=?', body.status, id);
    }
    if (body.kickoff) { const d = new Date(body.kickoff); if (isNaN(d)) throw new HttpError(400, 'Invalid kick-off.'); run('UPDATE matches SET kickoff_at=? WHERE id=?', d.toISOString(), id); }
    if (body.homeScore !== undefined) run('UPDATE matches SET home_score=?, away_score=? WHERE id=?', Number.isInteger(+body.homeScore) ? +body.homeScore : null, Number.isInteger(+body.awayScore) ? +body.awayScore : null, id);
  }
  return { ok: true };
}, A);
route('DELETE', '/api/admin/matches/:id', async ({ params }) => {
  const id = parseInt(params.id, 10), m = get('SELECT source FROM matches WHERE id=?', id);
  if (!m) throw new HttpError(404, 'Match not found.');
  if (m.source === 'manual') { run('DELETE FROM matches WHERE id=?', id); return { removed: true }; }
  run('UPDATE matches SET hidden=1 WHERE id=?', id); // provider matches are hidden, not deleted, so they stay removed after the next sync
  return { removed: false, hidden: true };
}, A);

/* ---------- competitions & categories ---------- */
route('GET', '/api/admin/competitions', async ({ query }) => {
  const s = size(query.pageSize, 40), p = page(query.page);
  const where = ['1=1'], params = [];
  if (query.q) { where.push('(name LIKE ? OR country LIKE ?)'); params.push(`%${query.q}%`, `%${query.q}%`); }
  if (query.popular === '1') where.push('popular=1');
  const total = get(`SELECT COUNT(*) AS n FROM competitions WHERE ${where.join(' AND ')}`, ...params).n;
  const items = all(`SELECT id,name,country,logo,popular,enabled,sort_order,provider_id FROM competitions WHERE ${where.join(' AND ')} ORDER BY popular DESC, sort_order, name LIMIT ? OFFSET ?`, ...params, s, (p - 1) * s);
  return { items: items.map((c) => ({ ...c, popular: !!c.popular, enabled: !!c.enabled })), total, page: p, pages: pages(total, s) };
}, A);
route('PATCH', '/api/admin/competitions/:id', async ({ params, body }) => {
  const id = parseInt(params.id, 10);
  if (!get('SELECT 1 AS x FROM competitions WHERE id=?', id)) throw new HttpError(404, 'Competition not found.');
  if (body.popular !== undefined) run('UPDATE competitions SET popular=? WHERE id=?', bool(body.popular), id);
  if (body.enabled !== undefined) run('UPDATE competitions SET enabled=? WHERE id=?', bool(body.enabled), id);
  if (body.sort_order !== undefined) run('UPDATE competitions SET sort_order=? WHERE id=?', Math.max(0, Math.min(9999, parseInt(body.sort_order, 10) || 100)), id);
  if (body.name) run('UPDATE competitions SET name=? WHERE id=?', String(body.name).trim().slice(0, 80), id);
  return { ok: true };
}, A);
route('GET', '/api/admin/categories', async () => ({ items: all('SELECT * FROM prediction_categories ORDER BY sort_order').map((c) => ({ ...c, enabled: !!c.enabled })) }), A);
route('PATCH', '/api/admin/categories/:key', async ({ params, body }) => {
  if (!get('SELECT 1 AS x FROM prediction_categories WHERE key=?', params.key)) throw new HttpError(404, 'Category not found.');
  if (body.enabled !== undefined) run('UPDATE prediction_categories SET enabled=? WHERE key=?', bool(body.enabled), params.key);
  if (body.min_tier !== undefined) { if (!TIERS.includes(body.min_tier)) throw new HttpError(400, 'Unknown tier.'); run('UPDATE prediction_categories SET min_tier=? WHERE key=?', body.min_tier, params.key); }
  if (body.label) run('UPDATE prediction_categories SET label=? WHERE key=?', String(body.label).trim().slice(0, 40), params.key);
  resetCategoryCache();
  return { ok: true };
}, A);

/* ---------- settings ---------- */
const isNum = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
function validate(key, v) {
  const bad = (m) => { throw new HttpError(400, m); };
  switch (key) {
    case 'thresholds': {
      const t = {}; for (const k of ['very_high', 'high', 'good', 'medium']) { t[k] = Number(v?.[k]); if (!isNum(t[k], 1, 100)) bad('Thresholds must be numbers between 1 and 100.'); }
      if (!(t.very_high > t.high && t.high > t.good && t.good > t.medium)) bad('Thresholds must descend: Very High > High > Good > Medium.');
      return t;
    }
    case 'min_odds': if (!isNum(Number(v), 1.01, 20)) bad('Minimum odds must be between 1.01 and 20.'); return Number(v);
    case 'min_edge': if (!isNum(Number(v), 0, 1)) bad('Minimum edge must be between 0 and 1.'); return Number(v);
    case 'value_min_confidence': if (!isNum(Number(v), 0, 100)) bad('Value-bet minimum confidence must be 0-100.'); return Number(v);
    case 'free_daily_picks': if (!isNum(Number(v), 0, 100)) bad('Free daily picks must be 0-100.'); return Math.round(Number(v));
    case 'unlock_everything': case 'maintenance': return !!bool(v);
    case 'app_name': { const s = String(v).trim(); if (!s || s.length > 40) bad('App name must be 1-40 characters.'); return s; }
    case 'disclaimer': { const s = String(v).trim(); if (s.length < 20 || s.length > 2000) bad('Disclaimer must be 20-2000 characters.'); return s; }
    case 'analysis_scope': if (!['popular', 'all'].includes(v)) bad('Scope must be popular or all.'); return v;
    case 'analysis_batch': if (!isNum(Number(v), 1, 100)) bad('Analysis batch must be 1-100.'); return Math.round(Number(v));
    case 'analysis_horizon_hours': if (!isNum(Number(v), 1, 96)) bad('Horizon must be 1-96 hours.'); return Math.round(Number(v));
    case 'analysis_ttl_minutes': if (!isNum(Number(v), 1, 240)) bad('Analysis refresh must be 1-240 minutes.'); return Math.round(Number(v));
    case 'min_data_quality': if (!isNum(Number(v), 0, 1)) bad('Minimum data quality must be 0-1.'); return Number(v);
    case 'live_poll_seconds': if (!isNum(Number(v), 30, 900)) bad('Live refresh must be 30-900 seconds.'); return Math.round(Number(v));
    case 'cache_ttl': { const o = {}; for (const k of Object.keys(DEFAULTS.cache_ttl)) { o[k] = Number(v?.[k]); if (!isNum(o[k], 30, 604800)) bad(`Cache TTL "${k}" must be 30-604800 seconds.`); } return o; }
    case 'tier_features': {
      const o = {};
      for (const t of TIERS) {
        const f = v?.[t] || {};
        const legs = Number(f.bet_machine_max_legs);
        if (!isNum(legs, 0, 20)) bad('Bet Machine legs must be 0-20.');
        o[t] = { high_confidence: !!bool(f.high_confidence), value_bets: !!bool(f.value_bets), bet_machine: !!bool(f.bet_machine), bet_machine_max_legs: Math.round(legs), combos: (Array.isArray(f.combos) ? f.combos : []).filter((c) => c in DEFAULTS.combos) };
      }
      return o;
    }
    case 'combos': {
      const o = {};
      for (const k of Object.keys(DEFAULTS.combos)) {
        const c = v?.[k] || {};
        if (!['confidence', 'target', 'value'].includes(c.strategy)) bad(`Combination "${k}" has an unknown strategy.`);
        if (!isNum(Number(c.legs), 1, 12) || !isNum(Number(c.minConfidence), 0, 99)) bad(`Combination "${k}": legs 1-12, minimum confidence 0-99.`);
        o[k] = { label: String(c.label || DEFAULTS.combos[k].label).slice(0, 40), legs: Math.round(Number(c.legs)), minConfidence: Number(c.minConfidence), strategy: c.strategy };
        if (c.strategy === 'target') { if (!isNum(Number(c.targetOdds), 1.1, 5000)) bad(`Combination "${k}": target odds 1.10-5000.`); o[k].targetOdds = Number(c.targetOdds); }
      }
      return o;
    }
    default: bad(`"${key}" cannot be edited here.`);
  }
}
route('GET', '/api/admin/settings', async () => allSettings(), A);
route('PUT', '/api/admin/settings', async ({ body }) => {
  const clean = {};
  for (const [k, v] of Object.entries(body)) clean[k] = validate(k, v);
  for (const [k, v] of Object.entries(clean)) setSetting(k, v);
  return allSettings();
}, A);

/* ---------- banners ---------- */
const bannerRow = (b) => ({ ...b, active: !!b.active });
route('GET', '/api/admin/banners', async () => ({ items: all('SELECT * FROM banners ORDER BY sort_order, id').map(bannerRow) }), A);
route('POST', '/api/admin/banners', async ({ body }) => {
  const title = String(body.title || '').trim().slice(0, 80);
  if (!title) throw new HttpError(400, 'A banner needs a title.');
  const id = Number(run('INSERT INTO banners(title,body,link,active,sort_order,starts_at,ends_at) VALUES(?,?,?,?,?,?,?)', title, String(body.body || '').slice(0, 200), String(body.link || '').slice(0, 200), bool(body.active ?? 1), parseInt(body.sort_order, 10) || 100, body.starts_at || null, body.ends_at || null).lastInsertRowid);
  return { id };
}, A);
route('PATCH', '/api/admin/banners/:id', async ({ params, body }) => {
  const id = parseInt(params.id, 10), b = get('SELECT * FROM banners WHERE id=?', id);
  if (!b) throw new HttpError(404, 'Banner not found.');
  const n = { ...b, ...body };
  run('UPDATE banners SET title=?, body=?, link=?, active=?, sort_order=?, starts_at=?, ends_at=? WHERE id=?', String(n.title).slice(0, 80), String(n.body || '').slice(0, 200), String(n.link || '').slice(0, 200), bool(n.active), parseInt(n.sort_order, 10) || 100, n.starts_at || null, n.ends_at || null, id);
  return { ok: true };
}, A);
route('DELETE', '/api/admin/banners/:id', async ({ params }) => { run('DELETE FROM banners WHERE id=?', parseInt(params.id, 10)); return { ok: true }; }, A);

/* ---------- notifications ---------- */
route('GET', '/api/admin/notifications', async () => ({ items: all("SELECT id,title,body,kind,created_at,user_id FROM notifications WHERE kind IN ('broadcast','info','plan') ORDER BY id DESC LIMIT 50") }), A);
route('POST', '/api/admin/notifications', async ({ body }) => {
  const title = String(body.title || '').trim().slice(0, 80);
  if (!title) throw new HttpError(400, 'A notification needs a title.');
  let userId = null;
  if (body.email) {
    const u = get('SELECT id FROM users WHERE email=?', String(body.email).trim().toLowerCase());
    if (!u) throw new HttpError(404, 'No user with that email.');
    userId = u.id;
  }
  return { id: notif.notify({ userId, title, body: String(body.body || '').slice(0, 500), kind: 'broadcast' }) };
}, A);

/* ---------- history & performance ---------- */
route('GET', '/api/admin/history', async ({ query }) => {
  const s = size(query.pageSize), p = page(query.page);
  const where = ['1=1'], params = [];
  if (query.scope === 'system') where.push('h.user_id IS NULL'); else if (query.scope === 'users') where.push('h.user_id IS NOT NULL');
  if (['pending', 'won', 'lost', 'void'].includes(query.result)) { where.push('h.result=?'); params.push(query.result); }
  const total = get(`SELECT COUNT(*) AS n FROM prediction_history h WHERE ${where.join(' AND ')}`, ...params).n;
  const rows = all(`SELECT h.*, u.email, th.name AS home_name, ta.name AS away_name, m.kickoff_at, m.home_score, m.away_score
    FROM prediction_history h JOIN matches m ON m.id=h.match_id JOIN teams th ON th.id=m.home_team_id JOIN teams ta ON ta.id=m.away_team_id
    LEFT JOIN users u ON u.id=h.user_id WHERE ${where.join(' AND ')} ORDER BY h.id DESC LIMIT ? OFFSET ?`, ...params, s, (p - 1) * s);
  return { items: rows.map((r) => ({ id: r.id, who: r.email || 'AI (tracked)', match: `${r.home_name} v ${r.away_name}`, kickoff: r.kickoff_at, score: r.home_score == null ? null : `${r.home_score}-${r.away_score}`, pick: pickText(r.market, r.selection, r.line, r.home_name, r.away_name), probability: r.probability, confidence: r.confidence, level: r.level, odds: r.odds, result: r.result })), total, page: p, pages: pages(total, s) };
}, A);
route('GET', '/api/admin/performance', async () => predictions.performance(), A);
