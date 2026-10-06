'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { get, run } = require('./db');
const { HttpError } = require('./util');

const b64u = (b) => Buffer.from(b).toString('base64url');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [kind, saltHex, hashHex] = stored.split('$');
  if (kind !== 'scrypt') return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const expected = Buffer.from(hashHex, 'hex');
  return expected.length === hash.length && crypto.timingSafeEqual(hash, expected);
}

function signToken(userId, ttlSec = 60 * 60 * 24 * 14) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', cfg.jwtSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const sig = crypto.createHmac('sha256', cfg.jwtSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function effectiveTier(u) {
  if (u.tier !== 'free' && u.tier_expires_at && u.tier_expires_at < new Date().toISOString()) return 'free';
  return u.tier;
}
function loadUser(id) {
  const u = get('SELECT * FROM users WHERE id=?', id);
  if (!u) return null;
  u.is_admin = !!get('SELECT 1 AS x FROM admin_users WHERE user_id=?', id);
  u.effective_tier = effectiveTier(u);
  return u;
}
function userFromRequest(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const p = verifyToken(h.slice(7));
  if (!p) return null;
  const u = loadUser(p.sub);
  return u && !u.disabled ? u : null;
}
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, tier: u.effective_tier, tier_expires_at: u.tier_expires_at, is_admin: u.is_admin, created_at: u.created_at };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function register({ email, password, name }) {
  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (String(password || '').length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
  if (get('SELECT 1 AS x FROM users WHERE email=?', email)) throw new HttpError(409, 'An account with this email already exists.');
  const r = run('INSERT INTO users(email,name,password_hash) VALUES(?,?,?)', email, String(name || '').trim().slice(0, 60) || email.split('@')[0], hashPassword(password));
  return loadUser(Number(r.lastInsertRowid));
}
function login({ email, password }) {
  email = String(email || '').trim().toLowerCase();
  const u = get('SELECT * FROM users WHERE email=?', email);
  if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Email or password is incorrect.');
  if (u.disabled) throw new HttpError(403, 'This account has been disabled. Contact support.');
  run("UPDATE users SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", u.id);
  return loadUser(u.id);
}
async function googleLogin(credential) {
  if (!cfg.googleClientId) throw new HttpError(501, 'Google login is not configured.');
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new HttpError(401, 'Google sign-in could not be verified.');
  const p = await res.json();
  if (p.aud !== cfg.googleClientId || !(p.email_verified === true || p.email_verified === 'true')) throw new HttpError(401, 'Google sign-in could not be verified.');
  const email = String(p.email).toLowerCase();
  let u = get('SELECT * FROM users WHERE google_id=? OR email=?', p.sub, email);
  if (!u) {
    const r = run('INSERT INTO users(email,name,google_id) VALUES(?,?,?)', email, p.name || email.split('@')[0], p.sub);
    u = { id: Number(r.lastInsertRowid) };
  } else if (u.disabled) throw new HttpError(403, 'This account has been disabled. Contact support.');
  else if (!u.google_id) run('UPDATE users SET google_id=? WHERE id=?', p.sub, u.id);
  run("UPDATE users SET last_login_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?", u.id);
  return loadUser(u.id);
}
function makeAdmin(userId, on = true) {
  if (on) run('INSERT OR IGNORE INTO admin_users(user_id) VALUES(?)', userId);
  else run('DELETE FROM admin_users WHERE user_id=?', userId);
}
function bootstrapAdmin() {
  if (get('SELECT 1 AS x FROM admin_users LIMIT 1')) return;
  if (!cfg.adminEmail || !cfg.adminPassword) return;
  let u = get('SELECT * FROM users WHERE email=?', cfg.adminEmail);
  if (!u) { const nu = register({ email: cfg.adminEmail, password: cfg.adminPassword, name: 'Admin' }); u = { id: nu.id }; }
  makeAdmin(u.id);
  console.log(`[auth] Admin account ready: ${cfg.adminEmail}`);
}

// Small in-memory sliding-window rate limiter
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > windowMs) hits.delete(k);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, loadUser, userFromRequest, publicUser, register, login, googleLogin, makeAdmin, bootstrapAdmin, effectiveTier, rateLimit };
