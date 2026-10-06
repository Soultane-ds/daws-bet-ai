'use strict';
// Decide whether a stored selection won, lost or was void, given the final score.
// Returns null when the outcome cannot be determined from the data (e.g. corners/cards).
function evaluate(market, sel, line, s) {
  if (s.h == null || s.a == null) return null;
  const L = Number(line);
  const { h, a } = s;
  switch (market) {
    case '1X2': return (h > a ? '1' : h < a ? '2' : 'X') === sel ? 'won' : 'lost';
    case 'DC': { const r = h > a ? '1' : h < a ? '2' : 'X'; return sel.includes(r) ? 'won' : 'lost'; }
    case 'OU': { const t = h + a; if (t === L) return 'void'; return (sel === 'over' ? t > L : t < L) ? 'won' : 'lost'; }
    case 'BTTS': return ((h > 0 && a > 0) === (sel === 'yes')) ? 'won' : 'lost';
    case 'AH': { const d = (sel === 'home' ? h - a : a - h) + L; return d > 0 ? 'won' : d === 0 ? 'void' : 'lost'; }
    case 'HT_1X2': if (s.hth == null || s.hta == null) return null; return (s.hth > s.hta ? '1' : s.hth < s.hta ? '2' : 'X') === sel ? 'won' : 'lost';
    case 'HT_OU': { if (s.hth == null || s.hta == null) return null; const t = s.hth + s.hta; if (t === L) return 'void'; return (sel === 'over' ? t > L : t < L) ? 'won' : 'lost'; }
    case 'CS': return `${h}-${a}` === sel ? 'won' : 'lost';
    default: return null;
  }
}
module.exports = { evaluate };
