'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'daws-app-'));
process.env.JOBS_ENABLED = '0';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setProvider } = require('../src/providers');
const fake = require('./fakeProvider').create();
setProvider(fake);
const { createApp } = require('../src/app');
const auth = require('../src/auth');
const { get, all, run } = require('../src/db');
const predictions = require('../src/services/predictions');

const D = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10); // future date: kick-offs are always upcoming
let base, server;
const call = async (method, path, { token, body } = {}) => {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const tokens = {};

test.before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('registration, login and validation', async () => {
  let r = await call('POST', '/api/auth/register', { body: { email: 'bad', password: 'password1' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/auth/register', { body: { email: 'free@test.co', password: 'short' } });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/auth/register', { body: { email: 'free@test.co', password: 'password1', name: 'Free User' } });
  assert.equal(r.status, 200);
  tokens.free = r.body.token;
  assert.equal(r.body.user.tier, 'free');
  r = await call('POST', '/api/auth/register', { body: { email: 'free@test.co', password: 'password1' } });
  assert.equal(r.status, 409);
  r = await call('POST', '/api/auth/login', { body: { email: 'free@test.co', password: 'wrong-pass' } });
  assert.equal(r.status, 401);
  r = await call('GET', '/api/me', { token: tokens.free });
  assert.equal(r.body.user.email, 'free@test.co');
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/me', { token: 'x.y.z' })).status, 401);

  const adminUser = auth.register({ email: 'admin@test.co', password: 'password1', name: 'Admin' });
  auth.makeAdmin(adminUser.id);
  tokens.admin = (await call('POST', '/api/auth/login', { body: { email: 'admin@test.co', password: 'password1' } })).body.token;
  const vip = await call('POST', '/api/auth/register', { body: { email: 'vip@test.co', password: 'password1' } });
  tokens.vip = vip.body.token; tokens.vipId = vip.body.user.id;
});

test('admin routes are protected', async () => {
  assert.equal((await call('GET', '/api/admin/users')).status, 401);
  assert.equal((await call('GET', '/api/admin/users', { token: tokens.free })).status, 403);
  assert.equal((await call('GET', '/api/admin/users', { token: tokens.admin })).status, 200);
});

test('admin settings are validated; thresholds are editable', async () => {
  let r = await call('PUT', '/api/admin/settings', { token: tokens.admin, body: { thresholds: { very_high: 90, high: 95, good: 80, medium: 70 } } });
  assert.equal(r.status, 400);
  r = await call('PUT', '/api/admin/settings', { token: tokens.admin, body: { thresholds: { very_high: 96, high: 91, good: 81, medium: 71 } } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/config')).body.thresholds.high, 91);
  await call('PUT', '/api/admin/settings', { token: tokens.admin, body: { thresholds: { very_high: 95, high: 90, good: 80, medium: 70 }, unlock_everything: false, analysis_horizon_hours: 96, free_daily_picks: 1 } });
  const cfgRes = await call('GET', '/api/config');
  assert.equal(cfgRes.body.features.unlock_everything, false);
  assert.equal(cfgRes.body.features.bet_machine, false);
});

test('fixtures sync, list, search and pagination', async () => {
  const r = await call('GET', `/api/home?date=${D}&tz=0`);
  assert.equal(r.status, 200);
  assert.ok(r.body.today.total >= 6);
  assert.equal(r.body.warnings, undefined);
  const list = await call('GET', `/api/matches?date=${D}&tz=0&pageSize=3&page=1`);
  assert.equal(list.body.items.length, 3);
  assert.ok(list.body.pages >= 2);
  const s = await call('GET', '/api/search?q=Team 10');
  assert.ok(s.body.teams.length > 0);
  const popular = await call('GET', '/api/competitions?popular=1');
  assert.ok(popular.body.items.some((c) => c.name === 'Test Premier'));
  assert.ok(!popular.body.items.some((c) => c.name === 'Test Obscure Cup'));
});

test('provider responses are cached (no repeat upstream calls)', async () => {
  const before = fake.calls.fixtures;
  await call('GET', `/api/home?date=${D}&tz=0`);
  await call('GET', `/api/matches?date=${D}&tz=0`);
  assert.equal(fake.calls.fixtures, before);
});

test('analysis pipeline produces priced predictions only for supported matches', async () => {
  const r = await call('POST', '/api/admin/analyse', { token: tokens.admin, body: {} });
  assert.ok(r.body.analysed >= 4, `analysed ${r.body.analysed}`);
  const preds = all('SELECT * FROM predictions');
  assert.ok(preds.length > 20);
  assert.ok(preds.filter((p) => p.is_best).every((p) => p.market_odds == null || p.market_odds >= 1.2));
  // non-popular competition is not analysed in the background batch
  const obscure = get("SELECT m.id FROM matches m JOIN competitions c ON c.id=m.competition_id WHERE c.name='Test Obscure Cup' LIMIT 1");
  assert.equal(get('SELECT COUNT(*) AS n FROM predictions WHERE match_id=?', obscure.id).n, 0);
});

test('match page: odds, probabilities, form, h2h, graceful gaps', async () => {
  const m = get("SELECT m.id FROM matches m JOIN teams t ON t.id=m.home_team_id WHERE t.name='Team 101' AND m.kickoff_at LIKE ?", `${D}%`);
  const r = await call('GET', `/api/matches/${m.id}`, { token: tokens.admin });
  assert.equal(r.status, 200);
  const b = r.body;
  assert.equal(b.analysis.status, 'ok');
  assert.ok(Math.abs(b.analysis.probs.home + b.analysis.probs.draw + b.analysis.probs.away - 100) < 0.6);
  assert.ok(b.odds.find((g) => g.market === '1X2'));
  assert.ok(b.odds.find((g) => g.market === 'OU').items.length >= 4);
  assert.ok(b.form.home.form.length > 0);
  assert.equal(b.h2h.summary.n, 3);
  assert.ok(b.analysis.best && b.analysis.best.explanation.summary.includes('not a guarantee'));
  assert.ok(b.analysis.best.marketOdds >= 1.2);
  // team with no statistics -> insufficient, not an error, nothing invented
  const nostats = get("SELECT m.id FROM matches m JOIN teams t ON t.id=m.away_team_id WHERE t.name='Team 999' AND m.kickoff_at LIKE ?", `${D}%`);
  const r2 = await call('GET', `/api/matches/${nostats.id}`, { token: tokens.admin });
  assert.equal(r2.status, 200);
  assert.equal(r2.body.analysis.status, 'insufficient');
  assert.equal(get('SELECT COUNT(*) AS n FROM predictions WHERE match_id=?', nostats.id).n, 0);
  // postponed
  const pst = get("SELECT id FROM matches WHERE status='postponed' LIMIT 1");
  const r3 = await call('GET', `/api/matches/${pst.id}`);
  assert.ok(r3.body.statusNote.includes('postponed'));
  assert.equal((await call('GET', '/api/matches/999999')).status, 404);
});

test('free tier: pick limit is enforced server-side without leaking locked picks', async () => {
  const r = await call('GET', `/api/picks?date=${D}&tz=0`, { token: tokens.free });
  assert.ok(r.body.items.length >= 3);
  const locked = r.body.items.filter((p) => p.locked);
  assert.ok(locked.length >= 2);
  for (const p of locked) { assert.equal(p.text, undefined); assert.equal(p.marketOdds, undefined); assert.equal(p.selection, undefined); }
  assert.ok(r.body.items.slice(0, 1).every((p) => !p.locked || p.lockReason !== 'limit'));
  const value = await call('GET', `/api/picks?date=${D}&tz=0&type=value`, { token: tokens.free });
  assert.equal(value.body.locked, true);
});

test('Bet Machine and combos are tier-gated, and the admin unlock switch works', async () => {
  const body = { date: D, tz: 0, legs: 2, targetOdds: 3, minConfidence: 50 };
  assert.equal((await call('POST', '/api/bet-machine', { token: tokens.free, body })).status, 403);
  await call('PATCH', `/api/admin/users/${tokens.vipId}`, { token: tokens.admin, body: { tier: 'vip', days: 30 } });
  let r = await call('POST', '/api/bet-machine', { token: tokens.vip, body });
  assert.equal(r.status, 200);
  assert.ok(r.body.result && r.body.result.count === 2, JSON.stringify(r.body).slice(0, 300));
  const product = r.body.result.legs.reduce((p, l) => p * l.odds, 1);
  assert.ok(Math.abs(product - r.body.result.combinedOdds) < 0.02);
  assert.equal(new Set(r.body.result.legs.map((l) => l.matchId)).size, 2);
  assert.ok(r.body.result.legs.every((l) => l.confidence >= 50 && l.odds >= 1.2));
  assert.ok(r.body.result.note.includes('independent'));
  assert.equal((await call('POST', '/api/bet-machine', { token: tokens.vip, body: { ...body, legs: 50 } })).status, 400);
  assert.equal((await call('POST', '/api/bet-machine', { token: tokens.vip, body: { ...body, targetOdds: 0.5 } })).status, 400);

  const combos = await call('GET', `/api/combos?date=${D}&tz=0`, { token: tokens.vip });
  const by = Object.fromEntries(combos.body.items.map((c) => [c.key, c]));
  assert.equal(by.safe.locked, false);
  assert.equal(by.balanced.locked, false);
  assert.equal(by.vip.locked, true);
  assert.equal(by.vip.legs, undefined);
  const freeCombos = await call('GET', `/api/combos?date=${D}&tz=0`);
  assert.equal(freeCombos.body.items.find((c) => c.key === 'balanced').locked, true);

  await call('PUT', '/api/admin/settings', { token: tokens.admin, body: { unlock_everything: true } });
  const unlocked = await call('GET', `/api/combos?date=${D}&tz=0`, { token: tokens.free });
  assert.ok(unlocked.body.items.every((c) => !c.locked));
  assert.equal((await call('POST', '/api/bet-machine', { token: tokens.free, body })).status, 200);
  await call('PUT', '/api/admin/settings', { token: tokens.admin, body: { unlock_everything: false } });
  assert.equal((await call('POST', '/api/bet-machine', { token: tokens.free, body })).status, 403);
});

test('tier expiry returns the user to Free', async () => {
  run("UPDATE users SET tier_expires_at='2020-01-01T00:00:00.000Z' WHERE id=?", tokens.vipId);
  assert.equal((await call('GET', '/api/me', { token: tokens.vip })).body.user.tier, 'free');
  await call('PATCH', `/api/admin/users/${tokens.vipId}`, { token: tokens.admin, body: { tier: 'vip', days: 30 } });
  assert.equal((await call('GET', '/api/me', { token: tokens.vip })).body.user.tier, 'vip');
});

test('favourites, saved history and notifications', async () => {
  const m = get('SELECT id FROM matches WHERE kickoff_at LIKE ? LIMIT 1', `${D}%`);
  assert.equal((await call('POST', '/api/favorites', { body: { kind: 'match', refId: m.id } })).status, 401);
  await call('POST', '/api/favorites', { token: tokens.free, body: { kind: 'match', refId: m.id } });
  let f = await call('GET', '/api/favorites', { token: tokens.free });
  assert.equal(f.body.matches.length, 1);
  await call('DELETE', `/api/favorites/match/${m.id}`, { token: tokens.free });
  f = await call('GET', '/api/favorites', { token: tokens.free });
  assert.equal(f.body.matches.length, 0);

  const pick = get('SELECT * FROM predictions WHERE is_best=1 AND confidence < 90 LIMIT 1');
  const saved = await call('POST', '/api/history', { token: tokens.vip, body: { matchId: pick.match_id, market: pick.market, selection: pick.selection, line: pick.line } });
  assert.equal(saved.status, 200);
  const h = await call('GET', '/api/history', { token: tokens.vip });
  assert.equal(h.body.items.length, 1);
  assert.equal(h.body.items[0].result, 'pending');

  await call('POST', '/api/admin/notifications', { token: tokens.admin, body: { title: 'Welcome back', body: 'Test broadcast' } });
  const n = await call('GET', '/api/notifications', { token: tokens.free });
  assert.ok(n.body.items.some((x) => x.title === 'Welcome back') && n.body.unread >= 1);
  await call('POST', '/api/notifications/read', { token: tokens.free });
  assert.equal((await call('GET', '/api/notifications', { token: tokens.free })).body.unread, 0);
});

test('results are settled and performance is measured honestly', async () => {
  // Past, finished fixtures come from the provider as finished with scores
  await call('GET', '/api/matches?date=2026-01-15&tz=0');
  const fin = all("SELECT m.id, m.home_score, m.away_score FROM matches m WHERE m.status='finished' ORDER BY m.id LIMIT 3");
  assert.equal(fin.length, 3);
  const mk = (mid, market, sel, line) => run("INSERT INTO prediction_history(user_id,match_id,market,selection,line,probability,confidence,level,odds,created_at) VALUES(NULL,?,?,?,?,80,78,'medium',1.5,'2026-01-14T00:00:00Z')", mid, market, sel, line);
  mk(fin[0].id, 'OU', 'under', 5.5); mk(fin[1].id, 'OU', 'over', 5.5); mk(fin[2].id, 'CORNERS_OU', 'over', 9.5);
  assert.ok(predictions.settleMatches() >= 2);
  const rows = all('SELECT market, result FROM prediction_history WHERE match_id IN (?,?,?) AND user_id IS NULL', fin[0].id, fin[1].id, fin[2].id);
  assert.equal(rows.find((r) => r.market === 'CORNERS_OU').result, 'pending'); // cannot be settled without data
  const perf = (await call('GET', '/api/admin/performance', { token: tokens.admin })).body;
  assert.ok(perf.overall.picks >= 2);
  assert.ok(perf.note.includes('recalibrating'));
});

test('admin: manage users, matches, competitions, categories, banners', async () => {
  const a = tokens.admin;
  const users = await call('GET', '/api/admin/users?q=free', { token: a });
  assert.equal(users.body.items[0].email, 'free@test.co');
  const freeId = users.body.items[0].id;
  assert.equal((await call('PATCH', `/api/admin/users/${freeId}`, { token: a, body: { disabled: true } })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { body: { email: 'free@test.co', password: 'password1' } })).status, 403);
  assert.equal((await call('GET', '/api/me', { token: tokens.free })).status, 401); // existing session is cut off too
  await call('PATCH', `/api/admin/users/${freeId}`, { token: a, body: { disabled: false } });
  const self = auth.loadUser(get("SELECT id FROM users WHERE email='admin@test.co'").id);
  assert.equal((await call('PATCH', `/api/admin/users/${self.id}`, { token: a, body: { disabled: true } })).status, 400);

  const added = await call('POST', '/api/admin/matches', { token: a, body: { competition: 'Friendly Cup', home: 'Alpha FC', away: 'Beta FC', kickoff: `${D}T18:00:00Z`, isTop: true } });
  assert.equal(added.status, 200);
  assert.equal((await call('POST', '/api/admin/matches', { token: a, body: { competition: 'X', home: 'Same', away: 'same', kickoff: `${D}T18:00:00Z` } })).status, 400);
  const mm = await call('GET', `/api/matches/${added.body.id}`);
  assert.equal(mm.body.analysis.status, 'insufficient'); // no provider data for manual matches; nothing invented
  assert.equal((await call('DELETE', `/api/admin/matches/${added.body.id}`, { token: a })).body.removed, true);
  const prov = get("SELECT id FROM matches WHERE source='provider' LIMIT 1");
  assert.equal((await call('DELETE', `/api/admin/matches/${prov.id}`, { token: a })).body.hidden, true);
  assert.equal((await call('GET', `/api/matches?q=Team&date=${D}&tz=0&pageSize=50`)).body.items.some((i) => i.id === prov.id), false);

  const comp = get("SELECT id FROM competitions WHERE name='Test Obscure Cup'");
  await call('PATCH', `/api/admin/competitions/${comp.id}`, { token: a, body: { enabled: false } });
  assert.equal((await call('GET', `/api/matches?date=${D}&tz=0&pageSize=50`)).body.items.some((i) => i.competition.name === 'Test Obscure Cup'), false);

  await call('PATCH', '/api/admin/categories/goals', { token: a, body: { enabled: false } });
  const picks = await call('GET', `/api/picks?date=${D}&tz=0&pageSize=50`, { token: a });
  assert.ok(picks.body.items.every((p) => p.category !== 'goals'));
  await call('PATCH', '/api/admin/categories/goals', { token: a, body: { enabled: true } });

  const b = await call('POST', '/api/admin/banners', { token: a, body: { title: 'Launch week', body: 'Hello' } });
  assert.equal((await call('GET', `/api/home?date=${D}&tz=0`)).body.banners[0].title, 'Launch week');
  await call('DELETE', `/api/admin/banners/${b.body.id}`, { token: a });
  assert.equal((await call('GET', '/api/admin/overview', { token: a })).status, 200);
});

test('provider failure degrades gracefully with stale data and clear warnings', async () => {
  const orig = fake.getFixtures;
  fake.getFixtures = async () => { throw new (require('../src/providers').ProviderError)('Football data provider unreachable (timeout).', { code: 'network' }); };
  const fresh = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const r = await call('GET', `/api/home?date=${fresh}&tz=0`);
  assert.equal(r.status, 200);
  assert.ok(r.body.warnings[0].includes('unreachable'));
  assert.equal(r.body.today.total, 0);
  fake.getFixtures = orig;
});

test('static app, security headers and SPA fallback', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(r.headers.get('content-security-policy').includes("default-src 'self'"));
  const spa = await fetch(base + '/match/12');
  assert.equal(spa.status, 200);
  assert.equal((await fetch(base + '/js/missing.js')).status, 404);
  assert.equal((await fetch(base + '/..%2f..%2fpackage.json')).status === 200, false);
});
