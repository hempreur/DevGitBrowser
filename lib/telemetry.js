'use strict';
// Statistiques anonymes DevGitBrowser — uniquement après accord de l'utilisateur.
// Envoyé toutes les 30 min : identifiant aléatoire, version, pays de Windows,
// minutes d'utilisation et nombre de pages ouvertes. Jamais d'adresse de site.
const crypto = require('crypto');

const PING_EVERY = 30 * 60_000;
const newId = () => crypto.randomBytes(16).toString('hex');
const validId = v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const osName = p => (p === 'win32' ? 'win' : p === 'darwin' ? 'mac' : p === 'linux' ? 'linux' : 'other');
function cleanUrl(url) {
  try { const u = new URL(String(url || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.origin : ''; } catch { return ''; }
}

class Telemetry {
  constructor({url, fetcher, getSettings, version, country, platform, isActive}) {
    this.url = cleanUrl(url);
    this.fetcher = fetcher; this.getSettings = getSettings;
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
module.exports = {Telemetry, newId, validId, cleanUrl, osName};
