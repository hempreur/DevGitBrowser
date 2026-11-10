'use strict';
// Statistiques anonymes DevGitBrowser — uniquement après accord de l'utilisateur.
// Envoyé toutes les 30 min : identifiant aléatoire, version, pays de Windows,
// minutes d'utilisation et nombre de pages ouvertes. Jamais d'adresse de site.
const crypto = require('crypto');
const tls = require('tls');
const http = require('http');

const PING_EVERY = 30 * 60_000;
const newId = () => crypto.randomBytes(16).toString('hex');
const validId = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const osName = p => (p === 'win32' ? 'win' : p === 'darwin' ? 'mac' : p === 'linux' ? 'linux' : 'other');
function cleanUrl(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : ''; } catch { return ''; }
}

// Requête HTTPS vers un serveur au certificat auto-signé ÉPINGLÉ : la connexion est
// coupée avant tout envoi si l'empreinte SHA-256 du certificat ne correspond pas.
const cleanPin = v => (typeof v === 'string' ? v.replace(/[^a-f0-9]/gi, '').toLowerCase() : '');
function pinnedFetch(pin, url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const port = Number(u.port || 443);
    const sock = tls.connect({host: u.hostname, port, servername: /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false, ALPNProtocols: ['http/1.1']});
    const fail = e => { sock.destroy(); reject(e); };
    sock.setTimeout(15_000, () => fail(new Error('Délai dépassé')));
    sock.once('error', reject);
    sock.once('secureConnect', () => {
      const fp = String(sock.getPeerCertificate()?.fingerprint256 || '').replace(/:/g, '').toLowerCase();
      if (!fp || fp !== pin) return fail(new Error('Certificat du serveur inattendu (empreinte différente).'));
      const body = opts.body === undefined ? null : Buffer.from(String(opts.body));
      const headers = {host: u.host, ...(opts.headers || {}), ...(body ? {'content-length': body.length} : {})};
      const req = http.request({method: opts.method || 'GET', path: u.pathname + u.search, headers, createConnection: () => sock}, res => {
        const chunks = []; let size = 0;
        res.on('data', c => { size += c.length; if (size > 1_000_000) fail(new Error('Réponse trop grande')); else chunks.push(c); });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8'); sock.end();
          resolve({ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => JSON.parse(text), text: async () => text});
        });
      });
      req.on('error', reject);
      req.end(body || undefined);
    });
  });
}

class Telemetry {
  constructor({url, pin, fetcher, getSettings, version, country, platform, isActive}) {
    this.url = cleanUrl(url);
    const p = cleanPin(pin);
    this.fetcher = p.length === 64 ? (u, o) => pinnedFetch(p, u, o) : fetcher; this.getSettings = getSettings;
    this.version = version; this.country = country; this.platform = platform; this.isActive = isActive;
    this.minutes = 0; this.pages = 0; this.timer = null; this.tick = null; this.lastError = '';
  }
  get available() { return Boolean(this.url); }
  get enabled() { const s = this.getSettings(); return this.available && s.telemetry === true && validId(s.telemetryId); }
  start() {
    this.stop();
    this.tick = setInterval(() => { if (this.enabled && this.isActive()) this.minutes++; }, 60_000);
    this.timer = setInterval(() => this.ping().catch(() => {}), PING_EVERY);
    this.tick.unref?.(); this.timer.unref?.();
    setTimeout(() => this.ping().catch(() => {}), 20_000).unref?.();
  }
  stop() { clearInterval(this.tick); clearInterval(this.timer); this.tick = this.timer = null; }
  countPage() { if (this.enabled) this.pages = Math.min(this.pages + 1, 5000); }
  payload() {
    const cc = String(this.country() || '').toUpperCase();
    return {id: this.getSettings().telemetryId, v: this.version, cc: /^[A-Z]{2}$/.test(cc) ? cc : 'ZZ', os: osName(this.platform), min: Math.min(this.minutes, 120), pages: this.pages};
  }
  async post(path, body) {
    const res = await this.fetcher(this.url + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
    if (!res.ok) throw new Error('Serveur de statistiques : ' + res.status);
  }
  async ping() {
    if (!this.enabled) return false;
    const body = this.payload();
    try { await this.post('/v1/ping', body); this.minutes -= body.min; this.pages -= body.pages; this.lastError = ''; return true; }
    catch (e) { this.lastError = e.message; return false; }
  }
  async rate(stars) {
    if (!this.available) throw new Error('Notation indisponible dans cette version.');
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('Note invalide.');
    const s = this.getSettings();
    await this.post('/v1/rate', {id: validId(s.telemetryId) ? s.telemetryId : newId(), stars, v: this.version});
  }
  async adminStats(token) {
    if (!this.available) throw new Error('Aucun serveur de statistiques configuré.');
    const res = await this.fetcher(this.url + '/v1/stats', {headers: {authorization: 'Bearer ' + token}});
    if (res.status === 401) throw new Error('Jeton du serveur refusé.');
    if (!res.ok) throw new Error('Serveur de statistiques : ' + res.status);
    return res.json();
  }
}
module.exports = {Telemetry, newId, validId, cleanUrl, osName, pinnedFetch, cleanPin};
