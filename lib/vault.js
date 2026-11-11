'use strict';
// Coffre de mots de passe DevGitBrowser.
// - Clé dérivée du mot de passe maître avec scrypt (N=2^17, r=8, p=1) + sel aléatoire.
// - Contenu chiffré en AES-256-GCM (authentifié : toute modification est détectée).
// - Le fichier est en plus enveloppé par le chiffrement du compte Windows (DPAPI via
//   safeStorage) : copié sur un autre PC ou un autre compte, il est illisible même
//   avec le mot de passe maître.
// - Le mot de passe maître n'est jamais stocké ; la clé n'existe qu'en mémoire
//   pendant que le coffre est déverrouillé (verrouillage automatique).
const crypto = require('node:crypto');

const MAGIC = 'DGBVAULT2';
const KDF = Object.freeze({N: 1 << 17, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024});
const MIN_MASTER = 8;
const MAX_ENTRIES = 5000;
const AUTO_LOCK_MS = 15 * 60 * 1000;

// Asynchrone : ne bloque pas l'interface pendant la dérivation (~0,3 s).
function deriveKey(master, salt, params = KDF) {
  return new Promise((resolve, reject) => crypto.scrypt(String(master).normalize('NFKC'), salt, params.keylen, {N: params.N, r: params.r, p: params.p, maxmem: params.maxmem}, (err, key) => err ? reject(err) : resolve(key)));
}
function deriveKeySync(master, salt, params = KDF) {
  return crypto.scryptSync(String(master).normalize('NFKC'), salt, params.keylen, {N: params.N, r: params.r, p: params.p, maxmem: params.maxmem});
}
function seal(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(MAGIC));
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64')};
}
function open(key, box) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(MAGIC));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}
function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) return u.origin;
  } catch {}
  return '';
}
function siteKey(origin) {
  // Les identifiants de compte.google.com valent aussi pour accounts.google.com ? Non :
  // on reste strict sur l'origine exacte, plus le domaine enregistrable pour la recherche.
  try { const h = new URL(origin).hostname; const parts = h.split('.'); return parts.slice(-2).join('.'); } catch { return ''; }
}
function cleanText(value, max) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max); }
function masterStrength(pw) {
  const s = String(pw || '');
  let score = 0;
  if (s.length >= MIN_MASTER) score++;
  if (s.length >= 12) score++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
  if (/\d/.test(s)) score++;
  if (/[^A-Za-z0-9]/.test(s)) score++;
  return Math.min(4, score);
}
function generatePassword(length = 20, {symbols = true, digits = true} = {}) {
  const n = Math.max(12, Math.min(64, Number(length) || 20));
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', ...(digits ? ['23456789'] : []), ...(symbols ? ['!#$%&*+-=?@_~'] : [])];
  const all = sets.join('');
  const out = sets.map(set => set[crypto.randomInt(set.length)]);
  while (out.length < n) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

// ---- Import CSV (export Chrome / Edge / Firefox / Brave / Opera / Bitwarden…)
function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
    else field += c;
    if (rows.length > MAX_ENTRIES + 1) break;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some(v => v !== '')) rows.push(row); }
  return rows;
}
function csvCredentials(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('Fichier CSV vide ou illisible.');
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = names => head.findIndex(h => names.includes(h));
  const iUrl = col(['url', 'origin', 'login_uri', 'website', 'web site', 'uri', 'hostname']);
  const iUser = col(['username', 'login_username', 'login', 'user', 'email', 'user name']);
  const iPass = col(['password', 'login_password', 'pass']);
  const iNote = col(['note', 'notes', 'name', 'title']);
  if (iUrl < 0 || iPass < 0) throw new Error('Colonnes « url » et « password » introuvables : utilise l’export CSV des mots de passe de ton ancien navigateur.');
  return rows.slice(1).map(r => ({url: r[iUrl] || '', username: iUser >= 0 ? r[iUser] || '' : '', password: r[iPass] || '', note: iNote >= 0 ? r[iNote] || '' : ''}));
}
// ---- Have I Been Pwned (k-anonymat) : seuls les 5 premiers caractères de
// l'empreinte SHA-1 sont envoyés ; le mot de passe ne quitte jamais le PC.
async function pwnedCount(password, fetcher) {
  const sha = crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
  const res = await fetcher('https://api.pwnedpasswords.com/range/' + sha.slice(0, 5), {headers: {'Add-Padding': 'true'}});
  if (!res.ok) throw new Error('Service de vérification indisponible (' + res.status + ').');
  const suffix = sha.slice(5);
  for (const line of String(await res.text()).split(/\r?\n/)) {
    const [s, n] = line.split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}
// ---- Fiches de coordonnées pour le remplissage automatique des formulaires
const PROFILE_FIELDS = ['label', 'givenName', 'familyName', 'email', 'tel', 'organization', 'street', 'street2', 'postalCode', 'city', 'country'];
function cleanProfile(p = {}) {
  const out = {};
  for (const k of PROFILE_FIELDS) out[k] = cleanText(p[k], k === 'street' || k === 'street2' ? 200 : 120).trim();
  if (!out.label) out.label = [out.givenName, out.familyName].filter(Boolean).join(' ') || 'Mes coordonnées';
  return out;
}

class PasswordVault {
  constructor({read, write, protect = b => b, unprotect = b => b, now = () => Date.now(), kdf = KDF, autoLockMs = AUTO_LOCK_MS, onLock = () => {}}) {
    this.read = read; this.write = write; this.protect = protect; this.unprotect = unprotect; this.now = now;
    this.kdf = kdf; this.autoLockMs = autoLockMs; this.onLock = onLock;
    this.key = null; this.entries = null; this.never = []; this.profiles = null; this.lockTimer = null; this.failures = 0; this.blockedUntil = 0;
  }
  loadFile() {
    let raw;
    try { raw = this.read(); } catch { return null; }
    if (!raw || !raw.length) return null;
    const text = this.unprotect(raw).toString('utf8');
    const file = JSON.parse(text);
    if (file?.magic !== MAGIC || !file.salt || !file.box) throw new Error('Coffre de mots de passe corrompu.');
    return file;
  }
  exists() { try { return Boolean(this.loadFile()); } catch { return true; } }
  isUnlocked() { return Boolean(this.key); }
  status() { return {exists: this.exists(), unlocked: this.isUnlocked(), count: this.entries ? this.entries.length : null, autoLockMinutes: Math.round(this.autoLockMs / 60000)}; }
  touch() {
    if (this.lockTimer) clearTimeout(this.lockTimer);
    if (this.key && this.autoLockMs > 0) { this.lockTimer = setTimeout(() => this.lock(), this.autoLockMs); this.lockTimer.unref?.(); }
  }
  persist() {
    const salt = Buffer.from(this.file.salt, 'base64');
    const payload = JSON.stringify({entries: this.entries, never: this.never, profiles: this.profiles || []});
    const file = {magic: MAGIC, kdf: {N: this.kdf.N, r: this.kdf.r, p: this.kdf.p}, salt: salt.toString('base64'), box: seal(this.key, payload), updatedAt: this.now()};
    this.file = file;
    this.write(this.protect(Buffer.from(JSON.stringify(file), 'utf8')));
  }
  async create(master) {
    if (this.exists()) throw new Error('Un coffre existe déjà. Déverrouille-le avec ton mot de passe maître.');
    if (String(master || '').length < MIN_MASTER) throw new Error(`Le mot de passe maître doit contenir au moins ${MIN_MASTER} caractères.`);
    const salt = crypto.randomBytes(16);
    this.file = {salt: salt.toString('base64')};
    this.key = await deriveKey(master, salt, this.kdf);
    this.entries = []; this.never = []; this.profiles = [];
    this.persist(); this.touch();
    return this.status();
  }
  async unlock(master) {
    if (this.now() < this.blockedUntil) throw new Error(`Trop d’essais. Réessaie dans ${Math.ceil((this.blockedUntil - this.now()) / 1000)} s.`);
    const file = this.loadFile();
    if (!file) throw new Error('Aucun coffre : crée d’abord ton mot de passe maître.');
    const params = {...KDF, ...(file.kdf || {}), keylen: 32, maxmem: KDF.maxmem};
    const key = await deriveKey(master, Buffer.from(file.salt, 'base64'), params);
    let data;
    try { data = JSON.parse(open(key, file.box)); }
    catch {
      this.failures++;
      // Ralentit les attaques par essais successifs (en plus du coût de scrypt).
      if (this.failures >= 5) this.blockedUntil = this.now() + Math.min(300_000, 15_000 * 2 ** (this.failures - 5));
      throw new Error('Mot de passe maître incorrect.');
    }
    this.failures = 0; this.blockedUntil = 0;
    this.file = file; this.key = key; this.kdf = params;
    this.entries = Array.isArray(data.entries) ? data.entries.slice(0, MAX_ENTRIES) : [];
    this.never = Array.isArray(data.never) ? data.never.filter(o => typeof o === 'string').slice(0, 500) : [];
    this.profiles = Array.isArray(data.profiles) ? data.profiles.slice(0, 20).map(p => ({id: String(p.id || crypto.randomUUID()), ...cleanProfile(p)})) : [];
    this.touch();
    return this.status();
  }
  lock() {
    if (this.key) this.key.fill(0);
    this.key = null; this.entries = null; this.never = []; this.profiles = null;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
    try { this.onLock(); } catch {}
  }
  requireUnlocked() { if (!this.key) throw new Error('Coffre verrouillé : saisis ton mot de passe maître.'); this.touch(); }
  async changeMaster(oldMaster, newMaster) {
    await this.unlock(oldMaster);
    if (String(newMaster || '').length < MIN_MASTER) throw new Error(`Le nouveau mot de passe maître doit contenir au moins ${MIN_MASTER} caractères.`);
    const salt = crypto.randomBytes(16);
    this.key.fill(0);
    this.file = {salt: salt.toString('base64')};
    this.key = await deriveKey(newMaster, salt, KDF); this.kdf = KDF;
    this.persist();
    return this.status();
  }
  // Liste sans les mots de passe (affichage, recherche).
  list(query = '') {
    this.requireUnlocked();
    const q = String(query).toLowerCase();
    return this.entries.filter(e => !q || (e.origin + ' ' + e.username + ' ' + (e.note || '')).toLowerCase().includes(q))
      .map(({id, origin, username, note, updatedAt, lastUsed}) => ({id, origin, username, note, updatedAt, lastUsed}));
  }
  reveal(id) { this.requireUnlocked(); const e = this.entries.find(x => x.id === id); if (!e) throw new Error('Identifiant introuvable.'); return e.password; }
  forOrigin(url) {
    if (!this.key) return [];
    const origin = originOf(url);
    if (!origin) return [];
    this.touch();
    return this.entries.filter(e => e.origin === origin);
  }
  hasFor(url) { const origin = originOf(url); return Boolean(origin && this.key && this.entries.some(e => e.origin === origin)); }
  isNever(url) { const origin = originOf(url); return Boolean(origin && this.never.includes(origin)); }
  save({url, origin, username, password, note = ''}) {
    this.requireUnlocked();
    const o = origin ? originOf(origin) : originOf(url);
    if (!o) throw new Error('Seuls les sites HTTPS peuvent enregistrer des mots de passe.');
    const user = cleanText(username, 200).trim();
    const pass = String(password ?? '');
    if (!pass || pass.length > 1000) throw new Error('Mot de passe vide ou trop long.');
    let entry = this.entries.find(e => e.origin === o && e.username === user);
    const now = this.now();
    if (entry) { entry.password = pass; entry.updatedAt = now; if (note) entry.note = cleanText(note, 300); }
    else {
      if (this.entries.length >= MAX_ENTRIES) throw new Error('Coffre plein.');
      entry = {id: crypto.randomUUID(), origin: o, username: user, password: pass, note: cleanText(note, 300), createdAt: now, updatedAt: now, lastUsed: 0};
      this.entries.push(entry);
    }
    this.never = this.never.filter(x => x !== o);
    this.persist(); this.touch();
    return {id: entry.id, origin: o, username: user};
  }
  update(id, {username, password, note}) {
    this.requireUnlocked();
    const e = this.entries.find(x => x.id === id); if (!e) throw new Error('Identifiant introuvable.');
    if (username !== undefined) e.username = cleanText(username, 200).trim();
    if (password !== undefined) { if (!password) throw new Error('Mot de passe vide.'); e.password = String(password).slice(0, 1000); }
    if (note !== undefined) e.note = cleanText(note, 300);
    e.updatedAt = this.now(); this.persist();
  }
  remove(id) { this.requireUnlocked(); const before = this.entries.length; this.entries = this.entries.filter(e => e.id !== id); if (before !== this.entries.length) this.persist(); }
  markUsed(id) { const e = this.entries?.find(x => x.id === id); if (e) { e.lastUsed = this.now(); this.persist(); } }
  neverFor(url) { this.requireUnlocked(); const o = originOf(url); if (o && !this.never.includes(o)) { this.never.push(o); this.persist(); } }
  // Import d'un export CSV : les doublons (même site + même identifiant) sont mis à jour.
  importCsv(text) {
    this.requireUnlocked();
    const rows = csvCredentials(text);
    let added = 0, updated = 0, skipped = 0;
    const before = new Set(this.entries.map(e => e.origin + '\u0000' + e.username));
    const persist = this.persist; this.persist = () => {};
    try {
      for (const r of rows) {
        try {
          const res = this.save({url: r.url, username: r.username, password: r.password, note: r.note});
          if (before.has(res.origin + '\u0000' + res.username)) updated++; else { added++; before.add(res.origin + '\u0000' + res.username); }
        } catch { skipped++; }
      }
    } finally { this.persist = persist; }
    this.persist(); this.touch();
    return {added, updated, skipped, total: rows.length};
  }
  // Vérifie chaque mot de passe distinct auprès de Have I Been Pwned (k-anonymat).
  async breachCheck(fetcher, {concurrency = 4} = {}) {
    this.requireUnlocked();
    const byPass = new Map();
    for (const e of this.entries) { if (!byPass.has(e.password)) byPass.set(e.password, []); byPass.get(e.password).push(e.id); }
    const passwords = [...byPass.keys()], counts = new Map();
    let next = 0;
    const worker = async () => { while (next < passwords.length) { const p = passwords[next++]; counts.set(p, await pwnedCount(p, fetcher)); } };
    await Promise.all(Array.from({length: Math.min(concurrency, passwords.length)}, worker));
    const result = {};
    for (const [p, ids] of byPass) for (const id of ids) result[id] = counts.get(p) || 0;
    this.touch();
    return result;
  }
  listProfiles() { this.requireUnlocked(); return (this.profiles || []).map(p => ({...p})); }
  saveProfile(data) {
    this.requireUnlocked();
    this.profiles ||= [];
    const clean = cleanProfile(data);
    if (!clean.givenName && !clean.familyName && !clean.email && !clean.street) throw new Error('Renseigne au moins un nom, un e-mail ou une adresse.');
    const existing = data?.id && this.profiles.find(p => p.id === data.id);
    if (existing) Object.assign(existing, clean);
    else { if (this.profiles.length >= 20) throw new Error('20 fiches maximum.'); this.profiles.push({id: crypto.randomUUID(), ...clean}); }
    this.persist(); this.touch();
    return this.listProfiles();
  }
  removeProfile(id) { this.requireUnlocked(); this.profiles = (this.profiles || []).filter(p => p.id !== id); this.persist(); }
  // Mots de passe réutilisés ou faibles (audit local, rien n'est envoyé).
  audit() {
    this.requireUnlocked();
    const counts = new Map();
    for (const e of this.entries) counts.set(e.password, (counts.get(e.password) || 0) + 1);
    return this.entries.map(e => ({id: e.id, reused: counts.get(e.password) > 1, weak: masterStrength(e.password) < 3}));
  }
}
module.exports = {PasswordVault, originOf, siteKey, masterStrength, generatePassword, parseCsv, csvCredentials, pwnedCount, cleanProfile, PROFILE_FIELDS, MIN_MASTER, MAGIC, KDF, deriveKey, deriveKeySync, seal, open};
