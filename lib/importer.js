'use strict';
// Import des favoris et de l'historique depuis les autres navigateurs installés.
// Lecture seule : les fichiers sont copiés dans un dossier temporaire avant lecture
// (ils sont verrouillés quand l'autre navigateur est ouvert), puis la copie est supprimée.
// Les mots de passe ne sont PAS lus ici : Chrome et Edge les protègent par un chiffrement
// lié à leur propre programme (anti-voleurs de mots de passe). L'import passe par
// l'export CSV officiel de chaque navigateur (voir vault.importCsv).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 1601-01-01 → 1970-01-01 en microsecondes (horodatage WebKit/Chromium).
const WEBKIT_EPOCH_OFFSET_US = 11644473600000000n;
const webkitToMs = us => { try { const v = BigInt(us); return v > WEBKIT_EPOCH_OFFSET_US ? Number((v - WEBKIT_EPOCH_OFFSET_US) / 1000n) : 0; } catch { return 0; } };

function chromiumBrowsers(env = process.env) {
  const local = env.LOCALAPPDATA || '', roaming = env.APPDATA || '';
  return [
    {id: 'chrome', name: 'Google Chrome', root: path.join(local, 'Google', 'Chrome', 'User Data')},
    {id: 'edge', name: 'Microsoft Edge', root: path.join(local, 'Microsoft', 'Edge', 'User Data')},
    {id: 'brave', name: 'Brave', root: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')},
    {id: 'vivaldi', name: 'Vivaldi', root: path.join(local, 'Vivaldi', 'User Data')},
    {id: 'opera', name: 'Opera', root: path.join(roaming, 'Opera Software', 'Opera Stable'), flat: true},
    {id: 'operagx', name: 'Opera GX', root: path.join(roaming, 'Opera Software', 'Opera GX Stable'), flat: true}
  ];
}
function chromiumProfiles(browser) {
  if (!browser.root || !fs.existsSync(browser.root)) return [];
  if (browser.flat) return fs.existsSync(path.join(browser.root, 'Bookmarks')) || fs.existsSync(path.join(browser.root, 'History')) ? [{dir: browser.root, name: 'Profil principal'}] : [];
  let names = {};
  try { names = JSON.parse(fs.readFileSync(path.join(browser.root, 'Local State'), 'utf8'))?.profile?.info_cache || {}; } catch {}
  const dirs = fs.readdirSync(browser.root, {withFileTypes: true}).filter(d => d.isDirectory() && (d.name === 'Default' || /^Profile \d+$/.test(d.name))).map(d => d.name);
  return dirs.filter(d => fs.existsSync(path.join(browser.root, d, 'Bookmarks')) || fs.existsSync(path.join(browser.root, d, 'History')))
    .map(d => ({dir: path.join(browser.root, d), name: String(names[d]?.name || (d === 'Default' ? 'Profil principal' : d)).slice(0, 60)}));
}
function firefoxProfiles(env = process.env) {
  const base = path.join(env.APPDATA || '', 'Mozilla', 'Firefox', 'Profiles');
  if (!env.APPDATA || !fs.existsSync(base)) return [];
  return fs.readdirSync(base, {withFileTypes: true}).filter(d => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'places.sqlite')))
    .map(d => ({dir: path.join(base, d.name), name: d.name.replace(/^[a-z0-9]+\./, '')}));
}
// Liste des sources disponibles sur ce PC.
function detectSources(env = process.env) {
  const out = [];
  for (const b of chromiumBrowsers(env)) for (const p of chromiumProfiles(b)) out.push({id: `${b.id}:${path.basename(p.dir)}`, kind: 'chromium', browser: b.name, profile: p.name, dir: p.dir});
  for (const p of firefoxProfiles(env)) out.push({id: `firefox:${path.basename(p.dir)}`, kind: 'firefox', browser: 'Mozilla Firefox', profile: p.name, dir: p.dir});
  return out;
}

// ---- Favoris Chromium (fichier JSON « Bookmarks »)
function parseChromiumBookmarks(json) {
  const out = [];
  const walk = (node, folder) => {
    if (!node || out.length >= 1000) return;
    if (node.type === 'url' && /^https?:\/\//i.test(node.url || '')) out.push({url: node.url, title: String(node.name || ''), folder});
    for (const child of node.children || []) walk(child, node.type === 'folder' && node.name ? node.name : folder);
  };
  for (const root of Object.values(json?.roots || {})) walk(root, '');
  return out;
}

// ---- Lecture SQLite (historique Chromium, favoris/historique Firefox) sur une copie
function withSqliteCopy(file, fn) {
  let sqlite;
  try { sqlite = require('node:sqlite'); } catch { throw new Error('Lecture SQLite indisponible dans cette version.'); }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devgit-import-'));
  const copy = path.join(tmp, 'db.sqlite');
  try {
    fs.copyFileSync(file, copy);
    for (const ext of ['-wal', '-shm']) if (fs.existsSync(file + ext)) try { fs.copyFileSync(file + ext, copy + ext); } catch {}
    const db = new sqlite.DatabaseSync(copy, {readOnly: true});
    try { return fn(db); } finally { db.close(); }
  } finally { fs.rmSync(tmp, {recursive: true, force: true}); }
}
const bigints = stmt => { try { stmt.setReadBigInts(true); } catch {} return stmt; };
function chromiumHistory(dir, limit = 5000) {
  const file = path.join(dir, 'History');
  if (!fs.existsSync(file)) return [];
  // Horodatages Chromium (µs depuis 1601) > 2^53 : lecture en BigInt obligatoire.
  return withSqliteCopy(file, db => bigints(db.prepare("SELECT url, title, visit_count AS visits, last_visit_time AS t FROM urls WHERE hidden = 0 AND url LIKE 'http%' ORDER BY last_visit_time DESC LIMIT ?")).all(limit)
    .map(r => ({url: r.url, title: r.title || '', visits: Number(r.visits) || 1, visitedAt: webkitToMs(r.t)})));
}
function firefoxHistory(dir, limit = 5000) {
  return withSqliteCopy(path.join(dir, 'places.sqlite'), db => bigints(db.prepare("SELECT url, title, visit_count AS visits, last_visit_date AS t FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL AND url LIKE 'http%' ORDER BY last_visit_date DESC LIMIT ?")).all(limit)
    .map(r => ({url: r.url, title: r.title || '', visits: Number(r.visits) || 1, visitedAt: Number(BigInt(r.t) / 1000n)})));
}
function firefoxBookmarks(dir) {
  return withSqliteCopy(path.join(dir, 'places.sqlite'), db => db.prepare("SELECT p.url AS url, b.title AS title FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 AND p.url LIKE 'http%' ORDER BY b.dateAdded LIMIT 1000").all()
    .map(r => ({url: r.url, title: r.title || ''})));
}

// Import d'une source dans le stockage DevGit (favoris + historique).
function importFrom(source, browsing, {bookmarks = true, history = true} = {}) {
  if (!source || !fs.existsSync(source.dir)) throw new Error('Profil introuvable.');
  let bm = [], hi = [];
  if (source.kind === 'chromium') {
    if (bookmarks) try { bm = parseChromiumBookmarks(JSON.parse(fs.readFileSync(path.join(source.dir, 'Bookmarks'), 'utf8'))); } catch {}
    if (history) try { hi = chromiumHistory(source.dir); } catch {} // fichier verrouillé si le navigateur est ouvert
  } else if (source.kind === 'firefox') {
    if (bookmarks) try { bm = firefoxBookmarks(source.dir); } catch {}
    if (history) try { hi = firefoxHistory(source.dir); } catch {}
  }
  let addedBookmarks = 0;
  for (const b of bm) {
    if (browsing.isBookmarked(b.url)) continue;
    try { browsing.addBookmark(b.url, b.title); addedBookmarks++; } catch { break; }
  }
  const addedHistory = hi.length ? browsing.importHistory(hi) : 0;
  return {bookmarks: addedBookmarks, history: addedHistory};
}

// Page des réglages de mots de passe de chaque navigateur (pour l'export CSV).
const PASSWORD_EXPORT_HELP = Object.freeze({
  'Google Chrome': 'chrome://password-manager/settings → « Exporter les mots de passe »',
  'Microsoft Edge': 'edge://wallet/passwords → ⋯ → « Exporter les mots de passe »',
  'Brave': 'brave://password-manager/settings → « Exporter les mots de passe »',
  'Vivaldi': 'vivaldi://password-manager/settings → « Exporter les mots de passe »',
  'Opera': 'opera://password-manager/settings → « Exporter les mots de passe »',
  'Opera GX': 'opera://password-manager/settings → « Exporter les mots de passe »',
  'Mozilla Firefox': 'about:logins → ⋯ → « Exporter les identifiants »'
});

module.exports = {detectSources, importFrom, parseChromiumBookmarks, chromiumHistory, firefoxHistory, firefoxBookmarks, webkitToMs, PASSWORD_EXPORT_HELP};
