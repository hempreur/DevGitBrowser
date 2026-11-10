'use strict';
// DevGit Store : catalogue d'extensions hébergé sur le serveur DevGit (VPS).
// Format de paquet « dgx1 » : JSON {format, id, manifest, files:[{path, data(base64)}]}.
// Le catalogue donne l'empreinte SHA-256 de chaque paquet ; le navigateur la vérifie
// avant toute installation (et le canal HTTPS est lui-même épinglé).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIMITS = {files: 600, bytes: 20 * 1024 * 1024, file: 8 * 1024 * 1024, depth: 12};
const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const VERSION_RE = /^\d{1,5}(?:\.\d{1,5}){0,3}$/;
const SKIP = new Set(['node_modules', '.git', '.github', '.DS_Store', 'Thumbs.db']);

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const validId = id => typeof id === 'string' && ID_RE.test(id);
function slug(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'extension';
}
function validPath(p) {
  if (typeof p !== 'string' || !p || p.length > 200 || p.startsWith('/') || p.includes('\\') || p.includes('\0')) return false;
  const parts = p.split('/');
  if (parts.length > LIMITS.depth) return false;
  return parts.every(seg => seg && seg !== '.' && seg !== '..' && !seg.startsWith('.') && /^[A-Za-z0-9 _.()@+\-]+$/.test(seg));
}
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function checkManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest.json manquant ou illisible.');
  if (![2, 3].includes(m.manifest_version)) throw new Error('manifest.json : manifest_version 2 ou 3 attendu.');
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80) throw new Error('manifest.json : nom invalide.');
  if (!VERSION_RE.test(String(m.version || ''))) throw new Error('manifest.json : version invalide (ex. 1.0.0).');
  if (/^__MSG_/.test(m.name)) throw new Error('manifest.json : nom localisé (__MSG_) non pris en charge, indique un nom en clair.');
  return m;
}
// Résumé lisible des autorisations demandées (affiché avant l'installation).
function permissionsOf(m) {
  const list = [...(m.permissions || []), ...(m.host_permissions || []), ...(m.optional_permissions || [])].map(String);
  for (const cs of m.content_scripts || []) for (const u of cs.matches || []) list.push(String(u));
  return [...new Set(list)].slice(0, 40);
}

// ---- Création d'un paquet depuis un dossier (panneau admin)
function buildBundle(dir, wantedId) {
  const root = path.resolve(dir);
  const manifest = checkManifest(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')));
  const files = []; let total = 0;
  const walk = rel => {
    for (const ent of fs.readdirSync(path.join(root, rel), {withFileTypes: true})) {
      if (SKIP.has(ent.name) || ent.name.startsWith('.')) continue;
      const r = rel ? rel + '/' + ent.name : ent.name;
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { walk(r); continue; }
      if (!ent.isFile()) continue;
      if (!validPath(r)) throw new Error('Nom de fichier non pris en charge : ' + r);
      const data = fs.readFileSync(path.join(root, r));
      if (data.length > LIMITS.file) throw new Error('Fichier trop gros (8 Mo max) : ' + r);
      total += data.length;
      if (total > LIMITS.bytes) throw new Error('Extension trop grosse (20 Mo max).');
      if (files.length >= LIMITS.files) throw new Error('Trop de fichiers (600 max).');
      files.push({path: r, data: data.toString('base64')});
    }
  };
  walk('');
  const id = wantedId || slug(manifest.name);
  if (!validId(id)) throw new Error('Identifiant d’extension invalide.');
  return {format: 'dgx1', id, manifest, files};
}

// ---- Vérification et décompression d'un paquet (navigateur)
function parseBundle(buf, expectedSha, expectedId) {
  if (sha256(buf) !== expectedSha) throw new Error('Empreinte du paquet incorrecte : installation refusée.');
  const b = JSON.parse(buf.toString('utf8'));
  if (b?.format !== 'dgx1' || b.id !== expectedId || !Array.isArray(b.files)) throw new Error('Paquet d’extension invalide.');
  checkManifest(b.manifest);
  if (b.files.length > LIMITS.files) throw new Error('Paquet trop volumineux.');
  if (!b.files.some(f => f.path === 'manifest.json')) throw new Error('manifest.json absent du paquet.');
  let total = 0; const seen = new Set();
  for (const f of b.files) {
    if (!validPath(f.path) || seen.has(f.path.toLowerCase()) || typeof f.data !== 'string') throw new Error('Chemin de fichier refusé dans le paquet.');
    seen.add(f.path.toLowerCase());
    total += Math.floor(f.data.length * 3 / 4);
    if (total > LIMITS.bytes) throw new Error('Paquet trop volumineux.');
  }
  return b;
}
function unpack(bundle, destDir) {
  const root = path.resolve(destDir);
  fs.rmSync(root, {recursive: true, force: true});
  fs.mkdirSync(root, {recursive: true, mode: 0o700});
  for (const f of bundle.files) {
    const out = path.resolve(root, ...f.path.split('/'));
    if (!out.startsWith(root + path.sep)) throw new Error('Chemin de fichier refusé.');
    fs.mkdirSync(path.dirname(out), {recursive: true, mode: 0o700});
    fs.writeFileSync(out, Buffer.from(f.data, 'base64'), {mode: 0o600});
  }
  // Le manifest écrit sur disque doit être celui qui a été vérifié.
  checkManifest(JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')));
  return root;
}

module.exports = {LIMITS, sha256, validId, validPath, slug, compareVersions, checkManifest, permissionsOf, buildBundle, parseBundle, unpack};
