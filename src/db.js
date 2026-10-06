'use strict';
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const db = new DatabaseSync(cfg.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  google_id TEXT UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  tier_expires_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS admin_users (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY,
  provider_id TEXT UNIQUE,
  name TEXT NOT NULL,
  country TEXT,
  logo TEXT,
  season INTEGER,
  popular INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  provider_id TEXT UNIQUE,
  name TEXT NOT NULL,
  logo TEXT,
  country TEXT
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  provider_id TEXT UNIQUE,
  competition_id INTEGER NOT NULL REFERENCES competitions(id),
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  kickoff_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  minute INTEGER,
  home_score INTEGER,
  away_score INTEGER,
  ht_home INTEGER,
  ht_away INTEGER,
  is_top INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'provider',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON matches(kickoff_at);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE TABLE IF NOT EXISTS odds (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  bookmaker TEXT NOT NULL,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(match_id, bookmaker, market, selection, line)
);
CREATE INDEX IF NOT EXISTS idx_odds_match ON odds(match_id);
CREATE TABLE IF NOT EXISTS standings (
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank INTEGER, points INTEGER, played INTEGER, goal_diff INTEGER,
  PRIMARY KEY (competition_id, team_id)
);
CREATE TABLE IF NOT EXISTS match_extras (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (match_id, kind)
);
CREATE TABLE IF NOT EXISTS predictions (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL,
  probability REAL NOT NULL,
  confidence REAL NOT NULL,
  model_odds REAL NOT NULL,
  market_odds REAL,
  bookmaker TEXT,
  edge REAL,
  is_best INTEGER NOT NULL DEFAULT 0,
  explanation TEXT,
  model_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(match_id, market, selection, line)
);
CREATE INDEX IF NOT EXISTS idx_pred_match ON predictions(match_id);
CREATE TABLE IF NOT EXISTS prediction_history (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  market TEXT NOT NULL,
  selection TEXT NOT NULL,
  line REAL NOT NULL DEFAULT 0,
  probability REAL NOT NULL,
  confidence REAL NOT NULL,
  level TEXT NOT NULL,
  odds REAL,
  result TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_hist_user ON prediction_history(user_id);
CREATE INDEX IF NOT EXISTS idx_hist_result ON prediction_history(result);
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, kind, ref_id)
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  note TEXT,
  created_by INTEGER
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  kind TEXT NOT NULL DEFAULT 'info',
  ref TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notification_id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS banners (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  starts_at TEXT, ends_at TEXT
);
CREATE TABLE IF NOT EXISTS prediction_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  min_tier TEXT NOT NULL DEFAULT 'free',
  sort_order INTEGER NOT NULL DEFAULT 100
);
CREATE TABLE IF NOT EXISTS api_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

const stmts = new Map();
const prep = (sql) => {
  let s = stmts.get(sql);
  if (!s) { s = db.prepare(sql); stmts.set(sql, s); }
  return s;
};
const clean = (a) => a.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

const all = (sql, ...p) => prep(sql).all(...clean(p));
const get = (sql, ...p) => prep(sql).get(...clean(p));
const run = (sql, ...p) => prep(sql).run(...clean(p));
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}
const inList = (arr) => arr.map(() => '?').join(',') || 'NULL';

const CATEGORIES = [
  ['result', 'Match result', 'free', 10], ['goals', 'Goals', 'free', 20], ['btts', 'Both teams to score', 'free', 30],
  ['handicap', 'Asian handicap', 'vip', 40], ['half_time', 'Half-time', 'vip', 50],
  ['corners', 'Corners', 'vip', 60], ['cards', 'Cards', 'vip', 70], ['correct_score', 'Correct score', 'premium', 80],
];
for (const [key, label, min_tier, sort] of CATEGORIES) {
  run('INSERT OR IGNORE INTO prediction_categories(key,label,min_tier,sort_order) VALUES(?,?,?,?)', key, label, min_tier, sort);
}

module.exports = { db, all, get, run, tx, inList };
