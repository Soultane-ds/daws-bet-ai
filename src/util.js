'use strict';
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const j = (s) => { try { return JSON.parse(s); } catch { return null; } };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const round = (x, d = 2) => { const m = 10 ** d; return Math.round(x * m) / m; };
const num = (x) => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
const isoNow = () => new Date().toISOString();
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
module.exports = { HttpError, j, clamp, round, num, isoNow, dayKey };
