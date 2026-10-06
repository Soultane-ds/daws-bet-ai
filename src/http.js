'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const cfg = require('./config');
const { userFromRequest } = require('./auth');
const { HttpError } = require('./util');
const { getSetting } = require('./settings');

const routes = [];
function route(method, pattern, handler, auth = 'none') {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth });
}

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://accounts.google.com; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; base-uri 'self'; form-action 'self'; object-src 'none'",
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY });
  res.end(body);
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Request body too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!match) {
    if (routes.some((r) => r.re.test(url.pathname))) throw new HttpError(405, 'Method not allowed.');
    throw new HttpError(404, 'Not found.');
  }
  const m = url.pathname.match(match.re);
  const params = {};
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
  const user = userFromRequest(req);
  if (match.auth !== 'none' && !user) throw new HttpError(401, 'Please sign in to continue.');
  if (match.auth === 'admin' && !user.is_admin) throw new HttpError(403, 'Administrator access required.');
  if (getSetting('maintenance') && !user?.is_admin && !/^\/api\/(config|auth)/.test(url.pathname)) throw new HttpError(503, 'DAWS BET AI is undergoing maintenance. Please try again shortly.');
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  const query = Object.fromEntries(url.searchParams);
  const out = await match.handler({ req, res, params, query, body, user, ip: req.socket.remoteAddress });
  sendJson(res, 200, out ?? { ok: true });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PUBLIC = path.join(cfg.root, 'public');
const gzCache = new Map();

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) { res.writeHead(404, SECURITY); return res.end('Not found'); }
    file = path.join(PUBLIC, 'index.html'); // single-page app fallback
  }
  const ext = path.extname(file);
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300', ...SECURITY };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const compressible = ['.html', '.js', '.css', '.json', '.svg', '.webmanifest'].includes(ext);
  if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    let gz = gzCache.get(file);
    if (!gz || gz.etag !== etag) { gz = { etag, buf: zlib.gzipSync(fs.readFileSync(file)) }; gzCache.set(file, gz); }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Content-Length': gz.buf.length });
    return res.end(gz.buf);
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else { res.writeHead(405); res.end(); }
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[error]', req.method, url.pathname, e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on our side. Please try again.' : e.message });
    }
  });
}
module.exports = { route, createServer };
