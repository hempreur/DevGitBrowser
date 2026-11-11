'use strict';
// Configuration distante DevGit (v1.17) — deux systèmes séparés :
//  • ARRÊT D'URGENCE : verrouillage total décidé par l'éditeur. Lu au démarrage (/v1/config) et
//    reçu instantanément pendant l'utilisation (/v1/live). Le navigateur le garde sur le disque :
//    il reste bloqué au redémarrage et hors ligne, jusqu'à ce que le serveur confirme le déblocage.
//  • MESSAGES EN DIRECT : uniquement pour les navigateurs ouverts, reçus dès leur envoi grâce à une
//    connexion d'écoute (/v1/live) ; un navigateur qui démarre ne reçoit pas les anciens messages.
// Seuls la version et le pays de Windows sont envoyés ; aucun identifiant.
const FEATURES = Object.freeze({
  store: 'Boutique d’extensions', preview: 'Aperçu des liens', media: 'Lecteur protégé',
  vpn: 'VPN', import: 'Import depuis un autre navigateur', telemetry: 'Statistiques anonymes'
});
const CONFIG_EVERY = 30 * 60_000;          // vérification de secours de /v1/config
const LIVE_TIMEOUT = 40_000;               // le serveur répond au plus tard en 25 s
const RETRY = [5_000, 15_000, 30_000, 60_000];

const cleanFeatures = list => (Array.isArray(list) ? list : []).filter(f => Object.hasOwn(FEATURES, f));
function cleanLock(raw) {
  // Format 1.17 : {lockdown:{blocked,message}} ; secours : ancien champ kill.blocked.
  const l = raw && typeof raw.lockdown === 'object' ? raw.lockdown : null;
  return {blocked: l ? l.blocked === true : false, message: String(l?.message || '').slice(0, 300), since: String(l?.since || '').slice(0, 40), rev: Number.isSafeInteger(l?.rev) ? l.rev : 0};
}
function cleanMessages(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).filter(m => m && Number.isSafeInteger(m.id) && typeof m.text === 'string' && m.text.trim()).map(m => ({
    id: m.id, text: m.text.slice(0, 400), level: m.level === 'alert' ? 'alert' : 'info',
    url: /^https:\/\/[^\s]{3,300}$/.test(String(m.url || '')) ? String(m.url) : ''
  }));
}
// Compatibilité : ancienne fonction (tests 1.13).
function cleanRemote(raw) {
  return {lockdown: cleanLock(raw), features: cleanFeatures(raw?.features ?? raw?.kill?.features), kill: {blocked: cleanLock(raw).blocked, message: cleanLock(raw).message, features: cleanFeatures(raw?.features ?? raw?.kill?.features)}, messages: []};
}

class RemoteConfig {
  // onLock(lock, {reached}) : à chaque réponse du serveur (reached = true), ou au démarrage depuis le verrou local.
  // onMessage(msg) : message en direct reçu. onFeatures(list) : fonctions coupées modifiées.
  constructor({telemetry, version, country, onLock = () => {}, onMessage = () => {}, onFeatures = () => {}, initialLock = null}) {
    this.telemetry = telemetry; this.version = version; this.country = country;
    this.onLock = onLock; this.onMessage = onMessage; this.onFeatures = onFeatures;
    this.lock = initialLock ? {blocked: true, message: String(initialLock.message || ''), since: String(initialLock.since || ''), rev: Number(initialLock.rev) || 0} : {blocked: false, message: '', since: '', rev: 0};
    this.features = []; this.cursor = -1; this.running = false; this.timer = null; this.lastError = ''; this.reachedAt = 0; this.fails = 0;
  }
  disabled(feature) { return this.features.includes(feature); }
  query() {
    const cc = String(this.country() || '').toUpperCase();
    return `v=${encodeURIComponent(this.version)}&cc=${/^[A-Z]{2}$/.test(cc) ? cc : 'ZZ'}`;
  }
  apply(raw) {
    this.reachedAt = Date.now(); this.lastError = ''; this.fails = 0;
    const lock = cleanLock(raw), features = cleanFeatures(raw?.features);
    // Réponse plus ancienne que l'état déjà appliqué (requêtes croisées) : ignorée.
    if (lock.rev < this.lock.rev) return;
    this.lock = lock;
    try { this.onLock(lock, {reached: true}); } catch {}
    if (JSON.stringify(features) !== JSON.stringify(this.features)) { this.features = features; try { this.onFeatures(features); } catch {} }
  }
  async refresh() {
    if (!this.telemetry?.available) return this.lock;
    try { this.apply(await this.telemetry.api(`/v1/config?${this.query()}`, {timeout: 15_000, maxBytes: 64 * 1024})); }
    catch (e) { this.lastError = e.message; }
    return this.lock;
  }
  start() {
    if (this.running || !this.telemetry?.available) return;
    this.running = true;
    this.refresh().finally(() => this.listen());
    this.timer = setInterval(() => this.refresh().catch(() => {}), CONFIG_EVERY); this.timer.unref?.();
  }
  stop() { this.running = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
  // Boucle d'écoute : le serveur garde la requête ouverte jusqu'à un message, un changement
  // du verrou, ou 25 s ; on relance aussitôt. En cas d'erreur, nouvel essai progressif.
  async listen() {
    while (this.running) {
      try {
        const raw = await this.telemetry.api(`/v1/live?after=${this.cursor}&lock=${this.lock.blocked ? 1 : 0}&${this.query()}`, {timeout: LIVE_TIMEOUT, maxBytes: 128 * 1024});
        const first = this.cursor < 0;
        if (Number.isSafeInteger(raw?.cursor)) this.cursor = Math.max(this.cursor, raw.cursor);
        this.apply(raw);
        if (!first) for (const m of cleanMessages(raw?.messages)) { this.cursor = Math.max(this.cursor, m.id); try { this.onMessage(m); } catch {} }
      } catch (e) {
        this.lastError = e.message;
        const wait = RETRY[Math.min(this.fails++, RETRY.length - 1)];
        await new Promise(r => { const t = setTimeout(r, wait); t.unref?.(); });
      }
    }
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
module.exports = {RemoteConfig, cleanRemote, cleanLock, cleanMessages, FEATURES, newRefCode, validRefCode, BADGES, badgeFor, nextBadge, sanitizeLog};
