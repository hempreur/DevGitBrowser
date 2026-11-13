'use strict';
// Mises à jour automatiques depuis les releases GitHub publiques
// (hempreur/DevGitBrowser). L'installateur NSIS « par utilisateur » permet
// l'installation sans droits administrateur.
// Vérification de secours toutes les 30 min ; les nouvelles versions arrivent normalement tout de suite
// par le canal en direct du serveur (voir checkFor).
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

class UpdateService {
  constructor({app, onState = () => {}, enabled = true, force = false, loadUpdater = () => require('electron-updater').autoUpdater}) {
    this.app = app; this.force = Boolean(force); this.onState = onState; this.enabled = enabled; this.loadUpdater = loadUpdater;
    this.updater = null; this.timer = null;
    this.state = {status: app.isPackaged || force ? 'idle' : 'disabled', version: '', progress: 0, error: '', lastCheck: null,
      current: app.getVersion(), releaseNotes: '', auto: enabled};
  }
  set(patch) { this.state = {...this.state, ...patch}; try { this.onState(this.state); } catch {} }
  start() {
    if (!this.app.isPackaged && !this.force) { this.set({status: 'disabled', error: 'Mises à jour désactivées en mode développement.'}); return; }
    try { this.updater = this.loadUpdater(); }
    catch (err) { this.set({status: 'error', error: 'Module de mise à jour absent : ' + (err.message || err)}); return; }
    const u = this.updater;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.allowPrerelease = false;
    u.allowDowngrade = false;
    u.on('checking-for-update', () => this.set({status: 'checking', error: ''}));
    u.on('update-available', info => this.set({status: 'downloading', version: info?.version || '', progress: 0,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').slice(0, 1500) : ''}));
    u.on('update-not-available', () => this.set({status: 'none', lastCheck: Date.now()}));
    u.on('download-progress', p => this.set({status: 'downloading', progress: Math.max(0, Math.min(100, Math.round(p?.percent || 0)))}));
    u.on('update-downloaded', info => this.set({status: 'downloaded', version: info?.version || this.state.version, progress: 100, lastCheck: Date.now()}));
    u.on('error', err => this.set({status: 'error', error: String(err?.message || err).split('\n')[0].slice(0, 220), lastCheck: Date.now()}));
    if (this.enabled) {
      setTimeout(() => this.check().catch(() => {}), 5_000).unref?.();
      this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL_MS);
      this.timer.unref?.();
    }
  }
  setAuto(value) {
    this.enabled = Boolean(value);
    this.set({auto: this.enabled});
    if (!this.updater) return;
    this.updater.autoDownload = this.enabled;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.enabled) { this.timer = setInterval(() => this.check().catch(() => {}), CHECK_INTERVAL_MS); this.timer.unref?.(); }
  }
  async check() {
    if (!this.updater) throw new Error(this.state.error || 'Mises à jour indisponibles dans cette version.');
    if (['checking', 'downloading'].includes(this.state.status)) return this.state;
    this.updater.autoDownload = true;
    await this.updater.checkForUpdates();
    return this.state;
  }
  // Version annoncée par le serveur : on vérifie tout de suite si elle est plus récente que celle installée.
  checkFor(version) {
    if (!this.updater || !this.enabled || !newer(version, this.state.current)) return false;
    if (this.state.version === version && ['downloading', 'downloaded'].includes(this.state.status)) return false;
    this.check().catch(() => {});
    return true;
  }
  install() {
    if (!this.updater || this.state.status !== 'downloaded') throw new Error('Aucune mise à jour prête à installer.');
    setImmediate(() => this.updater.quitAndInstall(true, true));
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
function newer(a, b) {
  const pa = String(a || '').split('.').map(Number), pb = String(b || '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}
module.exports = {UpdateService, CHECK_INTERVAL_MS, newer};
