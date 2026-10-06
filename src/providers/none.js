'use strict';
const { ProviderError } = require('./index');
function create() {
  const fail = async () => { throw new ProviderError('No football data provider is configured. Set FOOTBALL_PROVIDER and an API key in .env.', { code: 'not_configured' }); };
  return { name: 'none', configured: false, getFixtures: fail, getLiveFixtures: fail, getOdds: fail, getTeamStats: fail, getLastMatches: fail, getH2H: fail, getStandings: fail, getLineups: fail, getInjuries: fail, getFixtureStats: fail, popularLeagueIds: [] };
}
module.exports = { create };
