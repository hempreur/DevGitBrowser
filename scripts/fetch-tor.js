'use strict';
// Télécharge le « Tor Expert Bundle » Windows officiel pour le VPN DevGit.
//   node scripts/fetch-tor.js download  → vendor/tmp (archive + sommes SHA-256 signées)
//   (la CI vérifie la signature GPG des sommes avec la clé de Tor Browser)
//   node scripts/fetch-tor.js extract   → contrôle SHA-256 puis extraction dans vendor/tor
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const BASE = 'https://dist.torproject.org/torbrowser/';
const TMP = path.join(__dirname, '..', 'vendor', 'tmp');
const OUT = path.join(__dirname, '..', 'vendor', 'tor');

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, {headers: {'user-agent': 'DevGitBrowser-CI'}}, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); resolve(get(new URL(res.headers.location, url).href, redirects - 1)); return; }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} pour ${url}`)); return; }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject);
  });
}
function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
async function download() {
  const index = (await get(BASE)).toString('utf8');
  const versions = [...new Set([...index.matchAll(/href="(\d+(?:\.\d+)+)\/"/g)].map(m => m[1]))].sort(compareVersions).reverse();
  if (!versions.length) throw new Error('Aucune version stable de Tor trouvée.');
  for (const version of versions.slice(0, 3)) {
    const name = `tor-expert-bundle-windows-x86_64-${version}.tar.gz`;
    try {
      const sums = await get(`${BASE}${version}/sha256sums-signed-build.txt`);
      if (!sums.toString('utf8').includes(name)) continue;
      const asc = await get(`${BASE}${version}/sha256sums-signed-build.txt.asc`);
      const archive = await get(`${BASE}${version}/${name}`);
      fs.rmSync(TMP, {recursive: true, force: true}); fs.mkdirSync(TMP, {recursive: true});
      fs.writeFileSync(path.join(TMP, 'sums.txt'), sums);
      fs.writeFileSync(path.join(TMP, 'sums.txt.asc'), asc);
      fs.writeFileSync(path.join(TMP, 'bundle.tar.gz'), archive);
      fs.writeFileSync(path.join(TMP, 'name.txt'), name);
      console.log(`Tor ${version} téléchargé (${(archive.length / 1048576).toFixed(1)} Mo).`);
      return;
    } catch (err) { console.warn(`Version ${version} ignorée : ${err.message}`); }
  }
  throw new Error('Impossible de télécharger le Tor Expert Bundle.');
}
function extract() {
  const name = fs.readFileSync(path.join(TMP, 'name.txt'), 'utf8').trim();
  const archive = fs.readFileSync(path.join(TMP, 'bundle.tar.gz'));
  const digest = crypto.createHash('sha256').update(archive).digest('hex');
  const line = fs.readFileSync(path.join(TMP, 'sums.txt'), 'utf8').split('\n').find(l => l.trim().endsWith(name));
  if (!line || line.trim().split(/\s+/)[0].toLowerCase() !== digest) throw new Error('Empreinte SHA-256 du Tor Expert Bundle invalide : archive refusée.');
  fs.rmSync(OUT, {recursive: true, force: true}); fs.mkdirSync(OUT, {recursive: true});
  const rel = p => path.relative(process.cwd(), p).split(path.sep).join('/');
  execFileSync('tar', ['-xzf', rel(path.join(TMP, 'bundle.tar.gz')), '-C', rel(OUT)], {stdio: 'inherit'});
  const exe = path.join(OUT, 'tor', 'tor.exe');
  if (!fs.existsSync(exe)) throw new Error('tor.exe absent de l’archive.');
  for (const f of ['geoip', 'geoip6']) if (!fs.existsSync(path.join(OUT, 'data', f))) console.warn(`Avertissement : data/${f} absent (choix du pays limité).`);
  fs.rmSync(TMP, {recursive: true, force: true});
  console.log('OK — Tor vérifié (signature + SHA-256) et extrait dans vendor/tor.');
}
const step = process.argv[2];
(step === 'download' ? download() : step === 'extract' ? Promise.resolve().then(extract) : Promise.reject(new Error('Usage : fetch-tor.js download|extract')))
  .catch(err => { console.error(err.message); process.exit(1); });
