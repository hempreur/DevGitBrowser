'use strict';
const https = require('node:https');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_TREE_ENTRIES = 500;
const MAX_EXTENSION_FILES = 100;
const MAX_FILE_BYTES = 1_500_000;
const MAX_EXTENSION_BYTES = 12_000_000;
const MAX_EXTENSIONS = 20;

function cleanRepoName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name) || name === '.' || name === '..') throw new Error('Nom de dépôt GitHub invalide.');
  return name;
}
function cleanBranch(value) {
  const branch = String(value || '').trim();
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]{0,99}$/.test(branch) || branch.includes('..') || branch.includes('//') || branch.endsWith('/') || branch.includes('@{')) {
    throw new Error('Nom de branche invalide.');
  }
  return branch;
}
function groupExtensions(tree) {
  if (!tree || !Array.isArray(tree.tree) || tree.truncated) throw new Error('Arbre GitHub trop grand ou incomplet.');
  if (tree.tree.length > MAX_TREE_ENTRIES) throw new Error('Dépôt trop volumineux pour la synchronisation sûre.');
  const groups = new Map();
  for (const item of tree.tree) {
    if (!item || item.type !== 'blob') continue;
    const value = String(item.path || '');
    if (!value.startsWith('extensions/')) continue;
    // No symlinks, submodules, suspicious names, absolute paths, or traversal.
    if (!/^(extensions\/)([a-zA-Z0-9_-]{1,48})\/(.+)$/.test(value)) continue;
    const [, , key, remainder] = value.match(/^(extensions\/)([a-zA-Z0-9_-]{1,48})\/(.+)$/);
    const parts = remainder.split('/');
    if (parts.some(part => !/^[\w.\-@()+ ]{1,120}$/.test(part) || part === '..' || part === '.' || part.startsWith('.'))) continue;
    if (!['100644', '100755'].includes(String(item.mode))) continue;
    if (!/^[0-9a-f]{40}$/.test(String(item.sha))) throw new Error('Objet GitHub non valide.');
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_FILE_BYTES) throw new Error(`Fichier trop grand : ${value}`);
    if (!groups.has(key)) groups.set(key, []);
    const files = groups.get(key);
    files.push({ path: parts.join('/'), sha: item.sha, size: item.size });
    if (files.length > MAX_EXTENSION_FILES) throw new Error(`Extension trop volumineuse : ${key}`);
  }
  if (groups.size > MAX_EXTENSIONS) throw new Error('Trop d’extensions dans le dépôt.');
  for (const [key, files] of groups) {
    if (!files.some(item => item.path === 'manifest.json')) { groups.delete(key); continue; }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_EXTENSION_BYTES) throw new Error(`Extension trop volumineuse : ${key}`);
    files.sort((a,b) => a.path.localeCompare(b.path));
  }
  return groups;
}
function revision(files) {
  return crypto.createHash('sha256').update(files.map(f => `${f.path}:${f.sha}`).join('\n')).digest('hex').slice(0, 24);
}
function verifyPrivateOwnedRepo(user, repo) {
  if (!user || !Number.isSafeInteger(user.id) || !user.login) throw new Error('Compte GitHub non reconnu.');
  if (!repo || !Number.isSafeInteger(repo.id) || repo.owner?.id !== user.id || !repo.private) {
    throw new Error('Seul un dépôt PRIVÉ appartenant au compte GitHub connecté est accepté.');
  }
  if (!repo.permissions?.pull) throw new Error('Droit de lecture absent sur le dépôt.');
  return { owner: user.login, ownerId: user.id, repo: cleanRepoName(repo.name), repoId: repo.id };
}

function requestGitHub(endpoint, token, maxBytes = 5_000_000) {
  if (typeof token !== 'string' || !/^(github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)$/.test(token.trim())) {
    return Promise.reject(new Error('Jeton GitHub personnel invalide. Utilise un jeton à accès limité.'));
  }
  if (!/^\/[A-Za-z0-9_./%?=&-]+$/.test(endpoint) || endpoint.includes('..')) {
    return Promise.reject(new Error('Chemin API GitHub non autorisé.'));
  }
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', port: 443, path: endpoint, method: 'GET', timeout: 15000,
      headers: {
        Authorization: `Bearer ${token.trim()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'DevGitBrowser/1.0'
      }
    }, res => {
      let size = 0; const chunks = [];
      res.on('data', chunk => { size += chunk.length; if (size > maxBytes) res.destroy(new Error('Réponse GitHub trop volumineuse.')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        let obj;
        try { obj = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { reject(new Error('Réponse GitHub non JSON.')); return; }
        if (res.statusCode !== 200) {
          const explanation = [401,403].includes(res.statusCode) ? 'Accès refusé : vérifie ton jeton, ses permissions et son expiration.' : (obj.message || `Erreur GitHub ${res.statusCode}`);
          reject(new Error(explanation)); return;
        }
        resolve(obj);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Délai GitHub dépassé.')));
    req.on('error', reject); req.end();
  });
}

class GitHubAPI {
  constructor(token, request = requestGitHub) { this.token = token; this.request = request; }
  getUser() { return this.request('/user', this.token); }
  getRepo(owner, repo) { return this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(cleanRepoName(repo))}`, this.token); }
  async getTree(owner, repo, branch) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(cleanRepoName(repo))}`;
    const commit = await this.request(`${base}/commits/${encodeURIComponent(cleanBranch(branch))}`, this.token);
    const sha = commit?.commit?.tree?.sha;
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('Arbre GitHub indisponible.');
    return this.request(`${base}/git/trees/${sha}?recursive=1`, this.token);
  }
  async blob(owner, repo, sha) {
    if (!/^[0-9a-f]{40}$/.test(sha || '')) throw new Error('SHA de fichier invalide.');
    const obj = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(cleanRepoName(repo))}/git/blobs/${sha}`, this.token);
    if (obj.encoding !== 'base64' || typeof obj.content !== 'string') throw new Error('Format de fichier non pris en charge.');
    const b64 = obj.content.replace(/\s/g, '');
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_FILE_BYTES || buf.length !== obj.size) throw new Error('Fichier GitHub corrompu ou trop grand.');
    // Check the blob hash, including git object header, to ensure contents match the tree object.
    const calculated = crypto.createHash('sha1').update(Buffer.from(`blob ${buf.length}\0`)).update(buf).digest('hex');
    if (calculated !== sha) throw new Error('Empreinte du fichier GitHub incorrecte.');
    return buf;
  }
}

function extensionPath(root, key, revisionId, relative) {
  const base = path.resolve(root, key, revisionId);
  const dest = path.resolve(base, relative);
  if (!dest.startsWith(base + path.sep)) throw new Error('Chemin GitHub dangereux.');
  return dest;
}
module.exports = {
  GitHubAPI, cleanRepoName, cleanBranch, groupExtensions, revision, extensionPath,
  verifyPrivateOwnedRepo, requestGitHub, MAX_EXTENSION_BYTES
};
