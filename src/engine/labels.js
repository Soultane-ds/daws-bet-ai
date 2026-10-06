'use strict';
const LEVELS = ['very_high', 'high', 'good', 'medium', 'risky'];
const LEVEL_TEXT = { very_high: 'VERY HIGH', high: 'HIGH', good: 'GOOD', medium: 'MEDIUM', risky: 'RISKY' };
const RISK_OF_LEVEL = { very_high: 'Low', high: 'Low', good: 'Moderate', medium: 'Elevated', risky: 'High' };

function levelFor(confidence, th) {
  if (confidence >= th.very_high) return 'very_high';
  if (confidence >= th.high) return 'high';
  if (confidence >= th.good) return 'good';
  if (confidence >= th.medium) return 'medium';
  return 'risky';
}
const CATEGORY_OF = {
  '1X2': 'result', DC: 'result', OU: 'goals', BTTS: 'btts', AH: 'handicap',
  HT_1X2: 'half_time', HT_OU: 'half_time', CS: 'correct_score', CORNERS_OU: 'corners', CARDS_OU: 'cards',
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLine = (L) => (L > 0 ? `+${L}` : String(L));

function pickText(market, sel, line, home = 'Home', away = 'Away') {
  const L = Number(line);
  switch (market) {
    case '1X2': return sel === '1' ? `${home} to win` : sel === '2' ? `${away} to win` : 'Draw';
    case 'DC': return sel === '1X' ? `${home} or draw` : sel === 'X2' ? `Draw or ${away}` : `${home} or ${away}`;
    case 'OU': return `${cap(sel)} ${L} goals`;
    case 'BTTS': return sel === 'yes' ? 'Both teams to score' : 'Both teams not to score';
    case 'AH': return `${sel === 'home' ? home : away} ${fmtLine(L)}`;
    case 'HT_1X2': return sel === '1' ? `${home} leading at half-time` : sel === '2' ? `${away} leading at half-time` : 'Draw at half-time';
    case 'HT_OU': return `${cap(sel)} ${L} first-half goals`;
    case 'CS': return `Correct score ${sel}`;
    case 'CORNERS_OU': return `${cap(sel)} ${L} corners`;
    case 'CARDS_OU': return `${cap(sel)} ${L} cards`;
    default: return `${market} ${sel}`;
  }
}
const MARKET_NAMES = {
  '1X2': 'Match result (1X2)', DC: 'Double chance', OU: 'Goals over/under', BTTS: 'Both teams to score',
  AH: 'Asian handicap', HT_1X2: 'Half-time result', HT_OU: 'First-half goals', CS: 'Correct score',
  CORNERS_OU: 'Corners over/under', CARDS_OU: 'Cards over/under',
};
module.exports = { LEVELS, LEVEL_TEXT, RISK_OF_LEVEL, levelFor, CATEGORY_OF, pickText, MARKET_NAMES };
