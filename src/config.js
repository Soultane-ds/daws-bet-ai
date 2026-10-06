'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');

function loadEnvFile() {
  const p = path.join(root, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1] in process.env) continue;
    process.env[m[1]] = m[2].replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
  }
}
loadEnvFile();

const env = process.env;
const isProd = env.NODE_ENV === 'production';
const dataDir = path.resolve(root, env.DATA_DIR || 'data');
fs.mkdirSync(dataDir, { recursive: true });

function jwtSecret() {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (isProd) throw new Error('JWT_SECRET must be set in production');
  const f = path.join(dataDir, '.jwt_secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(f, 'utf8').trim();
}

module.exports = {
  root,
  isProd,
  port: Number(env.PORT) || 3000,
  dataDir,
  dbPath: env.DB_PATH || path.join(dataDir, 'dawsbet.db'),
  jwtSecret: jwtSecret(),
  provider: (env.FOOTBALL_PROVIDER || 'api-football').toLowerCase(),
  apiFootballKey: env.API_FOOTBALL_KEY || '',
  apiFootballBase: env.API_FOOTBALL_BASE || 'https://v3.football.api-sports.io',
  apiDailyLimit: Number(env.API_DAILY_LIMIT) || 100,
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || '',
  jobsEnabled: env.JOBS_ENABLED !== '0',
};
