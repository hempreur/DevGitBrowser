#!/usr/bin/env node
'use strict';
// Serveur de statistiques DevGitBrowser — Node.js 18+, sans dépendance.
// Reçoit des mesures anonymes (aucune IP ni adresse de site n'est conservée)
// et les sert, agrégées, au panneau admin protégé par un jeton.
const http = require('http');
const https = require('https');
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
let db = {secret: crypto.randomBytes(32).toString('hex'), days: {}, users: {}, ratings: {}, referrals: {}};
try { db = {...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8'))}; } catch {}
db.referrals ||= {};
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
  const user = db.users[u]; user.last = k; user.cc = cc; user.v = v; user.at = Date.now();
  if (typeof body.rc === 'string' && REF_CODE.test(body.rc)) user.rc = body.rc;
  if (!d.users[u]) {
    d.users[u] = 1;
    d.countries[cc] = (d.countries[cc] || 0) + 1;
    d.versions[v] = (d.versions[v] || 0) + 1;
    d.os[os] = (d.os[os] || 0) + 1;
  }
  d.minutes += clean.num(body.min, 120);
  d.pages += clean.num(body.pages, 5000);
  dirty = true; bumpAdmin('stats'); return true;
}
function rate(body) {
  const id = clean.id(body.id), stars = Number(body.stars);
  if (!id || !Number.isInteger(stars) || stars < 1 || stars > 5) return false;
  db.ratings[anon(id)] = {stars, at: today(), v: clean.ver(body.v)};
  dirty = true; bumpAdmin('stats'); return true;
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
  // En ligne maintenant : ping reçu dans les 35 dernières minutes (un ping toutes les 30 min).
  const liveSince = Date.now() - 35 * 60_000, live = {};
  for (const u of Object.values(db.users)) if ((u.at || 0) >= liveSince) live[u.cc] = (live[u.cc] || 0) + 1;
  const refs = {};
  for (const r of Object.values(db.referrals)) refs[r.code] = (refs[r.code] || 0) + 1;
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
    live: {total: Object.values(live).reduce((a, b) => a + b, 0), countries: live},
    referrals: {total: Object.keys(db.referrals).length, top: Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 10)},
    bugs: bugs.length,
    daily: keys.slice(-30).map(k => ({day: k, users: Object.keys(db.days[k].users).length, hours: Math.round(db.days[k].minutes / 6) / 10, pages: db.days[k].pages})),
  };
}

function send(res, code, obj) {
  res.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
  res.end(obj === undefined ? '' : JSON.stringify(obj));
}
function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size <= limit) chunks.push(c); else if (size > limit + 65536) req.destroy(); });
    req.on('end', () => { if (size > limit) return reject(new Error('too large')); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function authorized(req) {
  const got = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(ADMIN_TOKEN);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ------------------------------------------------------------- DevGit Store
const STORE_DIR = path.join(DATA_DIR, 'store');
const PKG_DIR = path.join(STORE_DIR, 'pkg');
fs.mkdirSync(PKG_DIR, {recursive: true});
const CATALOG_FILE = path.join(STORE_DIR, 'catalog.json');
let catalog = {extensions: {}};
try { catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8')); } catch {}
const saveCatalog = () => { const tmp = CATALOG_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(catalog, null, 1)); fs.renameSync(tmp, CATALOG_FILE); };
const STORE_ID = /^[a-z0-9][a-z0-9-]{1,39}$/;
const storePath = p => typeof p === 'string' && p.length <= 200 && !p.startsWith('/') && !p.includes('\\') &&
  p.split('/').length <= 12 && p.split('/').every(seg => seg && seg !== '..' && !seg.startsWith('.') && /^[A-Za-z0-9 _.()@+\-]+$/.test(seg));
const text = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
function publish(bundle) {
  const m = bundle && bundle.manifest;
  if (bundle?.format !== 'dgx1' || !STORE_ID.test(bundle.id) || !Array.isArray(bundle.files) || !bundle.files.length || bundle.files.length > 600) throw new Error('paquet invalide');
  if (![2, 3].includes(m?.manifest_version) || typeof m.name !== 'string' || !/^\d{1,5}(\.\d{1,5}){0,3}$/.test(String(m.version))) throw new Error('manifest invalide');
  if (!bundle.files.every(f => storePath(f.path) && typeof f.data === 'string') || !bundle.files.some(f => f.path === 'manifest.json')) throw new Error('fichiers invalides');
  const buf = Buffer.from(JSON.stringify({format: 'dgx1', id: bundle.id, manifest: m, files: bundle.files.map(f => ({path: f.path, data: f.data}))}));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(path.join(PKG_DIR, bundle.id + '.json'), buf);
  const prev = catalog.extensions[bundle.id] || {};
  catalog.extensions[bundle.id] = {id: bundle.id, name: text(m.name, 80), version: String(m.version), description: text(m.description, 300),
    author: typeof m.author === 'string' ? text(m.author, 60) : '', manifest_version: m.manifest_version, size: buf.length, sha256: sha, updated: new Date().toISOString(),
    published: prev.published || new Date().toISOString(), installs: prev.installs || 0};
  saveCatalog();
  return catalog.extensions[bundle.id];
}
function publicCatalog() { return {extensions: Object.values(catalog.extensions).sort((a, b) => a.name.localeCompare(b.name))}; }


// ------------------------------------------------- Configuration distante (v1.17)
// Deux systèmes séparés :
//  • ARRÊT D'URGENCE : verrouillage TOTAL des navigateurs ciblés (toutes versions par défaut).
//    Enregistré ici, appliqué aux navigateurs ouverts (instantanément) et fermés (au lancement),
//    conservé par chaque navigateur jusqu'au déblocage. + coupure facultative de fonctions.
//  • MESSAGES EN DIRECT : envoyés immédiatement aux navigateurs OUVERTS (connexion d'écoute
//    /v1/live) ; jamais conservés pour les navigateurs fermés (durée de vie 10 min).
// Seuls la version et le pays de Windows sont reçus ; rien n'est enregistré sur les visiteurs.
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const FEATURES = ['store', 'preview', 'media', 'vpn', 'import', 'telemetry'];
const VERSION_SPEC = /^(\*|(?:(?:<=|>=|<|>|=)?\d{1,3}\.\d{1,3}\.\d{1,3})(?:\s*,\s*(?:<=|>=|<|>|=)?\d{1,3}\.\d{1,3}\.\d{1,3})*)$/;
let config = {lockdown: {active: false, versions: '', message: '', since: '', rev: 0}, features: []};
try {
  const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  if (raw.lockdown) config.lockdown = {...config.lockdown, ...raw.lockdown, active: raw.lockdown.active === true};
  config.features = (Array.isArray(raw.features) ? raw.features : Array.isArray(raw.kill?.features) ? raw.kill.features : []).filter(f => FEATURES.includes(f));
  // Ancienne configuration (1.13–1.16) : le blocage par version n'est PAS converti en verrouillage total.
} catch {}
const saveConfig = () => { const tmp = CONFIG_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(config, null, 1)); fs.renameSync(tmp, CONFIG_FILE); };
function cmpVersion(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}
// « * », « 1.12.0 », « <1.13.0 », « >=1.10.0, <1.12.0 » (toutes les conditions).
function versionMatches(spec, v) {
  spec = String(spec || '').trim();
  if (!spec) return false;
  if (spec === '*') return true;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v)) return false;
  return spec.split(',').every(part => {
    const m = part.trim().match(/^(<=|>=|<|>|=)?(\d{1,3}\.\d{1,3}\.\d{1,3})$/); if (!m) return false;
    const c = cmpVersion(v, m[2]);
    return {'<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0, '=': c === 0, undefined: c === 0}[m[1]];
  });
}
const lockApplies = v => config.lockdown.active === true && (config.lockdown.versions ? versionMatches(config.lockdown.versions, v) : true);
// rev : numéro de révision du verrou — le navigateur ignore une réponse plus ancienne que la dernière appliquée.
function publicLockdown(v) { const on = lockApplies(v); return {blocked: on, message: on ? config.lockdown.message : '', since: on ? config.lockdown.since : '', rev: Number(config.lockdown.rev) || 0}; }
function cleanLockdown(input) {
  const versions = text(input?.versions, 120);
  if (versions && !VERSION_SPEC.test(versions)) throw new Error('versions invalides (ex. « <1.17.0 » ou vide pour toutes)');
  const active = input?.active === true;
  // Révision basée sur l'horloge : toujours croissante, même si config.json est perdu.
  const rev = Math.max((Number(config.lockdown.rev) || 0) + 1, Date.now());
  return {active, versions, message: text(input?.message, 300), since: active ? (config.lockdown.active ? config.lockdown.since : new Date().toISOString()) : '', rev};
}
// Réponse de /v1/config. « kill » et « messages » restent pour les navigateurs 1.13–1.16 :
// ils affichent un bandeau et lancent la mise à jour, qui leur apporte le verrouillage total.
function publicConfig(v, cc) {
  v = clean.ver(v); cc = clean.cc(cc);
  const lock = publicLockdown(v);
  return {lockdown: lock, features: config.features,
    kill: {blocked: lock.blocked, message: lock.message, features: config.features}, messages: []};
}

// ---- Messages en direct (connexions d'écoute)
const LIVE_TTL = 10 * 60_000, LIVE_HOLD = 25_000, MAX_WAITERS = 20_000, MAX_WAITERS_PER_IP = 6;
// Version de l'API, lue par le navigateur pour signaler un serveur pas à jour (18 = DevGitBrowser 1.18).
const API_VERSION = 19;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
let liveSeq = Date.now(); // croissant même après un redémarrage du serveur
let liveItems = [];
const waiters = new Set();
function cleanMessage(m) {
  const msg = text(m?.text, 400); if (!msg) throw new Error('message vide');
  const versions = text(m?.versions, 120) || '*';
  if (!VERSION_SPEC.test(versions)) throw new Error('versions invalides pour le message');
  const url = text(m?.url, 300);
  if (url && !/^https:\/\/[^\s]+$/.test(url)) throw new Error('le lien du message doit commencer par https://');
  const countries = (Array.isArray(m?.countries) ? m.countries : String(m?.countries || '').split(','))
    .map(c => String(c).trim().toUpperCase()).filter(c => /^[A-Z]{2}$/.test(c)).slice(0, 50);
  return {text: msg, level: m?.level === 'alert' || m?.level === 'warning' ? 'alert' : 'info', versions, countries, url};
}
function messagesFor(after, v, cc) {
  const now = Date.now();
  return liveItems.filter(m => m.id > after && now - m.at < LIVE_TTL && versionMatches(m.versions, v) && (!m.countries.length || m.countries.includes(cc)))
    .map(({id, text: body, level, url, at}) => ({id, text: body, level, url, at}));
}
// ---- Nouvelle version publiée (v1.18.5) : le serveur surveille la dernière release GitHub (toutes les 2 min,
// requêtes conditionnelles ETag qui ne consomment pas le quota) et la pousse aussitôt aux navigateurs ouverts.
let latestRelease = '', latestEtag = '';
const RELEASES_URL = process.env.RELEASES_URL || 'https://api.github.com/repos/hempreur/DevGitBrowser/releases/latest';
function setLatestRelease(raw) {
  const v = String(raw?.tag_name || '').replace(/^v/, '');
  const ready = !raw?.draft && !raw?.prerelease && (Array.isArray(raw?.assets) ? raw.assets : []).some(a => a?.name === 'latest.yml');
  if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(v) || !ready || v === latestRelease) return false;
  latestRelease = v; wakeWaiters({force: true}); bumpAdmin('config');
  return true;
}
async function pollLatestRelease() {
  try {
    const r = await fetch(RELEASES_URL, {headers: {'user-agent': 'DevGit-Stats', accept: 'application/vnd.github+json', ...(latestEtag ? {'if-none-match': latestEtag} : {})}, signal: AbortSignal.timeout(15_000)});
    if (r.status === 304 || !r.ok) return;
    latestEtag = r.headers.get('etag') || '';
    setLatestRelease(await r.json());
  } catch {}
}
function liveBody(w) {
  return {cursor: liveSeq, latest: latestRelease, messages: w.after < 0 ? [] : messagesFor(w.after, w.v, w.cc), retracted: retractedSince(w.after),
    lockdown: publicLockdown(w.v), features: config.features, support: supportFor(w.chats)};
}
function releaseWaiter(w, body) {
  if (!waiters.has(w)) return false;
  waiters.delete(w); clearTimeout(w.timer);
  try { send(w.res, 200, body || liveBody(w)); } catch {}
  return true;
}
// Réveille les navigateurs en écoute concernés ; renvoie le nombre de messages remis.
function wakeWaiters({force = false} = {}) {
  let delivered = 0;
  for (const w of [...waiters]) {
    const body = liveBody(w);
    const lockChanged = body.lockdown.blocked !== w.lock;
    if (force || lockChanged || body.messages.length || body.retracted.length || body.support.length) { if (body.messages.length) delivered++; releaseWaiter(w, body); }
  }
  return delivered;
}
function liveRequest(req, res, ip) {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const w = {res, ip, after: /^\d{1,16}$/.test(q.get('after') || '') ? Number(q.get('after')) : -1,
    v: clean.ver(q.get('v')), cc: clean.cc(q.get('cc')), lock: q.get('lock') === '1', timer: null, chats: parseChats(q.get('chat'))};
  const body = liveBody(w);
  // Réponse immédiate : premier appel (curseur de départ), message en attente, verrou différent ou nouvelle réponse du support.
  if (w.after < 0 || body.messages.length || body.retracted.length || body.support.length || body.lockdown.blocked !== w.lock) return send(res, 200, body);
  let perIp = 0; for (const x of waiters) if (x.ip === ip) perIp++;
  if (waiters.size >= MAX_WAITERS || perIp >= MAX_WAITERS_PER_IP) return send(res, 200, body);
  waiters.add(w);
  w.timer = setTimeout(() => releaseWaiter(w), LIVE_HOLD);
  res.on('close', () => { waiters.delete(w); clearTimeout(w.timer); });
}
function postMessage(input) {
  const m = {...cleanMessage(input), id: ++liveSeq, at: Date.now()};
  liveItems = [...liveItems.filter(x => Date.now() - x.at < 24 * 3_600_000), m].slice(-100);
  const listening = waiters.size;
  m.delivered = wakeWaiters();
  bumpAdmin('messages');
  return {id: m.id, delivered: m.delivered, listening};
}
// Suppression d'un message envoyé : il disparaît aussi des navigateurs ouverts qui l'affichent.
let retracted = []; // [{id, at}]
function retractedSince(after) { if (after < 0) return []; const now = Date.now(); return retracted.filter(r => r.seq > after && now - r.at < LIVE_TTL).map(r => r.id); }
function deleteMessages(ids) {
  const set = new Set(ids); const before = liveItems.length;
  liveItems = liveItems.filter(m => !set.has(m.id));
  const now = Date.now();
  if (ids.length) { const seq = ++liveSeq; retracted = [...retracted.filter(r => now - r.at < LIVE_TTL), ...ids.map(id => ({id, seq, at: now}))].slice(-500); }
  // Les navigateurs en écoute reçoivent tout de suite la liste des messages retirés.
  wakeWaiters();
  bumpAdmin('messages');
  return before - liveItems.length;
}
// ---- Temps réel pour le panneau admin : chaque événement augmente « adminRev » et réveille les écoutes admin.
let adminRev = Date.now(); const adminEvents = []; const adminWaiters = new Set();
function bumpAdmin(kind) {
  adminRev++; adminEvents.push({rev: adminRev, kind}); if (adminEvents.length > 200) adminEvents.splice(0, adminEvents.length - 200);
  for (const w of [...adminWaiters]) releaseAdmin(w);
}
function adminWatchBody(after) { return {rev: adminRev, kinds: [...new Set(adminEvents.filter(e => e.rev > after).map(e => e.kind))], listening: waiters.size}; }
function releaseAdmin(w) { if (!adminWaiters.delete(w)) return; clearTimeout(w.timer); try { send(w.res, 200, adminWatchBody(w.after)); } catch {} }
function adminWatch(req, res) {
  const q = new URLSearchParams(req.url.split('?')[1] || '');
  const after = /^\d{1,16}$/.test(q.get('rev') || '') ? Number(q.get('rev')) : -1;
  if (after < 0 || after < adminRev) return send(res, 200, adminWatchBody(after < 0 ? adminRev : after));
  if (adminWaiters.size >= 50) return send(res, 200, adminWatchBody(after));
  const w = {res, after, timer: null}; adminWaiters.add(w);
  w.timer = setTimeout(() => releaseAdmin(w), LIVE_HOLD);
  res.on('close', () => { adminWaiters.delete(w); clearTimeout(w.timer); });
}
// Nombre de navigateurs ouverts : signalé à l'admin quand il change (au plus toutes les 5 s).
let lastListening = 0;
setInterval(() => { if (waiters.size !== lastListening) { lastListening = waiters.size; bumpAdmin('listening'); } }, 5_000).unref();
function adminConfig() {
  return {api: API_VERSION, latest: latestRelease, lockdown: config.lockdown, features: config.features, listening: waiters.size,
    recent: [...liveItems].reverse().slice(0, 30).map(({id, text: body, level, versions, countries, url, at, delivered}) => ({id, text: body, level, versions, countries, url, at, delivered}))};
}

// ------------------------------------------------- Rapports de bug (v1.13, avec accord)
const BUGS_FILE = path.join(DATA_DIR, 'bugs.json');
let bugs = [];
try { bugs = JSON.parse(fs.readFileSync(BUGS_FILE, 'utf8')); } catch {}
const saveBugs = () => { const tmp = BUGS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(bugs)); fs.renameSync(tmp, BUGS_FILE); };
function addBug(body) {
  const description = String(body?.text || '').replace(/\u0000/g, '').trim().slice(0, 3000);
  if (description.length < 5) return null;
  const bug = {id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), v: clean.ver(body.v), os: clean.os(body.os), cc: clean.cc(body.cc),
    text: description, contact: text(body.contact, 120), log: String(body.log || '').replace(/\u0000/g, '').slice(-60_000), status: 'new'};
  // Tchat de support (1.18+) : le navigateur garde une clé secrète ; seule son empreinte est stockée ici.
  if (/^[a-f0-9]{64}$/.test(String(body.chatKey || ''))) bug.chatKeyHash = sha256(body.chatKey);
  bugs.unshift(bug); bugs = bugs.slice(0, 500); saveBugs();
  bumpAdmin('bugs');
  return bug.id;
}
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');

// ------------------------------------------------- Tchat de support (v1.18)
// L'admin « prend en charge » un signalement : une discussion s'ouvre avec le navigateur qui l'a envoyé.
const CHAT_MAX = 300, CHAT_TEXT = 1000;
function parseChats(raw) {
  const out = [];
  for (const part of String(raw || '').split(',').slice(0, 5)) {
    const m = part.match(/^([a-f0-9]{64}):(\d{1,9})$/); if (m) out.push({hash: sha256(m[1]), seq: Number(m[2])});
  }
  return out;
}
function supportView(bug) {
  return {bugId: bug.id, open: bug.chat.open === true, seq: bug.chat.seq, messages: bug.chat.messages.map(({from, text: t, at}) => ({from, text: t, at})),
    subject: bug.text.slice(0, 140), openedAt: bug.chat.openedAt};
}
function supportFor(chats) {
  const out = [];
  for (const c of chats || []) {
    const bug = bugs.find(b => b.chatKeyHash && b.chatKeyHash === c.hash);
    if (bug?.chat && bug.chat.seq > c.seq) out.push(supportView(bug));
  }
  return out;
}
function chatChanged(bug) { bug.chat.seq++; saveBugs(); wakeWaiters(); bumpAdmin('support'); }
function supportPost(bug, from, raw) {
  const t = String(raw || '').replace(/\u0000/g, '').trim().slice(0, CHAT_TEXT);
  if (!t) throw new Error('message vide');
  if (!bug.chat || !bug.chat.open) throw new Error('discussion fermée');
  bug.chat.messages.push({from, text: t, at: new Date().toISOString()});
  if (bug.chat.messages.length > CHAT_MAX) bug.chat.messages.splice(0, bug.chat.messages.length - CHAT_MAX);
  if (from === 'user') bug.chat.unread = (bug.chat.unread || 0) + 1;
  chatChanged(bug);
}
const supportLimiter = new Map();
function limitedSupport(key) {
  const now = Date.now(), h = supportLimiter.get(key) || {n: 0, t: now};
  if (now - h.t > 60_000) { h.n = 0; h.t = now; }
  h.n++; supportLimiter.set(key, h); if (supportLimiter.size > 5000) supportLimiter.clear();
  return h.n > 20;
}

// ------------------------------------------------- Parrainage (v1.13)
const REF_CODE = /^[A-Z2-9]{8}$/;
function claimReferral(body) {
  const id = clean.id(body?.id), code = String(body?.code || '').toUpperCase();
  if (!id || !REF_CODE.test(code)) return 'invalid';
  const u = anon(id);
  if (db.referrals[u]) return 'already';
  if (db.users[u]?.rc === code) return 'self';
  db.referrals[u] = {code, at: today()}; dirty = true; bumpAdmin('stats'); return 'ok';
}
const referralCount = code => Object.values(db.referrals).filter(r => r.code === code).length;
const bugLimiter = new Map();
function limitedBug(ip) {
  const now = Date.now(), h = bugLimiter.get(ip) || {n: 0, t: now};
  if (now - h.t > 3_600_000) { h.n = 0; h.t = now; }
  h.n++; bugLimiter.set(ip, h); if (bugLimiter.size > 20_000) bugLimiter.clear();
  return h.n > 5;
}

const handler = async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (req.method === 'GET' && url === '/v1/store/catalog') return send(res, 200, publicCatalog());
    let m;
    if (req.method === 'GET' && (m = url.match(/^\/v1\/store\/package\/([a-z0-9-]{2,40})$/)) && catalog.extensions[m[1]]) {
      res.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'});
      return fs.createReadStream(path.join(PKG_DIR, m[1] + '.json')).pipe(res);
    }
    if (req.method === 'POST' && url === '/v1/store/installed') {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (limited(ip)) return send(res, 429, {error: 'rate'});
      const body = await readBody(req);
      const ext = catalog.extensions[String(body.id || '')];
      if (!ext) return send(res, 400, {error: 'invalid'});
      ext.installs = (ext.installs || 0) + 1; saveCatalog(); return send(res, 204);
    }
    if (req.method === 'POST' && url === '/v1/store/publish') {
      if (!authorized(req)) return send(res, 401, {error: 'unauthorized'});
      let body; try { body = await readBody(req, 30 * 1024 * 1024); } catch { return send(res, 413, {error: 'trop gros'}); }
      try { return send(res, 200, publish(body)); } catch (e) { return send(res, 400, {error: e.message}); }
    }
    if (req.method === 'DELETE' && (m = url.match(/^\/v1\/store\/([a-z0-9-]{2,40})$/))) {
      if (!authorized(req)) return send(res, 401, {error: 'unauthorized'});
      delete catalog.extensions[m[1]]; saveCatalog();
      try { fs.rmSync(path.join(PKG_DIR, m[1] + '.json'), {force: true}); } catch {}
      return send(res, 204);
    }
    // Le serveur est exposé directement (HTTPS 8443) : l'en-tête X-Forwarded-For n'est lu que derrière un proxy déclaré (TRUST_PROXY=1).
    const ipOf = () => String((TRUST_PROXY && req.headers['x-forwarded-for']) || req.socket.remoteAddress || '').split(',')[0].trim();
    if (req.method === 'GET' && url === '/v1/config') {
      const q = new URLSearchParams(req.url.split('?')[1] || '');
      return send(res, 200, publicConfig(q.get('v'), q.get('cc')));
    }
    if (req.method === 'GET' && url === '/v1/live') return liveRequest(req, res, ipOf());
    if (req.method === 'POST' && (m = url.match(/^\/v1\/support\/([a-f0-9]{16})\/messages$/))) {
      const b = await readBody(req, 8 * 1024);
      const bug = bugs.find(x => x.id === m[1]);
      if (!bug || !bug.chatKeyHash || !/^[a-f0-9]{64}$/.test(String(b?.key || '')) || sha256(b.key) !== bug.chatKeyHash) return send(res, 403, {error: 'forbidden'});
      if (limitedSupport(bug.id)) return send(res, 429, {error: 'trop de messages, patiente un peu'});
      try { supportPost(bug, 'user', b.text); return send(res, 200, supportView(bug)); } catch (e) { return send(res, 409, {error: e.message}); }
    }
    if (req.method === 'POST' && url === '/v1/bug') {
      if (limitedBug(ipOf())) return send(res, 429, {error: 'trop de rapports, réessaie plus tard'});
      let body; try { body = await readBody(req, 80 * 1024); } catch { return send(res, 413, {error: 'rapport trop gros'}); }
      const id = addBug(body); return id ? send(res, 200, {id}) : send(res, 400, {error: 'description trop courte'});
    }
    if (req.method === 'POST' && url === '/v1/referral/claim') {
      if (limited(ipOf())) return send(res, 429, {error: 'rate'});
      const r = claimReferral(await readBody(req));
      return r === 'ok' ? send(res, 204) : send(res, r === 'invalid' ? 400 : 409, {error: r});
    }
    if (req.method === 'GET' && (m = url.match(/^\/v1\/referral\/([A-Z2-9]{8})$/))) return send(res, 200, {count: referralCount(m[1])});
    if (url.startsWith('/v1/admin/')) {
      if (!authorized(req)) return send(res, 401, {error: 'unauthorized'});
      if (req.method === 'GET' && url === '/v1/admin/config') return send(res, 200, adminConfig());
      if (req.method === 'GET' && url === '/v1/admin/watch') return adminWatch(req, res);
      if (req.method === 'DELETE' && url === '/v1/admin/messages') return send(res, 200, {deleted: deleteMessages(liveItems.map(x => x.id)), ...adminConfig()});
      if (req.method === 'DELETE' && (m = url.match(/^\/v1\/admin\/messages\/(\d{1,16})$/))) return send(res, 200, {deleted: deleteMessages([Number(m[1])]), ...adminConfig()});
      if (req.method === 'DELETE' && url === '/v1/admin/bugs') {
        const q = new URLSearchParams(req.url.split('?')[1] || ''); const only = q.get('status');
        const before = bugs.length; bugs = only === 'fixed' ? bugs.filter(b => b.status !== 'fixed') : []; saveBugs(); bumpAdmin('bugs');
        return send(res, 200, {deleted: before - bugs.length});
      }
      if ((m = url.match(/^\/v1\/admin\/support\/([a-f0-9]{16})(?:\/(open|close|messages|read))?$/))) {
        const bug = bugs.find(b => b.id === m[1]); if (!bug) return send(res, 404, {error: 'not found'});
        const action = m[2] || '';
        if (req.method === 'GET' && !action) return send(res, 200, {...supportView(bug.chat ? bug : {...bug, chat: {open: false, seq: 0, messages: []}}), canChat: Boolean(bug.chatKeyHash), contact: bug.contact, v: bug.v, os: bug.os, cc: bug.cc, at: bug.at, status: bug.status});
        if (req.method !== 'POST') return send(res, 405, {error: 'method'});
        if (action === 'open') {
          if (!bug.chatKeyHash) return send(res, 409, {error: 'signalement envoyé par une version sans tchat (avant 1.18)'});
          bug.chat = bug.chat || {messages: [], seq: 0};
          bug.chat.open = true; bug.chat.openedAt = bug.chat.openedAt || new Date().toISOString(); bug.status = 'support';
          const welcome = text((await readBody(req, 4096))?.welcome, CHAT_TEXT);
          bug.chat.messages.push({from: 'system', text: 'open', at: new Date().toISOString()});
          if (welcome) bug.chat.messages.push({from: 'admin', text: welcome, at: new Date().toISOString()});
          chatChanged(bug); bumpAdmin('bugs');
          return send(res, 200, supportView(bug));
        }
        if (action === 'close') {
          if (!bug.chat) return send(res, 409, {error: 'aucune discussion'});
          bug.chat.open = false; bug.chat.messages.push({from: 'system', text: 'close', at: new Date().toISOString()}); bug.status = 'fixed';
          chatChanged(bug); bumpAdmin('bugs');
          return send(res, 200, supportView(bug));
        }
        if (action === 'read') { if (bug.chat) { bug.chat.unread = 0; saveBugs(); bumpAdmin('bugs'); } return send(res, 204); }
        if (action === 'messages') {
          try { supportPost(bug, 'admin', (await readBody(req, 8 * 1024))?.text); return send(res, 200, supportView(bug)); } catch (e) { return send(res, 409, {error: e.message}); }
        }
      }
      if (req.method === 'PUT' && url === '/v1/admin/lockdown') {
        try { config.lockdown = cleanLockdown(await readBody(req, 16 * 1024)); saveConfig(); wakeWaiters(); bumpAdmin('config'); return send(res, 200, adminConfig()); } catch (e) { return send(res, 400, {error: e.message}); }
      }
      if (req.method === 'PUT' && url === '/v1/admin/features') {
        const b = await readBody(req, 16 * 1024);
        config.features = (Array.isArray(b?.features) ? b.features : []).filter(f => FEATURES.includes(f)); saveConfig(); wakeWaiters({force: true}); bumpAdmin('config');
        return send(res, 200, adminConfig());
      }
      if (req.method === 'POST' && url === '/v1/admin/messages') {
        try { const r = postMessage(await readBody(req, 16 * 1024)); return send(res, 200, {...adminConfig(), ...r}); } catch (e) { return send(res, 400, {error: e.message}); }
      }
      if (req.method === 'GET' && url === '/v1/admin/bugs') return send(res, 200, {bugs: bugs.map(({chatKeyHash, chat, ...b}) => ({...b, canChat: Boolean(chatKeyHash), chatOpen: chat?.open === true, unread: chat?.unread || 0, chatCount: chat ? chat.messages.filter(x => x.from !== 'system').length : 0}))});
      if ((m = url.match(/^\/v1\/admin\/bugs\/([a-f0-9]{16})$/))) {
        const bug = bugs.find(b => b.id === m[1]); if (!bug) return send(res, 404, {error: 'not found'});
        if (req.method === 'DELETE') { bugs = bugs.filter(b => b !== bug); saveBugs(); bumpAdmin('bugs'); return send(res, 204); }
        if (req.method === 'PATCH') { const b = await readBody(req); if (['new', 'seen', 'fixed', 'support'].includes(b.status)) bug.status = b.status; saveBugs(); bumpAdmin('bugs'); return send(res, 200, bug); }
      }
      return send(res, 404, {error: 'not found'});
    }
    if (req.method === 'GET' && url === '/health') return send(res, 200, {ok: true, api: API_VERSION});
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
};
// HTTPS direct (certificat épinglé par le navigateur) si TLS_CERT / TLS_KEY sont fournis,
// sinon HTTP local derrière un proxy (Caddy…).
const TLS = process.env.TLS_CERT && process.env.TLS_KEY ? {cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY)} : null;
const server = TLS ? https.createServer(TLS, handler) : http.createServer(handler);
server.requestTimeout = 10_000; server.headersTimeout = 10_000;
if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`DevGit Stats en écoute sur ${TLS ? 'https' : 'http'}://${HOST}:${PORT}`));
  if (process.env.RELEASES_POLL !== '0') { pollLatestRelease(); setInterval(pollLatestRelease, 2 * 60_000).unref(); }
}
module.exports = {_setLatestRelease: setLatestRelease, _adminWaiters: () => adminWaiters, server, handler, publish, publicCatalog, ping, rate, stats, versionMatches, cleanLockdown, cleanMessage, publicConfig, postMessage, addBug, claimReferral, _db: () => db, _waiters: () => waiters, _setConfig: c => { config = c; }};
