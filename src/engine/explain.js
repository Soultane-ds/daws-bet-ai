'use strict';
const { pickText, MARKET_NAMES } = require('./labels');

/** Plain-language reasoning built only from numbers the model actually used. */
function explain(analysis, pick, names) {
  const f = analysis.factors, b = f.base, lam = analysis.lambdas;
  const pct = (x) => `${Math.round(x)}%`;
  const lines = [];
  lines.push(`The model expects about ${lam.home.toFixed(2)} goals for ${names.home} and ${lam.away.toFixed(2)} for ${names.away} (${lam.total.toFixed(2)} in total).`);
  lines.push(`${names.home} average ${b.attH.toFixed(2)} goals scored and ${b.defH.toFixed(2)} conceded at home (${b.nH} home games); ${names.away} average ${b.attA.toFixed(2)} scored and ${b.defA.toFixed(2)} conceded away (${b.nA} away games).`);
  if (f.form) lines.push(`Recent form was weighed more heavily for the latest matches${f.form.homeGF != null ? ` (${names.home} ${f.form.homeGF} scored / ${f.form.homeGA} conceded per game recently)` : ''}.`);
  if (f.xg) lines.push(`Expected-goals (xG) data points to ${f.xg.home.toFixed(2)} vs ${f.xg.away.toFixed(2)}.`);
  if (f.h2h) lines.push(`Their last ${f.h2h.n} meetings averaged ${f.h2h.avgGoals} goals.`);
  if (f.rank) lines.push(`Table positions: ${names.home} ${f.rank.home}, ${names.away} ${f.rank.away} (of ${f.rank.size}).`);
  if (f.injuries) lines.push(`Reported absences: ${f.injuries.home} for ${names.home}, ${f.injuries.away} for ${names.away}. Player importance is not known to the model, so the effect is kept small.`);
  if (f.market) lines.push('Bookmaker consensus was blended in lightly as a cross-check.');
  if (!analysis.used.injuries && !analysis.lineups) lines.push('Confirmed line-ups are not factored in yet.');
  const gaps = [];
  if (!analysis.used.form) gaps.push('recent form');
  if (!analysis.used.h2h) gaps.push('head-to-head');
  if (!analysis.used.xg) gaps.push('xG');
  if (gaps.length) lines.push(`Not available for this match: ${gaps.join(', ')}.`);

  let summary = '';
  if (pick) {
    const t = pickText(pick.market, pick.selection, pick.line, names.home, names.away);
    summary = `${t} comes out at ${pct(pick.probability)} in ${MARKET_NAMES[pick.market] || pick.market}, a confidence of ${Math.round(pick.confidence)} (${pick.risk.toLowerCase()} risk).`;
    if (pick.marketOdds) summary += ` Best price found: ${pick.marketOdds.toFixed(2)}; the model's fair price is ${pick.modelOdds.toFixed(2)}.`;
    if (pick.edge != null && pick.edge >= 0.03) summary += ' The price is higher than the model suggests, which is what makes it a potential value bet.';
    else if (pick.edge != null && pick.edge < 0) summary += ' The price is below the model\'s fair price, so there is no value at these odds.';
  }
  summary += ' This is a probability estimate, not a guarantee; outcomes can and do go the other way.';
  return { summary: summary.trim(), bullets: lines };
}
module.exports = { explain };
