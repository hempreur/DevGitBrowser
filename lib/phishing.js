'use strict';
// Protection anti-hameçonnage et anti-logiciels malveillants : avant d'ouvrir une
// page, son domaine est comparé à des listes publiques mises à jour chaque jour
// (malware-filter : sites d'hameçonnage et URLhaus). Rien n'est envoyé à un tiers :
// la vérification est entièrement locale.
const fs = require('node:fs');
const path = require('node:path');

const SOURCES = Object.freeze([
  {id: 'phishing', urls: ['https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt', 'https://curbengh.github.io/phishing-filter/phishing-filter-hosts.txt']},
  {id: 'urlhaus', urls: ['https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt', 'https://curbengh.github.io/urlhaus-filter/urlhaus-filter-hosts.txt']}
]);
const MAX_DOMAINS = 600_000;
const UPDATE_MS = 24 * 60 * 60 * 1000;

function parseHosts(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const host = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase().replace(/\.$/, '');
    if (/^[a-z0-9.-]{3,253}$/.test(host) && host.includes('.') && !['localhost', '0.0.0.0'].includes(host)) out.push(host);
    if (out.length >= MAX_DOMAINS) break;
  }
  return out;
}
class PhishingGuard {
  constructor({dataFolder, fetcher, enabled = true, onState = () => {}, now = () => Date.now()}) {
    this.file = path.join(dataFolder, 'devgit-phishing-domains.txt');
    this.fetcher = fetcher; this.enabled = enabled; this.onState = onState; this.now = now;
    this.domains = new Set(); this.updatedAt = 0; this.error = ''; this.updating = null;
    this.allowedOnce = new Set();
  }
  state() { return {enabled: this.enabled, domains: this.domains.size, updatedAt: this.updatedAt || null, error: this.error}; }
  load() {
    try {
      const stat = fs.statSync(this.file);
      this.domains = new Set(fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean));
      this.updatedAt = stat.mtimeMs;
    } catch {}
    if (this.now() - this.updatedAt > UPDATE_MS) this.refresh().catch(() => {});
    return this.state();
  }
  refresh() {
    if (this.updating) return this.updating;
    this.updating = (async () => {
      const all = new Set(); let ok = 0;
      for (const source of SOURCES) {
        for (const url of source.urls) {
          try {
            const res = await this.fetcher(url);
            if (!res.ok) { try { await res.body?.cancel?.(); } catch {} continue; }
            const list = parseHosts(await res.text());
            if (list.length < 10) continue;
            for (const d of list) all.add(d);
            ok++; break;
          } catch {}
        }
      }
      if (!ok) throw new Error('Listes anti-hameçonnage indisponibles.');
      this.domains = all; this.updatedAt = this.now(); this.error = '';
      fs.mkdirSync(path.dirname(this.file), {recursive: true});
      fs.writeFileSync(this.file, [...all].join('\n'), {mode: 0o600});
    })().catch(err => { this.error = err.message; }).finally(() => { this.updating = null; try { this.onState(this.state()); } catch {} });
    return this.updating;
  }
  // Renvoie le domaine listé correspondant (domaine exact ou parent), sinon ''.
  match(url) {
    if (!this.enabled || !this.domains.size) return '';
    let host;
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return ''; host = u.hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
    if (this.allowedOnce.has(host)) return '';
    const parts = host.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
      const candidate = parts.slice(i).join('.');
      if (this.domains.has(candidate)) return candidate;
    }
    return '';
  }
  allow(host) { if (host) this.allowedOnce.add(String(host).toLowerCase()); }
}
module.exports = {PhishingGuard, parseHosts, SOURCES};
