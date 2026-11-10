#!/usr/bin/env node
'use strict';
// Serveur de statistiques DevGitBrowser — Node.js 18+, sans dépendance.
// Reçoit des mesures anonymes (aucune IP ni adresse de site n'est conservée)
// et les sert, agrégées, au panneau admin protégé par un jeton.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_TOKEN = String(process.env.ADMIN_TOKEN || '');
const KEEP_DAYS = 400;
if (ADMIN_TOKEN.length < 24) { console.error('ADMIN_TOKEN manquant ou trop court.'); process.exit(1); }
fs.mkdirSync(DATA_DIR, {recursive: true});
const FILE = path.join(DATA_DIR, 'stats.json');

// L'identifiant envoyé par le navigateur est re-haché avec un secret du serveur :
// impossible de relier les données à une installation sans ce secret.
let db = {secret: crypto.randomBytes(32).toString('hex'), days: {}, users: {}, ratings: {}};
try { db = {...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8'))}; } catch {}
let dirty = false;
function save() {
  if (!dirty) return; dirty = false;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, FILE);
}
setInterval(save, 30_000).unref();
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { save(); } finally { process.exit(0); } });

const today = (d = new Date()) => d.toISOString().slice(0, 10);
const anon = id => crypto.createHmac('sha256', db.secret).update(String(id)).digest('hex').slice(0, 24);
function day(key) {
  return db.days[key] ||= {users: {}, minutes: 0, pages: 0, countries: {}, versions: {}, os: {}, newUsers: 0};
}
function prune() {
  const limit = today(new Date(Date.now() - KEEP_DAYS * 86_400_000));
  for (const k of Object.keys(db.days)) if (k < limit) delete db.days[k];
}
setInterval(prune, 6 * 3_600_000).unref();

// Limite simple par IP (en mémoire uniquement, jamais écrite sur disque).
const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = hits.get(ip) || {n: 0, t: now};
  if (now - h.t > 600_000) { h.n = 0; h.t = now; }
  h.n++; hits.set(ip, h);
  if (hits.size > 50_000) hits.clear();
  return h.n > 40;
}

const clean = {
  id: v => (typeof v === 'string' && /^[a-f0-9]{32}$/.test(v) ? v : null),
  cc: v => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : 'ZZ'),
  ver: v => (typeof v === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v) ? v : '?'),
  os: v => (['win', 'mac', 'linux'].includes(v) ? v : 'other'),
  num: (v, max) => (Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : 0),
};

function ping(body) {
  const id = clean.id(body.id); if (!id) return false;
  const u = anon(id), k = today(), d = day(k);
  const cc = clean.cc(body.cc), v = clean.ver(body.v), os = clean.os(body.os);
  if (!db.users[u]) { db.users[u] = {first: k}; d.newUsers++; }
  const user = db.users[u]; user.last = k; user.cc = cc; user.v = v;
  if (!d.users[u]) {
    d.users[u] = 1;
    d.countries[cc] = (d.countries[cc] || 0) + 1;
    d.versions[v] = (d.versions[v] || 0) + 1;
    d.os[os] = (d.os[os] || 0) + 1;
  }
  d.minutes += clean.num(body.min, 120);
  d.pages += clean.num(body.pages, 5000);
  dirty = true; return true;
}
function rate(body) {
  const id = clean.id(body.id), stars = Number(body.stars);
  if (!id || !Number.isInteger(stars) || stars < 1 || stars > 5) return false;
  db.ratings[anon(id)] = {stars, at: today(), v: clean.ver(body.v)};
  dirty = true; return true;
}

function stats() {
  const keys = Object.keys(db.days).sort();
  const lastN = n => keys.slice(-n).map(k => db.days[k]);
  const unique = list => { const s = new Set(); for (const d of list) for (const u of Object.keys(d.users)) s.add(u); return s.size; };
  const sum = (list, f) => list.reduce((n, d) => n + d[f], 0);
  const merge = (list, f) => { const out = {}; for (const d of list) for (const [k, n] of Object.entries(d[f])) out[k] = (out[k] || 0) + n; return out; };
  // Pays : utilisateurs uniques sur 30 jours (dernier pays connu de chaque utilisateur).
  const since30 = today(new Date(Date.now() - 30 * 86_400_000));
  const countries = {}, versions = {};
  for (const u of Object.values(db.users)) if (u.last >= since30) { countries[u.cc] = (countries[u.cc] || 0) + 1; versions[u.v] = (versions[u.v] || 0) + 1; }
  const ratings = Object.values(db.ratings);
  const dist = [1, 2, 3, 4, 5].map(n => ratings.filter(r => r.stars === n).length);
  const d30 = lastN(30);
  const t = db.days[today()];
  return {
    generatedAt: new Date().toISOString(),
    active: {today: t ? Object.keys(t.users).length : 0, week: unique(lastN(7)), month: unique(d30)},
    totalUsers: Object.keys(db.users).length,
    newUsers30: sum(d30, 'newUsers'),
    hours: {today: t ? Math.round(t.minutes / 6) / 10 : 0, month: Math.round(sum(d30, 'minutes') / 60)},
    pages: {today: t ? t.pages : 0, month: sum(d30, 'pages')},
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 25),
    versions: Object.entries(versions).sort((a, b) => b[1] - a[1]).slice(0, 10),
    os: merge(d30, 'os'),
    rating: {count: ratings.length, average: ratings.length ? Math.round(ratings.reduce((n, r) => n + r.stars, 0) / ratings.length * 10) / 10 : 0, distribution: dist},
    daily: keys.slice(-30).map(k => ({day: k, users: Object.keys(db.days[k].users).length, hours: Math.round(db.days[k].minutes / 6) / 10, pages: db.days[k].pages})),
  };
}

function send(res, code, obj) {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size <= 2048) chunks.push(c); else if (size > 65536) req.destroy(); });
    req.on('end', () => { if (size > 2048) return reject(new Error('too large')); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function authorized(req) {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(ADMIN_TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/health') return send(res, 200, {ok: true});
    if (req.method === 'POST' && (url === '/v1/ping' || url === '/v1/rate')) {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, {error: 'rate'});
      const body = await readBody(req);
      return (url === '/v1/ping' ? ping(body) : rate(body)) ? send(res, 204) : send(res, 400, {error: 'invalid'});
    }
    if (req.method === 'GET' && url === '/v1/stats') {
      if (!authorized(req)) return send(res, 401, {error: 'unauthorized'});
      return send(res, 200, stats());
    }
    send(res, 404, {error: 'not found'});
  } catch { send(res, 400, {error: 'invalid'}); }
});
server.requestTimeout = 10_000; server.headersTimeout = 10_000;
if (require.main === module) server.listen(PORT, HOST, () => console.log(`DevGit Stats en écoute sur ${HOST}:${PORT}`));
module.exports = {server, ping, rate, stats, _db: () => db};
