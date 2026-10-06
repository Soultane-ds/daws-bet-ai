'use strict';
// Poisson / Dixon-Coles score grid utilities.
const MAX = 10;

function pmf(lambda, max = MAX) {
  const out = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k++) out[k] = (out[k - 1] * lambda) / k;
  return out;
}

// Low-score dependence correction (Dixon & Coles, 1997)
function tau(x, y, lh, la, rho) {
  if (x === 0 && y === 0) return 1 - lh * la * rho;
  if (x === 0 && y === 1) return 1 + lh * rho;
  if (x === 1 && y === 0) return 1 + la * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

function scoreMatrix(lh, la, { max = MAX, rho = -0.06 } = {}) {
  const ph = pmf(lh, max), pa = pmf(la, max);
  const M = [];
  let sum = 0;
  for (let h = 0; h <= max; h++) {
    M[h] = [];
    for (let a = 0; a <= max; a++) {
      const v = Math.max(0, ph[h] * pa[a] * tau(h, a, lh, la, rho));
      M[h][a] = v; sum += v;
    }
  }
  for (let h = 0; h <= max; h++) for (let a = 0; a <= max; a++) M[h][a] /= sum;
  return M;
}

function sumWhere(M, pred) {
  let s = 0;
  for (let h = 0; h < M.length; h++) for (let a = 0; a < M[h].length; a++) if (pred(h, a)) s += M[h][a];
  return s;
}

// P(X > line) for a Poisson variable (line is a half-line such as 9.5)
function poissonOver(lambda, line) {
  const p = pmf(lambda, Math.max(40, Math.ceil(lambda * 4)));
  let cdf = 0;
  for (let k = 0; k <= Math.floor(line); k++) cdf += p[k];
  return 1 - cdf;
}

module.exports = { pmf, scoreMatrix, sumWhere, poissonOver, MAX };
