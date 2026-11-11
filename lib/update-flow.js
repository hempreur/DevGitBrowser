'use strict';
// Parcours de mise à jour (v1.16).
//  • Pendant l'utilisation : notification Windows quand une nouvelle version est trouvée,
//    puis quand elle est prête (une seule fois par version), en plus du bandeau.
//  • Au lancement (navigateur pas utilisé depuis un moment) : une fenêtre s'ouvre, montre le
//    téléchargement et installe automatiquement la mise à jour au bout d'un court compte à rebours,
//    sauf si l'utilisateur choisit « Plus tard ».
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
    if (this.inStartupPhase() && this.windowFor !== v) {
      this.windowFor = v; this.windowOpen = true;
      this.openWindow(state);
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
