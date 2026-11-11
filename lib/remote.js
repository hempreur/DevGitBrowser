'use strict';
// Configuration distante DevGit (v1.13) : arrêt d'urgence d'une version boguée,
// fonctions coupées à distance et messages ciblés par version / pays.
// Seuls la version et le pays de Windows sont envoyés ; aucun identifiant.
const FEATURES = Object.freeze({
  store: 'Boutique d’extensions', preview: 'Aperçu des liens', media: 'Lecteur protégé',
  vpn: 'VPN', import: 'Import depuis un autre navigateur', telemetry: 'Statistiques anonymes'
});
const EVERY = 6 * 3_600_000;

function cleanRemote(raw) {
  const kill = raw && typeof raw.kill === 'object' ? raw.kill : {};
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  return {
    kill: {
      blocked: kill.blocked === true,
      message: String(kill.message || '').slice(0, 300),
      features: (Array.isArray(kill.features) ? kill.features : []).filter(f => Object.hasOwn(FEATURES, f))
    },
    messages: messages.slice(0, 10).filter(m => m && /^[a-z0-9-]{4,40}$/.test(String(m.id || '')) && m.text).map(m => ({
      id: String(m.id), text: String(m.text).slice(0, 400), level: m.level === 'warning' ? 'warning' : 'info',
      url: /^https:\/\/[^\s]{3,300}$/.test(String(m.url || '')) ? String(m.url) : ''
    }))
  };
}

class RemoteConfig {
  constructor({telemetry, version, country, onChange}) {
    this.telemetry = telemetry; this.version = version; this.country = country; this.onChange = onChange;
    this.state = cleanRemote({}); this.timer = null; this.lastError = ''; this.fetchedAt = 0;
  }
  disabled(feature) { return this.state.kill.features.includes(feature); }
  start() {
    this.stop();
    setTimeout(() => this.refresh().catch(() => {}), 8_000).unref?.();
    this.timer = setInterval(() => this.refresh().catch(() => {}), EVERY); this.timer.unref?.();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async refresh() {
    if (!this.telemetry?.available) return this.state;
    const cc = String(this.country() || '').toUpperCase();
    try {
      const raw = await this.telemetry.api(`/v1/config?v=${encodeURIComponent(this.version)}&cc=${/^[A-Z]{2}$/.test(cc) ? cc : 'ZZ'}`, {timeout: 15_000, maxBytes: 64 * 1024});
      const next = cleanRemote(raw);
      const changed = JSON.stringify(next) !== JSON.stringify(this.state);
      this.state = next; this.lastError = ''; this.fetchedAt = Date.now();
      if (changed) try { this.onChange(next); } catch {}
    } catch (e) { this.lastError = e.message; }
    return this.state;
  }
}

// ------------------------------------------------- Parrainage
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newRefCode(rand = require('crypto').randomInt) {
  let out = ''; for (let i = 0; i < 8; i++) out += REF_ALPHABET[rand(REF_ALPHABET.length)]; return out;
}
const validRefCode = c => typeof c === 'string' && /^[A-Z2-9]{8}$/.test(c);
// Badges selon le nombre de filleuls.
const BADGES = Object.freeze([
  {min: 25, id: 'legend', name: 'Légende DevGit', icon: '💎'},
  {min: 10, id: 'gold', name: 'Ambassadeur Or', icon: '🥇'},
  {min: 3, id: 'silver', name: 'Ambassadeur Argent', icon: '🥈'},
  {min: 1, id: 'bronze', name: 'Ambassadeur Bronze', icon: '🥉'}
]);
const badgeFor = n => BADGES.find(b => n >= b.min) || null;
const nextBadge = n => [...BADGES].reverse().find(b => n < b.min) || null;

// ------------------------------------------------- Journal joint aux rapports de bug
// Masque ce qui pourrait identifier l'utilisateur : chemins de profil Windows,
// adresses de sites (seule l'origine reste), adresses e-mail et IP.
function sanitizeLog(text, maxLines = 200) {
  return String(text || '').split(/\r?\n/).slice(-maxLines).join('\n')
    .replace(/([A-Za-z]:\\(?:Users|Documents and Settings)\\)[^\\\s"']+/gi, '$1***')
    .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1***')
    .replace(/\b(https?:\/\/[^/\s"'<>]+)[^\s"'<>]*/gi, '$1/…')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '*.*.*.*')
    .slice(-60_000);
}
module.exports = {RemoteConfig, cleanRemote, FEATURES, newRefCode, validRefCode, BADGES, badgeFor, nextBadge, sanitizeLog};
