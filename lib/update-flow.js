'use strict';
// Parcours de mise à jour (v1.16).
//  • Dès qu'une nouvelle version est trouvée (1.18.5) : la fenêtre de mise à jour s'ouvre tout de suite,
//    une seule fois par version, et suit le téléchargement.
//  • Au lancement : l'installation se fait toute seule après un court compte à rebours.
//  • Pendant l'utilisation : pas d'installation automatique (on ne coupe pas un appel ou une webcam) :
//    « Installer maintenant » ou « Plus tard ». Une notification Windows accompagne la fenêtre.
const STARTUP_WINDOW_MS = 10 * 60_000;

class UpdateFlow {
  constructor({notify = () => {}, openWindow = () => {}, now = () => Date.now(), startupWindowMs = STARTUP_WINDOW_MS} = {}) {
    this.notify = notify; this.openWindow = openWindow; this.now = now;
    this.startedAt = now(); this.startupWindowMs = startupWindowMs;
    this.notified = new Set(); // « available:1.16.0 », « ready:1.16.0 »
    this.windowFor = '';       // version pour laquelle la fenêtre a déjà été ouverte
    this.windowOpen = false;
    this.postponed = new Set();
  }
  inStartupPhase() { return this.now() - this.startedAt < this.startupWindowMs; }
  setWindowOpen(open) { this.windowOpen = Boolean(open); }
  postpone(version) { if (version) this.postponed.add(version); }
  // Appelé à chaque changement d'état du service de mise à jour.
  handle(state) {
    const v = String(state?.version || '');
    const status = state?.status;
    if (!v || !['downloading', 'downloaded'].includes(status)) return null;
    if (this.windowOpen || this.postponed.has(v)) return null; // la fenêtre suit déjà, ou « Plus tard »
    if (this.windowFor !== v) {
      const autoInstall = this.inStartupPhase();
      this.windowFor = v; this.windowOpen = true;
      this.openWindow(state, {autoInstall});
      if (!autoInstall) { this.notified.add(`available:${v}`); this.notify('available', state); }
      return 'window';
    }
    const kind = status === 'downloaded' ? 'ready' : 'available';
    const key = `${kind}:${v}`;
    if (this.notified.has(key)) return null;
    this.notified.add(key);
    this.notify(kind, state);
    return kind;
  }
}
module.exports = {UpdateFlow, STARTUP_WINDOW_MS};
