'use strict';
/**
 * API-Football (api-sports.io) v3 adapter. Requires your own licensed key and a plan
 * whose terms permit your intended use (display, commercial, etc.).
 * Endpoint and field names follow the v3 documentation; verify them against your plan
 * when you first connect (the admin System page shows the last provider error).
 */
const cfg = require('../config');
const { ProviderError } = require('./index');
const budget = require('../services/budget');

const POPULAR = ['39', '140', '135', '78', '61', '2', '3', '848', '94', '88', '203', '253', '71', '45', '48', '1', '4', '5', '9', '10'];

const STATUS = {
  NS: 'scheduled', TBD: 'scheduled', '1H': 'live', HT: 'live', '2H': 'live', ET: 'live', BT: 'live', P: 'live', LIVE: 'live', INT: 'live',
  FT: 'finished', AET: 'finished', PEN: 'finished', AWD: 'finished', WO: 'finished',
  PST: 'postponed', CANC: 'cancelled', SUSP: 'suspended', ABD: 'cancelled',
};
const numOrNull = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };

function mapFixture(r) {
  return {
    id: String(r.fixture.id), status: STATUS[r.fixture.status?.short] || 'scheduled', minute: r.fixture.status?.elapsed ?? null,
    kickoff: new Date(r.fixture.date).toISOString(),
    competition: { id: String(r.league.id), name: r.league.name, country: r.league.country, logo: r.league.logo, season: r.league.season },
    home: { id: String(r.teams.home.id), name: r.teams.home.name, logo: r.teams.home.logo },
    away: { id: String(r.teams.away.id), name: r.teams.away.name, logo: r.teams.away.logo },
    score: { home: r.goals?.home ?? null, away: r.goals?.away ?? null, htHome: r.score?.halftime?.home ?? null, htAway: r.score?.halftime?.away ?? null },
  };
}

function normaliseBet(bookmaker, bet, out) {
  const name = String(bet.name || '');
  const push = (market, selection, line, odd) => { const price = numOrNull(odd); if (price && price > 1) out.push({ bookmaker, market, selection, line, price }); };
  for (const v of bet.values || []) {
    const val = String(v.value);
    if (name === 'Match Winner') push('1X2', { Home: '1', Draw: 'X', Away: '2' }[val], 0, v.odd);
    else if (name === 'Double Chance') push('DC', { 'Home/Draw': '1X', 'Home/Away': '12', 'Draw/Away': 'X2' }[val], 0, v.odd);
    else if (name === 'First Half Winner') push('HT_1X2', { Home: '1', Draw: 'X', Away: '2' }[val], 0, v.odd);
    else if (name === 'Both Teams Score') push('BTTS', val.toLowerCase(), 0, v.odd);
    else if (name === 'Goals Over/Under' || name === 'Goals Over/Under First Half' || /corners/i.test(name) && /over/i.test(name) || /^cards over\/under$/i.test(name)) {
      const m = val.match(/^(Over|Under)\s+([\d.]+)$/i);
      if (!m) continue;
      const market = name === 'Goals Over/Under' ? 'OU' : name === 'Goals Over/Under First Half' ? 'HT_OU' : /corners/i.test(name) ? 'CORNERS_OU' : 'CARDS_OU';
      push(market, m[1].toLowerCase(), parseFloat(m[2]), v.odd);
    } else if (name === 'Asian Handicap') {
      const m = val.match(/^(Home|Away)\s*([+-]?[\d.]+)$/i);
      if (m) push('AH', m[1].toLowerCase(), parseFloat(m[2]), v.odd);
    } else if (name === 'Exact Score') {
      const m = val.match(/^(\d+):(\d+)$/);
      if (m) push('CS', `${m[1]}-${m[2]}`, 0, v.odd);
    }
  }
}

function create() {
  async function call(path, params = {}) {
    if (!cfg.apiFootballKey) throw new ProviderError('Football data provider is not configured: API_FOOTBALL_KEY is missing.', { code: 'not_configured' });
    budget.consume();
    const url = new URL(cfg.apiFootballBase + path);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try { res = await fetch(url, { headers: { 'x-apisports-key': cfg.apiFootballKey }, signal: ctrl.signal }); }
    catch (e) { throw new ProviderError(`Football data provider unreachable (${e.name === 'AbortError' ? 'timeout' : e.message}).`, { code: 'network' }); }
    finally { clearTimeout(timer); }
    if (res.status === 429) throw new ProviderError('Football data provider rate limit reached.', { status: 429, code: 'rate_limit' });
    if (!res.ok) throw new ProviderError(`Football data provider returned HTTP ${res.status}.`, { status: res.status });
    const data = await res.json();
    const errs = data.errors;
    if (errs && (Array.isArray(errs) ? errs.length : Object.keys(errs).length)) {
      throw new ProviderError(`Football data provider error: ${JSON.stringify(errs)}`, { code: 'api' });
    }
    return data.response || [];
  }

  return {
    name: 'api-football',
    get configured() { return !!cfg.apiFootballKey; },
    popularLeagueIds: POPULAR,

    async getFixtures({ date }) { return (await call('/fixtures', { date })).map(mapFixture); },
    async getLiveFixtures() { return (await call('/fixtures', { live: 'all' })).map(mapFixture); },

    async getOdds({ fixtureId }) {
      const rows = await call('/odds', { fixture: fixtureId });
      const out = [];
      for (const r of rows) for (const b of r.bookmakers || []) for (const bet of b.bets || []) normaliseBet(b.name, bet, out);
      return out;
    },

    async getTeamStats({ teamId, leagueId, season }) {
      const r = await call('/teams/statistics', { team: teamId, league: leagueId, season });
      if (!r || Array.isArray(r) || !r.fixtures) return null;
      const g = (o) => ({ home: numOrNull(o?.average?.home), away: numOrNull(o?.average?.away), total: numOrNull(o?.average?.total) });
      return {
        form: r.form || '',
        played: { home: r.fixtures.played?.home ?? 0, away: r.fixtures.played?.away ?? 0, total: r.fixtures.played?.total ?? 0 },
        gf_avg: g(r.goals?.for), ga_avg: g(r.goals?.against),
      };
    },

    async getLastMatches({ teamId, n = 8 }) {
      const rows = await call('/fixtures', { team: teamId, last: n });
      return rows.filter((x) => x.goals?.home != null).map((x) => {
        const isHome = String(x.teams.home.id) === String(teamId);
        return { date: x.fixture.date, home: isHome, gf: isHome ? x.goals.home : x.goals.away, ga: isHome ? x.goals.away : x.goals.home, opponentId: String(isHome ? x.teams.away.id : x.teams.home.id), opponent: isHome ? x.teams.away.name : x.teams.home.name };
      }).sort((a, b) => b.date.localeCompare(a.date));
    },

    async getH2H({ homeId, awayId, n = 8 }) {
      const rows = await call('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: n });
      return rows.filter((x) => x.goals?.home != null).map((x) => ({ date: x.fixture.date, homeId: String(x.teams.home.id), awayId: String(x.teams.away.id), home: x.teams.home.name, away: x.teams.away.name, hg: x.goals.home, ag: x.goals.away }));
    },

    async getStandings({ leagueId, season }) {
      const rows = await call('/standings', { league: leagueId, season });
      const table = rows[0]?.league?.standings?.[0] || [];
      return table.map((t) => ({
        teamId: String(t.team.id), rank: t.rank, points: t.points, played: t.all?.played ?? 0, goalDiff: t.goalsDiff ?? 0,
        home: { played: t.home?.played ?? 0, gf: t.home?.goals?.for ?? 0, ga: t.home?.goals?.against ?? 0 },
        away: { played: t.away?.played ?? 0, gf: t.away?.goals?.for ?? 0, ga: t.away?.goals?.against ?? 0 },
        all: { played: t.all?.played ?? 0, gf: t.all?.goals?.for ?? 0, ga: t.all?.goals?.against ?? 0 },
      }));
    },

    async getLineups({ fixtureId }) {
      const rows = await call('/fixtures/lineups', { fixture: fixtureId });
      return rows.map((r) => ({
        teamId: String(r.team.id), team: r.team.name, formation: r.formation || null,
        startXI: (r.startXI || []).map((p) => ({ name: p.player.name, number: p.player.number, pos: p.player.pos })),
        subs: (r.substitutes || []).map((p) => ({ name: p.player.name, number: p.player.number, pos: p.player.pos })),
      }));
    },

    async getInjuries({ fixtureId }) {
      const rows = await call('/injuries', { fixture: fixtureId });
      return rows.map((r) => ({ teamId: String(r.team.id), player: r.player.name, type: r.player.type, reason: r.player.reason }));
    },

    async getFixtureStats({ fixtureId }) {
      const rows = await call('/fixtures/statistics', { fixture: fixtureId });
      const out = {};
      for (const r of rows) {
        out[String(r.team.id)] = {};
        for (const s of r.statistics || []) out[String(r.team.id)][s.type] = s.value;
      }
      return out;
    },
  };
}
module.exports = { create, normaliseBet, STATUS };
