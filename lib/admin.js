'use strict';
// Panneau admin DevGitBrowser (commande %AdminDBG%).
// Aucune clé en clair ici : seules les empreintes scrypt sont stockées.
const crypto = require('crypto');

const REPO = 'hempreur/DevGitBrowser';
// Clé d'origine remise au propriétaire lors de l'installation du panneau.
const ORIGINAL_KEY_HASH = 'scrypt$3aobrPBELytNKF+YlFs2mQ==$5K0me2p1o9W3bZTnP3nKun7Q3kuF+GfekdFs7RTK4Fk=';
// Les trois mots de sécurité, dans l'ordre (insensible à la casse et aux espaces).
const RECOVERY_HASH = 'scrypt$OdR+XUpKZUPgs5awnaiiug==$JFdn2G1b+6/Yn3FkMsTc7wtazWyiUGRR5EH6rhcwd6o=';
const SCRYPT = {N: 1 << 15, maxmem: 64 * 1024 * 1024};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ADMIN_COMMAND = /^\s*%AdminDBG%\s*$/i;

function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64') + '$' + crypto.scryptSync(String(secret), salt, 32, SCRYPT).toString('base64');
}
function verifySecret(secret, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = crypto.scryptSync(String(secret || ''), Buffer.from(salt, 'base64'), 32, SCRYPT);
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
function normalizeKey(key) {
  const raw = String(key || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('DGB') ? raw.slice(3) : raw;
  return body.length === 16 ? 'DGB-' + body.match(/.{4}/g).join('-') : String(key || '').trim();
}
function generateKey() {
  return 'DGB-' + [0, 1, 2, 3].map(() => Array.from(crypto.randomBytes(4), b => ALPHABET[b % 32]).join('')).join('-');
}
function recoveryPhrase(words) {
  return (Array.isArray(words) ? words : []).slice(0, 3).map(w => String(w || '').trim().toLowerCase()).join('|');
}
const isHash = v => typeof v === 'string' && /^scrypt\$[A-Za-z0-9+/=]{20,}\$[A-Za-z0-9+/=]{40,}$/.test(v);

// Verrou anti-essais : 5 erreurs -> 2 minutes, puis doublement.
function createLimiter() {
  let failures = 0, until = 0, penalty = 120_000;
  return {
    check() { if (Date.now() < until) throw new Error('Trop d’essais. Réessaie dans ' + Math.ceil((until - Date.now()) / 1000) + ' s.'); },
    fail() { if (++failures >= 5) { failures = 0; until = Date.now() + penalty; penalty = Math.min(penalty * 2, 3_600_000); } },
    ok() { failures = 0; penalty = 120_000; },
  };
}

// ---------------------------------------------------------------- statistiques
async function githubJson(fetcher, path) {
  const res = await fetcher('https://api.github.com/repos/' + REPO + path, {headers: {accept: 'application/vnd.github+json', 'user-agent': 'DevGitBrowser-Admin'}});
  if (res.status === 403 || res.status === 429) throw new Error('Limite de l’API GitHub atteinte, réessaie dans une heure.');
  if (!res.ok) throw new Error('GitHub a répondu ' + res.status + '.');
  return res.json();
}
function summarize(repo, releases) {
  const versions = releases.filter(r => !r.draft).map(r => {
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const sum = re => assets.filter(a => re.test(a.name)).reduce((n, a) => n + (Number(a.download_count) || 0), 0);
    return {tag: r.tag_name, date: r.published_at, installs: sum(/\.exe$/i), updateChecks: sum(/^latest\.yml$/i), updates: sum(/\.blockmap$/i)};
  });
  const total = k => versions.reduce((n, v) => n + v[k], 0);
  const latest = versions[0] || null;
  const days = latest ? Math.max(1, (Date.now() - Date.parse(latest.date)) / 86_400_000) : 1;
  return {
    fetchedAt: new Date().toISOString(),
    repo: {stars: repo.stargazers_count || 0, forks: repo.forks_count || 0, watchers: repo.subscribers_count || 0, openIssues: repo.open_issues_count || 0, url: repo.html_url},
    totals: {installs: total('installs'), updateChecks: total('updateChecks'), updates: total('updates'), releases: versions.length},
    // Chaque navigateur lancé vérifie latest.yml au démarrage puis toutes les 4 h :
    // c'est l'indicateur d'activité le plus fiable sans collecte de données.
    activity: latest ? {version: latest.tag, checksPerDay: Math.round(latest.updateChecks / days), sinceDays: Math.round(days * 10) / 10} : null,
    versions: versions.slice(0, 12),
  };
}
async function fetchStats(fetcher) {
  const [repo, releases] = await Promise.all([githubJson(fetcher, ''), githubJson(fetcher, '/releases?per_page=100')]);
  return summarize(repo, Array.isArray(releases) ? releases : []);
}

module.exports = {ADMIN_COMMAND, ORIGINAL_KEY_HASH, RECOVERY_HASH, hashSecret, verifySecret, normalizeKey, generateKey, recoveryPhrase, isHash, createLimiter, fetchStats, summarize};
