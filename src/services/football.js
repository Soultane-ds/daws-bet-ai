'use strict';
const { all, get, run, tx, inList } = require('../db');
const { getProvider } = require('../providers');
const { cachedMeta, cached } = require('./cache');
const odds = require('./odds');
const budget = require('./budget');
const { getSetting, rawSet } = require('../settings');
const { dayKey, isoNow } = require('../util');

const MATCH_COLS = `
SELECT m.*, c.name AS comp_name, c.logo AS comp_logo, c.country AS comp_country, c.provider_id AS comp_pid, c.season AS comp_season, c.popular AS comp_popular,
       th.name AS home_name, th.logo AS home_logo, th.provider_id AS home_pid,
       ta.name AS away_name, ta.logo AS away_logo, ta.provider_id AS away_pid`;
const MATCH_FROM = `
FROM matches m
JOIN competitions c ON c.id = m.competition_id
JOIN teams th ON th.id = m.home_team_id
JOIN teams ta ON ta.id = m.away_team_id`;
const MATCH_SELECT = MATCH_COLS + MATCH_FROM;
const getMatchRow = (id) => get(`${MATCH_SELECT} WHERE m.id=?`, id);

function noteProvider(ok, message) { rawSet('provider_status', { ok, message: message || null, at: isoNow() }); }

function upsertCompetition(c, provider) {
  const ex = get('SELECT id FROM competitions WHERE provider_id=?', c.id);
  if (ex) { run('UPDATE competitions SET name=?, country=?, logo=?, season=? WHERE id=?', c.name, c.country, c.logo, c.season, ex.id); return ex.id; }
  const popular = provider.popularLeagueIds?.includes(String(c.id)) ? 1 : 0;
  return Number(run('INSERT INTO competitions(provider_id,name,country,logo,season,popular) VALUES(?,?,?,?,?,?)', c.id, c.name, c.country, c.logo, c.season, popular).lastInsertRowid);
}
function upsertTeam(t) {
  const ex = get('SELECT id FROM teams WHERE provider_id=?', t.id);
  if (ex) { run('UPDATE teams SET name=?, logo=? WHERE id=?', t.name, t.logo, ex.id); return ex.id; }
  return Number(run('INSERT INTO teams(provider_id,name,logo) VALUES(?,?,?)', t.id, t.name, t.logo).lastInsertRowid);
}
function upsertFixtures(list, provider) {
  tx(() => {
    for (const f of list) {
      const cid = upsertCompetition(f.competition, provider), h = upsertTeam(f.home), a = upsertTeam(f.away);
      const ex = get('SELECT id FROM matches WHERE provider_id=?', f.id);
      const s = f.score || {};
      if (ex) {
        run('UPDATE matches SET competition_id=?, home_team_id=?, away_team_id=?, kickoff_at=?, status=?, minute=?, home_score=?, away_score=?, ht_home=?, ht_away=?, updated_at=? WHERE id=?',
          cid, h, a, f.kickoff, f.status, f.minute, s.home, s.away, s.htHome, s.htAway, isoNow(), ex.id);
      } else {
        run('INSERT INTO matches(provider_id,competition_id,home_team_id,away_team_id,kickoff_at,status,minute,home_score,away_score,ht_home,ht_away) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          f.id, cid, h, a, f.kickoff, f.status, f.minute, s.home, s.away, s.htHome, s.htAway);
      }
    }
  });
}

async function syncDate(date, { force = false } = {}) {
  const p = getProvider(), ttl = getSetting('cache_ttl');
  const r = await cachedMeta(`fixtures:${date}`, date === dayKey() ? ttl.fixtures_today : ttl.fixtures_other, () => p.getFixtures({ date }), { force });
  if (r.fresh) upsertFixtures(r.value, p);
  return r;
}
/** Sync every UTC date overlapped by [fromIso, toIso). Never throws; returns the errors. */
async function syncWindow(fromIso, toIso) {
  const errors = [];
  const start = new Date(fromIso), end = new Date(toIso);
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); d < end; d = new Date(d.getTime() + 86400000)) {
    try { await syncDate(dayKey(d)); noteProvider(true); }
    catch (e) { errors.push(e.message); noteProvider(false, e.message); if (e.code === 'not_configured' || e.code === 'budget') break; }
  }
  return errors;
}
async function syncLive() {
  const p = getProvider();
  // Live polling may use at most 60% of the daily request budget so analysis keeps working.
  if (budget.used() >= budget.limit() * 0.6) return ['Live updates paused to protect the daily provider request budget.'];
  try {
    const r = await cachedMeta('live', getSetting('live_poll_seconds'), () => p.getLiveFixtures());
    if (r.fresh) {
      upsertFixtures(r.value, p);
      const ids = new Set(r.value.map((f) => f.id));
      const lost = all("SELECT provider_id, kickoff_at FROM matches WHERE status='live' AND provider_id IS NOT NULL").filter((x) => !ids.has(x.provider_id));
      for (const d of new Set(lost.map((x) => x.kickoff_at.slice(0, 10))).values()) await syncDate(d, { force: true });
    }
    noteProvider(true);
    return [];
  } catch (e) { noteProvider(false, e.message); return [e.message]; }
}
/** Matches that should have started/finished but the feed still shows as scheduled/live. */
async function refreshOverdue() {
  const now = Date.now();
  const rows = all("SELECT kickoff_at, status FROM matches WHERE provider_id IS NOT NULL AND status IN ('scheduled','live') AND kickoff_at < ? AND kickoff_at > ?",
    new Date(now - (15 * 60000)).toISOString(), new Date(now - 6 * 3600000).toISOString());
  const dates = [...new Set(rows.map((r) => r.kickoff_at.slice(0, 10)))].slice(0, 2);
  for (const d of dates) { try { await syncDate(d, { force: true }); } catch (e) { noteProvider(false, e.message); break; } }
}

function statsFromStandings(row) {
  if (!row || !row.all.played) return null;
  const avg = (gf, pl) => (pl ? gf / pl : null);
  return {
    form: '', fromStandings: true,
    played: { home: row.home.played, away: row.away.played, total: row.all.played },
    gf_avg: { home: avg(row.home.gf, row.home.played), away: avg(row.away.gf, row.away.played), total: avg(row.all.gf, row.all.played) },
    ga_avg: { home: avg(row.home.ga, row.home.played), away: avg(row.away.ga, row.away.played), total: avg(row.all.ga, row.all.played) },
  };
}
function leagueAverages(table) {
  let hp = 0, hg = 0, ap = 0, ag = 0;
  for (const t of table) { hp += t.home.played; hg += t.home.gf; ap += t.away.played; ag += t.away.gf; }
  return hp >= 30 && ap >= 30 ? { home: hg / hp, away: ag / ap } : null;
}

/**
 * Gather everything the model and the match page need. Each source fails independently:
 * a missing piece lowers data quality but never breaks the response.
 */
async function loadContext(m, { force = false } = {}) {
  const p = getProvider(), ttl = getSetting('cache_ttl');
  const warnings = [];
  const ctx = { homeStats: null, awayStats: null, homeForm: [], awayForm: [], h2h: [], league: null, standing: null, injuries: null, lineups: null, injuryList: [], table: [], market: null };
  if (!m.provider_id) {
    warnings.push('This match was added manually, so no provider statistics are available.');
    ctx.market = odds.marketView(m.id);
    return { ctx, warnings };
  }
  const safe = async (label, fn, def) => { try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); return def; } };
  const lid = m.comp_pid, season = m.comp_season;
  const upcoming = m.status === 'scheduled' || m.status === 'live';
  const [hs, as, hf, af, h2h, table] = await Promise.all([
    safe('Home team statistics', () => cached(`tstats:${lid}:${season}:${m.home_pid}`, ttl.team, () => p.getTeamStats({ teamId: m.home_pid, leagueId: lid, season }), { force }), null),
    safe('Away team statistics', () => cached(`tstats:${lid}:${season}:${m.away_pid}`, ttl.team, () => p.getTeamStats({ teamId: m.away_pid, leagueId: lid, season }), { force }), null),
    safe('Home recent matches', () => cached(`last:${m.home_pid}`, ttl.team, () => p.getLastMatches({ teamId: m.home_pid, n: 8 }), { force }), []),
    safe('Away recent matches', () => cached(`last:${m.away_pid}`, ttl.team, () => p.getLastMatches({ teamId: m.away_pid, n: 8 }), { force }), []),
    safe('Head-to-head', () => cached(`h2h:${m.home_pid}:${m.away_pid}`, ttl.h2h, () => p.getH2H({ homeId: m.home_pid, awayId: m.away_pid, n: 8 }), { force }), []),
    safe('League table', () => cached(`standings:${lid}:${season}`, ttl.standings, () => p.getStandings({ leagueId: lid, season }), { force }), []),
  ]);
  ctx.homeForm = hf || []; ctx.awayForm = af || []; ctx.h2h = h2h || []; ctx.table = table || [];
  const rowOf = (pid) => ctx.table.find((t) => t.teamId === String(pid));
  ctx.homeStats = hs || statsFromStandings(rowOf(m.home_pid));
  ctx.awayStats = as || statsFromStandings(rowOf(m.away_pid));
  if (ctx.table.length) {
    ctx.league = leagueAverages(ctx.table);
    const hr = rowOf(m.home_pid), ar = rowOf(m.away_pid);
    if (hr && ar) ctx.standing = { homeRank: hr.rank, awayRank: ar.rank, size: ctx.table.length };
    tx(() => {
      for (const t of ctx.table) {
        const team = get('SELECT id FROM teams WHERE provider_id=?', t.teamId);
        if (team) run('INSERT OR REPLACE INTO standings(competition_id,team_id,rank,points,played,goal_diff) VALUES(?,?,?,?,?,?)', m.competition_id, team.id, t.rank, t.points, t.played, t.goalDiff);
      }
    });
  }

  if (upcoming) {
    await safe('Odds', () => odds.refreshOdds(m, { force }), null);
    ctx.market = odds.marketView(m.id);
    const hoursToKick = (new Date(m.kickoff_at) - Date.now()) / 3600000;
    if (hoursToKick < 48) {
      const inj = await safe('Injuries', () => cached(`inj:${m.provider_id}`, ttl.lineups, () => p.getInjuries({ fixtureId: m.provider_id }), { force }), []);
      if (inj?.length) {
        ctx.injuryList = inj;
        ctx.injuries = { home: inj.filter((x) => x.teamId === String(m.home_pid)).length, away: inj.filter((x) => x.teamId === String(m.away_pid)).length };
      }
    }
    if (hoursToKick < 3) {
      const lu = await safe('Line-ups', () => cached(`lineups:${m.provider_id}`, ttl.lineups, () => p.getLineups({ fixtureId: m.provider_id }), { force }), []);
      if (lu?.length) ctx.lineups = lu;
    }
  } else if (m.status === 'finished') {
    const lu = await safe('Line-ups', () => cached(`lineups:${m.provider_id}`, 86400, () => p.getLineups({ fixtureId: m.provider_id })), []);
    if (lu?.length) ctx.lineups = lu;
  }
  return { ctx, warnings };
}

/** Live / full-time statistics (possession, shots, corners, cards...). */
async function loadMatchStats(m) {
  if (!m.provider_id || m.status === 'scheduled') return null;
  try {
    const raw = await cached(`fstats:${m.provider_id}`, m.status === 'live' ? getSetting('cache_ttl').stats : 86400, () => getProvider().getFixtureStats({ fixtureId: m.provider_id }));
    const h = raw[String(m.home_pid)], a = raw[String(m.away_pid)];
    if (!h || !a) return null;
    return Object.keys(h).map((k) => ({ name: k, home: h[k], away: a[k] ?? null }));
  } catch { return null; }
}

/* ---------- queries over the local database ---------- */
function windowFor(dateStr, tzOffsetMin = 0) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const start = Date.UTC(y, mo - 1, d) + tzOffsetMin * 60000;
  return { from: new Date(start).toISOString(), to: new Date(start + 86400000).toISOString() };
}
function listMatches({ from, to, status, competitionId, q, popular, top, ids, page = 1, pageSize = 20, order = 'asc' }) {
  const where = ['m.hidden=0', 'c.enabled=1'];
  const params = [];
  if (from) { where.push('m.kickoff_at >= ?'); params.push(from); }
  if (to) { where.push('m.kickoff_at < ?'); params.push(to); }
  if (status) {
    const list = String(status).split(',');
    where.push(`m.status IN (${inList(list)})`); params.push(...list);
  }
  if (competitionId) { where.push('m.competition_id=?'); params.push(competitionId); }
  if (popular) where.push('c.popular=1');
  if (top) where.push('(m.is_top=1 OR c.popular=1)');
  if (ids) { where.push(`m.id IN (${inList(ids)})`); params.push(...ids); }
  if (q) { where.push('(th.name LIKE ? OR ta.name LIKE ? OR c.name LIKE ?)'); const l = `%${q}%`; params.push(l, l, l); }
  const total = get(`SELECT COUNT(*) AS n ${MATCH_FROM} WHERE ${where.join(' AND ')}`, ...params).n;
  pageSize = Math.min(50, Math.max(1, pageSize | 0 || 20)); page = Math.max(1, page | 0 || 1);
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  const rows = all(`${MATCH_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.popular DESC, c.sort_order, m.kickoff_at ${dir}, m.id LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

module.exports = { MATCH_SELECT, MATCH_COLS, MATCH_FROM, getMatchRow, syncDate, syncWindow, syncLive, refreshOverdue, loadContext, loadMatchStats, windowFor, listMatches, upsertFixtures };
