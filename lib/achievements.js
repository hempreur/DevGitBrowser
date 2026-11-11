'use strict';
// Succès DevGitBrowser (v1.15) : statistiques 100 % locales (rien n'est envoyé),
// débloquées au fil de l'utilisation. Chaque succès : icône, catégorie, palier,
// objectif sur une statistique. Les succès « secrets » (mode DGBx) ne sont
// visibles et annoncés que depuis le mode DGBx.
const TIERS = Object.freeze({bronze: 10, silver: 25, gold: 50, platinum: 100});
const CATEGORIES = Object.freeze([
  {id: 'time', icon: '⏳', fr: 'Temps', en: 'Time'},
  {id: 'protection', icon: '🛡️', fr: 'Protection', en: 'Protection'},
  {id: 'explore', icon: '🧭', fr: 'Exploration', en: 'Exploration'},
  {id: 'security', icon: '🔐', fr: 'Sécurité', en: 'Security'},
  {id: 'community', icon: '🤝', fr: 'Communauté', en: 'Community'},
  {id: 'secret', icon: '🎭', fr: 'Secret', en: 'Secret'}
]);
const RANKS = Object.freeze([
  {min: 0, icon: '🌱', fr: 'Novice', en: 'Rookie'},
  {min: 100, icon: '🧭', fr: 'Explorateur', en: 'Explorer'},
  {min: 300, icon: '⚔️', fr: 'Aventurier', en: 'Adventurer'},
  {min: 700, icon: '🏅', fr: 'Expert', en: 'Expert'},
  {min: 1200, icon: '👑', fr: 'Maître DevGit', en: 'DevGit Master'},
  {min: 1800, icon: '💎', fr: 'Légende', en: 'Legend'}
]);
// [id, icône, catégorie, palier, statistique, objectif, nom FR, description FR, nom EN, description EN]
const DEFS = [
  ['first_steps', '👣', 'time', 'bronze', 'minutes', 10, 'Premiers pas', 'Navigue 10 minutes avec DevGitBrowser.', 'First steps', 'Browse for 10 minutes with DevGitBrowser.'],
  ['hour_one', '⏱️', 'time', 'bronze', 'minutes', 60, 'Une heure de surf', 'Passe 1 heure sur le navigateur.', 'One hour of surfing', 'Spend 1 hour in the browser.'],
  ['ten_hours', '⌛', 'time', 'silver', 'minutes', 600, 'Dix heures au compteur', 'Passe 10 heures sur le navigateur.', 'Ten hours on the clock', 'Spend 10 hours in the browser.'],
  ['centurion', '🕰️', 'time', 'gold', 'minutes', 6000, 'Centurion', 'Passe 100 heures sur le navigateur.', 'Centurion', 'Spend 100 hours in the browser.'],
  ['marathon', '🏃', 'time', 'platinum', 'minutes', 30000, 'Marathonien', 'Passe 500 heures sur le navigateur.', 'Marathoner', 'Spend 500 hours in the browser.'],
  ['regular', '📅', 'time', 'silver', 'days', 7, 'Habitué', 'Utilise DevGitBrowser 7 jours différents.', 'Regular', 'Use DevGitBrowser on 7 different days.'],
  ['faithful', '💍', 'time', 'gold', 'days', 30, 'Fidèle', 'Utilise DevGitBrowser 30 jours différents.', 'Faithful', 'Use DevGitBrowser on 30 different days.'],
  ['streak7', '🔥', 'time', 'silver', 'bestStreak', 7, 'Série de feu', 'Utilise le navigateur 7 jours d’affilée.', 'On fire', 'Use the browser 7 days in a row.'],
  ['streak30', '☄️', 'time', 'gold', 'bestStreak', 30, 'Inarrêtable', 'Utilise le navigateur 30 jours d’affilée.', 'Unstoppable', 'Use the browser 30 days in a row.'],
  ['night_owl', '🦉', 'time', 'silver', 'nightMinutes', 60, 'Oiseau de nuit', 'Navigue 1 heure entre minuit et 5 h du matin.', 'Night owl', 'Browse for 1 hour between midnight and 5 a.m.'],
  ['early_bird', '🐦', 'time', 'bronze', 'morningMinutes', 30, 'Lève-tôt', 'Navigue 30 minutes entre 5 h et 7 h du matin.', 'Early bird', 'Browse for 30 minutes between 5 and 7 a.m.'],
  ['ads_100', '🛡️', 'protection', 'bronze', 'ads', 100, 'Bouclier levé', 'DevGitShield bloque 100 publicités et pisteurs.', 'Shield up', 'DevGitShield blocks 100 ads and trackers.'],
  ['ads_1k', '🧱', 'protection', 'silver', 'ads', 1000, 'Muraille', 'DevGitShield bloque 1 000 publicités et pisteurs.', 'Great wall', 'DevGitShield blocks 1,000 ads and trackers.'],
  ['ads_10k', '🏰', 'protection', 'gold', 'ads', 10000, 'Forteresse', 'DevGitShield bloque 10 000 publicités et pisteurs.', 'Fortress', 'DevGitShield blocks 10,000 ads and trackers.'],
  ['ads_100k', '🐉', 'protection', 'platinum', 'ads', 100000, 'Gardien légendaire', 'DevGitShield bloque 100 000 publicités et pisteurs.', 'Legendary guardian', 'DevGitShield blocks 100,000 ads and trackers.'],
  ['detective', '🕵️', 'protection', 'bronze', 'trackerReports', 5, 'Détective', 'Ouvre 5 fois le rapport « Qui me piste ? ».', 'Detective', 'Open the “Who’s tracking me?” report 5 times.'],
  ['incognito', '🌍', 'protection', 'silver', 'vpnMinutes', 60, 'Incognito', 'Navigue 1 heure sous VPN.', 'Incognito', 'Browse for 1 hour over the VPN.'],
  ['ghost', '🛰️', 'protection', 'gold', 'vpnMinutes', 600, 'Fantôme', 'Navigue 10 heures sous VPN.', 'Ghost', 'Browse for 10 hours over the VPN.'],
  ['private_tabs', '🕶️', 'protection', 'bronze', 'privateTabs', 10, 'Passe-muraille', 'Ouvre 10 onglets privés sous VPN.', 'Wall walker', 'Open 10 private tabs over the VPN.'],
  ['vault', '🔐', 'security', 'bronze', 'vaultCreated', 1, 'Coffre-fort', 'Crée ton coffre à mots de passe.', 'Safe keeper', 'Create your password vault.'],
  ['keyring', '🔑', 'security', 'silver', 'passwords', 10, 'Trousseau', 'Garde 10 identifiants dans ton coffre.', 'Key ring', 'Keep 10 logins in your vault.'],
  ['vigilant', '🔎', 'security', 'bronze', 'breachChecks', 1, 'Vigilant', 'Vérifie si tes mots de passe ont fuité.', 'Vigilant', 'Check whether your passwords have leaked.'],
  ['generator', '🎲', 'security', 'bronze', 'generated', 5, 'Imprévisible', 'Génère 5 mots de passe forts.', 'Unpredictable', 'Generate 5 strong passwords.'],
  ['autofill', '📇', 'security', 'bronze', 'profiles', 1, 'Formulaires express', 'Enregistre tes coordonnées pour le remplissage automatique.', 'Express forms', 'Save your details for autofill.'],
  ['explorer', '🧭', 'explore', 'bronze', 'pages', 100, 'Explorateur', 'Visite 100 pages.', 'Explorer', 'Visit 100 pages.'],
  ['globetrotter', '🗺️', 'explore', 'silver', 'pages', 1000, 'Globe-trotter', 'Visite 1 000 pages.', 'Globetrotter', 'Visit 1,000 pages.'],
  ['cartographer', '🌌', 'explore', 'gold', 'pages', 10000, 'Cartographe du web', 'Visite 10 000 pages.', 'Web cartographer', 'Visit 10,000 pages.'],
  ['collector', '⭐', 'explore', 'bronze', 'bookmarks', 10, 'Collectionneur', 'Ajoute 10 favoris.', 'Collector', 'Add 10 bookmarks.'],
  ['chameleon', '🎨', 'explore', 'silver', 'themes', 3, 'Caméléon', 'Essaie 3 thèmes différents.', 'Chameleon', 'Try 3 different themes.'],
  ['music_lover', '📻', 'explore', 'silver', 'radioMinutes', 60, 'Mélomane', 'Écoute la radio pendant 1 heure.', 'Music lover', 'Listen to the radio for 1 hour.'],
  ['dj', '🎧', 'explore', 'gold', 'radioMinutes', 600, 'DJ', 'Écoute la radio pendant 10 heures.', 'DJ', 'Listen to the radio for 10 hours.'],
  ['multitask', '📺', 'explore', 'bronze', 'pip', 5, 'Multitâche', 'Utilise le Picture-in-Picture 5 fois.', 'Multitasker', 'Use Picture-in-Picture 5 times.'],
  ['lynx', '👁️', 'explore', 'bronze', 'previews', 20, 'Œil de lynx', 'Ouvre 20 aperçus de liens.', 'Eagle eye', 'Open 20 link previews.'],
  ['juggler', '🗂️', 'explore', 'silver', 'maxTabs', 20, 'Jongleur', 'Garde 20 onglets ouverts en même temps.', 'Juggler', 'Keep 20 tabs open at the same time.'],
  ['gamer', '🎮', 'explore', 'silver', 'gamingMinutes', 120, 'Gamer', 'Joue 2 heures avec le mode gaming activé.', 'Gamer', 'Play for 2 hours with gaming mode on.'],
  ['polyglot', '🌐', 'explore', 'bronze', 'languages', 2, 'Polyglotte', 'Utilise l’interface dans 2 langues.', 'Polyglot', 'Use the interface in 2 languages.'],
  ['tinkerer', '🧩', 'explore', 'silver', 'extensions', 3, 'Bricoleur', 'Installe 3 extensions depuis la boutique.', 'Tinkerer', 'Install 3 extensions from the store.'],
  ['mover', '📥', 'explore', 'bronze', 'imports', 1, 'Déménageur', 'Importe tes données depuis un autre navigateur.', 'Mover', 'Import your data from another browser.'],
  ['ambassador', '📣', 'community', 'bronze', 'invites', 1, 'Ambassadeur', 'Partage ton lien d’invitation.', 'Ambassador', 'Share your invitation link.'],
  ['megaphone', '📢', 'community', 'silver', 'invites', 10, 'Porte-voix', 'Partage ton lien d’invitation 10 fois.', 'Megaphone', 'Share your invitation link 10 times.'],
  ['first_referral', '🤝', 'community', 'silver', 'referrals', 1, 'Premier filleul', 'Un ami installe DevGitBrowser avec ton code.', 'First referral', 'A friend installs DevGitBrowser with your code.'],
  ['recruiter', '👥', 'community', 'gold', 'referrals', 5, 'Recruteur', '5 amis installent DevGitBrowser avec ton code.', 'Recruiter', '5 friends install DevGitBrowser with your code.'],
  ['legend', '👑', 'community', 'platinum', 'referrals', 25, 'Légende DevGit', '25 amis installent DevGitBrowser avec ton code.', 'DevGit legend', '25 friends install DevGitBrowser with your code.'],
  ['critic', '🌟', 'community', 'bronze', 'rated', 1, 'Critique', 'Donne ta note à DevGitBrowser.', 'Critic', 'Rate DevGitBrowser.'],
  ['bug_hunter', '🐞', 'community', 'silver', 'bugs', 1, 'Chasseur de bugs', 'Envoie un rapport de bug.', 'Bug hunter', 'Send a bug report.'],
  ['connected', '💬', 'community', 'bronze', 'discord', 1, 'Connecté', 'Affiche DevGitBrowser sur ton profil Discord.', 'Connected', 'Show DevGitBrowser on your Discord profile.'],
  ['dgbx_first', '🗝️', 'secret', 'bronze', 'dgbxMinutes', 10, 'Initié', 'Passe 10 minutes dans le mode DGBx.', 'Initiate', 'Spend 10 minutes in DGBx mode.'],
  ['dgbx_hour', '🌙', 'secret', 'silver', 'dgbxMinutes', 60, 'Noctambule', 'Passe 1 heure dans le mode DGBx.', 'Night prowler', 'Spend 1 hour in DGBx mode.'],
  ['dgbx_10h', '🎭', 'secret', 'gold', 'dgbxMinutes', 600, 'Double vie', 'Passe 10 heures dans le mode DGBx.', 'Double life', 'Spend 10 hours in DGBx mode.']
];
const ACHIEVEMENTS = Object.freeze(DEFS.map(([id, icon, category, tier, stat, target, name, desc, nameEn, descEn]) =>
  Object.freeze({id, icon, category, tier, stat, target, name, desc, nameEn, descEn, points: TIERS[tier], secret: category === 'secret'})));
const STAT_KEYS = [...new Set(ACHIEVEMENTS.map(a => a.stat))];
const MINUTE_STATS = new Set(['minutes', 'nightMinutes', 'morningMinutes', 'vpnMinutes', 'radioMinutes', 'gamingMinutes', 'dgbxMinutes']);

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const prevDay = key => { const d = new Date(key + 'T12:00:00'); d.setDate(d.getDate() - 1); return dayKey(d); };

class Achievements {
  constructor({read = () => null, write = () => {}, now = () => new Date(), onUnlock = () => {}} = {}) {
    this.write = write; this.now = now; this.onUnlock = onUnlock; this.dirty = false;
    let raw = null; try { raw = read(); } catch {}
    const st = raw && typeof raw.stats === 'object' ? raw.stats : {};
    this.stats = {};
    for (const k of STAT_KEYS) this.stats[k] = Number.isFinite(st[k]) && st[k] >= 0 ? st[k] : 0;
    this.sets = {themes: new Set(), languages: new Set()};
    for (const k of Object.keys(this.sets)) if (Array.isArray(raw?.sets?.[k])) for (const v of raw.sets[k].slice(0, 50)) this.sets[k].add(String(v));
    this.days = Array.isArray(raw?.days) ? raw.days.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-400) : [];
    this.streak = Number.isFinite(raw?.streak) ? raw.streak : 0;
    this.unlocked = {};
    if (raw?.unlocked && typeof raw.unlocked === 'object') for (const a of ACHIEVEMENTS) if (typeof raw.unlocked[a.id] === 'string') this.unlocked[a.id] = raw.unlocked[a.id];
    this.unseen = new Set(Array.isArray(raw?.unseen) ? raw.unseen.filter(id => this.unlocked[id]) : []);
    this.syncDerived();
  }
  syncDerived() {
    this.stats.days = this.days.length;
    this.stats.themes = this.sets.themes.size;
    this.stats.languages = this.sets.languages.size;
  }
  // Compteurs d'événements.
  bump(stat, n = 1) {
    if (!STAT_KEYS.includes(stat) || !(n > 0)) return [];
    this.stats[stat] += n; this.dirty = true;
    return this.evaluate();
  }
  // Valeurs « au moins » (onglets ouverts, filleuls, identifiants…).
  atLeast(stat, value) {
    if (!STAT_KEYS.includes(stat) || !Number.isFinite(value) || value <= this.stats[stat]) return [];
    this.stats[stat] = value; this.dirty = true;
    return this.evaluate();
  }
  addDistinct(kind, value) {
    const set = this.sets[kind]; if (!set || !value || set.has(String(value)) || set.size >= 50) return [];
    set.add(String(value)); this.syncDerived(); this.dirty = true;
    return this.evaluate();
  }
  // Appelé chaque minute d'utilisation active.
  tickMinute({vpn = false, radio = false, gaming = false, dgbx = false} = {}) {
    const d = this.now(), today = dayKey(d), h = d.getHours();
    if (!this.days.includes(today)) {
      this.streak = this.days.length && this.days[this.days.length - 1] === prevDay(today) ? this.streak + 1 : 1;
      this.days.push(today); if (this.days.length > 400) this.days.shift();
      if (this.streak > this.stats.bestStreak) this.stats.bestStreak = this.streak;
    }
    this.stats.minutes++;
    if (h < 5) this.stats.nightMinutes++;
    else if (h < 7) this.stats.morningMinutes++;
    if (vpn) this.stats.vpnMinutes++;
    if (radio) this.stats.radioMinutes++;
    if (gaming) this.stats.gamingMinutes++;
    if (dgbx) this.stats.dgbxMinutes++;
    this.syncDerived(); this.dirty = true;
    return this.evaluate();
  }
  evaluate() {
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked[a.id] || this.stats[a.stat] < a.target) continue;
      this.unlocked[a.id] = this.now().toISOString(); this.unseen.add(a.id); fresh.push(a);
    }
    if (fresh.length) { this.dirty = true; try { this.onUnlock(fresh); } catch {} }
    return fresh;
  }
  markSeen(includeSecret = false) {
    for (const id of [...this.unseen]) if (includeSecret || !ACHIEVEMENTS.find(a => a.id === id)?.secret) this.unseen.delete(id);
    this.dirty = true;
  }
  points(includeSecret = false) {
    return ACHIEVEMENTS.filter(a => this.unlocked[a.id] && (includeSecret || !a.secret)).reduce((n, a) => n + a.points, 0);
  }
  rank(includeSecret = false) {
    const p = this.points(includeSecret);
    const i = RANKS.reduce((best, r, idx) => (p >= r.min ? idx : best), 0);
    return {...RANKS[i], points: p, next: RANKS[i + 1] || null};
  }
  // Vue publique : les secrets n'apparaissent que si includeSecret.
  summary({includeSecret = false} = {}) {
    const list = ACHIEVEMENTS.filter(a => includeSecret || !a.secret).map(a => ({
      id: a.id, icon: a.icon, category: a.category, tier: a.tier, points: a.points, name: a.name, desc: a.desc, secret: a.secret,
      target: a.target, value: Math.min(this.stats[a.stat], a.target), minutes: MINUTE_STATS.has(a.stat),
      unlockedAt: this.unlocked[a.id] || null, unseen: this.unseen.has(a.id)
    }));
    return {
      list, categories: CATEGORIES.filter(c => includeSecret || c.id !== 'secret'),
      unlocked: list.filter(a => a.unlockedAt).length, total: list.length,
      unseen: list.filter(a => a.unseen).length, rank: this.rank(includeSecret), ranks: RANKS,
      streak: this.streak, stats: {minutes: this.stats.minutes, pages: this.stats.pages, ads: this.stats.ads, days: this.stats.days, bestStreak: this.stats.bestStreak}
    };
  }
  toJSON() {
    return {v: 1, stats: this.stats, sets: {themes: [...this.sets.themes], languages: [...this.sets.languages]}, days: this.days, streak: this.streak, unlocked: this.unlocked, unseen: [...this.unseen]};
  }
  flush() { if (!this.dirty) return; this.dirty = false; try { this.write(this.toJSON()); } catch { this.dirty = true; } }
}
// Paires français → anglais pour le dictionnaire de l'interface.
function i18nPairs() {
  const out = {};
  for (const a of ACHIEVEMENTS) { out[a.name] = a.nameEn; out[a.desc] = a.descEn; }
  for (const c of CATEGORIES) out[c.fr] = c.en;
  for (const r of RANKS) out[r.fr] = r.en;
  return out;
}
module.exports = {Achievements, ACHIEVEMENTS, CATEGORIES, RANKS, TIERS, STAT_KEYS, i18nPairs, dayKey};
