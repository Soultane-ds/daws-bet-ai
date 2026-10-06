'use strict';
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'daws-eng-'));
process.env.JOBS_ENABLED = '0';
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyse } = require('../src/engine/model');
const { evaluate } = require('../src/engine/settle');
const { levelFor, pickText } = require('../src/engine/labels');
const { scoreMatrix, sumWhere } = require('../src/engine/poisson');

const TH = { very_high: 95, high: 90, good: 80, medium: 70 };
const cfg = { thresholds: TH, minOdds: 1.2, minQuality: 0.35 };
const stats = (gfH, gaH, gfA, gaA) => ({ played: { home: 10, away: 10, total: 20 }, gf_avg: { home: gfH, away: gfA, total: (gfH + gfA) / 2 }, ga_avg: { home: gaH, away: gaA, total: (gaH + gaA) / 2 } });
const form = (gf, ga) => Array.from({ length: 6 }, () => ({ gf, ga }));
const base = () => ({ homeStats: stats(2.1, 0.8, 1.5, 1.2), awayStats: stats(1.2, 1.3, 1.0, 1.7), homeForm: form(2, 1), awayForm: form(1, 2), h2h: [{ hg: 2, ag: 1 }, { hg: 1, ag: 1 }, { hg: 3, ag: 0 }], market: null });

test('score grid sums to 1', () => {
  assert.ok(Math.abs(sumWhere(scoreMatrix(1.6, 1.1), () => true) - 1) < 1e-9);
});

test('probabilities are coherent', () => {
  const a = analyse(base(), cfg);
  assert.equal(a.ok, true);
  assert.ok(Math.abs(a.probs.home + a.probs.draw + a.probs.away - 100) < 0.5);
  const get = (m, s, l) => a.candidates.find((c) => c.market === m && c.selection === s && c.line === l).probability;
  assert.ok(get('OU', 'over', 0.5) > get('OU', 'over', 1.5));
  assert.ok(get('OU', 'over', 1.5) > get('OU', 'over', 2.5));
  assert.ok(Math.abs(get('OU', 'over', 2.5) + get('OU', 'under', 2.5) - 100) < 0.2);
  assert.ok(get('DC', '1X', 0) >= get('1X2', '1', 0));
  assert.ok(get('AH', 'home', -0.5) <= get('AH', 'home', 0.5));
  for (const c of a.candidates) assert.ok(c.probability >= 0 && c.probability <= 100 && c.confidence <= c.probability);
});

test('stronger home side is favoured', () => {
  const a = analyse(base(), cfg);
  assert.ok(a.probs.home > a.probs.away);
  assert.ok(a.lambdas.home > a.lambdas.away);
});

test('missing statistics produce no prediction rather than invented numbers', () => {
  const ctx = base(); ctx.homeStats = null;
  const a = analyse(ctx, cfg);
  assert.equal(a.ok, false);
  assert.ok(a.reason);
});

test('thin data is rejected by the data-quality gate', () => {
  const ctx = base();
  ctx.homeStats.played = { home: 1, away: 1, total: 2 }; ctx.awayStats.played = { home: 1, away: 1, total: 2 };
  ctx.homeForm = []; ctx.awayForm = []; ctx.h2h = [];
  assert.equal(analyse(ctx, cfg).ok, false);
});

test('best pick requires a real bookmaker price at or above the minimum odds', () => {
  const noOdds = analyse(base(), cfg);
  assert.equal(noOdds.best, null);
  const ctx = base();
  ctx.market = { odds: { 'OU|over|1.5': { best: 1.35, bookmaker: 'X', avg: 1.33, n: 3 }, 'OU|over|0.5': { best: 1.05, bookmaker: 'X', avg: 1.05, n: 3 } }, implied: {}, p1x2: null, pOver25: null };
  const a = analyse(ctx, cfg);
  assert.ok(a.best);
  assert.ok(a.best.marketOdds >= 1.2);
});

test('bookmaker consensus pulls the estimate toward the market', () => {
  const plain = analyse(base(), cfg);
  const ctx = base();
  ctx.market = { odds: {}, implied: {}, p1x2: { '1': 0.3, X: 0.3, '2': 0.4 }, pOver25: null };
  assert.ok(analyse(ctx, cfg).probs.home < plain.probs.home);
});

test('confidence thresholds map to labels and are editable', () => {
  assert.equal(levelFor(96, TH), 'very_high');
  assert.equal(levelFor(92, TH), 'high');
  assert.equal(levelFor(85, TH), 'good');
  assert.equal(levelFor(75, TH), 'medium');
  assert.equal(levelFor(69.9, TH), 'risky');
  assert.equal(levelFor(80, { ...TH, good: 85 }), 'medium');
});

test('settlement logic', () => {
  const s = { h: 2, a: 1, hth: 1, hta: 0 };
  assert.equal(evaluate('1X2', '1', 0, s), 'won');
  assert.equal(evaluate('1X2', 'X', 0, s), 'lost');
  assert.equal(evaluate('DC', 'X2', 0, s), 'lost');
  assert.equal(evaluate('DC', '12', 0, s), 'won');
  assert.equal(evaluate('OU', 'over', 2.5, s), 'won');
  assert.equal(evaluate('OU', 'under', 3, s), 'void');
  assert.equal(evaluate('BTTS', 'yes', 0, s), 'won');
  assert.equal(evaluate('AH', 'home', -0.5, s), 'won');
  assert.equal(evaluate('AH', 'home', -1, s), 'void');
  assert.equal(evaluate('AH', 'away', 1.5, s), 'won');
  assert.equal(evaluate('HT_1X2', '1', 0, s), 'won');
  assert.equal(evaluate('HT_1X2', '1', 0, { h: 1, a: 1 }), null);
  assert.equal(evaluate('CS', '2-1', 0, s), 'won');
  assert.equal(evaluate('CORNERS_OU', 'over', 9.5, s), null);
  assert.equal(evaluate('1X2', '1', 0, { h: null, a: null }), null);
});

test('pick text is readable', () => {
  assert.equal(pickText('OU', 'over', 1.5, 'A', 'B'), 'Over 1.5 goals');
  assert.equal(pickText('AH', 'home', -0.5, 'A', 'B'), 'A -0.5');
  assert.equal(pickText('DC', '1X', 0, 'A', 'B'), 'A or draw');
});
