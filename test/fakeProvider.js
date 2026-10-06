'use strict';
/**
 * TEST FIXTURE ONLY. Used by the automated tests to exercise the pipeline without
 * network access. It is never imported by the application.
 */
const iso = (d) => d.toISOString();
const dayStart = (date) => Date.parse(`${date}T00:00:00.000Z`);

function strength(id) { return { att: 1.0 + (id % 5) * 0.22, def: 1.6 - (id % 4) * 0.2 }; }
function teamStats(id) {
  const s = strength(id);
  return { form: 'WDWLW', played: { home: 9, away: 9, total: 18 }, gf_avg: { home: s.att + 0.2, away: s.att - 0.2, total: s.att }, ga_avg: { home: s.def - 0.2, away: s.def + 0.2, total: s.def } };
}
function create() {
  const calls = {};
  const bump = (k) => { calls[k] = (calls[k] || 0) + 1; };
  const FIX = (date) => {
    const t0 = dayStart(date) + 12 * 3600000;
    const mk = (id, lg, h, a, hr, status = 'scheduled') => ({
      id: String(id), status, minute: null, kickoff: iso(new Date(t0 + hr * 3600000)),
      competition: { id: String(lg), name: lg === 39 ? 'Test Premier' : 'Test Obscure Cup', country: 'Testland', logo: null, season: 2026 },
      home: { id: String(h), name: `Team ${h}`, logo: null }, away: { id: String(a), name: `Team ${a}`, logo: null },
      score: { home: null, away: null, htHome: null, htAway: null },
    });
    const d = date.replace(/-/g, '').slice(2);
    return [
      mk(`${d}1`, 39, 101, 102, 0), mk(`${d}2`, 39, 103, 104, 1), mk(`${d}3`, 39, 105, 106, 2), mk(`${d}4`, 39, 107, 108, 3),
      mk(`${d}5`, 999, 201, 202, 4), mk(`${d}6`, 39, 109, 110, 5, 'postponed'), mk(`${d}7`, 39, 111, 999, 6),
    ];
  };
  return {
    name: 'fake', configured: true, popularLeagueIds: ['39'], calls,
    async getFixtures({ date }) {
      bump('fixtures');
      if (date === '2026-01-15') return FIX(date).map((f, i) => ({ ...f, status: 'finished', score: { home: i % 3, away: 1, htHome: 0, htAway: 1 } }));
      return FIX(date);
    },
    async getLiveFixtures() { bump('live'); return []; },
    async getOdds({ fixtureId }) {
      bump('odds');
      const seed = [...fixtureId].reduce((s, c) => s + c.charCodeAt(0), 0);
      const out = [];
      for (const [bk, k] of [['BookA', 1], ['BookB', 1.04], ['BookC', 0.97]]) {
        const w = (x) => Math.round(x * k * 100) / 100;
        const hm = 1.7 + (seed % 7) * 0.15;
        out.push({ bookmaker: bk, market: '1X2', selection: '1', line: 0, price: w(hm) }, { bookmaker: bk, market: '1X2', selection: 'X', line: 0, price: w(3.4) }, { bookmaker: bk, market: '1X2', selection: '2', line: 0, price: w(4.6 - (seed % 7) * 0.25) });
        out.push({ bookmaker: bk, market: 'OU', selection: 'over', line: 2.5, price: w(1.85) }, { bookmaker: bk, market: 'OU', selection: 'under', line: 2.5, price: w(1.95) });
        out.push({ bookmaker: bk, market: 'OU', selection: 'over', line: 1.5, price: w(1.3) }, { bookmaker: bk, market: 'OU', selection: 'under', line: 1.5, price: w(3.4) });
        out.push({ bookmaker: bk, market: 'BTTS', selection: 'yes', line: 0, price: w(1.75) }, { bookmaker: bk, market: 'BTTS', selection: 'no', line: 0, price: w(2.0) });
        out.push({ bookmaker: bk, market: 'DC', selection: '1X', line: 0, price: w(1.3) });
      }
      return out;
    },
    async getTeamStats({ teamId }) { bump('teamStats'); if (teamId === '999') return null; return teamStats(+teamId); },
    async getLastMatches({ teamId }) {
      bump('last'); if (teamId === '999') return [];
      const s = strength(+teamId);
      return Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-${20 - i}T15:00:00Z`, home: i % 2 === 0, gf: Math.max(0, Math.round(s.att + (i % 3) - 1)), ga: Math.round(s.def), opponentId: '1', opponent: 'X' }));
    },
    async getH2H({ homeId, awayId }) {
      bump('h2h');
      return [{ date: '2025-10-01', homeId, awayId, home: 'H', away: 'A', hg: 2, ag: 1 }, { date: '2025-03-01', homeId: awayId, awayId: homeId, home: 'A', away: 'H', hg: 0, ag: 0 }, { date: '2024-10-01', homeId, awayId, home: 'H', away: 'A', hg: 3, ag: 1 }];
    },
    async getStandings({ leagueId }) {
      bump('standings');
      if (leagueId !== '39') return [];
      return Array.from({ length: 12 }, (_, i) => ({ teamId: String(101 + i), rank: i + 1, points: 30 - i, played: 18, goalDiff: 10 - i, home: { played: 9, gf: 14, ga: 8 }, away: { played: 9, gf: 11, ga: 11 }, all: { played: 18, gf: 25, ga: 19 } }));
    },
    async getLineups() { bump('lineups'); return []; },
    async getInjuries() { bump('injuries'); return []; },
    async getFixtureStats() { bump('fstats'); return {}; },
  };
}
module.exports = { create };
