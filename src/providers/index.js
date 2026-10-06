'use strict';
/**
 * Football data provider abstraction.
 *
 * A provider is any object implementing the methods below. Swap providers by
 * changing FOOTBALL_PROVIDER in .env (and adding a file next to this one).
 * All methods are async, return normalised plain objects, and throw ProviderError.
 *
 *   getFixtures({ date })            -> [Fixture]
 *   getLiveFixtures()                -> [Fixture]
 *   getOdds({ fixtureId })           -> [{ bookmaker, market, selection, line, price }]
 *   getTeamStats({ teamId, leagueId, season }) -> TeamStats | null
 *   getLastMatches({ teamId, n })    -> [{ date, gf, ga, home, opponentId }]   newest first
 *   getH2H({ homeId, awayId, n })    -> [{ date, homeId, awayId, hg, ag }]
 *   getStandings({ leagueId, season }) -> [{ teamId, rank, points, played, goalDiff,
 *                                            home: {played, gf, ga}, away: {played, gf, ga} }]
 *   getLineups({ fixtureId })        -> [{ teamId, team, formation, startXI: [{name, number, pos}], subs: [...] }]
 *   getInjuries({ fixtureId })       -> [{ teamId, player, type, reason }]
 *   getFixtureStats({ fixtureId })   -> { [teamId]: { [statName]: value } }
 *   popularLeagueIds                 -> [string]  (optional)
 *
 * Fixture: { id, status, minute, kickoff (ISO), competition: {id,name,country,logo,season},
 *            home: {id,name,logo}, away: {id,name,logo}, score: {home,away,htHome,htAway} }
 *   status is one of: scheduled | live | finished | postponed | cancelled | suspended
 * TeamStats: { form, played:{home,away,total}, gf_avg:{home,away,total}, ga_avg:{...},
 *              xg_for_avg?, xg_against_avg?, corners?:{for,against}, cards?:{for,against} }
 */
const cfg = require('../config');

class ProviderError extends Error {
  constructor(message, { status, code } = {}) { super(message); this.name = 'ProviderError'; this.status = status; this.code = code || 'provider'; }
}

let instance = null;
function getProvider() {
  if (!instance) {
    if (cfg.provider === 'api-football') instance = require('./apiFootball').create();
    else instance = require('./none').create();
  }
  return instance;
}
function setProvider(p) { instance = p; }

module.exports = { ProviderError, getProvider, setProvider };
