'use strict';

// Lecteur protégé (DevGitMedia.exe) : même code d'application, mode dédié au streaming.
{
  const media = require('./lib/media-player');
  if (media.isMediaExecutable(process.execPath) || process.argv.includes('--devgit-media')) { media.run(); return; }
}

const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu, safeStorage, desktopCapturer, screen, shell, clipboard, powerMonitor, Notification, webContents: allWebContents } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {NetworkMonitor} = require('./lib/network-monitor');
const {AdBlockService} = require('./lib/adblocker');
const {DETECTOR_SOURCE,validateLegacyTarget} = require('./lib/legacy');
const {originOf, shouldAutoEmbed, encodeCommand, decodeEvent, requiresModernVideo, preserveIEInSession, legacyHostFilename} = require('./lib/legacy-embedded');
const { DEFAULT_PROXY, normalizeAddress, isWebUrl, normalizeProxy, proxyForElectron } = require('./lib/validation');
const { GitHubAPI, cleanRepoName, cleanBranch, groupExtensions, revision, extensionPath, verifyPrivateOwnedRepo } = require('./lib/github-source');
const { popupMode, PopupLimiter, parseOrigin } = require('./lib/popup-policy');
const { BUILTIN_KEYS, bundledDescriptor, reservedGitHubKey } = require('./lib/bundled-extensions');
const { BrowsingData } = require('./lib/browsing-data');
const { UpdateService } = require('./lib/updater');
const { cleanUserAgent, SEARCH_ENGINES, searchUrl, httpsUpgrade, isDangerousFile, externalProtocolAllowed, insertInMap, errorPage: errorPageFr, warningPage: warningPageFr, crashPage: crashPageFr, THEMES, LEGACY_THEMES, DNS_PROVIDERS, INTERNAL_HOST } = require('./lib/browser-utils');
// ======================================================== Langue de l'interface (v1.14)
const i18nCore = require('./ui/i18n.js');
const LANGUAGES = ['auto','fr','en'];
let i18nDict = null, i18nLang = 'fr', i18nTr = i18nCore.createTranslator({});
function loadI18nDict() { if (!i18nDict) { try { i18nDict = JSON.parse(fs.readFileSync(path.join(__dirname,'i18n','en.json'),'utf8')); } catch { i18nDict = {}; } i18nDict = {...require('./lib/achievements').i18nPairs(), ...i18nDict}; } return i18nDict; }
function effectiveLang() {
  const pref = settings?.language || 'auto';
  if (pref === 'fr' || pref === 'en') return pref;
  let loc = ''; try { loc = app.getPreferredSystemLanguages?.()[0] || app.getLocale(); } catch {}
  return /^fr\b/i.test(String(loc)) ? 'fr' : 'en';
}
function applyLanguage() {
  i18nLang = effectiveLang();
  i18nTr = i18nCore.createTranslator(i18nLang === 'en' ? loadI18nDict() : {});
}
const T = s => (i18nLang === 'en' ? i18nTr.t(s) : s);
const i18nPayload = () => ({lang: i18nLang, dict: i18nLang === 'en' ? loadI18nDict() : {}});
function broadcastLanguage() {
  const payload = i18nPayload();
  for (const wc of allWebContents.getAllWebContents()) {
    try { if (!wc.isDestroyed() && /^file:/i.test(wc.getURL())) wc.send('dgb-i18n:changed', payload); } catch {}
  }
}
// Pages d'erreur générées (data:) : textes traduits, balisage intact.
function translateDataPage(url) {
  if (i18nLang !== 'en') return url;
  const prefix = 'data:text/html;charset=utf-8,';
  if (!url.startsWith(prefix)) return url;
  return prefix + encodeURIComponent(i18nTr.html(decodeURIComponent(url.slice(prefix.length))));
}
const errorPage = o => translateDataPage(errorPageFr(o));
const warningPage = o => translateDataPage(warningPageFr(o));
const crashPage = o => translateDataPage(crashPageFr(o));
// Menus natifs et boîtes de dialogue : libellés traduits au moment de leur création.
function translateMenuTemplate(items) {
  return (items || []).map(it => {
    if (!it || typeof it !== 'object' || it instanceof Menu) return it;
    const out = {...it};
    if (typeof out.label === 'string') out.label = T(out.label);
    if (typeof out.sublabel === 'string') out.sublabel = T(out.sublabel);
    if (typeof out.toolTip === 'string') out.toolTip = T(out.toolTip);
    if (Array.isArray(out.submenu)) out.submenu = translateMenuTemplate(out.submenu);
    return out;
  });
}
{
  const build = Menu.buildFromTemplate.bind(Menu);
  Menu.buildFromTemplate = tpl => build(i18nLang === 'en' ? translateMenuTemplate(tpl) : tpl);
  const trOpts = o => {
    if (i18nLang !== 'en' || !o || typeof o !== 'object') return o;
    const c = {...o};
    for (const k of ['title','message','detail','checkboxLabel','buttonLabel','nameFieldLabel']) if (typeof c[k] === 'string') c[k] = T(c[k]);
    if (Array.isArray(c.buttons)) c.buttons = c.buttons.map(b => T(b));
    if (Array.isArray(c.filters)) c.filters = c.filters.map(f => ({...f, name: T(f.name)}));
    return c;
  };
  for (const fn of ['showMessageBox','showMessageBoxSync','showOpenDialog','showOpenDialogSync','showSaveDialog','showSaveDialogSync']) {
    const orig = dialog[fn].bind(dialog);
    dialog[fn] = (a, b) => (b === undefined ? orig(trOpts(a)) : orig(a, trOpts(b)));
  }
  const box = dialog.showErrorBox.bind(dialog);
  dialog.showErrorBox = (title, content) => box(T(title), T(content));
}
const { PasswordVault, generatePassword } = require('./lib/vault');
const importer = require('./lib/importer');
const trackerDb = require('./lib/trackers');
const remoteLib = require('./lib/remote');
const {UpdateFlow} = require('./lib/update-flow');
// ======================================================== Arrêt d'urgence : verrouillage total (v1.17)
// L'éditeur peut suspendre totalement le navigateur depuis son serveur. Le verrou est écrit sur le
// disque : il s'applique aux navigateurs ouverts (instantanément) et fermés (au lancement), tient au
// redémarrage et hors ligne, et ne se lève que lorsque le serveur confirme le déblocage.
// Exceptions : le PC administrateur (jeton du serveur enregistré) et une session déverrouillée avec la clé admin.
let locked = false, lockWin = null, lockInfo = {message: '', since: ''}, startupLock = null, lockActive = false, adminOverride = false;
function readLockdown() { const d = readJson('lockdown.json'); return d && d.blocked === true ? d : null; }
function writeLockdown(info) { try { writeAtomic(userDataFile('lockdown.json'), JSON.stringify({blocked: true, message: String(info.message || ''), since: String(info.since || ''), rev: Number(info.rev) || 0, at: new Date().toISOString()})); } catch {} }
function clearLockdown() { try { fs.rmSync(userDataFile('lockdown.json'), {force: true}); } catch {} }
const lockExempt = () => adminOverride || Boolean(readStatsToken());
function sendLockStatus(state, extra = {}) { if (lockWin && !lockWin.isDestroyed()) lockWin.webContents.send('dgb-lock:status', {state, info: {message: lockInfo.message, version: app.getVersion()}, ...extra}); }
function openLockWindow() {
  if (lockWin && !lockWin.isDestroyed()) { if (lockWin.isMinimized()) lockWin.restore(); lockWin.show(); lockWin.focus(); return; }
  lockWin = new BrowserWindow({width: 640, height: 660, resizable: false, maximizable: false, fullscreenable: false,
    title: T('DevGitBrowser — Accès suspendu'), icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#0a0a1e', show: false, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'ui', 'lock', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
  lockWin.setMenu(null);
  lockWin.webContents.on('will-navigate', e => e.preventDefault());
  lockWin.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  lockWin.once('ready-to-show', () => { lockWin.show(); lockWin.focus(); });
  // Fermer la fenêtre revient à quitter ; au prochain lancement, le verrou local re-bloque l'accès.
  lockWin.on('closed', () => { lockWin = null; if (locked && !quitting) { quitting = true; app.quit(); } });
  lockWin.loadFile(path.join(__dirname, 'ui', 'lock', 'index.html'));
}
// Applique le verrou : tout est fermé (fenêtres, aperçu, radio, VPN) après sauvegarde des onglets.
function engageLockdown(info) {
  lockActive = true;
  lockInfo = {message: String(info?.message || ''), since: String(info?.since || ''), rev: Number(info?.rev) || 0};
  writeLockdown(lockInfo);
  if (lockExempt()) { broadcast(); return; }
  if (locked) { sendLockStatus('still'); return; }
  locked = true;
  logger.warn('Arrêt d’urgence : verrouillage total engagé');
  // Onglets sauvegardés pour être rouverts au déblocage (même si « Rouvrir les onglets » est désactivé).
  try { if (windows.size) { settings.restoreAfterUpdate = true; saveSettings(); saveSessionNow(); } } catch {}
  openLockWindow();
  try { closeLinkPreview(); } catch {}
  for (const w of [updateWin, radioWin, ...supportWins.values()]) { try { if (w && !w.isDestroyed()) w.destroy(); } catch {} }
  try { if (tor?.state?.status && tor.state.status !== 'off') { vpnGlobal = false; tor.stop?.(); } } catch {}
  for (const st of [...windows.values()]) { try { st.win.destroy(); } catch {} }
}
function liftLockdown() {
  const wasActive = lockActive;
  lockActive = false; clearLockdown();
  if (wasActive) logger.info('Arrêt d’urgence levé');
  if (locked) {
    locked = false; startupLock = null;
    // D'abord rouvrir le navigateur, ENSUITE fermer l'écran de blocage (sinon, plus aucune fenêtre : Electron quitterait).
    if (!windows.size) restoreSession();
    if (lockWin && !lockWin.isDestroyed()) { const w = lockWin; lockWin = null; try { w.destroy(); } catch {} }
    const s = windows.values().next().value; if (s) setTimeout(() => notice(s, '✅ L’accès à DevGitBrowser a été rétabli.'), 1200);
  }
  if (wasActive) broadcast();
}
// Déverrouillage de ce PC avec la clé admin (pour cette session), afin de pouvoir lever l'arrêt depuis l'admin.
function adminUnlockLockScreen(key) {
  try {
    adminLimiter.check();
    if (!admin.verifySecret(admin.normalizeKey(key), adminKeyHash())) { adminLimiter.fail(); logger.warn('Écran de verrouillage : clé admin refusée'); sendLockStatus('admin-refused', {error: 'Clé admin incorrecte.'}); return; }
  } catch (e) { sendLockStatus('admin-refused', {error: e.message}); return; }
  adminLimiter.ok(); adminOverride = true; locked = false;
  logger.warn('Écran de verrouillage : déverrouillé avec la clé admin (session uniquement)');
  if (!windows.size) restoreSession();
  if (lockWin && !lockWin.isDestroyed()) { const w = lockWin; lockWin = null; try { w.destroy(); } catch {} }
  const s = windows.values().next().value;
  if (s) { s.adminOpen = true; broadcast(); adminWatchLoop(); setTimeout(() => { if (!s.win.isDestroyed()) s.win.webContents.send('dgb:command', 'admin-dash'); }, 900); }
}
async function recheckLock() {
  if (!remote || !telemetry?.available) { sendLockStatus('offline'); return; }
  sendLockStatus('checking');
  const before = remote.reachedAt;
  await remote.refresh().catch(() => {});
  if (locked) sendLockStatus(remote.reachedAt === before ? 'offline' : 'still');
}
// Messages en direct (uniquement pendant l'utilisation) : file d'affichage en mémoire.
let liveMessages = [];
function onLiveMessage(m) {
  if (locked) return;
  liveMessages = [...liveMessages.filter(x => x.id !== m.id), m].slice(-5);
  logger.info('Message en direct reçu', m.level);
  if (m.level === 'alert') {
    try { if (Notification.isSupported()) { const n = new Notification({title: T('⚠️ Alerte DevGitBrowser'), body: m.text, icon: path.join(__dirname, 'assets', 'icon.png'), urgency: 'critical'}); n.on('click', () => { const s = focusedState() || windows.values().next().value; if (s) { if (s.win.isMinimized()) s.win.restore(); s.win.focus(); } }); n.show(); } } catch {}
  }
  broadcast();
}
// Message retiré par l'éditeur : il disparaît du bandeau des navigateurs ouverts.
function onLiveRetract(ids) {
  const gone = new Set(ids); const before = liveMessages.length;
  liveMessages = liveMessages.filter(m => !gone.has(m.id));
  if (liveMessages.length !== before) broadcast();
}
// ======================================================== Tchat de support (v1.18)
// Côté utilisateur : chaque signalement porte une clé secrète ; quand l'éditeur le prend en charge, une
// fenêtre de discussion s'ouvre automatiquement. Côté admin : même fenêtre, en mode « support ».
const supportWins = new Map();   // 'user:<id>' | 'admin:<id>' → BrowserWindow
const supportOwner = new Map();  // webContents.id → {mode, bugId}
const supportViews = new Map();  // bugId → dernière vue reçue (côté utilisateur)
const SUPPORT_MAX_CHATS = 5;
const supportChatList = () => (Array.isArray(settings.supportChats) ? settings.supportChats : []);
function addSupportChat(bugId, key, subject) {
  settings.supportChats = [...supportChatList().filter(c => c.bugId !== bugId), {bugId, key, subject: String(subject || '').slice(0, 140), at: new Date().toISOString()}].slice(-SUPPORT_MAX_CHATS);
  saveSettings();
}
function sendSupport(mode, bugId, view) {
  const w = supportWins.get(mode + ':' + bugId);
  if (w && !w.isDestroyed()) w.webContents.send('dgb-support:update', view);
}
function openSupportWindow(mode, bugId, {focus = true} = {}) {
  const k = mode + ':' + bugId; let w = supportWins.get(k);
  if (w && !w.isDestroyed()) { if (focus) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } return w; }
  w = new BrowserWindow({width: 460, height: 640, minWidth: 360, minHeight: 440, title: mode === 'admin' ? T('Support — discussion avec l’utilisateur') : T('Support DevGitBrowser'),
    icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#0d0b1c', show: false, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'ui', 'support', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
  w.setMenu(null);
  const wcId = w.webContents.id;
  supportWins.set(k, w); supportOwner.set(wcId, {mode, bugId});
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  w.once('ready-to-show', () => { if (focus) { w.show(); w.focus(); } else w.showInactive(); });
  w.on('closed', () => { supportWins.delete(k); supportOwner.delete(wcId); });
  w.loadFile(path.join(__dirname, 'ui', 'support', 'index.html'), {query: {mode}});
  if (mode === 'admin') adminWatchLoop();
  return w;
}
function onSupportView(v) {
  if (locked) return;
  const chat = supportChatList().find(c => c.bugId === v.bugId); if (!chat) return;
  const prev = supportViews.get(v.bugId); supportViews.set(v.bugId, v);
  const w = supportWins.get('user:' + v.bugId);
  if (v.open && (!w || w.isDestroyed())) openSupportWindow('user', v.bugId);
  sendSupport('user', v.bugId, {...v, subject: v.subject || chat.subject});
  const last = v.messages[v.messages.length - 1];
  if (prev && last?.from === 'admin' && !(w && !w.isDestroyed() && w.isFocused())) {
    try { if (Notification.isSupported()) { const n = new Notification({title: T('💬 Réponse du support DevGitBrowser'), body: last.text.slice(0, 200), icon: path.join(__dirname, 'assets', 'icon.png')}); n.on('click', () => openSupportWindow('user', v.bugId)); n.show(); } } catch {}
  }
  // Discussion close : la fenêtre affiche la fin ; on arrête d'écouter ce signalement.
  if (!v.open && v.messages.some(m => m.from === 'system' && m.text === 'close')) { settings.supportChats = supportChatList().filter(c => c.bugId !== v.bugId); saveSettings(); }
}
// Route inconnue du serveur : on vérifie sa version pour donner une erreur claire (serveur pas mis à jour).
async function outdatedServer(e, token) {
  if (/not found|: 404$/.test(e.message)) {
    let api = 0; try { api = Number((await telemetry.api('/v1/admin/config', {token, timeout: 10_000}))?.api) || 0; } catch {}
    if (api < 18) throw new Error('Ton serveur n’est pas à jour : relance la commande d’installation sur le VPS.');
  }
  throw e;
}
async function adminSupportCall(bugId, action = '', body) {
  const token = readStatsToken(); if (!token || !telemetry?.available) throw new Error('Enregistre d’abord le jeton du serveur.');
  const p = '/v1/admin/support/' + bugId + (action ? '/' + action : '');
  return telemetry.api(p, {method: action ? 'POST' : 'GET', body: action ? (body || {}) : undefined, token, timeout: 20_000, maxBytes: 2 * 1024 * 1024})
    .catch(e => outdatedServer(e, token));
}
async function refreshAdminSupport(bugId) {
  try { const v = await adminSupportCall(bugId); sendSupport('admin', bugId, v); const w = supportWins.get('admin:' + bugId); if (w && !w.isDestroyed() && w.isFocused()) adminSupportCall(bugId, 'read').catch(() => {}); } catch (e) { sendSupport('admin', bugId, {error: e.message}); }
}
// ---- Panneau admin en temps réel : écoute longue du serveur tant que le panneau ou une discussion est ouvert.
let adminWatchRunning = false, adminWatchRev = -1;
const adminWatching = () => [...windows.values()].some(s => s.adminOpen && !s.win.isDestroyed()) || [...supportWins.keys()].some(k => k.startsWith('admin:'));
const pause = ms => new Promise(r => { const t = setTimeout(r, ms); t.unref?.(); });
function emitAdminEvent(ev) {
  for (const s of windows.values()) if (s.adminOpen && !s.win.isDestroyed()) s.win.webContents.send('dgb:admin-event', ev);
  if (ev.kinds.includes('support') || ev.kinds.includes('bugs')) {
    for (const k of supportWins.keys()) if (k.startsWith('admin:')) refreshAdminSupport(k.slice(6));
    // Un utilisateur écrit dans une discussion ouverte : la fenêtre de support s'ouvre aussi côté admin.
    if (ev.kinds.includes('support') && [...windows.values()].some(s => s.adminOpen)) {
      const token = readStatsToken();
      if (token) telemetry.api('/v1/admin/bugs', {token, timeout: 20_000, maxBytes: 20 * 1024 * 1024}).then(r => {
        for (const b of r?.bugs || []) if (b.chatOpen && b.unread > 0 && !supportWins.has('admin:' + b.id)) openSupportWindow('admin', b.id, {focus: false});
      }).catch(() => {});
    }
  }
}
async function adminWatchLoop() {
  if (adminWatchRunning) return; adminWatchRunning = true; let fails = 0;
  try {
    while (adminWatching()) {
      const token = readStatsToken();
      if (!token || !telemetry?.available) { await pause(2_000); continue; }
      try {
        const r = await telemetry.api('/v1/admin/watch?rev=' + adminWatchRev, {token, timeout: 40_000, maxBytes: 16 * 1024});
        fails = 0; const first = adminWatchRev < 0;
        if (Number.isSafeInteger(r?.rev)) adminWatchRev = r.rev;
        const kinds = (Array.isArray(r?.kinds) ? r.kinds : []).filter(k => typeof k === 'string').slice(0, 10);
        if (!first && kinds.length) emitAdminEvent({kinds, listening: Number(r.listening) || 0});
      } catch (e) {
        // Serveur antérieur à la 1.18 (pas d'écoute admin) : simple rafraîchissement toutes les 30 s.
        if (/404|not found/i.test(e.message)) { await pause(30_000); emitAdminEvent({kinds: ['stats', 'bugs', 'config'], poll: true}); continue; }
        await pause(Math.min(30_000, 2_000 * ++fails));
      }
    }
  } finally { adminWatchRunning = false; }
}
// ======================================================== Mises à jour : notification et fenêtre (v1.16)
let updateWin = null, updateFlow = null;
function sendUpdateState() { if (updateWin && !updateWin.isDestroyed() && updater) updateWin.webContents.send('dgb-update:state', updater.state); }
function openUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.show(); updateWin.focus(); return; }
  const parent = focusedState()?.win || windows.values().next().value?.win;
  updateWin = new BrowserWindow({width: 470, height: 520, resizable: false, minimizable: true, maximizable: false, fullscreenable: false,
    title: T('Mise à jour de DevGitBrowser'), icon: path.join(__dirname, 'assets', 'icon.png'), backgroundColor: '#0a0d26', show: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined, autoHideMenuBar: true,
    webPreferences: {preload: path.join(__dirname, 'ui', 'update', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
  updateWin.setMenu(null);
  updateWin.webContents.on('will-navigate', e => e.preventDefault());
  updateWin.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  updateWin.once('ready-to-show', () => { updateWin.show(); updateWin.focus(); });
  updateWin.on('closed', () => { updateWin = null; updateFlow?.setWindowOpen(false); });
  updateWin.loadFile(path.join(__dirname, 'ui', 'update', 'index.html'));
}
function notifyUpdate(kind, state) {
  const v = state.version;
  const title = kind === 'ready' ? T('Mise à jour prête') : T('Nouvelle version disponible');
  const body = kind === 'ready' ? T(`DevGitBrowser ${v} est prêt : clique pour l’installer.`) : T(`DevGitBrowser ${v} est disponible : téléchargement en cours…`);
  try {
    if (Notification.isSupported()) {
      const n = new Notification({title, body, icon: path.join(__dirname, 'assets', 'icon.png'), silent: false});
      n.on('click', () => openUpdateWindow());
      n.show();
    }
  } catch (e) { logger.warn('Notification de mise à jour', e.message); }
  for (const w of windows.values()) notice(w, `${title} : ${body}`);
}
// Faux service de mise à jour, uniquement pour les tests hors installation (DGB_TEST_UPDATER=1.99.0).
function testUpdater(version) {
  const {EventEmitter} = require('node:events');
  const u = new EventEmitter();
  u.checkForUpdates = async () => {
    u.emit('checking-for-update');
    setTimeout(() => {
      u.emit('update-available', {version, releaseNotes: 'Nouveautés de test'});
      let p = 0; const t = setInterval(() => { p += 25; u.emit('download-progress', {percent: p}); if (p >= 100) { clearInterval(t); u.emit('update-downloaded', {version}); } }, 400);
    }, 300);
  };
  u.quitAndInstall = () => { try { fs.writeFileSync(userDataFile('test-update-installed.txt'), version); } catch {} app.quit(); };
  return u;
}
const achLib = require('./lib/achievements');
let achievements = null, achTimer = null, achLastAds = 0;
// Succès (v1.15) : un compteur local, débloqué au fil de l'utilisation.
const ach = (fn, ...args) => { try { return achievements ? achievements[fn](...args) : []; } catch { return []; } };
const inDgbx = () => [...windows.values()].some(w => w.xmode);
function onAchievementsUnlocked(list) {
  for (const a of list) {
    if (a.secret && !inDgbx()) continue; // succès secrets : annoncés seulement dans le mode DGBx
    // Après le message de l'action en cours (« Lien copié »…), pour ne pas être recouvert.
    setTimeout(() => { const s = focusedState() || windows.values().next().value; if (s) notice(s, `🏆 Succès débloqué : ${a.icon} ${a.name}`); }, 1400);
    logger.info('Succès débloqué', a.id);
  }
  broadcast();
}
async function claimReferral(raw) {
  const code=String(raw||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!remoteLib.validRefCode(code))throw new Error('Code de parrainage invalide (8 caractères).');
  if(settings.referredBy)throw new Error('Tu as déjà indiqué un parrain.');
  if(code===settings.refCode)throw new Error('C’est ton propre code !');
  if(!telemetry?.available)throw new Error('Aucun serveur DevGit configuré dans cette version.');
  if(!telemetryLib.validId(settings.telemetryId)){settings.telemetryId=telemetryLib.newId();}
  try{await telemetry.api('/v1/referral/claim',{method:'POST',body:{code,id:settings.telemetryId},timeout:15_000});}
  catch(e){if(/already/.test(e.message))throw new Error('Un parrain a déjà été enregistré pour ce PC.');if(/self/.test(e.message))throw new Error('C’est ton propre code !');throw e;}
  settings.referredBy=code;saveSettings();broadcast();return true;
}
// Premier lancement : le code du lien d'invitation est retrouvé et validé tout seul.
function installerPathFromRegistry() {
  if (process.platform !== 'win32') return '';
  try {
    const out = require('node:child_process').execFileSync('reg', ['query', 'HKCU\\Software\\DevGitBrowser', '/v', 'InstallerPath'], {encoding: 'utf8', windowsHide: true, timeout: 5000});
    const m = out.match(/InstallerPath\s+REG_SZ\s+(.+)/); return m ? m[1].trim() : '';
  } catch { return ''; }
}
async function autoReferral() {
  if (settings.welcomed || settings.referredBy || settings.refAutoChecked) return;
  settings.refAutoChecked = true; saveSettings();
  let found = null;
  try {
    found = require('./lib/referral-source').findReferralCode({installerPath: installerPathFromRegistry(),
      downloadsDir: (() => { try { return app.getPath('downloads'); } catch { return ''; } })(), clipboardText: () => clipboard.readText()});
  } catch {}
  if (!found) return;
  logger.info('Parrainage détecté', found.source);
  autoReferralCode = found.code;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await claimReferral(found.code); const s = windows.values().next().value; if (s) notice(s, `🎁 Parrainage validé automatiquement (code ${found.code}). Merci !`); return; }
    catch (e) { if (/déjà|propre code|invalide/.test(e.message)) { logger.warn('Parrainage auto', e.message); return; } await new Promise(r => setTimeout(r, 20_000)); }
  }
}
let autoReferralCode = '';
async function refreshReferralCount() {
  if (!telemetry?.available || !remoteLib.validRefCode(settings.refCode)) return;
  try { const r = await telemetry.api('/v1/referral/' + settings.refCode, {timeout: 10_000}); if (Number.isFinite(r?.count)) ach('atLeast', 'referrals', r.count); } catch {}
}
// Invitation : message prêt à partager, dans la langue de l'interface.
function inviteMessage() {
  if (!settings.refCode) { settings.refCode = remoteLib.newRefCode(); saveSettings(); }
  const link = 'https://hempreur.github.io/DevGitBrowser/?ref=' + settings.refCode;
  const text = i18nLang === 'en'
    ? `I recommend DevGitBrowser, a free browser with an ad blocker, a VPN and a password vault. Install it with my link: ${link} (code ${settings.refCode})`
    : `Je te conseille DevGitBrowser, un navigateur gratuit avec bloqueur de pubs, VPN et coffre à mots de passe. Installe-le avec mon lien : ${link} (code ${settings.refCode})`;
  return {link, text, code: settings.refCode};
}
const SHARE_TARGETS = {
  whatsapp: m => 'https://wa.me/?text=' + encodeURIComponent(m.text),
  telegram: m => 'https://t.me/share/url?url=' + encodeURIComponent(m.link) + '&text=' + encodeURIComponent(m.text.replace(m.link, '').trim()),
  x: m => 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(m.text),
  facebook: m => 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(m.link),
  reddit: m => 'https://www.reddit.com/submit?url=' + encodeURIComponent(m.link) + '&title=' + encodeURIComponent('DevGitBrowser'),
  email: m => 'mailto:?subject=' + encodeURIComponent('DevGitBrowser') + '&body=' + encodeURIComponent(m.text)
};
function shareInvite(s, channel) {
  const m = inviteMessage();
  if (channel === 'link') { clipboard.writeText(m.link); ach('bump', 'invites'); return 'Lien de parrainage copié.'; }
  if (channel === 'message' || channel === 'discord') { clipboard.writeText(m.text); ach('bump', 'invites'); return channel === 'discord' ? 'Message copié : colle-le dans Discord (Ctrl+V).' : 'Message d’invitation copié.'; }
  const build = SHARE_TARGETS[channel]; if (!build) throw new Error('Choix invalide.');
  const url = build(m);
  if (channel === 'email') shell.openExternal(url).catch(() => {});
  else newTab(s, url);
  ach('bump', 'invites');
  return '';
}
function achievementsMinute() {
  if (!achievements) return;
  const focused = BrowserWindow.getFocusedWindow();
  const s = focused ? [...windows.values()].find(w => w.win === focused) : null;
  const radioOn = Boolean(radioNow) && radioWin && !radioWin.isDestroyed();
  if (adBlocker) { const total = adBlocker.totalBlocked || 0; if (total > achLastAds) ach('bump', 'ads', total - achLastAds); achLastAds = total; }
  if (s || (focused && radioWin && focused === radioWin) || radioOn) {
    const t = s ? activeTab(s) : null;
    ach('tickMinute', {vpn: vpnGlobal && tor?.state?.status === 'on', radio: radioOn, gaming: Boolean(settings.gamingMode), dgbx: Boolean(s?.xmode || t?.xTab)});
  }
  ach('flush');
}
const {DiscordPresence} = require('./lib/discord');
const DISCORD_APP_ID = '1570094942779473930';
let remote = null, discord = null;
const WINDOW_MATERIALS = ['none','mica','acrylic'];
const LINK_PREVIEW_MODES = ['off','shift','hover'];
// Mica / Acrylic : Windows 11 22H2 (build 22621) ou plus récent.
function materialSupported() {
  if (process.platform !== 'win32') return false;
  const build = Number(String(os.release()).split('.')[2]) || 0;
  return build >= 22621;
}
function applyMaterial(win) {
  if (!win || win.isDestroyed() || !materialSupported() || typeof win.setBackgroundMaterial !== 'function') return;
  const m = WINDOW_MATERIALS.includes(settings.windowMaterial) ? settings.windowMaterial : 'none';
  try { win.setBackgroundColor(m === 'none' ? '#06091c' : '#00000000'); win.setBackgroundMaterial(m); } catch (e) { logger.warn('Effet de fenêtre', e.message); }
}
const { TorService, COUNTRIES: VPN_COUNTRIES } = require('./lib/tor');
const { PhishingGuard } = require('./lib/phishing');
const logger = require('./lib/logger');
const admin = require('./lib/admin');
const weather = require('./lib/weather');
const store = require('./lib/store');
const mediaPlayer = require('./lib/media-player');
const {VideoLocal, validateRequest: validateVideoRequest, isYoutubeWatchUrl} = require('./lib/video-local');
const { Telemetry, newId: newTelemetryId, validId: validTelemetryId } = require('./lib/telemetry');
const telemetryLib = require('./lib/telemetry');
const STATS_URL = String(require('./package.json').devgitStats?.url || '');
const STATS_PIN = String(require('./package.json').devgitStats?.pin || '');

// Default chrome height; the interface reports its real height (favorites bar,
// search bar, update banner) so web pages are never drawn over the controls.
const SHELL_HEIGHT = 132;
const STATUS_HEIGHT = 27;
const RAIL_WIDTH = 0;
const MAX_TABS = 30;
const REPOSITORY_URL = 'https://github.com/hempreur/DevGitBrowser';

const popupLimiter = new PopupLimiter();
const windows = new Map();
const networkWindows = new Map(); // owner-window id -> {win, monitor}
const installed = new Map(); // private GitHub only; key -> {id, name, fingerprint, directory, error}
const storeInstalled = new Map(); // DevGit Store (VPS) : id -> {chromeId, name, version, sha256, directory, error}
const bundledInstalled = new Map(); // official extensions shipped with DevGitBrowser; never removed by GitHub
const popupOrigins = new WeakMap(); // popup webContents -> opener origin for about:blank windows
const ephemeralMedia = new Map();
const videoRequestTimes = new Map();
const videoFormatCache = new Map();
const closedTabs = []; // {url,title} reopened with Ctrl+Maj+T
const downloads = []; // recent downloads, newest first
const tabOpenEvents = new Map(); // origin -> timestamps of link-driven new tabs (anti popunder)
let nextWindowId = 0, nextTabId = 0, nextDownloadId = 0;
let browsingSession, settings, account = null, token = '', syncTimer = null;
let adBlocker = null, adBlockTimer = null, updater = null, browsing = null;
let syncing = false, lastSync = null, lastError = '';
let syncTimerCadence = 90_000;
let sessionTimer = null, quitting = false, draggedTab = null;
let vault = null, tor = null, phishing = null, radioWin = null, radioNow = '', pendingPassword = null, clipboardTimer = null, perfTimer = null;

function userDataFile(name) { return path.join(app.getPath('userData'), name); }
function cacheFolder() { return userDataFile('github-extension-cache'); }
function writeAtomic(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, contents, { mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
}
function readJson(name) { try { return JSON.parse(fs.readFileSync(userDataFile(name),'utf8')); } catch { return null; } }
function defaultSettings() {
  return { proxy: { ...DEFAULT_PROXY }, github: null, popupModes: {}, mediaGrants: {}, sitePrivacy: {}, performance:{mode:'balanced',hardwareAcceleration:true},
    downloads:{folder:'',askEachTime:true}, zoomByOrigin:{}, popupTopmost:{}, legacyTrustedOrigins:{}, adblockEnabled:true, adblockAllowlist:[],
    httpsOnly:true, gpc:true, webrtcProtection:true, restoreSession:true, showBookmarksBar:true, recordHistory:true, clearHistoryOnExit:false,
    autoUpdate:true, searchEngine:'duckduckgo', theme:'neon', welcomed:false, vpnCountry:'', secureDns:'automatic', dnsProvider:'cloudflare',
    phishingProtection:true, gamingMode:false, savePasswords:true, xmodeAge:false, xmodeCode:'', adminKey:'', store:{}, weatherCity:null, showClock:true, shieldAnnoyances:false, shieldBoost:false, vpnAtStartup:false, windowMaterial:'none', linkPreview:'shift', discordPresence:false, discordShowSite:false, language:'auto', refCode:'', referredBy:'', refAutoChecked:false, restoreAfterUpdate:false, dismissedMessages:[], supportChats:[], mediaPlayer:true, telemetry:false, telemetryAsked:false, telemetryId:'', rating:0 };
}
function loadSettings() {
  const fallback = defaultSettings;
  try {
    const raw = JSON.parse(fs.readFileSync(userDataFile('preferences.json'), 'utf8'));
    const p = fallback();
    try { p.proxy = normalizeProxy(raw.proxy || DEFAULT_PROXY); } catch {}
    if (raw.popupModes && typeof raw.popupModes === 'object' && !Array.isArray(raw.popupModes)) {
      for (const [origin, mode] of Object.entries(raw.popupModes).slice(0,100)) {
        if (isSecureOrigin(origin) && ['allow','block'].includes(mode)) p.popupModes[origin]=mode;
      }
    }
    // Ad blocking is enabled for every new Windows profile.
    if (typeof raw.adblockEnabled==='boolean') p.adblockEnabled=raw.adblockEnabled;
    if (Array.isArray(raw.adblockAllowlist)) p.adblockAllowlist=raw.adblockAllowlist.filter(h=>typeof h==='string' && /^[a-z0-9.-]{1,253}$/.test(h)).slice(0,300);
    // Une installation existante (mise à jour) ne revoit pas l'accueil de bienvenue.
    p.welcomed = typeof raw.welcomed==='boolean' ? raw.welcomed : true;
    const savedTheme = LEGACY_THEMES[raw.theme] || raw.theme;
    if (THEMES.some(t=>t.id===savedTheme)) p.theme=savedTheme;
    if (VPN_COUNTRIES.some(c=>c.code===raw.vpnCountry)) p.vpnCountry=raw.vpnCountry;
    if (WINDOW_MATERIALS.includes(raw.windowMaterial)) p.windowMaterial=raw.windowMaterial;
    if (LINK_PREVIEW_MODES.includes(raw.linkPreview)) p.linkPreview=raw.linkPreview;
    if (LANGUAGES.includes(raw.language)) p.language=raw.language;
    if (remoteLib.validRefCode(raw.refCode)) p.refCode=raw.refCode;
    if (remoteLib.validRefCode(raw.referredBy)) p.referredBy=raw.referredBy;
    if (Array.isArray(raw.dismissedMessages)) p.dismissedMessages=raw.dismissedMessages.filter(x=>typeof x==='string'&&/^[a-z0-9-]{4,40}$/.test(x)).slice(-50);
    if (Array.isArray(raw.supportChats)) p.supportChats=raw.supportChats.filter(c=>c&&/^[a-f0-9]{16}$/.test(c.bugId)&&/^[a-f0-9]{64}$/.test(c.key)).slice(-5).map(c=>({bugId:c.bugId,key:c.key,subject:String(c.subject||'').slice(0,140),at:String(c.at||'').slice(0,40)}));
    if (['off','automatic','secure'].includes(raw.secureDns)) p.secureDns=raw.secureDns;
    if (Object.hasOwn(DNS_PROVIDERS, raw.dnsProvider)) p.dnsProvider=raw.dnsProvider;
    if (raw.xmodeAge===true) p.xmodeAge=true;
    if (admin.isHash(raw.adminKey)) p.adminKey=raw.adminKey;
    if (raw.store && typeof raw.store==='object' && !Array.isArray(raw.store)) for (const [id,v] of Object.entries(raw.store).slice(0,100)) {
      if (store.validId(id) && v && /^[a-f0-9]{64}$/.test(v.sha256) && typeof v.version==='string' && v.version.length<=24) p.store[id]={version:v.version,sha256:v.sha256};
    }
    if (validTelemetryId(raw.telemetryId)) p.telemetryId=raw.telemetryId;
    if (raw.telemetryAsked===true) p.telemetryAsked=true;
    if (raw.telemetry===true && p.telemetryId) p.telemetry=true;
    if (Number.isInteger(raw.rating) && raw.rating>=1 && raw.rating<=5) p.rating=raw.rating;
    if (weather.validCity(raw.weatherCity)) p.weatherCity={name:raw.weatherCity.name,country:String(raw.weatherCity.country||'').slice(0,40),lat:raw.weatherCity.lat,lon:raw.weatherCity.lon};
    if (typeof raw.xmodeCode==='string' && /^scrypt\$[A-Za-z0-9+/=]{20,}\$[A-Za-z0-9+/=]{40,}$/.test(raw.xmodeCode)) p.xmodeCode=raw.xmodeCode;
    for (const key of ['httpsOnly','gpc','webrtcProtection','restoreSession','showBookmarksBar','recordHistory','clearHistoryOnExit','autoUpdate','phishingProtection','gamingMode','savePasswords','showClock','shieldAnnoyances','shieldBoost','vpnAtStartup','discordPresence','discordShowSite','refAutoChecked','restoreAfterUpdate','mediaPlayer']) {
      if (typeof raw[key]==='boolean') p[key]=raw[key];
    }
    if (Object.hasOwn(SEARCH_ENGINES, raw.searchEngine)) p.searchEngine=raw.searchEngine;
    // Migrate version 1.0 manually allowlisted origins; preserve user choices.
    if (Array.isArray(raw.popupAllowed)) for(const origin of raw.popupAllowed.filter(isSecureOrigin).slice(0,80)) {
      if (!Object.hasOwn(p.popupModes,origin))p.popupModes[origin]='allow';
    }
    if (raw.sitePrivacy && typeof raw.sitePrivacy === 'object' && !Array.isArray(raw.sitePrivacy)) {
      for (const [origin, values] of Object.entries(raw.sitePrivacy).slice(0,100)) {
        if (!isSecureOrigin(origin) || !values || typeof values!=='object') continue;
        p.sitePrivacy[origin]={};
        for(const key of ['camera','microphone','notifications','geolocation']) {
          if(['allow','block','ask'].includes(values[key]))p.sitePrivacy[origin][key]=values[key];
        }
      }
    }
    // Opt-in consent remembered separately for each legacy origin.
    if (raw.legacyTrustedOrigins && typeof raw.legacyTrustedOrigins === 'object' && !Array.isArray(raw.legacyTrustedOrigins)) {
      for(const [origin,approved] of Object.entries(raw.legacyTrustedOrigins).slice(0,100)){
        if(originOf(origin)===origin && approved===true)p.legacyTrustedOrigins[origin]=true;
      }
    }
    if (raw.popupTopmost && typeof raw.popupTopmost === 'object' && !Array.isArray(raw.popupTopmost)) {
      for(const [origin,value] of Object.entries(raw.popupTopmost).slice(0,100)) if(isSecureOrigin(origin) && typeof value==='boolean')p.popupTopmost[origin]=value;
    }
    if (raw.performance?.mode==='eco') p.performance.mode='eco';
    if (raw.performance?.hardwareAcceleration===false) p.performance.hardwareAcceleration=false;
    if (raw.downloads && typeof raw.downloads.folder==='string' && raw.downloads.folder.length<=600 && path.isAbsolute(raw.downloads.folder))p.downloads.folder=raw.downloads.folder;
    if (raw.downloads?.askEachTime===false) p.downloads.askEachTime=false;
    if(raw.zoomByOrigin && typeof raw.zoomByOrigin==='object')for(const [origin,scale] of Object.entries(raw.zoomByOrigin).slice(0,200)) {
      if(isSecureOrigin(origin) && Number.isFinite(scale) && scale>=0.5 && scale<=2)p.zoomByOrigin[origin]=scale;
    }
    if (raw.mediaGrants && typeof raw.mediaGrants === 'object' && !Array.isArray(raw.mediaGrants)) {
      for (const [origin, value] of Object.entries(raw.mediaGrants).slice(0, 80)) {
        if (isSecureOrigin(origin)) p.mediaGrants[origin] = { camera: value?.camera === true, microphone: value?.microphone === true };
      }
    }
    if (raw.github && typeof raw.github === 'object') {
      try {
        p.github = { owner: String(raw.github.owner), ownerId: Number(raw.github.ownerId), repo: cleanRepoName(raw.github.repo),
          repoId: Number(raw.github.repoId), branch: cleanBranch(raw.github.branch) };
      } catch {}
    }
    return p;
  } catch { return fallback(); }
}
function saveSettings() {
  if (adBlocker) settings.adblockAllowlist=[...adBlocker.allowlist];
  writeAtomic(userDataFile('preferences.json'), JSON.stringify(settings, null, 2));
}
function isSecureOrigin(input) {
  try {
    const url = new URL(input);
    return url.origin === input && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
  } catch { return false; }
}
function siteOrigin(url) {
  try { const u = new URL(url); return isSecureOrigin(u.origin) ? u.origin : ''; }
  catch { return ''; }
}
function storeToken(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Stockage chiffré indisponible. Aucun jeton ne sera sauvegardé.');
  writeAtomic(userDataFile('github-secret.dat'), safeStorage.encryptString(value));
}
function restoreToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(fs.readFileSync(userDataFile('github-secret.dat')));
  } catch { return ''; }
}
function stateForSender(sender) {
  for (const s of windows.values()) if (!s.win.isDestroyed() && s.win.webContents === sender) return s;
  throw new Error('Accès au navigateur refusé.');
}
function activeTab(s) { return s?.tabs.get(s.activeId) || null; }
function findTab(id) {
  for (const s of windows.values()) { const t=s.tabs.get(Number(id)); if (t) return t; }
  return null;
}
function tabState(t) {
  const wc = t.view.webContents;
  let back = false, forward = false, muted = false;
  if (!wc.isDestroyed()) {
    try { back = wc.navigationHistory.canGoBack(); forward = wc.navigationHistory.canGoForward(); muted = wc.isAudioMuted(); } catch {}
  }
  if (t.engine==='mshtml') { back = true; forward = true; }
  return { id: t.id, title: t.title, url: t.url, loading: t.loading, back, forward, engine:t.engine||'chromium',
    favicon: t.favicon||'', audible: Boolean(t.audible), muted, pinned:false, secure: /^https:/.test(t.url),
    blocked: adBlocker && !wc.isDestroyed() ? adBlocker.blockedFor(wc.id) : 0, error: t.loadError||'', sleeping: Boolean(t.sleeping), xTab: Boolean(t.xTab), private: Boolean(t.private) };
}
function currentOrigin(s) { return siteOrigin(activeTab(s)?.url || ''); }
function currentHost(s) { try { return new URL(activeTab(s)?.url||'').hostname.replace(/^www\./,''); } catch { return ''; } }
function publicState(s) {
  const origin = currentOrigin(s);
  const t = activeTab(s);
  const shield = adBlocker ? adBlocker.state() : {enabled:settings.adblockEnabled,ready:false,quality:'initialisation',updating:false,error:'',scope:'chromium',allowlist:[]};
  return {
    windowId: s.id, activeId: s.activeId, tabs: [...s.tabs.values()].map(tabState), windowCount: windows.size,
    platform: process.platform, version: app.getVersion(),
    proxy: settings.proxy, popupModeHere: origin ? popupMode(origin,settings.popupModes) : 'block',
    popupOverrideHere:origin ? settings.popupModes[origin]||'default':'default',
    popupDefaultBabel: Boolean(origin && !Object.hasOwn(settings.popupModes,origin) && popupMode(origin)==='allow'),
    popupTopmostHere:origin ? nativePopupTopmost(origin):false, popupTopmostOverride:origin && Object.hasOwn(settings.popupTopmost,origin)?(settings.popupTopmost[origin]?'yes':'no'):'default',
    legacyHere:{...(t?.legacy||{likely:false,hints:[]}), engine:t?.engine||'chromium', modernOnly:Boolean(t?.url&&requiresModernVideo(t.url)), trusted:settings.legacyTrustedOrigins[origin]===true, error:t?.legacyError||'', hostBits:t?.legacyBits||'', pluginDiagnostic:t?.legacyPluginInfo||''},
    performance: settings.performance, downloads: {folder: settings.downloads.folder || app.getPath('downloads'), askEachTime: settings.downloads.askEachTime,
      active: downloads.filter(d=>d.state==='progressing').length, recent: downloads.slice(0,8).map(d=>({id:d.id,name:d.name,state:d.state,progress:d.progress}))},
    zoom:t?.url && !t.view.webContents.isDestroyed() ? t.view.webContents.getZoomFactor():1,
    privacyHere:origin ? sitePermissions(origin) : sitePermissions(''),
    adblock: shield, shieldHere: { host: currentHost(s), allowed: Boolean(t?.url && adBlocker?.isAllowlisted(t.url)), blocked: t && !t.view.webContents.isDestroyed() && adBlocker ? adBlocker.blockedFor(t.view.webContents.id) : 0 },
    currentOrigin: origin, blockedPopups: s.blockedPopups,
    mediaHere: { camera:origin?mediaGranted(origin,'camera'):false, microphone:origin?mediaGranted(origin,'microphone'):false },
    bookmarks: browsing ? browsing.bookmarks.slice(0,80) : [], bookmarkedHere: Boolean(t?.url && browsing?.isBookmarked(t.url)),
    topSites: browsing ? browsing.topSites(8) : [],
    preferences: { httpsOnly:settings.httpsOnly, gpc:settings.gpc, webrtcProtection:settings.webrtcProtection, restoreSession:settings.restoreSession,
      showBookmarksBar:settings.showBookmarksBar, recordHistory:settings.recordHistory, clearHistoryOnExit:settings.clearHistoryOnExit,
      autoUpdate:settings.autoUpdate, searchEngine:settings.searchEngine, theme:settings.theme, phishingProtection:settings.phishingProtection,
      secureDns:settings.secureDns, dnsProvider:settings.dnsProvider, gamingMode:settings.gamingMode, savePasswords:settings.savePasswords, showClock:settings.showClock, mediaPlayer:settings.mediaPlayer,
      shieldAnnoyances:settings.shieldAnnoyances, shieldBoost:settings.shieldBoost, vpnAtStartup:settings.vpnAtStartup, vpnCountry:settings.vpnCountry,
      windowMaterial:settings.windowMaterial, linkPreview:settings.linkPreview, language:settings.language,
      discordPresence:settings.discordPresence, discordShowSite:settings.discordShowSite, telemetry:settings.telemetry===true },
    lang: i18nLang,
    achievements: achievements ? (() => { const sm = achievements.summary({includeSecret: Boolean(s.xmode)}); return {unseen: sm.unseen, unlocked: sm.unlocked, total: sm.total, rank: sm.rank.icon}; })() : null,
    materialSupported: materialSupported(),
    remote: {lockdownAdmin: lockActive && !locked, killMessage: lockInfo.message,
      disabled: (remote?.features || []).map(f => remoteLib.FEATURES[f]), messages: liveMessages},
    referral: {referredBy: settings.referredBy, auto: autoReferralCode === settings.referredBy && Boolean(autoReferralCode)},
    discord: {presence: settings.discordPresence, showSite: settings.discordShowSite, connected: Boolean(discord?.connected)},
    weather: {city: settings.weatherCity ? settings.weatherCity.name + (settings.weatherCity.country ? ', ' + settings.weatherCity.country : '') : '', now: weatherNow},
    adminOpen: Boolean(s.adminOpen),
    telemetry: {available: Boolean(telemetry?.available), enabled: Boolean(telemetry?.enabled), asked: settings.telemetryAsked, rating: settings.rating},
    searchEngines: Object.entries(SEARCH_ENGINES).map(([id,e])=>({id,name:e.name})),
    themes: THEMES, theme: settings.theme, welcomed: settings.welcomed,
    vpn: tor ? {...tor.state, status: vpnGlobal ? tor.state.status : 'off', error: vpnGlobal ? tor.state.error : '', privateTunnel: !vpnGlobal ? tor.state.status : '', countries: VPN_COUNTRIES} : {status:'off', available:false, countries: VPN_COUNTRIES},
    gaming: settings.gamingMode, xmode: Boolean(s.xmode), xmodeSetup: {age: settings.xmodeAge, code: Boolean(settings.xmodeCode)}, radio: {open: Boolean(radioWin && !radioWin.isDestroyed()), now: radioNow},
    passwords: vault ? {...vault.status(), here: {form: Boolean(t?.loginForm), count: t?.url ? vault.forOrigin(t.url).length : 0, never: Boolean(t?.url && vault.isUnlocked() && vault.isNever(t.url))},
      offer: pendingPassword && pendingPassword.windowId===s.id ? {origin: pendingPassword.origin, username: pendingPassword.username, update: pendingPassword.update} : null} : null,
    security: { phishing: phishing ? phishing.state() : null, dns: {mode: settings.secureDns, provider: settings.dnsProvider, providers: Object.entries(DNS_PROVIDERS).map(([id,d])=>({id,name:d.name}))} },
    update: updater ? updater.state : {status:'disabled',current:app.getVersion()},
    github: { connected: Boolean(token && account), user: account?.login || '', avatar: '',
      repo: settings.github?.repo || '', branch: settings.github?.branch || 'main',
      lastSync, syncing, lastError },
    extensions: [
      ...[...bundledInstalled.entries()].map(([key, info]) => ({key, name:info.name, version:info.version||'',error:info.error||null,loaded:Boolean(info.id),source:'included'})),
      ...[...installed.entries()].map(([key, info]) => ({key, name:info.name, version:info.version || '', error:info.error || null, loaded:Boolean(info.id),source:'github'})),
      ...[...storeInstalled.entries()].map(([key, info]) => ({key, name:info.name, version:info.version || '', error:info.error || null, loaded:Boolean(info.chromeId),source:'store'}))
    ],
    storeAvailable: Boolean(telemetry?.available), storeInstalled: Object.fromEntries([...storeInstalled].map(([k,v])=>[k,{version:v.version,loaded:Boolean(v.chromeId),error:v.error||null}])),
  };
}
function sendState(s) {
  if (s && !s.win.isDestroyed() && !s.win.webContents.isDestroyed()) {
    // Many events fire per page load: coalesce them into one UI refresh per frame.
    if (s.stateTimer) return;
    s.stateTimer = setTimeout(() => {
      s.stateTimer = null;
      if (!s.win.isDestroyed() && !s.win.webContents.isDestroyed()) s.win.webContents.send('dgb:state', publicState(s));
    }, 16);
  }
  scheduleSessionSave();
}
function broadcast() { for (const s of windows.values()) sendState(s); updateDiscord(); }
// ---- Discord Rich Presence (v1.13) : opt-in ; le site n'est affiché que si l'utilisateur l'a choisi,
// jamais pour un onglet privé ou DGBx.
let discordStart = Date.now();
function updateDiscord() {
  if (!discord) return;
  if (!settings.discordPresence) { discord.stop(); return; }
  const s = focusedState(); const t = s ? activeTab(s) : null;
  let details = T('Navigue avec DevGitBrowser'), state = T('Navigateur indépendant');
  if (s?.xmode || t?.xTab || t?.private) state = T('Navigation privée');
  else if (settings.discordShowSite && t?.url) { try { const h = new URL(t.url).hostname.replace(/^www\./, ''); if (h) state = T('Sur') + ' ' + h.slice(0, 60); } catch {} }
  discord.setActivity({details, state, timestamps: {start: discordStart},
    assets: {large_image: 'logo', large_text: 'DevGitBrowser ' + app.getVersion()},
    buttons: [{label: T('Télécharger DevGitBrowser'), url: 'https://hempreur.github.io/DevGitBrowser/'}]});
}
function notice(s, message, bad=false) {
  if (s && !s.win.isDestroyed() && !s.win.webContents.isDestroyed()) s.win.webContents.send('dgb:notice', {message:String(message).slice(0,300), bad:Boolean(bad)});
}
function focusedState() {
  const win = BrowserWindow.getFocusedWindow();
  for (const s of windows.values()) if (s.win === win) return s;
  return [...windows.values()].at(-1) || null;
}
function hostCommand(t,code,payload='') {
  const host=t?.legacyHost;
  if(host && !host.child.killed && host.child.stdin && !host.child.stdin.destroyed){
    try{host.child.stdin.write(encodeCommand(code,payload));}catch{}
  }
}
function syncNativeHost(t){
  if(!t?.legacyHost?.ready || t.owner.win.isDestroyed())return;
  const s=t.owner;const visible=s.activeId===t.id && !s.panelOpen && Boolean(t.url);
  hostCommand(t,visible?'SHOW':'HIDE');
}
function chromeHeight(s) { return s.htmlFullscreen ? 0 : s.shellHeight; }
function statusHeight(s) { return s.htmlFullscreen ? 0 : STATUS_HEIGHT; }
function nativeBounds(s) {
  // MSHTML uses a borderless, Win32-owned overlay positioned on the content
  // rectangle. Unlike cross-process WS_CHILD reparenting, it paints above
  // Chromium's composited web surface while visually remaining in the tab.
  const bounds=s.win.getContentBounds();
  const scale=process.platform==='win32' ? screen.getDisplayMatching(s.win.getBounds()).scaleFactor || 1 : 1;
  return [bounds.x+RAIL_WIDTH,bounds.y+chromeHeight(s),
    Math.max(1,bounds.width-RAIL_WIDTH),Math.max(1,bounds.height-chromeHeight(s)-statusHeight(s))]
    .map(v=>Math.max(0,Math.round(v*scale)));
}
function layout(s) {
  if (s.win.isDestroyed()) return;
  const t = activeTab(s);
  if (!t || !t.url) return;
  const [w,h] = s.win.getContentSize();
  const top=chromeHeight(s);
  const width=Math.max(1,w-RAIL_WIDTH),height=Math.max(1,h-top-statusHeight(s));
  t.view.setBounds({ x:RAIL_WIDTH, y:top, width, height });
  hostCommand(t,'BOUNDS',nativeBounds(s).join(','));
}
function showView(s, t) {
  if (!t?.url || s.win.isDestroyed()) return;
  if (!s.win.contentView.children.includes(t.view)) s.win.contentView.addChildView(t.view);
  t.view.setVisible(!s.panelOpen && t.engine!=='mshtml');
  layout(s);
}
function selectTab(s, id) {
  const next = s.tabs.get(Number(id)); if (!next) return;
  const prev = activeTab(s);
  if (prev && prev !== next) {
    hostCommand(prev,'HIDE');
    try { s.win.contentView.removeChildView(prev.view); } catch {}
    if (s.htmlFullscreen && !prev.view.webContents.isDestroyed()) { try { prev.view.webContents.executeJavaScript('document.fullscreenElement&&document.exitFullscreen()',true).catch(()=>{}); } catch {} }
  }
  s.activeId = next.id;
  next.lastActive = Date.now();
  if (prev && prev !== next) prev.lastActive = Date.now();
  if (next.sleeping) wakeTab(next);
  if (next.url) { showView(s,next); syncNativeHost(next); if (!s.panelOpen) next.view.webContents.focus(); }
  sendState(s);
  const inspector=networkWindows.get(s.id); if(inspector)inspector.monitor.start(next.url?next.view.webContents:null);
}
function searchOrAddress(text) {
  const value = String(text ?? '');
  const url = normalizeAddress(value);
  if (url && url.startsWith('https://duckduckgo.com/?q=') && !/^https?:\/\/duckduckgo\.com/i.test(value.trim()) && settings.searchEngine!=='duckduckgo') {
    return searchUrl(settings.searchEngine, value.trim());
  }
  return url;
}
function rememberClosed(t) {
  if (!t?.url || t.xTab) return;
  closedTabs.unshift({url:t.url,title:t.title});
  if (closedTabs.length>25) closedTabs.length=25;
}
function tabOpenAllowed(origin) {
  // Anti « popunder » : un site ne peut pas ouvrir des rafales d'onglets.
  const now=Date.now(), key=origin||'(inconnu)';
  const list=(tabOpenEvents.get(key)||[]).filter(x=>now-x<15000);
  if (list.length>=5) { tabOpenEvents.set(key,list); return false; }
  list.push(now); tabOpenEvents.set(key,list); return true;
}
function isAdDestination(url, sourceUrl) {
  try {
    if (!adBlocker?.engine || !adBlocker.enabled || adBlocker.isAllowlisted(sourceUrl)) return false;
    const {Request} = require('@ghostery/adblocker');
    const request = Request.fromRawDetails({url, sourceUrl, type:'sub_frame'});
    return Boolean(adBlocker.engine.match(request).match);
  } catch { return false; }
}
function attachPageHandlers(t) {
  const wc = t.view.webContents;
  const update = () => {
    if (wc.isDestroyed() || !findTab(t.id)) return;
    const value = wc.getURL(); if (isWebUrl(value)) t.url = value;
    const title = wc.getTitle(); if (title && title !== 'about:blank' && !String(value).startsWith('data:')) t.title = title.slice(0,90);
    sendState(t.owner);
  };
  wc.on('page-title-updated', (_event, title) => {
    if (String(wc.getURL()).startsWith('data:')) return;
    t.title = String(title).slice(0,90); sendState(t.owner);
    if (settings.recordHistory && !t.owner.xmode && !t.xTab && !t.private && t.engine==='chromium') browsing?.updateTitle(t.url, t.title);
  });
  wc.on('page-favicon-updated', (_event, icons) => {
    const icon = (icons||[]).find(u => /^https:\/\//i.test(u) || /^data:image\//i.test(u));
    t.favicon = icon && icon.length < 4096 ? icon : ''; sendState(t.owner);
  });
  wc.on('did-start-navigation', (details) => {
    if (details?.isMainFrame && !details.isSameDocument && adBlocker) adBlocker.resetTab(wc.id);
  });
  wc.on('did-navigate', (_event, url, httpCode) => {
    if (isWebUrl(url)) { t.loadError=''; t.favicon=''; t.upgradeHits=null; if (/^https:/i.test(url)) t.httpsUpgradedFrom=''; }
    update(); applySiteZoom(t);
    if (isWebUrl(url) && settings.recordHistory && !t.owner.xmode && !t.xTab && !t.private && t.engine==='chromium' && !(httpCode>=400)) browsing?.record(url, wc.getTitle());
    if (isWebUrl(url) && !t.owner.xmode && !t.xTab && !t.private) { telemetry?.countPage(); ach('bump','pages'); }
  });
  wc.on('did-finish-load',async()=>{
    if(!isWebUrl(wc.getURL()) || wc.isDestroyed())return;
    try{const result=await wc.executeJavaScript(DETECTOR_SOURCE,true);
      if(!wc.isDestroyed() && isWebUrl(wc.getURL()) && result && Array.isArray(result.hints)){
        t.legacy={likely:result.likely===true,hints:result.hints.slice(0,5)};sendState(t.owner);
        if(t.engine==='chromium' && !t.forceModern && shouldAutoEmbed({url:wc.getURL(),hints:t.legacy.hints,
            trustedOrigins:settings.legacyTrustedOrigins,platform:process.platform})){
          startEmbeddedLegacy(t.owner,t,false).catch(()=>{});
        }
      }
    }catch{}
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { update(); if (isMainFrame && isWebUrl(url) && settings.recordHistory && !t.owner.xmode && !t.xTab && !t.private && t.engine==='chromium') browsing?.record(url, wc.getTitle()); });
  wc.setBackgroundThrottling(true);
  if(typeof wc.setZoomMode==='function')wc.setZoomMode('isolated');
  if (settings.webrtcProtection) { try { wc.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch {} }
  wc.on('did-start-loading', () => { t.loading=true; sendState(t.owner); });
  wc.on('did-stop-loading', () => { t.loading=false; update(); });
  wc.on('media-started-playing', () => { t.audible=true; sendState(t.owner); });
  wc.on('media-paused', () => { t.audible=false; sendState(t.owner); });
  wc.on('audio-state-changed', (event) => { t.audible=Boolean(event?.audible); sendState(t.owner); });
  wc.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 || wc.isDestroyed()) return; // -3 = navigation annulée
    t.loading=false;
    const failed = validatedURL || t.url;
    // Mode HTTPS prioritaire : proposer explicitement le repli en HTTP.
    const fallback = t.httpsUpgradedFrom && /^https:/i.test(failed) ? t.httpsUpgradedFrom : '';
    t.loadError=`Erreur ${code}`;
    t.title=`Erreur de chargement (${code})`;
    if (isWebUrl(failed)) t.url=failed;
    wc.loadURL(errorPage({url:failed, code, description, httpFallback:fallback})).catch(()=>{});
    sendState(t.owner);
  });
  const guardNavigation = (event, target, isRedirect) => {
    const url = typeof target === 'string' ? target : target?.url;
    if (handleInternalLink(t, url)) { event.preventDefault(); return; }
    const dangerous = settings.phishingProtection && phishing ? phishing.match(url) : '';
    if (dangerous) { event.preventDefault(); showPhishingWarning(t, url, dangerous); return; }
    if (!isRedirect && sendToMediaPlayer(t, url)) { event.preventDefault(); return; }
    if (!isWebUrl(url)) {
      if (String(url).startsWith('data:') && !isRedirect) return; // pages d'erreur internes
      event.preventDefault(); return;
    }
    if (settings.httpsOnly) {
      const upgraded = httpsUpgrade(url);
      const host = upgraded ? new URL(url).host : '';
      if (upgraded && t.httpsAllowedHttp !== host) {
        // Un site qui redirige sans cesse vers HTTP : ne pas boucler.
        t.upgradeHits = t.upgradeHits?.host===host ? {host, n:t.upgradeHits.n+1} : {host, n:1};
        if (t.upgradeHits.n > 2) { t.httpsAllowedHttp = host; notice(t.owner, `${host} n’accepte que HTTP : connexion non chiffrée.`, true); return; }
        event.preventDefault();
        t.httpsUpgradedFrom = url;
        wc.loadURL(upgraded).catch(()=>{});
        return;
      }
    }
  };
  wc.on('will-navigate', (event, target) => {
    const url = String(typeof target === 'string' ? target : target?.url || '');
    // « Continuer en HTTP » sur la page d'erreur est un choix explicite de l'utilisateur.
    if (String(wc.getURL()).startsWith('data:') && /^http:/i.test(url) && t.httpsUpgradedFrom) {
      try { t.httpsAllowedHttp = new URL(url).host; } catch {}
      return;
    }
    guardNavigation(event, target, false);
  });
  wc.on('will-redirect', (event, target) => guardNavigation(event, target, true));
  wc.on('enter-html-full-screen', () => { if (t.owner.activeId!==t.id) return; t.owner.htmlFullscreen=true; try{t.owner.win.setFullScreen(true);}catch{} layout(t.owner); sendState(t.owner); });
  wc.on('leave-html-full-screen', () => { t.owner.htmlFullscreen=false; try{t.owner.win.setFullScreen(false);}catch{} layout(t.owner); sendState(t.owner); });
  wc.on('context-menu', (_event, params) => pageContextMenu(t, params));
  wc.on('render-process-gone', (_event, details) => {
    if (!details || details.reason === 'clean-exit' || wc.isDestroyed() || !findTab(t.id)) return;
    logger.warn('Onglet planté', details.reason, details.exitCode);
    t.loading=false; t.loadError='Plantage';
    wc.loadURL(crashPage({url:t.url, reason:details.reason})).catch(()=>{});
    sendState(t.owner);
  });
  wc.on('unresponsive', () => {
    if (wc.isDestroyed() || t.unresponsiveDialog) return;
    t.unresponsiveDialog=true;
    dialog.showMessageBox(t.owner.win,{type:'warning',title:'Page qui ne répond pas',message:`« ${t.title} » ne répond plus.`,
      detail:'Tu peux attendre qu’elle termine ou la recharger.',buttons:['Attendre','Recharger la page'],defaultId:0,cancelId:0,noLink:true})
      .then(({response})=>{ t.unresponsiveDialog=false; if(response===1 && !wc.isDestroyed()){ try{wc.forcefullyCrashRenderer();}catch{} wc.reload(); } }).catch(()=>{t.unresponsiveDialog=false;});
  });
  wc.on('update-target-url', (_event, url) => {
    if (t.owner.activeId===t.id && !t.owner.win.isDestroyed()) t.owner.win.webContents.send('dgb:hover-url', isWebUrl(url) ? String(url).slice(0,500) : '');
  });
  wc.on('found-in-page', (_event, result) => {
    if (!t.owner.win.isDestroyed()) t.owner.win.webContents.send('dgb:find-result', {active:result.activeMatchOrdinal||0, total:result.matches||0});
  });
  installPopupHandler(wc, () => siteOrigin(wc.getURL()), () => t.owner, 0, t);
  wc.on('before-input-event', (event,input) => { if (handleShortcut(t.owner, input, 'page')) event.preventDefault(); });
}
function newTab(s, url = '', options = {}) {
  if (s.tabs.size >= MAX_TABS) throw new Error(`Maximum de ${MAX_TABS} onglets par fenêtre.`);
  const t = { id:++nextTabId, owner:s, view:null, xTab:Boolean(s.xmode), private:Boolean(options.private), url:'', title:'Nouvel onglet', loading:false,legacy:{likely:false,hints:[]},engine:'chromium',legacyHost:null,legacyError:'',legacyBits:'',legacyPluginInfo:'',forceModern:false,favicon:'',audible:false,loadError:'',httpsUpgradedFrom:'' };
  createTabView(t);
  { let n = 0; for (const w of windows.values()) n += w.tabs.size; ach('atLeast','maxTabs',n+1); }
  if (Number.isInteger(options.index)) insertInMap(s.tabs, t.id, t, options.index); else s.tabs.set(t.id, t);
  if (options.lazy && isWebUrl(url)) {
    // Onglet restauré en veille : chargé seulement quand on l'affiche.
    t.url=url; t.title=options.title || (()=>{try{return new URL(url).hostname;}catch{return url;}})(); t.sleeping=true;
    if (!s.activeId) selectTab(s,t.id); else sendState(s);
    return t.id;
  }
  if (!options.background || !s.activeId) selectTab(s,t.id); else sendState(s);
  if (url) navigateTab(t,url);
  return t.id;
}
function createTabView(t) {
  const view = new WebContentsView({ webPreferences: {
    session: t.private ? ensurePrivateSession() : browsingSession, nodeIntegration:false, contextIsolation:true, sandbox:true,
    webSecurity:true, allowRunningInsecureContent:false, webviewTag:false, backgroundThrottling:true,
    spellcheck:true, safeDialogs:true, disableDialogs:false, navigateOnDragDrop:false
  }});
  view.setBackgroundColor('#ffffff');
  t.view = view;
  attachPageHandlers(t);
  // Onglet privé : WebRTC ne peut jamais contourner le VPN (fuite d'adresse IP).
  if (t.private || vpnActive()) { try { view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch {} }
  return view;
}
// Mise en veille d'un onglet : son processus est libéré (RAM/CPU), l'adresse est conservée.
function sleepTab(t) {
  const s=t.owner;
  if (!t.url || t.sleeping || s.activeId===t.id || t.audible || t.engine!=='chromium') return false;
  const old=t.view;
  try { s.win.contentView.removeChildView(old); } catch {}
  createTabView(t);
  t.sleeping=true; t.loading=false;
  if (!old.webContents.isDestroyed()) old.webContents.close();
  sendState(s);
  return true;
}
function wakeTab(t) {
  if (!t.sleeping) return;
  t.sleeping=false;
  const dangerous = settings.phishingProtection && phishing ? phishing.match(t.url) : '';
  if (dangerous) { showPhishingWarning(t, t.url, dangerous); return; }
  t.view.webContents.loadURL(t.url).then(()=>applySiteZoom(t)).catch(()=>{});
}
function closeTab(s,id) {
  const t = s.tabs.get(Number(id)); if (!t) return;
  const active = s.activeId === t.id;
  const order = [...s.tabs.keys()]; const position = order.indexOf(t.id);
  if (active && t.url) { try { s.win.contentView.removeChildView(t.view); } catch {} }
  rememberClosed(t);
  stopEmbeddedLegacy(t,false);
  s.tabs.delete(t.id);
  if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  if (t.private) setTimeout(cleanupPrivateSession, 500);
  if (!s.tabs.size) {
    // Fermer le dernier onglet ferme la fenêtre s'il en reste une autre.
    if (windows.size>1) { s.activeId=null; s.win.close(); return; }
    s.activeId=null; newTab(s); return;
  }
  if (active) { s.activeId=null; const keys=[...s.tabs.keys()]; selectTab(s, keys[Math.min(position, keys.length-1)]); }
  else sendState(s);
}
function navigateTab(t,text) {
  const s=t.owner;
  let url = searchOrAddress(text); if (!url) return;
  if(t.engine==='mshtml' && preserveIEInSession(url)){
    t.url=url;t.title=(new URL(url)).hostname;t.legacy={likely:true,hints:[]};
    hostCommand(t,'NAV',url);sendState(s);return;
  }
  stopEmbeddedLegacy(t,false);
  t.forceModern=false; t.loadError=''; t.httpsUpgradedFrom=''; t.httpsAllowedHttp=''; t.upgradeHits=null; t.sleeping=false; t.loginForm=false;
  if (settings.httpsOnly) { const upgraded=httpsUpgrade(url); if (upgraded) { t.httpsUpgradedFrom=url; url=upgraded; } }
  if (sendToMediaPlayer(t, url)) { if (!t.view.webContents.getURL()) { sendState(s); } return; }
  t.url=url; t.title=(new URL(url)).hostname; t.legacy={likely:false,hints:[]}; t.favicon='';
  const dangerous = settings.phishingProtection && phishing ? phishing.match(url) : '';
  if (dangerous) { if (s.activeId===t.id) showView(s,t); showPhishingWarning(t, url, dangerous); return; }
  if (s.activeId===t.id) {
    showView(s,t);
    const inspector=networkWindows.get(s.id);if(inspector)inspector.monitor.start(t.view.webContents);
  }
  sendState(s);
  t.view.webContents.loadURL(url).then(()=>applySiteZoom(t)).catch(() => {});
  if (s.activeId===t.id && !s.panelOpen) t.view.webContents.focus();
}
const XMODE_COMMAND = /^\s*%SxOnSite%\s*$/i;
function navigate(s,text) { if (XMODE_COMMAND.test(String(text||'')) || admin.ADMIN_COMMAND.test(String(text||''))) return; const t = activeTab(s); if (t) navigateTab(t,text); }
// ---- Mode DGBx (caché) : réservé aux adultes, navigation privée, code d'accès facultatif.
function hashCode(code) {
  const salt = crypto.randomBytes(16);
  return 'scrypt$' + salt.toString('base64') + '$' + crypto.scryptSync(String(code), salt, 32, {N: 1 << 14}).toString('base64');
}
function checkCode(code) {
  const [, salt, hash] = String(settings.xmodeCode).split('$');
  if (!salt || !hash) return true;
  const got = crypto.scryptSync(String(code||''), Buffer.from(salt, 'base64'), 32, {N: 1 << 14});
  const want = Buffer.from(hash, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
let xmodeFailures = 0, xmodeBlockedUntil = 0;
function exitXmode(s) {
  s.xmode = false;
  // Les onglets ouverts depuis le mode DGBx sont fermés en le quittant (aucune trace).
  for (const t of [...s.tabs.values()]) if (t.xTab) closeTab(s, t.id);
  if (s.activeId === null && !s.win.isDestroyed()) { try { newTab(s); } catch {} }
  broadcast();
}
// ---- Lecteur protégé : Netflix & co s'ouvrent dans DevGitMedia.exe (signé VMP).
function sendToMediaPlayer(t, url) {
  if (!settings.mediaPlayer || remote?.disabled('media') || t?.private || !mediaPlayer.isStreamingEntry(url)) return false;
  if (!mediaPlayer.openInMediaPlayer(url)) return false;
  notice(t.owner, 'Ouvert dans le lecteur protégé DevGit (vidéos Netflix, Disney+, Prime Video…).');
  logger.info('Lecteur protégé', new URL(url).hostname);
  return true;
}
// ---- Widevine (vidéos protégées)
let widevineStatus = {available: false, state: 'absent'};
function initWidevine() {
  const components = require('electron').components;
  if (!components || typeof components.whenReady !== 'function') { widevineStatus = {available: false, state: 'absent'}; return; }
  widevineStatus = {available: true, state: 'installation'};
  components.whenReady().then(() => {
    const st = components.status?.() || {};
    const cdm = Object.values(st).find(c => /widevine/i.test(String(c?.name || ''))) || Object.values(st)[0] || {};
    widevineStatus = {available: true, state: 'prêt', version: String(cdm.version || '')};
    logger.info('Widevine prêt', widevineStatus.version);
    broadcast();
  }).catch(err => { widevineStatus = {available: true, state: 'erreur', error: String(err?.message || err).slice(0, 160)}; logger.warn('Widevine', widevineStatus.error); broadcast(); });
}
// ---- Météo (barre d'outils) : Open-Meteo, rafraîchie toutes les 20 minutes.
let weatherNow = null, weatherTimer = null;
const webFetch = (url, opts) => (browsingSession && typeof browsingSession.fetch === 'function' ? browsingSession.fetch(url, opts) : fetch(url, opts));
async function refreshWeather() {
  if (!settings.weatherCity) { weatherNow = null; broadcast(); return null; }
  try { weatherNow = await weather.current(webFetch, settings.weatherCity); }
  catch (e) { logger.warn('Météo', e.message); if (weatherNow) weatherNow.stale = true; }
  broadcast(); return weatherNow;
}
function startWeather() { clearInterval(weatherTimer); refreshWeather(); weatherTimer = setInterval(refreshWeather, 20 * 60_000); }
// ---- Statistiques anonymes (avec accord) et jeton du serveur pour le panneau admin.
let telemetry = null;
function setTelemetry(on) {
  settings.telemetry = Boolean(on); settings.telemetryAsked = true;
  if (on && !validTelemetryId(settings.telemetryId)) settings.telemetryId = newTelemetryId();
  if (!on) settings.telemetryId = ''; // refus : l'identifiant aléatoire est effacé
  saveSettings(); broadcast();
  if (on) telemetry?.ping().catch(() => {});
}
let statsTokenMemory = ''; // repli si le chiffrement du système est indisponible (jamais écrit en clair)
function storeStatsToken(value) {
  statsTokenMemory = value;
  if (safeStorage.isEncryptionAvailable()) writeAtomic(userDataFile('stats-token.dat'), safeStorage.encryptString(value));
}
function readStatsToken() {
  try { if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(fs.readFileSync(userDataFile('stats-token.dat'))); } catch {}
  return statsTokenMemory;
}
// ---- Panneau admin (%AdminDBG%) : clé obligatoire à chaque ouverture.
const adminLimiter = admin.createLimiter();
const adminKeyHash = () => settings.adminKey || admin.ORIGINAL_KEY_HASH;
function showPhishingWarning(t, url, domain) {
  logger.warn('Site dangereux bloqué', domain);
  t.title='⛔ Site dangereux bloqué'; t.url=url; t.loadError='Hameçonnage';
  t.view.webContents.loadURL(warningPage({url, domain})).catch(()=>{});
  notice(t.owner, `Site dangereux bloqué : ${domain}`, true);
  sendState(t.owner);
}
// Liens des pages d'avertissement / de plantage (https://devgit.invalid/...).
function handleInternalLink(t, url) {
  let u; try { u = new URL(String(url||'')); } catch { return false; }
  if (u.hostname !== INTERNAL_HOST) return false;
  const target = u.searchParams.get('to') || '';
  const action = u.pathname.replace(/^\//,'');
  const wc = t.view.webContents;
  setImmediate(()=>{
    if (action === 'back') { if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); else home(t.owner); }
    else if (action === 'proceed' && isWebUrl(target)) { try { phishing?.allow(new URL(target).hostname); } catch {} navigateTab(t, target); }
    else if (action === 'reload' && isWebUrl(target)) navigateTab(t, target);
  });
  return true;
}
// ======================================================== Aperçu des liens (v1.12)
const PREVIEW_W = 560, PREVIEW_H = 400, PREVIEW_HEAD = 40;
let preview = null; // {s, win, view, url, linkRect, poll, graceAt}
let previewTimer = null;
function closeLinkPreview() {
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
  const p = preview; preview = null;
  if (!p) return;
  if (p.poll) clearInterval(p.poll);
  try { if (!p.view.webContents.isDestroyed()) p.view.webContents.close(); } catch {}
  try { if (!p.win.isDestroyed()) p.win.destroy(); } catch {}
}
function previewPlacement(s, rect) {
  // rect : position du lien dans la page (pixels CSS ≈ DIP au zoom 100 %).
  const content = s.win.getContentBounds();
  const pageX = content.x + RAIL_WIDTH, pageY = content.y + chromeHeight(s);
  const pageW = content.width - RAIL_WIDTH, pageH = content.height - chromeHeight(s) - statusHeight(s);
  const w = Math.min(PREVIEW_W, pageW - 16), h = Math.min(PREVIEW_H, pageH - 16);
  const [lx, ly, lw, lh] = rect;
  let x = pageX + lx, y = pageY + ly + lh + 6;
  if (y + h > pageY + pageH) y = pageY + ly - h - 6;          // pas de place dessous : au-dessus
  y = Math.max(pageY + 8, Math.min(y, pageY + pageH - h - 8));
  x = Math.max(pageX + 8, Math.min(x, pageX + pageW - w - 8));
  return {x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h),
    link: {x: pageX + lx, y: pageY + ly, width: lw, height: lh}};
}
const inside = (pt, r, pad = 0) => pt.x >= r.x - pad && pt.x <= r.x + r.width + pad && pt.y >= r.y - pad && pt.y <= r.y + r.height + pad;
function sendPreviewInfo() {
  const p = preview; if (!p || p.win.isDestroyed() || p.view.webContents.isDestroyed()) return;
  const wc = p.view.webContents;
  p.win.webContents.send('dgb-preview:info', {url: wc.getURL() || p.url, title: wc.getTitle(), loading: wc.isLoading()});
}
function openLinkPreview(s, t, url, rect) {
  if (!isWebUrl(url) || s.win.isDestroyed()) return;
  if (preview && preview.url === url && preview.s === s) return;
  closeLinkPreview();
  const place = previewPlacement(s, rect);
  if (place.width < 260 || place.height < 180) return;
  const win = new BrowserWindow({parent: s.win, x: place.x, y: place.y, width: place.width, height: place.height, frame: false, show: false,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, backgroundColor: '#0b1028', hasShadow: true,
    webPreferences: {preload: path.join(__dirname, 'ui', 'preview', 'preload.js'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
  win.setMenu(null);
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  const view = new WebContentsView({webPreferences: {session: browsingSession, nodeIntegration: false, contextIsolation: true, sandbox: true,
    webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, safeDialogs: true, disableDialogs: true, navigateOnDragDrop: false}});
  view.setBackgroundColor('#ffffff');
  win.contentView.addChildView(view);
  view.setBounds({x: 1, y: PREVIEW_HEAD, width: place.width - 2, height: place.height - PREVIEW_HEAD - 1});
  const vwc = view.webContents;
  vwc.setAudioMuted(true);
  // Liens « nouvel onglet » et pop-ups de l'aperçu : ouverts dans un vrai onglet.
  vwc.setWindowOpenHandler(({url: next}) => { if (isWebUrl(next)) { try { newTab(s, next); } catch {} closeLinkPreview(); } return {action: 'deny'}; });
  for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate']) vwc.on(ev, sendPreviewInfo);
  vwc.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'Escape') { e.preventDefault(); closeLinkPreview(); } });
  win.webContents.once('did-finish-load', sendPreviewInfo);
  win.loadFile(path.join(__dirname, 'ui', 'preview', 'index.html'));
  vwc.loadURL(url).catch(() => {});
  win.showInactive();
  preview = {s, t, win, view, url, linkRect: place.link, graceAt: 0, poll: null};
  ach('bump','previews');
  // Fermeture quand la souris quitte à la fois le lien et l'aperçu (délai de grâce).
  preview.poll = setInterval(() => {
    const p = preview; if (!p || p.win.isDestroyed()) { closeLinkPreview(); return; }
    if (p.s.win.isDestroyed() || !p.s.win.isVisible() || p.s.win.isMinimized() || p.s.panelOpen || activeTab(p.s) !== p.t) { closeLinkPreview(); return; }
    const pt = screen.getCursorScreenPoint();
    const over = inside(pt, p.win.getBounds(), 6) || inside(pt, p.linkRect, 4) || p.win.isFocused();
    if (over) { p.graceAt = 0; return; }
    if (!p.graceAt) p.graceAt = Date.now() + 700;
    else if (Date.now() >= p.graceAt) closeLinkPreview();
  }, 200);
}
function onPreviewHover(t, data) {
  const s = t.owner, mode = settings.linkPreview;
  if (mode === 'off' || remote?.disabled('preview') || t.private || t.xTab || s.xmode || s.panelOpen || activeTab(s) !== t) return;
  const type = String(data?.type || '');
  if (type === 'close') { closeLinkPreview(); return; }
  if (type === 'leave') { if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; } return; }
  let zoom = 1; try { zoom = t.view.webContents.getZoomFactor() || 1; } catch {}
  const url = String(data?.url || ''), rect = Array.isArray(data?.rect) && data.rect.length === 4 ? data.rect.map(n => (Number(n) || 0) * zoom) : null;
  if (!rect || !isWebUrl(url)) return;
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
  const delay = type === 'shift' || (type === 'enter' && data.shift) ? (mode === 'off' ? -1 : 250) : mode === 'hover' && type === 'enter' ? 1000 : -1;
  if (delay < 0) return;
  previewTimer = setTimeout(() => { previewTimer = null; openLinkPreview(s, t, url, rect); }, delay);
}
function tabForWebContents(wc) {
  for (const s of windows.values()) for (const t of s.tabs.values()) if (t.view?.webContents === wc) return t;
  return null;
}
function home(s) {
  const t=activeTab(s); if (!t) return;
  stopEmbeddedLegacy(t,false);
  if (t.url) { try { s.win.contentView.removeChildView(t.view); } catch {} }
  t.url='';t.title='Nouvel onglet';t.loading=false;t.legacy={likely:false,hints:[]};t.favicon='';t.loadError='';
  t.view.webContents.loadURL('about:blank').catch(()=>{});
  const inspector=networkWindows.get(s.id);if(inspector)inspector.monitor.start(null);
  sendState(s);
}
function createWindow({initialTab=true, bounds=null, tabs=null, activeIndex=0}={}) {
  if (locked) { openLockWindow(); return null; }
  const display = screen.getPrimaryDisplay().workArea;
  const options = {
    width:Math.min(1320,display.width),height:Math.min(850,display.height),minWidth:740,minHeight:520,
    title:'DevGitBrowser — CodexHempreur INC',
    icon:path.join(__dirname,'assets','icon.png'),
    autoHideMenuBar:true, backgroundColor:'#06091c', show:false,
    webPreferences:{ preload:path.join(__dirname,'preload.js'), nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false,spellcheck:false }
  };
  if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
    // Ne jamais restaurer une fenêtre hors de tous les écrans.
    const visible = screen.getAllDisplays().some(d => bounds.x < d.workArea.x+d.workArea.width-80 && bounds.x+ (bounds.width||400) > d.workArea.x+80 && bounds.y >= d.workArea.y-20 && bounds.y < d.workArea.y+d.workArea.height-80);
    if (visible) Object.assign(options, {x:Math.round(bounds.x), y:Math.round(bounds.y)});
    if (Number.isFinite(bounds.width)) options.width=Math.max(740,Math.round(bounds.width));
    if (Number.isFinite(bounds.height)) options.height=Math.max(520,Math.round(bounds.height));
  }
  const win = new BrowserWindow(options);
  const s={id:++nextWindowId,win,tabs:new Map(),activeId:null,panelOpen:false,blockedPopups:0,shellHeight:SHELL_HEIGHT,htmlFullscreen:false,stateTimer:null};
  windows.set(s.id,s);
  win.setMenu(null);
  applyMaterial(win);
  win.once('ready-to-show',()=>{ if (bounds?.maximized) win.maximize(); win.show(); });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('did-finish-load',()=>{ s.stateTimer=null; sendState(s); });
  win.webContents.on('before-input-event',(event,input)=>{ if (handleShortcut(s,input,'shell')) event.preventDefault(); });
  win.on('resize',()=>layout(s));
  win.on('move',()=>{ layout(s); if (preview?.s===s) closeLinkPreview(); });
  win.on('focus',()=>{ const t=activeTab(s); if (t?.url && !s.panelOpen && !t.view.webContents.isDestroyed()) {/* keep page focus */} });
  win.on('hide',()=>{const t=activeTab(s);if(t)hostCommand(t,'HIDE');});
  win.on('show',()=>{const t=activeTab(s);if(t)syncNativeHost(t);});
  win.on('minimize',()=>{const t=activeTab(s);if(t)hostCommand(t,'HIDE');});
  win.on('restore',()=>{const t=activeTab(s);if(t)syncNativeHost(t);});
  win.on('leave-full-screen',()=>{ if (s.htmlFullscreen) { s.htmlFullscreen=false; const t=activeTab(s); try{t?.view.webContents.executeJavaScript('document.fullscreenElement&&document.exitFullscreen()',true).catch(()=>{});}catch{} layout(s); sendState(s); } });
  win.on('close',()=>{ if (!quitting && windows.size===1) saveSessionNow(); });
  win.on('closed',()=>{
    for (const t of s.tabs.values()) {rememberClosed(t);stopEmbeddedLegacy(t,false);const wc=t.view?.webContents;if (wc && !wc.isDestroyed()) wc.close();}
    s.tabs.clear(); windows.delete(s.id);
    const inspector=networkWindows.get(s.id);if(inspector){inspector.win.close();networkWindows.delete(s.id);}
    if (!quitting && windows.size) scheduleSessionSave();
    broadcast();
  });
  win.loadFile(path.join(__dirname,'ui','index.html'));
  if (Array.isArray(tabs) && tabs.length) {
    tabs.slice(0,MAX_TABS).forEach((url,i)=>{ try { newTab(s, url, {background:true, lazy: i!==(activeIndex|0)}); } catch {} });
    const keys=[...s.tabs.keys()]; selectTab(s, keys[Math.max(0,Math.min(keys.length-1, activeIndex|0))]);
  } else if (initialTab) newTab(s);
  broadcast();
  return s;
}
// ---- Déplacement des onglets entre fenêtres (glisser-déposer ou menu)
function moveTab(t, target, index) {
  const from = t.owner;
  if (!target || target.win.isDestroyed()) return;
  if (from === target) {
    insertInMap(from.tabs, t.id, t, index);
    sendState(from); return;
  }
  if (target.tabs.size >= MAX_TABS) throw new Error(`Maximum de ${MAX_TABS} onglets par fenêtre.`);
  const wasLegacy = t.engine==='mshtml' || t.engine==='mshtml-pending';
  if (wasLegacy) stopEmbeddedLegacy(t, false);
  const wasActive = from.activeId === t.id;
  try { from.win.contentView.removeChildView(t.view); } catch {}
  const order=[...from.tabs.keys()]; const position=order.indexOf(t.id);
  from.tabs.delete(t.id);
  t.owner = target;
  insertInMap(target.tabs, t.id, t, Number.isInteger(index) ? index : target.tabs.size);
  if (wasLegacy && t.url) t.view.webContents.loadURL(t.url).catch(()=>{});
  selectTab(target, t.id);
  target.win.focus();
  if (!from.tabs.size) { from.activeId=null; from.win.close(); }
  else if (wasActive) { from.activeId=null; const keys=[...from.tabs.keys()]; selectTab(from, keys[Math.min(position,keys.length-1)]); }
  else sendState(from);
  const inspector=networkWindows.get(from.id);if(inspector)inspector.monitor.start(activeTab(from)?.url?activeTab(from).view.webContents:null);
}
function detachTab(t, point=null) {
  const from = t.owner;
  if (from.tabs.size === 1 && !point) { notice(from, 'Cet onglet est déjà seul dans sa fenêtre.'); return; }
  const [w,h] = from.win.getSize();
  const bounds = point ? {x:point.x-140, y:point.y-20, width:Math.max(900,Math.round(w*0.8)), height:Math.max(600,Math.round(h*0.85))} : null;
  if (from.tabs.size === 1 && point) { from.win.setPosition(Math.round(bounds.x), Math.round(bounds.y)); return; }
  const next = createWindow({initialTab:false, bounds});
  moveTab(t, next, 0);
}
function windowAtPoint(point, exclude) {
  for (const s of windows.values()) {
    if (s===exclude || s.win.isDestroyed() || s.win.isMinimized() || !s.win.isVisible()) continue;
    const b = s.win.getBounds();
    if (point.x>=b.x && point.x<=b.x+b.width && point.y>=b.y && point.y<=b.y+b.height) return s;
  }
  return null;
}
function setPanel(s,value) {
  s.panelOpen=Boolean(value);
  const t=activeTab(s); if(t?.url){t.view.setVisible(!s.panelOpen && t.engine!=='mshtml');syncNativeHost(t);}
}
// ---- Raccourcis clavier valables partout (page web et interface)
function handleShortcut(s, input, where) {
  if (input.type !== 'keyDown' || !s || s.win.isDestroyed()) return false;
  const mod = input.control || input.meta;
  const key = String(input.key).toLowerCase();
  const t = activeTab(s);
  const wc = t?.url ? t.view.webContents : null;
  const ui = s.win.webContents;
  if (mod && input.shift && key === 't') { reopenClosed(s); return true; }
  if (mod && input.shift && key === 'b') { setPreference('showBookmarksBar', !settings.showBookmarksBar); return true; }
  if (mod && input.shift && key === 'delete') { ui.send('dgb:command','history'); return true; }
  if (mod && input.shift && (key === 'i' || key === 'j')) { if (wc && t.engine!=='mshtml') wc.openDevTools({mode:'detach'}); return true; }
  if (mod && key === 'tab') { cycleTab(s, input.shift ? -1 : 1); return true; }
  if (mod && /^[1-9]$/.test(key)) { const keys=[...s.tabs.keys()]; const id = key==='9' ? keys.at(-1) : keys[Number(key)-1]; if (id) selectTab(s,id); return true; }
  if (mod && key === 'l') { ui.send('dgb:focus-address'); return true; }
  if (mod && key === 't') { try { newTab(s); ui.send('dgb:focus-address'); } catch (e) { notice(s,e.message,true); } return true; }
  if (mod && input.shift && key === 'n') { openPrivateTab(s).catch(e=>notice(s,e.message,true)); return true; }
  if (mod && key === 'n') { createWindow(); return true; }
  if (mod && key === 'w') { if (s.activeId) closeTab(s,s.activeId); return true; }
  if (mod && key === 'h') { ui.send('dgb:command','history'); return true; }
  if (mod && key === 'd') { toggleBookmark(s); return true; }
  if (mod && key === 'j') { ui.send('dgb:command','downloads'); return true; }
  if (mod && key === 'f') { ui.send('dgb:focus-find'); return true; }
  if (mod && key === 'p' && wc) { wc.print({printBackground:true},()=>{}); return true; }
  if (mod && key === 'r' || key === 'f5') { if (t?.engine==='mshtml') hostCommand(t,'RELOAD'); else if (wc) { if (input.shift || mod && key==='f5') wc.reloadIgnoringCache(); else wc.reload(); } return true; }
  if (mod && ['+','=','add'].includes(key)) { setZoom(s,1); return true; }
  if (mod && ['-','subtract'].includes(key)) { setZoom(s,-1); return true; }
  if (mod && key === '0') { setZoom(s,0); return true; }
  if (input.shift && !mod && key === 'escape') { ui.send('dgb:command','tasks'); return true; }
  if (key === 'f12') { if (wc && t.engine!=='mshtml') wc.openDevTools({mode:'detach'}); return true; }
  if (key === 'f11') { s.win.setFullScreen(!s.win.isFullScreen()); return true; }
  if (key === 'escape' && s.htmlFullscreen && wc) { wc.executeJavaScript('document.fullscreenElement&&document.exitFullscreen()',true).catch(()=>{}); return where==='shell'; }
  if (input.alt && !mod && key === 'home') { home(s); return true; }
  if (input.alt && !mod && key === 'arrowleft' || key === 'browserback') { if (t?.engine==='mshtml') hostCommand(t,'BACK'); else if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true; }
  if (input.alt && !mod && key === 'arrowright' || key === 'browserforward') { if (t?.engine==='mshtml') hostCommand(t,'FORWARD'); else if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true; }
  return false;
}
function cycleTab(s, delta) {
  const keys=[...s.tabs.keys()]; if (keys.length<2) return;
  const i=keys.indexOf(s.activeId);
  selectTab(s, keys[(i+delta+keys.length)%keys.length]);
}
function reopenClosed(s) {
  const item = closedTabs.shift();
  if (!item) { notice(s,'Aucun onglet récemment fermé.'); return; }
  try { newTab(s, item.url); } catch (e) { notice(s,e.message,true); }
}
function setPreference(key, value) {
  if (!Object.hasOwn(defaultSettings(), key) || typeof value !== typeof defaultSettings()[key]) throw new Error('Réglage inconnu.');
  if (['adminKey','xmodeCode','xmodeAge','weatherCity','welcomed','telemetryId','telemetryAsked','rating','store','refCode','referredBy','refAutoChecked','restoreAfterUpdate','dismissedMessages','supportChats'].includes(key)) throw new Error('Réglage protégé.');
  if (key==='telemetry') { setTelemetry(value); return; }
  if (key==='searchEngine' && !Object.hasOwn(SEARCH_ENGINES,value)) throw new Error('Moteur de recherche inconnu.');
  if (key==='theme' && !THEMES.some(t=>t.id===value)) throw new Error('Thème inconnu.');
  if (key==='secureDns' && !['off','automatic','secure'].includes(value)) throw new Error('Mode DNS inconnu.');
  if (key==='dnsProvider' && !Object.hasOwn(DNS_PROVIDERS,value)) throw new Error('Fournisseur DNS inconnu.');
  if (key==='vpnCountry' && !VPN_COUNTRIES.some(c=>c.code===value)) throw new Error('Pays inconnu.');
  if (key==='windowMaterial' && !WINDOW_MATERIALS.includes(value)) throw new Error('Effet inconnu.');
  if (key==='linkPreview' && !LINK_PREVIEW_MODES.includes(value)) throw new Error('Mode d’aperçu inconnu.');
  if (key==='language' && !LANGUAGES.includes(value)) throw new Error('Langue inconnue.');
  if (key==='gamingMode') { setGamingMode(value); return; }
  settings[key]=value;
  if (key==='secureDns' || key==='dnsProvider') applySecureDns();
  if (key==='phishingProtection' && phishing) { phishing.enabled=value; if (value) phishing.load(); }
  if (key==='theme' && radioWin && !radioWin.isDestroyed()) radioWin.webContents.send('dgb-radio:theme', value);
  if (key==='theme') ach('addDistinct','themes',value);
  if (key==='discordPresence' && value) ach('atLeast','discord',1);
  if (key==='autoUpdate' && updater) updater.setAuto(value);
  if (key==='windowMaterial') for (const w of windows.values()) applyMaterial(w.win);
  if (key==='language') { settings.language=value; applyLanguage(); broadcastLanguage(); updateDiscord(); ach('addDistinct','languages',i18nLang); }
  if (key==='discordPresence' || key==='discordShowSite') { settings[key]=value; updateDiscord(); }
  if (key==='linkPreview' && value==='off') closeLinkPreview();
  if (key==='shieldAnnoyances') adBlocker?.setAnnoyances(value).catch(()=>{});
  if (key==='shieldBoost') adBlocker?.setBoost(value);
  if (key==='webrtcProtection') for (const s of windows.values()) for (const t of s.tabs.values()) { try { t.view.webContents.setWebRTCIPHandlingPolicy(value?'default_public_interface_only':'default'); } catch {} }
  saveSettings(); broadcast();
}
function toggleBookmark(s) {
  const t = activeTab(s);
  if (!t?.url || !browsing) { notice(s,'Ouvre une page web pour l’ajouter aux favoris.',true); return false; }
  const added = browsing.toggleBookmark(t.url, t.title);
  if (added) ach('bump','bookmarks');
  notice(s, added ? '★ Ajouté aux favoris.' : 'Favori retiré.');
  broadcast();
  return added;
}
// ---- Picture-in-Picture
const PIP_SOURCE = `(async()=>{try{
  if(document.pictureInPictureElement){await document.exitPictureInPicture();return 'exit';}
  const videos=[...document.querySelectorAll('video')].filter(v=>v.readyState>0 && v.offsetWidth*v.offsetHeight>2000);
  if(!videos.length)return 'none';
  videos.sort((a,b)=>((b.paused?0:1)-(a.paused?0:1))||(b.offsetWidth*b.offsetHeight-a.offsetWidth*a.offsetHeight));
  const v=videos[0];
  try{v.disablePictureInPicture=false;v.removeAttribute('disablepictureinpicture');}catch{}
  await v.requestPictureInPicture();
  if(v.paused)v.play().catch(()=>{});
  return 'ok';
}catch(e){return 'error:'+(e&&e.message||e);}})()`;
async function togglePictureInPicture(s) {
  const t = activeTab(s);
  if (!t?.url || t.engine!=='chromium') throw new Error('Ouvre une page avec une vidéo (moteur moderne) pour utiliser le Picture-in-Picture.');
  const wc = t.view.webContents;
  const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter(f => f !== wc.mainFrame)].slice(0,40);
  let lastError = '';
  for (const frame of frames) {
    try {
      const result = await frame.executeJavaScript(PIP_SOURCE, true);
      if (result === 'ok') { ach('bump','pip'); return 'Vidéo en Picture-in-Picture. Elle reste visible au-dessus de tes fenêtres.'; }
      if (result === 'exit') return 'Picture-in-Picture fermé.';
      if (String(result).startsWith('error:')) lastError = String(result).slice(6);
    } catch (e) { lastError = e.message || String(e); }
  }
  throw new Error(lastError ? 'Picture-in-Picture refusé par le site : '+lastError : 'Aucune vidéo en lecture trouvée sur cette page.');
}
// ---- Menus natifs (au-dessus des pages web, sans conflit d'affichage)
function popupMenu(s, template) {
  const menu = Menu.buildFromTemplate(template);
  menu.popup({window:s.win});
}
function pageContextMenu(t, p) {
  const s = t.owner, wc = t.view.webContents;
  const items = [];
  const link = isWebUrl(p.linkURL) ? p.linkURL : '';
  if (link) {
    items.push({label:'Ouvrir le lien dans un nouvel onglet', click:()=>{ try{newTab(s,link,{background:true});}catch(e){notice(s,e.message,true);} }});
    items.push({label:'Ouvrir le lien dans une nouvelle fenêtre', click:()=>createWindow({tabs:[link]})});
    items.push({label:'Copier l’adresse du lien', click:()=>clipboard.writeText(link)});
    items.push({label:'Ajouter le lien aux favoris', click:()=>{ try{browsing.addBookmark(link, p.linkText||'');ach('bump','bookmarks');broadcast();notice(s,'★ Lien ajouté aux favoris.');}catch(e){notice(s,e.message,true);} }});
    items.push({type:'separator'});
  }
  if (p.mediaType==='image' && isWebUrl(p.srcURL)) {
    items.push({label:'Ouvrir l’image dans un nouvel onglet', click:()=>{ try{newTab(s,p.srcURL,{background:true});}catch{} }});
    items.push({label:'Enregistrer l’image sous…', click:()=>wc.downloadURL(p.srcURL)});
    items.push({label:'Copier l’image', click:()=>wc.copyImageAt(p.x,p.y)});
    items.push({label:'Copier l’adresse de l’image', click:()=>clipboard.writeText(p.srcURL)});
    items.push({type:'separator'});
  }
  if (p.mediaType==='video') {
    items.push({label:'Picture-in-Picture', click:()=>togglePictureInPicture(s).then(m=>notice(s,m)).catch(e=>notice(s,e.message,true))});
    items.push({type:'separator'});
  }
  if (p.isEditable) {
    for (const word of (p.dictionarySuggestions||[]).slice(0,5)) items.push({label:word, click:()=>wc.replaceMisspelling(word)});
    if (p.misspelledWord) items.push({label:'Ajouter au dictionnaire', click:()=>browsingSession.addWordToSpellCheckerDictionary(p.misspelledWord)},{type:'separator'});
    items.push({label:'Annuler', role:'undo', enabled:p.editFlags.canUndo},{label:'Rétablir', role:'redo', enabled:p.editFlags.canRedo},{type:'separator'},
      {label:'Couper', role:'cut', enabled:p.editFlags.canCut},{label:'Copier', role:'copy', enabled:p.editFlags.canCopy},
      {label:'Coller', role:'paste', enabled:p.editFlags.canPaste},{label:'Coller en texte brut', role:'pasteAndMatchStyle', enabled:p.editFlags.canPaste},
      {label:'Tout sélectionner', role:'selectAll'},{type:'separator'});
    // Remplissage des coordonnées depuis le coffre (jamais en navigation privée ni en DGBx).
    if (vault && !t.private && !t.xTab && /^https:/i.test(String(p.frameURL||p.pageURL||'')) && p.frame) {
      const profiles = vault.isUnlocked() ? vault.listProfiles() : [];
      if (vault.isUnlocked() && profiles.length) items.push({label:'Remplir mes coordonnées', submenu:profiles.map(pr=>({label:pr.label, click:()=>{ try { p.frame.send('dgb-autofill:fill', pr); } catch {} }}))},{type:'separator'});
      else if (!vault.isUnlocked() && vault.exists()) items.push({label:'Remplir mes coordonnées… (déverrouiller le coffre)', click:()=>{ s.win.webContents.send('dgb:command','unlock-fill'); }},{type:'separator'});
    }
  } else if (p.selectionText) {
    const text = p.selectionText.trim().slice(0,200);
    items.push({label:'Copier', role:'copy'});
    if (text) items.push({label:`Rechercher « ${text.length>32?text.slice(0,32)+'…':text} »`, click:()=>{ try{newTab(s,searchUrl(settings.searchEngine,text),{background:false});}catch{} }});
    items.push({type:'separator'});
  }
  if (!link && !p.isEditable && !p.selectionText && p.mediaType==='none') {
    items.push({label:'Précédent', enabled:wc.navigationHistory.canGoBack(), click:()=>wc.navigationHistory.goBack()},
      {label:'Suivant', enabled:wc.navigationHistory.canGoForward(), click:()=>wc.navigationHistory.goForward()},
      {label:'Actualiser', click:()=>wc.reload()},{type:'separator'},
      {label:browsing?.isBookmarked(t.url)?'Retirer des favoris':'Ajouter aux favoris', click:()=>toggleBookmark(s)},
      {label:'Enregistrer la page sous…', click:()=>savePage(s,t)},
      {label:'Imprimer…', click:()=>wc.print({printBackground:true},()=>{})},
      {label:'Picture-in-Picture', click:()=>togglePictureInPicture(s).then(m=>notice(s,m)).catch(e=>notice(s,e.message,true))},
      {type:'separator'});
  }
  items.push({label:'Inspecter l’élément', click:()=>{ wc.inspectElement(p.x,p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus(); }});
  popupMenu(s, items);
}
async function savePage(s, t) {
  const safe = String(t.title||'page').replace(/[\\/:*?"<>|]+/g,' ').trim().slice(0,80) || 'page';
  const res = await dialog.showSaveDialog(s.win,{title:'Enregistrer la page',defaultPath:path.join(settings.downloads.folder||app.getPath('downloads'),safe+'.html'),
    filters:[{name:'Page web complète',extensions:['html']},{name:'Page HTML seule',extensions:['htm']}]});
  if (res.canceled || !res.filePath) return;
  await t.view.webContents.savePage(res.filePath, res.filePath.endsWith('.htm') ? 'HTMLOnly' : 'HTMLComplete');
  notice(s,'Page enregistrée.');
}
function tabContextMenu(s, id) {
  const t = s.tabs.get(Number(id)); if (!t) return;
  const others = [...windows.values()].filter(x=>x!==s && !x.win.isDestroyed());
  const wc = t.view.webContents;
  popupMenu(s, [
    {label:'Nouvel onglet à droite', click:()=>{ const keys=[...s.tabs.keys()]; try{newTab(s,'',{index:keys.indexOf(t.id)+1});}catch(e){notice(s,e.message,true);} }},
    {label:'Actualiser', enabled:Boolean(t.url), click:()=>wc.reload()},
    {label:'Dupliquer', enabled:Boolean(t.url), click:()=>{ const keys=[...s.tabs.keys()]; try{newTab(s,t.url,{index:keys.indexOf(t.id)+1});}catch(e){notice(s,e.message,true);} }},
    {label:wc.isDestroyed()||!wc.isAudioMuted()?'Couper le son de l’onglet':'Réactiver le son de l’onglet', click:()=>{ wc.setAudioMuted(!wc.isAudioMuted()); sendState(s); }},
    {label:browsing?.isBookmarked(t.url)?'Retirer des favoris':'Ajouter aux favoris', enabled:Boolean(t.url), click:()=>{ browsing.toggleBookmark(t.url,t.title); broadcast(); }},
    {type:'separator'},
    {label:'Déplacer dans une nouvelle fenêtre', enabled:s.tabs.size>1, click:()=>detachTab(t)},
    {label:'Déplacer vers la fenêtre…', enabled:others.length>0, submenu: others.length ? others.map((o,i)=>({label:`Fenêtre ${i+1} · ${activeTab(o)?.title||'Nouvel onglet'}`.slice(0,70), click:()=>{ try{moveTab(t,o);}catch(e){notice(s,e.message,true);} }})) : [{label:'—',enabled:false}]},
    {type:'separator'},
    {label:'Fermer l’onglet', click:()=>closeTab(s,t.id)},
    {label:'Fermer les autres onglets', enabled:s.tabs.size>1, click:()=>{ for (const id of [...s.tabs.keys()]) if (id!==t.id) closeTab(s,id); }},
    {label:'Fermer les onglets à droite', enabled:[...s.tabs.keys()].indexOf(t.id)<s.tabs.size-1, click:()=>{ const keys=[...s.tabs.keys()]; for (const id of keys.slice(keys.indexOf(t.id)+1)) closeTab(s,id); }},
    {label:'Rouvrir l’onglet fermé', accelerator:'CmdOrCtrl+Shift+T', enabled:closedTabs.length>0, click:()=>reopenClosed(s)}
  ]);
}
function mainMenu(s) {
  const t = activeTab(s);
  const hasPage = Boolean(t?.url);
  const ui = s.win.webContents;
  const panel = name => () => ui.send('dgb:command', name);
  const recent = downloads.slice(0,8);
  popupMenu(s, [
    {label:'Nouvel onglet', accelerator:'CmdOrCtrl+T', click:()=>{ try{newTab(s);ui.send('dgb:focus-address');}catch(e){notice(s,e.message,true);} }},
    {label:'Nouvelle fenêtre', accelerator:'CmdOrCtrl+N', click:()=>createWindow()},
    {label:'Rouvrir l’onglet fermé', accelerator:'CmdOrCtrl+Shift+T', enabled:closedTabs.length>0, click:()=>reopenClosed(s)},
    {type:'separator'},
    {label:'Historique', accelerator:'CmdOrCtrl+H', click:panel('history')},
    {label:'Favoris', click:panel('bookmarks')},
    {label:'Afficher la barre de favoris', type:'checkbox', checked:settings.showBookmarksBar, accelerator:'CmdOrCtrl+Shift+B', click:()=>setPreference('showBookmarksBar',!settings.showBookmarksBar)},
    {label:'Téléchargements', submenu:[
      ...(recent.length ? recent.map(d=>({label:`${d.state==='completed'?'✓':d.state==='progressing'?d.progress+' %':'✕'}  ${d.name}`.slice(0,70), enabled:d.state==='completed' && Boolean(d.path),
        submenu:[{label:'Ouvrir', click:()=>shell.openPath(d.path)},{label:'Afficher dans le dossier', click:()=>shell.showItemInFolder(d.path)}]})) : [{label:'Aucun téléchargement récent', enabled:false}]),
      {type:'separator'},{label:'Ouvrir le dossier des téléchargements', click:()=>shell.openPath(settings.downloads.folder||app.getPath('downloads'))}
    ]},
    {type:'separator'},
    {label:'Rechercher dans la page…', accelerator:'CmdOrCtrl+F', enabled:hasPage, click:()=>ui.send('dgb:focus-find')},
    {label:'Imprimer / enregistrer en PDF…', accelerator:'CmdOrCtrl+P', enabled:hasPage, click:()=>{ if(t.engine==='mshtml')hostCommand(t,'PRINT'); else t.view.webContents.print({printBackground:true},()=>{}); }},
    {label:'Enregistrer la page sous…', enabled:hasPage && t.engine==='chromium', click:()=>savePage(s,t).catch(e=>notice(s,e.message,true))},
    {label:`Zoom (${Math.round((hasPage && !t.view.webContents.isDestroyed()?t.view.webContents.getZoomFactor():1)*100)} %)`, enabled:hasPage, submenu:[
      {label:'Agrandir', accelerator:'CmdOrCtrl+Plus', click:()=>setZoom(s,1)},{label:'Réduire', accelerator:'CmdOrCtrl+-', click:()=>setZoom(s,-1)},{label:'Taille réelle', accelerator:'CmdOrCtrl+0', click:()=>setZoom(s,0)}]},
    {label:'Plein écran', accelerator:'F11', click:()=>s.win.setFullScreen(!s.win.isFullScreen())},
    {type:'separator'},
    {label:'Mots de passe', click:panel('passwords')},
    {label:'Radio', click:()=>openRadio()},
    {label:vpnActive()?'VPN DevGit (connecté)':'VPN DevGit', click:()=>vpnMenu(s)},
    {label:'Nouvel onglet privé (VPN)', accelerator:'CmdOrCtrl+Shift+N', click:()=>openPrivateTab(s).catch(e=>notice(s,e.message,true))},
    {label:'Mode gaming', type:'checkbox', checked:settings.gamingMode, click:()=>setGamingMode(!settings.gamingMode)},
    {label:'Gestionnaire de tâches', accelerator:'Shift+Esc', click:panel('tasks')},
    {label:'Thème', submenu:THEMES.map(th=>({label:th.name, type:'radio', checked:settings.theme===th.id, click:()=>setPreference('theme',th.id)}))},
    {type:'separator'},
    {label:'Sécurité et autorisations du site', click:panel('security')},
    {label:'Extensions', click:panel('extensions')},
    {label:'GitHub privé', click:panel('github')},
    {label:'Outils de développement', submenu:[
      {label:'Inspecter la page', accelerator:'F12', enabled:hasPage && t.engine!=='mshtml', click:()=>t.view.webContents.openDevTools({mode:'detach'})},
      {label:'Analyse réseau en direct', click:()=>showNetworkWindow(s)},
      ...(process.platform==='win32' ? [{label:t?.engine==='mshtml'?'Quitter le mode IE (MSHTML)':'Ouvrir ce site en mode IE (MSHTML)', enabled:hasPage, click:()=>toggleLegacyInTab(s).catch(e=>notice(s,e.message,true))}] : []),
      {label:'Afficher la source de la page', enabled:hasPage && t.engine==='chromium', click:()=>{ const keys=[...s.tabs.keys()]; try{ const id=newTab(s,'',{index:keys.indexOf(t.id)+1}); const nt=s.tabs.get(id); nt.url=t.url; nt.title='Source · '+t.title; showView(s,nt); nt.view.webContents.loadURL('view-source:'+t.url).catch(()=>{}); sendState(s);}catch(e){notice(s,e.message,true);} }}
    ]},
    {type:'separator'},
    {label:'Paramètres', click:panel('settings')},
    {label:'À propos de DevGitBrowser', click:panel('about')},
    {type:'separator'},
    {label:'Quitter', click:()=>app.quit()}
  ]);
}
function shieldMenu(s) {
  const t = activeTab(s);
  const host = currentHost(s);
  const state = adBlocker?.state();
  const blocked = t && adBlocker && !t.view.webContents.isDestroyed() ? adBlocker.blockedFor(t.view.webContents.id) : 0;
  const allowed = Boolean(t?.url && adBlocker?.isAllowlisted(t.url));
  popupMenu(s, [
    {label:`DevGitShield · ${state?.enabled ? (allowed ? 'en pause sur ce site' : 'actif') : 'désactivé'}`, enabled:false},
    {label:`${blocked} requête(s) bloquée(s) sur cette page · ${state?.totalBlocked||0} depuis le démarrage`, enabled:false},
    {label:'🕵 Qui me piste sur ce site ?', enabled:Boolean(t?.url), click:()=>s.win.webContents.send('dgb:command','trackers')},
    {type:'separator'},
    {label:host ? `Protéger ${host}` : 'Protéger ce site', type:'checkbox', checked:!allowed, enabled:Boolean(host) && Boolean(state?.enabled), click:()=>{
      try { adBlocker.setAllowed(host, !allowed); saveSettings(); t.view.webContents.reload(); broadcast(); notice(s, !allowed ? `DevGitShield en pause sur ${host}.` : `DevGitShield réactivé sur ${host}.`); } catch(e) { notice(s,e.message,true); }
    }},
    {label:host ? `🔧 ${host} ne fonctionne pas ? Mettre la protection en pause ici` : '🔧 Le site ne fonctionne pas ?', enabled:Boolean(host) && Boolean(state?.enabled) && !allowed, click:()=>{
      try { adBlocker.setAllowed(host, true); saveSettings(); t.view.webContents.reload(); broadcast(); notice(s, `DevGitShield en pause sur ${host} : le site se recharge normalement.`); } catch(e) { notice(s,e.message,true); }
    }},
    {type:'separator'},
    {label:'Protection sur tous les sites', type:'checkbox', checked:Boolean(state?.enabled), click:()=>{
      settings.adblockEnabled=!settings.adblockEnabled; adBlocker?.setEnabled(settings.adblockEnabled); saveSettings(); broadcast();
      if (t?.url) t.view.webContents.reload();
    }},
    {label:'Bloquer aussi les nuisances (cookies, pop-ups) · peut gêner certains sites', type:'checkbox', checked:Boolean(settings.shieldAnnoyances), click:()=>{
      settings.shieldAnnoyances=!settings.shieldAnnoyances; saveSettings(); notice(s,'Mise à jour des listes de filtres…');
      adBlocker?.setAnnoyances(settings.shieldAnnoyances).then(()=>{ if (t?.url) t.view.webContents.reload(); notice(s,'Filtres DevGitShield : '+(adBlocker.state().error||adBlocker.state().quality)); }).catch(()=>{});
    }},
    {label:'Mode renforcé YouTube/Twitch (expérimental, peut ralentir ces sites)', type:'checkbox', checked:Boolean(settings.shieldBoost), click:()=>{
      settings.shieldBoost=!settings.shieldBoost; saveSettings(); adBlocker?.setBoost(settings.shieldBoost); if (t?.url) t.view.webContents.reload(); broadcast();
    }},
    {label:state?.updating ? 'Mise à jour des filtres en cours…' : 'Mettre à jour les filtres maintenant', enabled:!state?.updating, click:()=>adBlocker?.refresh().then(()=>notice(s,'Filtres DevGitShield : '+(adBlocker.state().error||adBlocker.state().quality))).catch(()=>{})},
    {type:'separator'},
    {label:'Sécurité et autorisations…', click:()=>s.win.webContents.send('dgb:command','security')}
  ]);
}
function sitePermissions(origin) {
  const saved=origin ? settings.sitePrivacy[origin] || {} : {};
  return Object.fromEntries(['camera','microphone','notifications','geolocation'].map(k=>[
    k, saved[k] || (settings.mediaGrants[origin]?.[k] ? 'allow' : k==='camera'||k==='microphone'?'ask':'block')
  ]));
}
function permissionDecision(origin,key) { return sitePermissions(origin)[key]; }
function mediaGranted(origin,key) {
  const mode=permissionDecision(origin,key);
  return mode==='allow' || (mode!=='block' && Boolean(ephemeralMedia.get(origin)?.[key]));
}
function safeSourceOrigin(wc, details={}) {
  const origin=siteOrigin(details.securityOrigin||'') || siteOrigin(details.requestingUrl||'') || siteOrigin(details.requestingOrigin||'');
  if(origin)return origin;
  if(details.isMainFrame===false)return '';
  const own=siteOrigin(wc?.getURL?.()||'');
  if(own)return own;
  // about:blank popups can inherit their creator's origin. Never use this
  // fallback for a child that has navigated to another site.
  return (!wc?.getURL?.() || wc?.getURL?.()==='about:blank') ? popupOrigins.get(wc)||'' : '';
}
function mediaPermissionCheck(wc, origin, details={}) {
  const actual=siteOrigin(details.securityOrigin||'') || siteOrigin(details.requestingUrl||'') || siteOrigin(origin||'');
  if(!actual)return false;
  const media=details.mediaType;
  if(media==='video')return mediaGranted(actual,'camera');
  if(media==='audio')return mediaGranted(actual,'microphone');
  return mediaGranted(actual,'camera') && mediaGranted(actual,'microphone');
}
function privacyOriginAllowed(wc, origin, key) {
  return Boolean(siteOrigin(origin) && permissionDecision(origin,key)==='allow');
}
function bundledExtensionOrigin(origin) {
  // Les alertes MatchPulse peuvent afficher une notification Windows.
  const id = bundledInstalled.get('matchpulse')?.id;
  const match = String(origin||'').match(/^chrome-extension:\/\/([a-p]{32})(?:\/|$)/);
  return Boolean(id && match && match[1] === id);
}
function dialogParentFor(wc) {
  for(const s of windows.values())if([...s.tabs.values()].some(t=>t.view?.webContents===wc))return s.win;
  try {return BrowserWindow.fromWebContents(wc)||undefined;} catch {return undefined;}
}
function permissionDialog(wc, options) {
  const win=dialogParentFor(wc);
  return win?dialog.showMessageBox(win,options):dialog.showMessageBox(options);
}
function configurePermissionPolicy(ses = browsingSession) {
  ses.setPermissionCheckHandler((wc,permission,origin,details={})=>{
    if(permission==='media')return mediaPermissionCheck(wc,origin,details);
    if(permission==='display-capture')return Boolean(siteOrigin(origin)); // picker still must ask explicitly
    // Lecture de vidéos protégées (Netflix, Prime Video, Disney+, Spotify…) via Widevine.
    if(permission==='clipboard-sanitized-write'||permission==='fullscreen'||permission==='mediaKeySystem')return true;
    if(permission==='notifications' && bundledExtensionOrigin(origin))return true;
    if(permission==='notifications'||permission==='geolocation')return Boolean(privacyOriginAllowed(wc,siteOrigin(origin),permission));
    return false;
  });
  ses.setPermissionRequestHandler((wc,permission,callback,details={})=>{
    if(permission==='clipboard-sanitized-write'||permission==='fullscreen'||permission==='mediaKeySystem'){callback(true);return;}
    if(permission==='notifications' && bundledExtensionOrigin(details.requestingUrl||wc?.getURL?.())){callback(true);return;}
    if(permission==='openExternal'){
      const target=String(details.externalURL||'');
      if(!externalProtocolAllowed(target)){callback(false);return;}
      const from=safeSourceOrigin(wc,details)||'Ce site';
      permissionDialog(wc,{type:'question',title:'Ouvrir une application externe',message:`${from} veut ouvrir une application externe.`,
        detail:target.slice(0,200),buttons:['Annuler','Ouvrir'],defaultId:0,cancelId:0,noLink:true})
        .then(({response})=>{ if(response===1) shell.openExternal(target).catch(()=>{}); callback(false); }).catch(()=>callback(false));
      return;
    }
    const origin=safeSourceOrigin(wc,details);
    if(!origin){callback(false);return;}
    if(permission==='display-capture') {callback(true);return;} // actual source picker below
    if(['notifications','geolocation'].includes(permission)){
      const decision=permissionDecision(origin,permission);
      if(decision!=='ask'){callback(decision==='allow');return;}
      const name=permission==='notifications'?'notifications':'position géographique';
      permissionDialog(wc,{type:'question',title:'Autorisation du site',message:`${origin} demande l’accès : ${name}.`,buttons:['Refuser','Autoriser cette fois','Toujours autoriser'],defaultId:0,cancelId:0,noLink:true})
        .then(({response})=>{
          if(response===2){settings.sitePrivacy[origin]={...(settings.sitePrivacy[origin]||{}),[permission]:'allow'};saveSettings();}
          callback(response===1||response===2);broadcast();
        }).catch(()=>callback(false));
      return;
    }
    if(permission!=='media'){callback(false);return;}
    const requested=Array.isArray(details.mediaTypes)?details.mediaTypes:[];
    const types=[...new Set(requested.filter(x=>x==='audio'||x==='video').map(x=>x==='video'?'camera':'microphone'))];
    if(!types.length){callback(false);return;}
    if(types.some(key=>permissionDecision(origin,key)==='block')){callback(false);return;}
    if(types.every(key=>mediaGranted(origin,key))){callback(true);return;}
    const labels=types.map(x=>x==='camera'?'caméra':'microphone').join(' et ');
    permissionDialog(wc,{type:'question',title:'Autorisation caméra / microphone',
      message:`${origin} demande l'accès à : ${labels}.`,
      detail:'Vérifie ton site. Le matériel peut rester actif pendant l’appel. Tu peux révoquer les autorisations dans Sécurité.',
      buttons:['Refuser','Autoriser cette fois','Toujours autoriser pour ce site'],defaultId:0,cancelId:0,noLink:true})
      .then(({response})=>{
        if(response===1){const e=ephemeralMedia.get(origin)||{};types.forEach(k=>e[k]=true);ephemeralMedia.set(origin,e);}
        if(response===2){const e=settings.sitePrivacy[origin]||{};types.forEach(k=>e[k]='allow');settings.sitePrivacy[origin]=e;saveSettings();}
        callback(response===1||response===2);broadcast();
      }).catch(()=>callback(false));
  });
  // Rien n'est partagé sans un choix explicite dans le sélecteur (fenêtre façon Chrome, avec aperçus).
  ses.setDisplayMediaRequestHandler((request,callback)=>{
    const origin=siteOrigin(request.securityOrigin||'');
    if(!origin || !request.userGesture || !request.videoRequested){callback(null);return;}
    openSharePicker(request.frame?.webContents,origin,request.audioRequested===true).then(choice=>callback(choice||null)).catch(()=>callback(null));
  });
}
// ---- Sélecteur de partage d'écran (v1.18.3) : onglets Fenêtre / Écran complet, aperçus, audio système (Windows).
let sharePicker=null;
async function shareSources(thumbs=true){
  const sources=await desktopCapturer.getSources({types:['window','screen'],thumbnailSize:thumbs?{width:320,height:200}:{width:0,height:0},fetchWindowIcons:true});
  const own=sharePicker&&!sharePicker.win.isDestroyed()?sharePicker.win.getMediaSourceId():'';
  return sources.filter(s=>s.id!==own).slice(0,40);
}
const sourceView=s=>({id:s.id,name:String(s.name||'').slice(0,120),
  thumb:s.thumbnail&&!s.thumbnail.isEmpty()?'data:image/jpeg;base64,'+s.thumbnail.toJPEG(72).toString('base64'):'',
  icon:s.appIcon&&!s.appIcon.isEmpty()?s.appIcon.resize({width:16,height:16}).toDataURL():''});
function openSharePicker(wc,origin,audioRequested){
  if(sharePicker&&!sharePicker.win.isDestroyed()){sharePicker.finish(null);}
  return new Promise(resolve=>{
    const parent=dialogParentFor(wc);
    const win=new BrowserWindow({parent,modal:Boolean(parent),width:640,height:600,minWidth:520,minHeight:460,resizable:true,minimizable:false,maximizable:false,
      title:T('Partager l’écran'),icon:path.join(__dirname,'assets','icon.png'),backgroundColor:'#202124',show:false,autoHideMenuBar:true,
      webPreferences:{preload:path.join(__dirname,'ui','share','preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
    win.setMenu(null);
    win.webContents.on('will-navigate',e=>e.preventDefault());win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    let offered=new Map(),done=false,timer=null;
    const audio=audioRequested&&process.platform==='win32';
    const picker={win,finish(choice){
      if(done)return;done=true;clearInterval(timer);if(sharePicker===picker)sharePicker=null;
      try{if(!win.isDestroyed())win.destroy();}catch{}
      resolve(choice);
    }};
    sharePicker=picker;
    // 1er envoi immédiat sans aperçus (la liste s'affiche tout de suite), puis aperçus rafraîchis toutes les 3 s.
    const push=async(thumbs=true)=>{
      if(done||win.isDestroyed())return;
      try{
        const list=await shareSources(thumbs);if(done||win.isDestroyed())return;
        offered=new Map(list.map(x=>[x.id,x]));
        const views=list.map(sourceView),screens=views.filter(v=>v.id.startsWith('screen:'));
        // Noms d'écrans en français : « Écran entier » s'il n'y en a qu'un, sinon « Écran 1 », « Écran 2 »…
        screens.forEach((v,i)=>{v.name=screens.length>1?T('Écran')+' '+(i+1):T('Écran entier');});
        win.webContents.send('dgb-share:sources',{origin:origin.replace(/^https?:\/\//,''),audio,
          windows:views.filter(v=>v.id.startsWith('window:')),screens});
      }catch{}
    };
    win.webContents.once('did-finish-load',()=>{push(false).then(()=>push(true));timer=setInterval(push,3000);});
    win.once('ready-to-show',()=>{win.show();win.focus();});
    win.on('closed',()=>picker.finish(null));
    picker.onChoose=(id,withAudio)=>{
      const src=offered.get(id);
      picker.finish(src?{video:src,...(withAudio&&audio?{audio:'loopback'}:{})}:null);
    };
    win.loadFile(path.join(__dirname,'ui','share','index.html'));
  });
}
function configurePrivacyHeaders(ses = browsingSession) {
  // Global Privacy Control + Do Not Track. onBeforeSendHeaders n'est pas utilisé
  // par DevGitShield (qui occupe onBeforeRequest/onHeadersReceived).
  ses.webRequest.onBeforeSendHeaders((details,callback)=>{
    if(!settings.gpc){callback({});return;}
    const headers={...details.requestHeaders,'Sec-GPC':'1','DNT':'1'};
    callback({requestHeaders:headers});
  });
}
function nativePopupTopmost(origin) {
  if(Object.hasOwn(settings.popupTopmost,origin))return settings.popupTopmost[origin]===true;
  return popupMode(origin)==='allow'; // BabelVisio native webcam popouts only, not arbitrary sites.
}
function installPopupHandler(wc, originProvider, ownerProvider, depth, tab=null) {
  if(depth>4)return;
  const icon=path.join(__dirname,'assets','icon.png');
  wc.setWindowOpenHandler(details=>{
    const origin=originProvider();
    const s=ownerProvider();
    // Un lien target=_blank, un clic molette ou Ctrl+clic ouvrent un ONGLET.
    // Seules les vraies fenêtres (window.open avec dimensions) suivent la
    // politique pop-up par site (BabelVisio, webcams détachées…).
    if(['foreground-tab','background-tab'].includes(details.disposition) && isWebUrl(details.url) && popupMode(origin,settings.popupModes)!=='allow'){
      if(s && !s.win.isDestroyed() && tabOpenAllowed(origin) && !isAdDestination(details.url, wc.getURL())){
        const keys=[...s.tabs.keys()];
        const index=tab ? keys.indexOf(tab.id)+1 : undefined;
        setImmediate(()=>{ try { newTab(s, details.url, {background:details.disposition==='background-tab', index}); } catch(e) { notice(s,e.message,true); } });
      } else if(s){ s.blockedPopups++; sendState(s); }
      return {action:'deny'};
    }
    if(!popupLimiter.admit(origin,details.url,settings.popupModes)){
      if(s){s.blockedPopups++;sendState(s);}
      return {action:'deny'};
    }
    // Electron creates a native child window, preserving window.opener and DOM
    // access for same-origin webcam popouts. Never substitute a new tab.
    return {action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:{
      width:Math.max(360,Math.min(1200,Number(details.features?.match(/width=(\d+)/)?.[1])||950)),
      height:Math.max(260,Math.min(1000,Number(details.features?.match(/height=(\d+)/)?.[1])||720)),
      autoHideMenuBar:true,icon,backgroundColor:'#121b2b',
      webPreferences:{session:browsingSession,nodeIntegration:false,contextIsolation:true,
        sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,backgroundThrottling:true}
    }};
  });
  wc.on('did-create-window',(popup,details)=>{
    const origin=originProvider();
    popupOrigins.set(popup.webContents,origin);
    popup.setMenu(null);
    const isVideoPopup=nativePopupTopmost(origin);
    if(isVideoPopup){try{popup.setAlwaysOnTop(true,'floating');}catch{}}
    if (settings.webrtcProtection) { try { popup.webContents.setWebRTCIPHandlingPolicy('default_public_interface_only'); } catch {} }
    // Native Windows BrowserWindow keeps the site window.open opener relationship.
    // Avoid background video throttling only for explicit webcam popouts.
    popup.webContents.setBackgroundThrottling(!isVideoPopup);
    popup.webContents.on('context-menu',(_e,p)=>{
      const items=[{label:'Garder cette fenêtre au premier plan',type:'checkbox',checked:popup.isAlwaysOnTop(),click:()=>{try{popup.setAlwaysOnTop(!popup.isAlwaysOnTop(),'floating');}catch{}}}];
      if(p.isEditable)items.push({type:'separator'},{label:'Couper',role:'cut'},{label:'Copier',role:'copy'},{label:'Coller',role:'paste'});
      else if(p.selectionText)items.push({type:'separator'},{label:'Copier',role:'copy'});
      Menu.buildFromTemplate(items).popup({window:popup});
    });
    popup.webContents.on('before-input-event',(ev,input)=>{
      if(input.type==='keyDown' && input.alt && input.shift && String(input.key).toLowerCase()==='p'){ev.preventDefault();popup.setAlwaysOnTop(!popup.isAlwaysOnTop(),'floating');}
    });
    popup.once('closed',()=>popupLimiter.release(origin));
    popup.webContents.on('will-navigate',(event,target)=>{
      const next=typeof target==='string'?target:target.url;
      let safe=isWebUrl(next);
      if(!safe && typeof next==='string' && next.startsWith('blob:')){
        try{ safe=new URL(next).origin===(siteOrigin(popup.webContents.getURL())||popupOrigins.get(popup.webContents)); }catch{}
      }
      if(!safe)event.preventDefault();
    });
    installPopupHandler(popup.webContents,()=>siteOrigin(popup.webContents.getURL())||(popup.webContents.getURL()==='about:blank'?origin:''),ownerProvider,depth+1);
  });
}
function applySiteZoom(t) {
  if(t.view.webContents.isDestroyed()||!t.url)return;
  const origin=siteOrigin(t.url);
  t.view.webContents.setZoomFactor(settings.zoomByOrigin[origin]||1);
}
function setZoom(s,direction) {
  const t=activeTab(s);if(!t?.url)return;
  const origin=currentOrigin(s);if(!origin)return;
  const wc=t.view.webContents;
  const value=direction===0?1:Math.min(2,Math.max(.5,Math.round((wc.getZoomFactor()+direction*.1)*10)/10));
  wc.setZoomFactor(value);
  if(value===1)delete settings.zoomByOrigin[origin];else settings.zoomByOrigin[origin]=value;
  saveSettings();sendState(s);
  notice(s,`Zoom ${Math.round(value*100)} %`);
}
function configureDownloads(ses = browsingSession) {
  ses.on('will-download',(_event,item,wc)=>{
    const folder=settings.downloads.folder || app.getPath('downloads');
    const safeName=path.basename(item.getFilename()||'telechargement').replace(/[\u0000-\u001f<>:"|?*]+/g,'_').slice(0,180)||'telechargement';
    const owner=[...windows.values()].find(s=>[...s.tabs.values()].some(t=>t.view.webContents===wc))||focusedState();
    const record={id:++nextDownloadId,name:safeName,state:'progressing',progress:0,path:'',url:item.getURL()};
    if(isDangerousFile(safeName)){
      const parent=owner?.win;
      const options={type:'warning',title:'Fichier potentiellement dangereux',
        message:`« ${safeName} » peut exécuter des programmes sur ton ordinateur.`,
        detail:`Source : ${(()=>{try{return new URL(item.getURL()).hostname;}catch{return 'inconnue';}})()}\nTélécharge uniquement des logiciels de sources de confiance. Le fichier ne sera jamais ouvert automatiquement.`,
        buttons:['Annuler le téléchargement','Télécharger quand même'],defaultId:0,cancelId:0,noLink:true};
      const choice=parent&&!parent.isDestroyed()?dialog.showMessageBoxSync(parent,options):dialog.showMessageBoxSync(options);
      if(choice!==1){item.cancel();notice(owner,'Téléchargement annulé.');return;}
    }
    if(settings.downloads.askEachTime) item.setSaveDialogOptions({title:'Enregistrer le téléchargement — DevGitBrowser',defaultPath:path.join(folder,safeName),buttonLabel:'Enregistrer'});
    else item.setSavePath(uniquePath(folder,safeName));
    downloads.unshift(record); if(downloads.length>30) downloads.length=30;
    let last=0;
    item.on('updated',(_e,state)=>{
      if(state==='interrupted'){record.state='interrupted';}
      else{const total=item.getTotalBytes();record.progress=total?Math.round(item.getReceivedBytes()/total*100):0;record.state='progressing';}
      if(Date.now()-last>700){last=Date.now();broadcast();}
    });
    item.once('done',(_e,state)=>{
      record.state=state==='completed'?'completed':'failed';record.path=item.getSavePath();record.progress=state==='completed'?100:record.progress;
      notice(owner,state==='completed'?`Téléchargé : ${record.name}`:`Téléchargement ${state==='cancelled'?'annulé':'échoué'} : ${record.name}`,state!=='completed'&&state!=='cancelled');
      broadcast();
    });
    broadcast();
  });
}
function uniquePath(folder,name) {
  const ext=path.extname(name), base=path.basename(name,ext);
  let candidate=path.join(folder,name);
  for(let i=1;fs.existsSync(candidate)&&i<500;i++)candidate=path.join(folder,`${base} (${i})${ext}`);
  return candidate;
}
// ---- Restauration de la session (après une mise à jour ou un redémarrage)
function sessionSnapshot() {
  return {version:1, savedAt:Date.now(), windows:[...windows.values()].filter(s=>!s.win.isDestroyed()).map(s=>{
    const kept=[...s.tabs.values()].filter(t=>isWebUrl(t.url) && !t.xTab && !t.private);
    const tabs=kept.map(t=>t.url);
    const keys=kept.map(t=>t.id);
    const bounds=s.win.isMaximized()||s.win.isFullScreen() ? {...s.win.getNormalBounds(),maximized:true} : s.win.getBounds();
    return {tabs, active:Math.max(0,keys.indexOf(s.activeId)), bounds};
  }).filter(w=>w.tabs.length)};
}
function saveSessionNow() {
  if (sessionTimer) { clearTimeout(sessionTimer); sessionTimer=null; }
  if (!settings || !app.isReady() || !windows.size) return;
  try { writeAtomic(userDataFile('session.json'), JSON.stringify(settings.restoreSession || settings.restoreAfterUpdate ? sessionSnapshot() : {version:1,windows:[]})); } catch {}
}
function scheduleSessionSave() {
  if (quitting || sessionTimer || !settings) return;
  sessionTimer = setTimeout(()=>{ sessionTimer=null; saveSessionNow(); }, 2500);
  sessionTimer.unref?.();
}
function restoreSession() {
  // Après une mise à jour lancée depuis la fenêtre dédiée, les onglets sont toujours rouverts (une fois).
  const afterUpdate = settings.restoreAfterUpdate === true;
  if (afterUpdate) { settings.restoreAfterUpdate = false; saveSettings(); }
  const data = settings.restoreSession || afterUpdate ? readJson('session.json') : null;
  const list = Array.isArray(data?.windows) ? data.windows.slice(0,6) : [];
  let restored = 0;
  for (const w of list) {
    const tabs=(Array.isArray(w.tabs)?w.tabs:[]).filter(u=>typeof u==='string' && isWebUrl(u)).slice(0,MAX_TABS);
    if (!tabs.length) continue;
    createWindow({tabs, activeIndex:Number(w.active)||0, bounds:w.bounds}); restored++;
  }
  if (!restored) createWindow();
}
function resetSyncTimer() {
  if(syncTimer)clearInterval(syncTimer);
  syncTimerCadence=settings.performance.mode==='eco'?300_000:90_000;
  syncTimer=setInterval(()=>{if(token&&settings.github)syncGithub().catch(()=>{});},syncTimerCadence);
}
async function configureProxy(proxy) {
  const safe=normalizeProxy(proxy);
  // Le VPN reste prioritaire : le réglage sera appliqué à sa déconnexion.
  if(!vpnGlobal || (tor?.state.status!=='on' && tor?.state.status!=='starting')) await browsingSession.setProxy(proxyForElectron(safe));
  if(typeof browsingSession.closeAllConnections==='function') await browsingSession.closeAllConnections();
  settings.proxy=safe;saveSettings();broadcast();
}
function api() { if(!token) throw new Error('Connecte d’abord ton compte GitHub.');return new GitHubAPI(token); }
async function connectGitHub(userToken) {
  if(typeof userToken!=='string'||userToken.length>300)throw new Error('Jeton invalide.');
  const candidate=userToken.trim();
  const user=await new GitHubAPI(candidate).getUser();
  if(!user?.id||!user?.login)throw new Error('Authentification GitHub non reconnue.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Ton système ne propose pas le stockage chiffré des identifiants : connexion refusée.');
  // Never keep the previous account's repository config when switching accounts.
  if(account?.id!==user.id || settings.github?.ownerId!==user.id) {
    settings.github=null; clearExtensions();saveSettings();
  }
  storeToken(candidate);token=candidate;account={id:user.id,login:user.login};
  lastError='';broadcast();return publicGitInfo();
}
function publicGitInfo(){return{connected:Boolean(token&&account),user:account?.login||'',repo:settings.github?.repo||''};}
async function selectRepository(name, branchValue) {
  const client=api();
  const repoName=cleanRepoName(name), branch=cleanBranch(branchValue||'main');
  const remote=await client.getRepo(account.login,repoName);
  const info=verifyPrivateOwnedRepo(account,remote);
  // Check that the target branch exists before enabling automatic extension installation.
  await client.getTree(info.owner,info.repo,branch);
  if(settings.github?.repoId!==info.repoId || settings.github?.branch!==branch) clearExtensions();
  settings.github={...info,branch};saveSettings();
  lastError='';await syncGithub();return publicGitInfo();
}
// ---- DevGit Store : extensions publiées sur le serveur DevGit (VPS), installées à la demande.
const storeFolder = () => path.join(app.getPath('userData'), 'store-extensions');
let storeCatalog = null, storeCatalogAt = 0, storeTimer = null;
const RESERVED_STORE_IDS = new Set(['matchpulse', ...BUILTIN_KEYS.map(k => store.slug(k))]);
async function fetchStoreCatalog(force) {
  if (remote?.disabled('store')) throw new Error('La boutique est temporairement fermée (maintenance).');
  if (!telemetry?.available) throw new Error('Aucun serveur DevGit configuré dans cette version.');
  if (!force && storeCatalog && Date.now() - storeCatalogAt < 5 * 60_000) return storeCatalog;
  const data = await telemetry.api('/v1/store/catalog');
  const list = (Array.isArray(data?.extensions) ? data.extensions : []).filter(e => store.validId(e.id) && !RESERVED_STORE_IDS.has(e.id) && /^[a-f0-9]{64}$/.test(e.sha256)).slice(0, 200);
  storeCatalog = list.map(e => ({id: e.id, name: String(e.name || e.id).slice(0, 80), version: String(e.version || ''), description: String(e.description || '').slice(0, 300),
    author: String(e.author || '').slice(0, 60), size: Number(e.size) || 0, sha256: e.sha256, updated: e.updated || '', installs: Number(e.installs) || 0}));
  storeCatalogAt = Date.now(); return storeCatalog;
}
async function loadStoreDirectory(id, info, dir) {
  const loaded = await browsingSession.extensions.loadExtension(dir, {allowFileAccess: false});
  const previous = storeInstalled.get(id);
  if (previous?.chromeId && previous.chromeId !== loaded.id) try { browsingSession.extensions.removeExtension(previous.chromeId); } catch {}
  storeInstalled.set(id, {chromeId: loaded.id, name: loaded.name || info.name, version: info.version, sha256: info.sha256, directory: dir, error: null});
}
async function installStoreExtension(id, {silent = false} = {}) {
  if (!store.validId(id) || RESERVED_STORE_IDS.has(id)) throw new Error('Extension inconnue.');
  const entry = (await fetchStoreCatalog(true)).find(e => e.id === id);
  if (!entry) throw new Error('Cette extension n’est plus disponible.');
  const buf = await telemetry.api('/v1/store/package/' + id, {raw: true, maxBytes: 40 * 1024 * 1024, timeout: 120_000});
  const bundle = store.parseBundle(buf, entry.sha256, id);
  const dir = store.unpack(bundle, path.join(storeFolder(), id, entry.sha256.slice(0, 16)));
  await loadStoreDirectory(id, {name: bundle.manifest.name, version: String(bundle.manifest.version), sha256: entry.sha256}, dir);
  // Nettoyer les anciennes versions de cette extension.
  for (const old of fs.readdirSync(path.join(storeFolder(), id))) if (old !== entry.sha256.slice(0, 16)) try { fs.rmSync(path.join(storeFolder(), id, old), {recursive: true, force: true}); } catch {}
  const isNew = !settings.store[id];
  settings.store[id] = {version: String(bundle.manifest.version), sha256: entry.sha256}; saveSettings();
  if (isNew && telemetry.enabled) telemetry.api('/v1/store/installed', {method: 'POST', body: {id}}).catch(() => {});
  if (!silent) { logger.info('Store : extension installée', id, bundle.manifest.version); ach('bump','extensions'); }
  broadcast(); return {id, name: bundle.manifest.name, version: String(bundle.manifest.version)};
}
function uninstallStoreExtension(id) {
  const info = storeInstalled.get(id);
  if (info?.chromeId) try { browsingSession.extensions.removeExtension(info.chromeId); } catch {}
  storeInstalled.delete(id); delete settings.store[id]; saveSettings();
  try { fs.rmSync(path.join(storeFolder(), id), {recursive: true, force: true}); } catch {}
  broadcast(); return true;
}
async function loadStoreExtensions() {
  for (const [id, info] of Object.entries(settings.store)) {
    const dir = path.join(storeFolder(), id, info.sha256.slice(0, 16));
    try {
      const manifest = store.checkManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
      await loadStoreDirectory(id, {name: manifest.name, version: info.version, sha256: info.sha256}, dir);
    } catch (e) { storeInstalled.set(id, {chromeId: null, name: id, version: info.version, sha256: info.sha256, directory: dir, error: 'À réinstaller : ' + (e.message || e)}); }
  }
  broadcast();
}
// Mises à jour automatiques des extensions de la boutique (au démarrage puis toutes les 6 h).
async function updateStoreExtensions() {
  if (!telemetry?.available || !Object.keys(settings.store).length) return;
  try {
    const list = await fetchStoreCatalog(true);
    for (const id of Object.keys(settings.store)) {
      const entry = list.find(e => e.id === id), mine = settings.store[id];
      if (entry && (entry.sha256 !== mine.sha256 || storeInstalled.get(id)?.error)) {
        try { const r = await installStoreExtension(id, {silent: true}); logger.info('Store : mise à jour', id, r.version); }
        catch (e) { logger.warn('Store : mise à jour impossible', id, e.message); }
      }
    }
  } catch (e) { logger.warn('Store', e.message); }
}
function startStore() { clearInterval(storeTimer); setTimeout(updateStoreExtensions, 30_000).unref?.(); storeTimer = setInterval(updateStoreExtensions, 6 * 3_600_000); storeTimer.unref?.(); }
async function loadBundledExtensions() {
  for (const key of BUILTIN_KEYS) {
    try {
      const resourceRoot = app.isPackaged ? path.join(process.resourcesPath,'app.asar.unpacked') : __dirname;
      const descriptor = bundledDescriptor(resourceRoot, key);
      const loaded = await browsingSession.extensions.loadExtension(descriptor.directory, {allowFileAccess:false});
      bundledInstalled.set(key,{id:loaded.id,name:loaded.name||descriptor.name,version:descriptor.version,directory:descriptor.directory,error:null});
    } catch (err) {
      bundledInstalled.set(key,{id:null,name:key,version:'',error:String(err.message||err)});
    }
  }
  broadcast();
}
function clearExtensions() {
  for(const ext of installed.values()){
    if(ext.id)try{browsingSession.extensions.removeExtension(ext.id);}catch{}
  }
  installed.clear();broadcast();
}
function disconnectGitHub() {
  clearExtensions();token='';account=null;settings.github=null;lastError='';lastSync=null;
  try{fs.rmSync(userDataFile('github-secret.dat'),{force:true});}catch{}
  // Only cached GitHub extensions are removed. Browser history/cookies remain per OS user.
  try{fs.rmSync(cacheFolder(),{recursive:true,force:true});}catch{}
  saveSettings();broadcast();
}
async function syncGithub() {
  if(syncing)return;
  if(!token||!account||!settings.github)throw new Error('Connecte GitHub et sélectionne un dépôt privé.');
  syncing=true;lastError='';broadcast();
  const repo=settings.github;
  try{
    const client=api();
    const [currentUser,remote]=await Promise.all([client.getUser(),client.getRepo(repo.owner,repo.repo)]);
    if(currentUser.id!==account.id)throw new Error('Le compte GitHub a changé. Déconnecte-toi puis reconnecte-toi.');
    const validated=verifyPrivateOwnedRepo(currentUser,remote);
    if(validated.repoId!==repo.repoId || validated.ownerId!==repo.ownerId)throw new Error('Identité du dépôt GitHub différente : synchronisation refusée.');
    const groups=groupExtensions(await client.getTree(repo.owner,repo.repo,repo.branch));
    const processed=new Set();
    for(const [key,files] of groups){
      // Official extensions are bundled by the publisher, not replaceable by a GitHub repo.
      if(reservedGitHubKey(key))continue;
      processed.add(key);
      const fingerprint=revision(files);
      if(installed.get(key)?.fingerprint===fingerprint && installed.get(key)?.id)continue;
      const dir=path.join(cacheFolder(),String(repo.repoId),key,fingerprint);
      try{
        // Never trust existing cache files as proof of GitHub origin: verify every Git blob.
        fs.rmSync(dir,{recursive:true,force:true});
        fs.mkdirSync(dir,{recursive:true,mode:0o700});
        for(const item of files){
          const output=extensionPath(path.join(cacheFolder(),String(repo.repoId)),key,fingerprint,item.path);
          const data=await client.blob(repo.owner,repo.repo,item.sha);
          fs.mkdirSync(path.dirname(output),{recursive:true,mode:0o700});
          fs.writeFileSync(output,data,{mode:0o600});
        }
        const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
        if(![2,3].includes(manifest.manifest_version)||typeof manifest.name!=='string'||!manifest.name.trim()){
          throw new Error('manifest.json invalide (version 2 ou 3 attendue).');
        }
        const previous=installed.get(key);
        // The new extension is loaded before the previous version is removed.
        const loaded=await browsingSession.extensions.loadExtension(dir,{allowFileAccess:false});
        if(previous?.id)try{browsingSession.extensions.removeExtension(previous.id);}catch{}
        installed.set(key,{id:loaded.id,name:loaded.name||manifest.name,version:manifest.version||'',fingerprint,directory:dir,error:null});
      }catch(err){
        const previous=installed.get(key);
        if(!previous?.id)installed.set(key,{id:null,name:key,version:'',fingerprint:'',error:String(err.message||err)});
      }
      broadcast();
    }
    for(const [key,info] of installed){
      if(processed.has(key))continue;
      if(info.id)try{browsingSession.extensions.removeExtension(info.id);}catch{}
      installed.delete(key);
    }
    lastSync=new Date().toISOString();
  }catch(err){lastError=String(err.message||err);throw err;}
  finally{syncing=false;broadcast();}
}
function showNetworkWindow(owner){
  const old=networkWindows.get(owner.id);
  if(old&&!old.win.isDestroyed()){old.win.focus();return;}
  const win=new BrowserWindow({width:1180,height:740,minWidth:720,minHeight:490,
    title:'DevGitBrowser — Analyse réseau',icon:path.join(__dirname,'assets','icon.png'),backgroundColor:'#070c25',autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'network','preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
  win.setMenu(null);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  const inspector={win,monitor:new NetworkMonitor(msg=>{if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send('dgb-network:event',msg);})};
  networkWindows.set(owner.id,inspector);
  win.on('closed',()=>{inspector.monitor.stop();networkWindows.delete(owner.id);});
  win.webContents.once('did-finish-load',()=>inspector.monitor.start(activeTab(owner)?.url?activeTab(owner).view.webContents:null));
  win.loadFile(path.join(__dirname,'network','index.html'));
}
function inspectorFromSender(wc){
  for(const inspector of networkWindows.values())if(!inspector.win.isDestroyed()&&inspector.win.webContents===wc)return inspector;
  throw new Error('Accès au moniteur réseau refusé.');
}
function ownerForInspector(inspector){
  for(const [id,entry] of networkWindows)if(entry===inspector)return windows.get(id);
  return null;
}
function registerNetworkIpc(){
  ipcMain.handle('dgb-network:initial',event=>({status:inspectorFromSender(event.sender).monitor.status}));
  ipcMain.handle('dgb-network:clear',event=>inspectorFromSender(event.sender).monitor.clear());
  ipcMain.handle('dgb-network:reconnect',event=>{
    const inspector=inspectorFromSender(event.sender),owner=ownerForInspector(inspector),tab=owner&&activeTab(owner);
    inspector.monitor.start(tab?.url?tab.view.webContents:null);
  });
  ipcMain.handle('dgb-network:body',(event,id)=>inspectorFromSender(event.sender).monitor.body(id));
}
// Separate MSHTML process is hosted as a native child in the current tab area.
// BrowserWindow's Chromium shell remains the owner; no second top-level window appears.
function stopEmbeddedLegacy(t,restore=true){
  if(!t)return;
  const host=t.legacyHost;
  t.legacyHost=null;t.engine='chromium';t.legacyTrustOrigin='';t.legacyBits='';t.legacyPluginInfo='';
  if(host){
    if(host.watchdog)clearTimeout(host.watchdog);
    host.stopping=true;
    try{host.child.stdin.write(encodeCommand('QUIT'));}catch{}
    try{host.child.stdin.end();}catch{}
    // The native child process must not outlive the browser if it misbehaves.
    setTimeout(()=>{try{if(host.child.exitCode===null)host.child.kill();}catch{}},1800).unref?.();
  }
  if(restore && t.url && !t.view.webContents.isDestroyed()){
    if(!t.owner.win.isDestroyed() && t.owner.activeId===t.id && !t.owner.panelOpen)t.view.setVisible(true);
    const current=t.view.webContents.getURL();
    if(current!==t.url)t.view.webContents.loadURL(t.url).catch(()=>{});
  }
}
function embeddedHostFailed(t){
  const origin=t.legacyTrustOrigin||originOf(t.url);
  if(origin && settings.legacyTrustedOrigins[origin]===true){
    delete settings.legacyTrustedOrigins[origin];saveSettings();
  }
}
function handleEmbeddedEvent(t,host,message){
  if(t.legacyHost!==host || host.stopping)return;
  const {event,value}=message;
  if(event==='ATTACHED'){
    host.attached=true;sendState(t.owner);
  } else if(event==='READY'){
    // Loading HTML is not proof of a painted window. Await the helper's
    // verified native DISPLAY event before hiding the Chromium fallback.
    host.documentLoaded=true;host.lastReadyUrl=value;
  } else if(event==='DISPLAY'){
    if(host.ready || !host.documentLoaded)return;
    if(host.watchdog)clearTimeout(host.watchdog);
    host.ready=true;host.starting=false;t.engine='mshtml';t.legacyError='';
    // Only hide Chromium after the owned Win32 overlay is visible.
    syncNativeHost(t);layout(t.owner);
    if(!t.view.webContents.isDestroyed())t.view.setVisible(false);
    if(!t.view.webContents.isDestroyed())t.view.webContents.loadURL('about:blank').catch(()=>{});
    sendState(t.owner);
    if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-ready', value);
  } else if(event==='HOSTARCH'){
    t.legacyBits=String(value).slice(0,32);sendState(t.owner);
  } else if(event==='PLUGIN'){
    t.legacyPluginInfo=String(value).slice(0,250);sendState(t.owner);
    if(/non trouvé|indisponible/i.test(t.legacyPluginInfo) && !host.pluginNoticeSent){
      host.pluginNoticeSent=true;
      if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error','Diagnostic CamfrogWeb : '+t.legacyPluginInfo);
    }
  } else if(event==='POPUP' || event==='POPUPREADY' || event==='POPUPBLOCKED' || event==='POPUPCLOSED'){
    if(event==='POPUPBLOCKED' && !t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',String(value).slice(0,250));
  } else if(event==='MODE'){
    host.documentMode=Number(value)||0;
  } else if(event==='INCOMPATIBLE'){
    const failure=String(value).slice(0,250);
    embeddedHostFailed(t);t.legacyError=failure;stopEmbeddedLegacy(t,true);sendState(t.owner);
    if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',failure);
  } else if(event==='URL'){
    try{t.url=validateLegacyTarget(value);t.title=new URL(t.url).hostname;}catch{return;}
    sendState(t.owner);
  } else if(event==='TITLE'){
    if(value)t.title=String(value).slice(0,90);sendState(t.owner);
  } else if(event==='ERROR'){
    const failure=String(value).slice(0,250);
    embeddedHostFailed(t);t.legacyError=failure;stopEmbeddedLegacy(t,true);sendState(t.owner);
    if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',failure);
  } else if(event==='EXTERNAL'){
    // Modern video targets deliberately fall back to Chromium (no WebRTC in IE11).
    try{const url=validateLegacyTarget(value);stopEmbeddedLegacy(t,false);navigateTab(t,url);}catch{}
  }
}
async function startEmbeddedLegacy(s,t,rememberTrust){
  if(!t?.url)throw new Error('Ouvre d’abord un site ancien.');
  if(process.platform!=='win32')throw new Error('Le moteur historique MSHTML est uniquement disponible sous Windows.');
  const url=validateLegacyTarget(t.url),origin=originOf(url);
  if(requiresModernVideo(url))throw new Error('Ce site utilise des webcams/vidéos modernes. MSHTML ne prend pas en charge WebRTC : Chromium est conservé pour éviter les pages noires.');
  if(t.legacyHost)return true;
  if(rememberTrust){settings.legacyTrustedOrigins[origin]=true;saveSettings();}
  t.legacyTrustOrigin=origin;
  t.legacyError='';t.legacyBits='';t.legacyPluginInfo='';t.forceModern=false;
  const handle=s.win.getNativeWindowHandle();
  const winHandle=handle.length===8?handle.readBigUInt64LE(0).toString():String(handle.readUInt32LE(0));
  const bounds=nativeBounds(s);
  const helper=path.join(__dirname.replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked'),'legacy',legacyHostFilename(url));
  const child=spawn(helper,['-ParentHandle',winHandle,'-InitialUrl',url,
    '-X',String(bounds[0]),'-Y',String(bounds[1]),'-Width',String(bounds[2]),
    '-Height',String(bounds[3])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const host={child,ready:false,starting:true,stopping:false,buffer:'',watchdog:null};
  host.watchdog=setTimeout(()=>{if(t.legacyHost===host && !host.ready){
    embeddedHostFailed(t);t.legacyError=host.attached ?
      'Le contrôle IE a été intégré, mais la page ne s’est pas chargée. Retour à Chromium.' :
      'Impossible d’afficher le contrôle Windows IE. Vérifie les composants MSHTML et les paramètres de sécurité Windows.';
    stopEmbeddedLegacy(t,true);sendState(t.owner);
    if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',t.legacyError);
  }},20000);host.watchdog.unref?.();
  t.legacyHost=host;t.engine='mshtml-pending';
  // Prevent the render from being replaced by an unrelated tab while it starts.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',text=>{
    host.buffer+=text;
    if(host.buffer.length>32000){host.buffer='';return;}
    let idx;while((idx=host.buffer.indexOf('\n'))!==-1){
      const line=host.buffer.slice(0,idx).replace(/\r$/, '');host.buffer=host.buffer.slice(idx+1);
      const event=decodeEvent(line);if(event)handleEmbeddedEvent(t,host,event);
    }
  });
  child.stderr.on('data',chunk=>{host.stderr=(host.stderr||'')+String(chunk).slice(0,200);}); // diagnostic only, never sent to website
  child.on('error',err=>{
    if(t.legacyHost===host){embeddedHostFailed(t);t.legacyError=String(err.message||err).slice(0,250);stopEmbeddedLegacy(t,true);sendState(t.owner);
      if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',t.legacyError);}
  });
  child.on('exit',()=>{
    if(t.legacyHost===host){embeddedHostFailed(t);t.legacyError='Le processus Windows MSHTML s’est arrêté sans afficher la page. Retour à Chromium.';stopEmbeddedLegacy(t,true);sendState(t.owner);
      if(!t.owner.win.isDestroyed())t.owner.win.webContents.send('dgb:legacy-error',t.legacyError);}
  });
  sendState(s);return true;
}
async function toggleLegacyInTab(s){
  const tab=activeTab(s);if(!tab?.url)throw new Error('Ouvre d’abord un site ancien.');
  if(tab.engine==='mshtml' || tab.engine==='mshtml-pending'){
    delete settings.legacyTrustedOrigins[tab.legacyTrustOrigin||originOf(tab.url)];saveSettings();
    tab.forceModern=true;stopEmbeddedLegacy(tab,true);sendState(s);return false;
  }
  return startEmbeddedLegacy(s,tab,true);
}

// ======================================================== Mots de passe
function vaultProtect(buffer) {
  // Enveloppe supplémentaire liée au compte Windows (DPAPI).
  if (!safeStorage.isEncryptionAvailable()) return buffer;
  return Buffer.concat([Buffer.from('DPAPI1:'), safeStorage.encryptString(buffer.toString('base64'))]);
}
function vaultUnprotect(buffer) {
  const head = Buffer.from('DPAPI1:');
  if (buffer.subarray(0, head.length).equals(head)) return Buffer.from(safeStorage.decryptString(buffer.subarray(head.length)), 'base64');
  return buffer;
}
function copySecret(text) {
  clipboard.writeText(String(text));
  if (clipboardTimer) clearTimeout(clipboardTimer);
  // Efface le presse-papiers 30 s plus tard s'il contient toujours le secret.
  clipboardTimer = setTimeout(() => { try { if (clipboard.readText() === String(text)) clipboard.clear(); } catch {} }, 30_000);
  clipboardTimer.unref?.();
}
function fillCredentials(t, entry) {
  const wc = t.view.webContents;
  const origin = siteOrigin(wc.getURL()) || (()=>{ try { const u=new URL(wc.getURL()); return u.origin; } catch { return ''; } })();
  if (!origin || origin !== entry.origin) throw new Error('Le site affiché ne correspond pas à cet identifiant.');
  wc.mainFrame.send('dgb-pw:fill', {origin: entry.origin, username: entry.username, password: entry.password});
  vault.markUsed(entry.id);
}
function passwordMenu(s) {
  const t = activeTab(s);
  if (!t?.url) return;
  if (!vault.isUnlocked()) { s.win.webContents.send('dgb:command', 'unlock-fill'); return; }
  const entries = vault.forOrigin(t.url);
  const items = entries.map(e => ({label: `Remplir : ${e.username || '(sans identifiant)'}`, click: () => { try { fillCredentials(t, e); } catch (err) { notice(s, err.message, true); } }}));
  if (!items.length) items.push({label: 'Aucun identifiant enregistré pour ce site', enabled: false});
  items.push({type: 'separator'},
    {label: 'Générer un mot de passe fort (copié)', click: () => { copySecret(generatePassword(20)); notice(s, 'Mot de passe fort copié (effacé du presse-papiers dans 30 s).'); }},
    {label: 'Gérer les mots de passe…', click: () => s.win.webContents.send('dgb:command', 'passwords')},
    {label: 'Verrouiller le coffre', click: () => { vault.lock(); broadcast(); }});
  popupMenu(s, items);
}
function registerPasswordCapture() {
  // DevGit Video local. Le VPS reste réservé au catalogue et aux fichiers d'extension.
  const toolsDir = app.isPackaged ? path.join(process.resourcesPath,'video') : path.join(__dirname,'vendor','video');
  const localVideo = new VideoLocal({toolDir:toolsDir});
  ipcMain.handle('dgb-video:local',async(event,request)=>{
    const t=tabForWebContents(event.sender);
    if(!t||event.sender.session!==browsingSession||event.senderFrame!==event.sender.mainFrame||t.engine!=='chromium')
      throw new Error('Demande vidéo non autorisée.');
    if(!storeInstalled.get('devgit-video')?.chromeId)throw new Error('Installe DevGit Video depuis la boutique.');
    if(!request||!['formats','download'].includes(request.action)||!isYoutubeWatchUrl(event.sender.getURL(),request.videoId))
      throw new Error('Seule la vidéo YouTube affichée est autorisée.');
    const now=Date.now(),id=request.videoId;
    if(request.action==='formats'){
      const cached=videoFormatCache.get(id);
      if(cached&&now-cached.at<30000)return cached.value;
      const key='formats:'+event.sender.id;
      if(now-(videoRequestTimes.get(key)||0)<5000)throw new Error('Recherche trop rapide. Réessaie dans quelques secondes.');
      videoRequestTimes.set(key,now);
      const value=await localVideo.formats(id);
      if(videoFormatCache.size>30)videoFormatCache.clear();
      videoFormatCache.set(id,{at:Date.now(),value});
      return value;
    }
    const quality=validateVideoRequest(id,request.kind,request.quality);
    const key='download:'+event.sender.id;
    if(now-(videoRequestTimes.get(key)||0)<3000)throw new Error('Une demande de téléchargement est déjà en cours.');
    videoRequestTimes.set(key,now);
    if(localVideo.busy)throw new Error('Un téléchargement local est déjà en cours.');
    const kind=request.kind;
    const pick=await dialog.showSaveDialog(t.owner.win,{
      title:'Enregistrer la vidéo — DevGit Video (local)',
      defaultPath:path.join(settings.downloads.folder||app.getPath('downloads'),'YouTube-'+id+'.'+kind),
      buttonLabel:'Enregistrer sur mon PC',
      filters:[{name:kind==='mp4'?'Vidéo MP4':'Audio MP3',extensions:[kind]}]
    });
    if(pick.canceled||!pick.filePath)return {cancelled:true};
    if(fs.existsSync(pick.filePath))throw new Error('Le fichier existe déjà : choisis un autre nom.');
    return localVideo.download({videoId:id,kind,quality,savePath:pick.filePath});
  });
  // Bouton « Télécharger » du survol vidéo : uniquement les fichiers vidéo directs (pas les flux protégés).
  ipcMain.on('dgb-preview:hover', (event, data) => {
    const t = tabForWebContents(event.sender);
    if (t && event.senderFrame === event.sender.mainFrame) onPreviewHover(t, data);
  });
  ipcMain.on('dgb-preview:action', (event, action) => {
    const p = preview; if (!p || p.win.isDestroyed() || event.sender !== p.win.webContents) return;
    if (action === 'open') { const url = p.view.webContents.getURL() || p.url; closeLinkPreview(); if (isWebUrl(url) && !p.s.win.isDestroyed()) { try { newTab(p.s, url); } catch (e) { notice(p.s, e.message, true); } } }
    else closeLinkPreview();
  });
  ipcMain.on('dgb-video:download', (event, src) => {
    const t = tabForWebContents(event.sender);
    if (!t || typeof src !== 'string' || !/^https?:\/\//i.test(src) || src.length > 4000) return;
    try { event.sender.downloadURL(src); notice(t.owner, 'Téléchargement de la vidéo lancé.'); } catch {}
  });
  ipcMain.on('dgb-pw:form', (event, url) => {
    const t = tabForWebContents(event.sender);
    if (!t || event.senderFrame !== event.sender.mainFrame) return;
    if (siteOrigin(String(url)) && siteOrigin(String(url)) === siteOrigin(event.sender.getURL())) { t.loginForm = true; sendState(t.owner); }
  });
  ipcMain.on('dgb-pw:submitted', (event, data) => {
    try {
      const t = tabForWebContents(event.sender);
      if (!t || !settings.savePasswords || !vault || event.senderFrame !== event.sender.mainFrame) return;
      const origin = siteOrigin(String(data?.url || ''));
      if (!origin || origin !== siteOrigin(event.sender.getURL())) return;
      const username = String(data?.username || '').slice(0, 200), password = String(data?.password || '');
      if (!password || password.length > 1000) return;
      if (vault.isUnlocked()) {
        if (vault.isNever(origin)) return;
        const existing = vault.forOrigin(origin).find(e => e.username === username);
        if (existing && existing.password === password) return;
        pendingPassword = {windowId: t.owner.id, tabId: t.id, origin, username, password, update: Boolean(existing), at: Date.now()};
      } else {
        pendingPassword = {windowId: t.owner.id, tabId: t.id, origin, username, password, update: false, at: Date.now()};
      }
      // Proposition valable 3 minutes, jamais écrite sur disque tant qu'elle n'est pas acceptée.
      setTimeout(() => { if (pendingPassword && Date.now() - pendingPassword.at >= 179_000) { pendingPassword = null; broadcast(); } }, 180_000).unref?.();
      sendState(t.owner);
    } catch (err) { logger.warn('Capture mot de passe', err.message); }
  });
}
// ======================================================== Radio
function openRadio() {
  if (radioWin && !radioWin.isDestroyed()) { radioWin.show(); radioWin.focus(); return; }
  radioWin = new BrowserWindow({width: 420, height: 640, minWidth: 360, minHeight: 460, title: 'Radio — DevGitBrowser', icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true, backgroundColor: '#070b22', show: false,
    webPreferences: {preload: path.join(__dirname, 'ui', 'radio', 'preload.js'), session: browsingSession, contextIsolation: true, sandbox: true,
      nodeIntegration: false, webSecurity: true, backgroundThrottling: false, allowRunningInsecureContent: true, spellcheck: false}});
  radioWin.setMenu(null);
  radioWin.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  radioWin.webContents.on('will-navigate', e => e.preventDefault());
  radioWin.once('ready-to-show', () => radioWin.show());
  // Fermer la fenêtre pendant la lecture la masque : la musique continue.
  radioWin.on('close', e => { if (!quitting && radioNow) { e.preventDefault(); radioWin.hide(); broadcast(); } });
  radioWin.on('closed', () => { radioWin = null; radioNow = ''; broadcast(); });
  radioWin.loadFile(path.join(__dirname, 'ui', 'radio', 'index.html'));
  broadcast();
}
// ======================================================== VPN
// Le tunnel Tor sert à deux usages : le VPN global (bouton 🌐, toute la navigation)
// et les onglets privés (clic droit sur +). Les onglets privés passent TOUJOURS
// par le VPN : tant qu'il n'est pas prêt, leur proxy est volontairement invalide
// (aucune connexion directe possible, donc aucune fuite d'adresse IP).
let vpnGlobal = false, vpnRules = '', privateSession = null;
const PRIVATE_FAIL_CLOSED = {proxyRules: 'socks5://127.0.0.1:9', proxyBypassRules: '<-loopback>'};
const vpnActive = () => vpnGlobal && tor?.state.status === 'on';
const allTabs = () => [...windows.values()].flatMap(s => [...s.tabs.values()]);
const privateTabCount = () => allTabs().filter(t => t.private).length;
async function applyVpnProxy(proxyRules) {
  vpnRules = proxyRules;
  if (privateSession) { await privateSession.setProxy({proxyRules, proxyBypassRules: '<-loopback>'}); if (typeof privateSession.closeAllConnections === 'function') await privateSession.closeAllConnections(); }
  if (!vpnGlobal) return;
  await browsingSession.setProxy({proxyRules, proxyBypassRules: '<-loopback>'});
  if (typeof browsingSession.closeAllConnections === 'function') await browsingSession.closeAllConnections();
  for (const t of allTabs()) { try { t.view.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch {} }
}
async function restoreBrowsingDirect() {
  await browsingSession.setProxy(proxyForElectron(settings.proxy));
  if (typeof browsingSession.closeAllConnections === 'function') await browsingSession.closeAllConnections();
  for (const t of allTabs()) if (!t.private) { try { t.view.webContents.setWebRTCIPHandlingPolicy(settings.webrtcProtection ? 'default_public_interface_only' : 'default'); } catch {} }
}
async function restoreDirectProxy() {
  vpnRules = '';
  if (privateSession) await privateSession.setProxy(PRIVATE_FAIL_CLOSED).catch(() => {});
  await restoreBrowsingDirect();
}
// Déconnexion du VPN global : le tunnel reste ouvert tant que des onglets privés l'utilisent.
async function disconnectVpn() {
  vpnGlobal = false;
  if (privateTabCount() && tor.state.status === 'on') { await restoreBrowsingDirect(); broadcast(); return; }
  await tor.stop();
}
function ensurePrivateSession() {
  if (privateSession) return privateSession;
  // Partition en mémoire (sans « persist: ») : rien n'est écrit sur le disque.
  const ses = session.fromPartition('devgit-private-' + crypto.randomBytes(6).toString('hex'));
  privateSession = ses;
  ses.setUserAgent(browsingSession.getUserAgent());
  try { ses.setSpellCheckerLanguages(['fr', 'en-US']); } catch {}
  try { ses.registerPreloadScript({type: 'frame', id: 'devgitshield-early', filePath: path.join(__dirname, 'lib', 'shield-preload.js')}); } catch {}
  configurePermissionPolicy(ses); configureDownloads(ses); configurePrivacyHeaders(ses);
  adBlocker?.attachSession(ses);
  ses.setProxy(vpnRules && tor?.state.status === 'on' ? {proxyRules: vpnRules, proxyBypassRules: '<-loopback>'} : PRIVATE_FAIL_CLOSED).catch(() => {});
  return ses;
}
// Dernier onglet privé fermé : cookies, cache et stockage effacés, tunnel arrêté s'il ne sert plus.
async function cleanupPrivateSession() {
  if (privateTabCount() || !privateSession) return;
  const ses = privateSession; privateSession = null;
  try { await ses.clearStorageData(); await ses.clearCache(); await ses.clearAuthCache(); } catch {}
  if (!vpnGlobal && tor && ['on', 'starting'].includes(tor.state.status)) tor.stop().catch(() => {});
  broadcast();
}
async function openPrivateTab(s, url = '') {
  ach('bump','privateTabs');
  if (!tor?.state.available) { notice(s, 'Navigation privée indisponible : composant VPN (Tor) absent.', true); return null; }
  const id = newTab(s, '', {private: true});
  const t = s.tabs.get(id);
  const go = () => { if (t && s.tabs.has(id)) { if (url) navigateTab(t, url); else sendState(s); } };
  if (tor.state.status === 'on') { go(); return id; }
  notice(s, 'Onglet privé : connexion au VPN… (10 à 40 secondes)');
  try {
    if (tor.state.status !== 'starting') await tor.start(settings.vpnCountry);
    else await new Promise((resolve, reject) => { const iv = setInterval(() => { if (tor.state.status === 'on') { clearInterval(iv); resolve(); } else if (tor.state.status !== 'starting') { clearInterval(iv); reject(new Error(tor.state.error || 'VPN indisponible.')); } }, 300); });
    notice(s, 'Onglet privé prêt : navigation via le VPN, rien n’est conservé à la fermeture.');
    go();
  } catch (e) { notice(s, 'VPN indisponible : ' + (e.message || e) + ' L’onglet privé reste bloqué (aucune connexion directe).', true); }
  return id;
}
function newTabMenu(s) {
  popupMenu(s, [
    {label: 'Nouvel onglet', accelerator: 'CmdOrCtrl+T', click: () => { try { newTab(s); } catch (e) { notice(s, e.message, true); } }},
    {label: 'Naviguer en mode privé (onglet sous VPN)', accelerator: 'CmdOrCtrl+Shift+N', click: () => openPrivateTab(s).catch(e => notice(s, e.message, true))}
  ]);
}
function vpnMenu(s) {
  const st = tor.state;
  const on = vpnGlobal && st.status === 'on', busy = vpnGlobal && st.status === 'starting';
  const country = VPN_COUNTRIES.find(c => c.code === (on || busy ? st.country : settings.vpnCountry))?.name || 'Automatique';
  popupMenu(s, [
    {label: on ? `VPN connecté · sortie : ${country}` : busy ? `Connexion au VPN… ${st.progress} %` : st.available ? 'VPN déconnecté' : 'VPN indisponible (composant absent)', enabled: false},
    {type: 'separator'},
    on || busy ? {label: 'Déconnecter le VPN', click: () => disconnectVpn().then(() => notice(s, privateTabCount() ? 'VPN déconnecté pour la navigation normale (les onglets privés restent protégés).' : 'VPN déconnecté : connexion directe.')).catch(e => notice(s, e.message, true))}
      : {label: `Connecter (${country})`, enabled: st.available, click: () => startVpn(s, settings.vpnCountry)},
    {label: 'Pays de sortie', enabled: st.available, submenu: VPN_COUNTRIES.map(c => ({label: c.name, type: 'radio', checked: (on || busy ? st.country : settings.vpnCountry) === c.code,
      click: () => { settings.vpnCountry = c.code; saveSettings(); if (on || busy) startVpn(s, c.code); else broadcast(); }}))},
    {label: 'Ouvrir un onglet privé sous VPN', enabled: st.available, click: () => openPrivateTab(s).catch(e => notice(s, e.message, true))},
    {label: 'Nouvelle adresse IP', enabled: st.status === 'on', click: () => tor.newIdentity().then(() => notice(s, 'Nouvelle identité : les prochaines connexions changent d’adresse IP.')).catch(e => notice(s, e.message, true))},
    {label: 'Vérifier mon adresse IP', click: () => { try { newTab(s, 'https://check.torproject.org/'); } catch {} }},
    {type: 'separator'},
    {label: 'À propos du VPN DevGit…', click: () => s.win.webContents.send('dgb:command', 'vpn-info')}
  ]);
}
function startVpn(s, country) {
  if (remote?.disabled('vpn')) { notice(s, 'Le VPN est temporairement désactivé par DevGitBrowser (maintenance).', true); return; }
  vpnGlobal = true;
  notice(s, 'Connexion au VPN… (10 à 40 secondes)');
  tor.start(country).then(() => notice(s, `VPN connecté · sortie : ${VPN_COUNTRIES.find(c => c.code === country)?.name || 'automatique'}.`))
    .catch(e => { notice(s, e.message, true); vpnGlobal = false; restoreDirectProxy().catch(() => {}); });
}
// ======================================================== DNS sécurisé
function applySecureDns() {
  try {
    const provider = DNS_PROVIDERS[settings.dnsProvider] || DNS_PROVIDERS.cloudflare;
    if (settings.secureDns === 'off') app.configureHostResolver({secureDnsMode: 'off'});
    else app.configureHostResolver({secureDnsMode: settings.secureDns, secureDnsServers: [provider.url]});
  } catch (err) { logger.warn('DNS sécurisé', err.message); }
}
// ======================================================== Performances / mode gaming
function appProcessIds() { try { return app.getAppMetrics().map(m => m.pid).filter(Boolean); } catch { return []; } }
function applyProcessPriority() {
  const priority = settings.gamingMode ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL;
  for (const pid of appProcessIds()) { try { os.setPriority(pid, priority); } catch {} }
}
function sleepIdleTabs() {
  const idleMs = settings.gamingMode ? 60_000 : settings.performance.mode === 'eco' ? 10 * 60_000 : 0;
  if (!idleMs) return 0;
  let count = 0;
  for (const s of windows.values()) for (const t of s.tabs.values()) {
    if (s.activeId !== t.id && Date.now() - (t.lastActive || 0) > idleMs && sleepTab(t)) count++;
  }
  return count;
}
function setGamingMode(value) {
  settings.gamingMode = Boolean(value); saveSettings();
  applyProcessPriority();
  if (settings.gamingMode) sleepIdleTabs();
  broadcast();
}
function perfMetrics() {
  const metrics = app.getAppMetrics();
  const byPid = new Map(metrics.map(m => [m.pid, m]));
  const mb = m => m ? Math.round((m.memory?.workingSetSize || 0) / 1024) : 0;
  const tabs = [];
  for (const s of windows.values()) for (const t of s.tabs.values()) {
    const wc = t.view.webContents;
    let pid = 0; try { pid = wc.isDestroyed() ? 0 : wc.getOSProcessId(); } catch {}
    const m = t.sleeping ? null : byPid.get(pid);
    tabs.push({id: t.id, windowId: s.id, title: t.title, url: t.url, sleeping: Boolean(t.sleeping), active: s.activeId === t.id, audible: Boolean(t.audible), memory: mb(m), cpu: m ? Math.round((m.cpu?.percentCPUUsage || 0) * 10) / 10 : 0});
  }
  const groups = {};
  for (const m of metrics) { const key = m.type; groups[key] = groups[key] || {type: key, count: 0, memory: 0, cpu: 0}; groups[key].count++; groups[key].memory += mb(m); groups[key].cpu += m.cpu?.percentCPUUsage || 0; }
  const total = {memory: metrics.reduce((a, m) => a + mb(m), 0), cpu: Math.round(metrics.reduce((a, m) => a + (m.cpu?.percentCPUUsage || 0), 0) * 10) / 10,
    systemFreeMB: Math.round(os.freemem() / 1048576), systemTotalMB: Math.round(os.totalmem() / 1048576)};
  return {tabs, groups: Object.values(groups).map(g => ({...g, cpu: Math.round(g.cpu * 10) / 10})), total, gaming: settings.gamingMode, mode: settings.performance.mode,
    radio: Boolean(radioNow), vpn: vpnGlobal ? (tor?.state.status || 'off') : 'off'};
}

function activeOriginRequired(s){const value=currentOrigin(s);if(!value)throw new Error('Ouvre un site HTTPS avant de modifier ses autorisations.');return value;}
function aboutInfo() {
  const bundled=[...bundledInstalled.values()].map(e=>({name:e.name,version:e.version,loaded:Boolean(e.id)}));
  return {
    name:'DevGitBrowser', version:app.getVersion(), author:'CodexHempreur INC', signature:'By CodexHempreur',
    electron:process.versions.electron, chrome:process.versions.chrome, node:process.versions.node, v8:process.versions.v8,
    os:`${os.type()} ${os.release()}`, arch:process.arch, platform:process.platform, locale:app.getLocale(),
    packaged:app.isPackaged, userData:app.getPath('userData'), executable:process.execPath, repository:REPOSITORY_URL,
    userAgent:browsingSession?.getUserAgent?.()||'', extensions:bundled, shield:adBlocker?.state()||null,
    update:updater?.state||null, history:browsing?.history.length||0, bookmarks:browsing?.bookmarks.length||0,
    gpu:settings.performance.hardwareAcceleration, uptime:Math.round(process.uptime()), widevine:widevineStatus
  };
}
function bookmarkContextMenu(s, id) {
  const b = browsing.bookmarks.find(x=>x.id===id); if (!b) return;
  popupMenu(s, [
    {label:'Ouvrir', click:()=>navigate(s,b.url)},
    {label:'Ouvrir dans un nouvel onglet', click:()=>{ try{newTab(s,b.url,{background:true});}catch(e){notice(s,e.message,true);} }},
    {label:'Ouvrir dans une nouvelle fenêtre', click:()=>createWindow({tabs:[b.url]})},
    {label:'Copier l’adresse', click:()=>clipboard.writeText(b.url)},
    {type:'separator'},
    {label:'Renommer…', click:()=>s.win.webContents.send('dgb:command','rename-bookmark:'+b.id)},
    {label:'Supprimer', click:()=>{ browsing.removeBookmark(b.id); broadcast(); }}
  ]);
}
function registerIpc(){
  const h={
    'initial':s=>publicState(s),
    'tab:new':(s,url='')=>newTab(s,typeof url==='string'?url:''),
    'tab:select':(s,id)=>selectTab(s,id),
    'tab:close':(s,id)=>closeTab(s,id),
    'tab:context':(s,id)=>tabContextMenu(s,id),
    'tab:mute':(s,id)=>{const t=s.tabs.get(Number(id));if(t&&!t.view.webContents.isDestroyed()){t.view.webContents.setAudioMuted(!t.view.webContents.isAudioMuted());sendState(s);}},
    'tab:detach':(s,id)=>{const t=s.tabs.get(Number(id))||activeTab(s);if(t)detachTab(t);},
    'tab:move':(s,id,index)=>{const t=s.tabs.get(Number(id));if(t&&Number.isInteger(index))moveTab(t,s,index);},
    'tab:attach':(s,id,index)=>{
      const t=(id!==null&&id!==undefined?findTab(id):null)||draggedTab?.tab;
      if(!t||!findTab(t.id))return;
      moveTab(t,s,Number.isInteger(index)?index:s.tabs.size);
    },
    'tab:drag-start':(s,id)=>{const t=s.tabs.get(Number(id));draggedTab=t?{tab:t,from:s}:null;},
    'tab:drag-end':(s,id)=>{
      const drag=draggedTab;const t=s.tabs.get(Number(id));
      if(!t||!drag||drag.tab!==t){draggedTab=null;return;}
      // Laisser une éventuelle dépose dans une autre fenêtre s'exécuter d'abord.
      setTimeout(()=>{
        if(draggedTab===drag)draggedTab=null;
        if(t.owner!==s||!findTab(t.id))return;
        const point=screen.getCursorScreenPoint();
        const over=windowAtPoint(point,null);
        if(over===s)return;
        try{ if(over)moveTab(t,over); else detachTab(t,point); }catch(e){notice(s,e.message,true);}
      },160);
    },
    'nav:go':(s,address)=>navigate(s,address),
    'nav:back':s=>{const t=activeTab(s);if(t?.engine==='mshtml')return hostCommand(t,'BACK');const wc=t?.view.webContents;if(wc?.navigationHistory.canGoBack())wc.navigationHistory.goBack();},
    'nav:forward':s=>{const t=activeTab(s);if(t?.engine==='mshtml')return hostCommand(t,'FORWARD');const wc=t?.view.webContents;if(wc?.navigationHistory.canGoForward())wc.navigationHistory.goForward();},
    'nav:reload':s=>{const t=activeTab(s);if(t?.engine==='mshtml')return hostCommand(t,'RELOAD');if(t?.url){if(t.loading)t.view.webContents.stop();else t.view.webContents.reload();}},
    'nav:home':s=>home(s),
    'nav:inspect':s=>{const t=activeTab(s);if(t?.engine==='mshtml')throw new Error('Les DevTools Chromium ne peuvent pas inspecter MSHTML. Reviens au mode moderne.');if(t?.url)t.view.webContents.openDevTools({mode:'detach'});},
    'nav:network':s=>showNetworkWindow(s),
    'nav:legacy':s=>toggleLegacyInTab(s),
    'nav:find':(s,query,forward=true,newSearch=false)=>{
      const wc=activeTab(s)?.view.webContents;
      if(!wc || !activeTab(s).url || typeof query!=='string' || query.length>150)return;
      if(!query){wc.stopFindInPage('clearSelection');return;}
      // findNext=true démarre une nouvelle recherche ; false passe à l'occurrence suivante.
      wc.findInPage(query,{forward:Boolean(forward),findNext:Boolean(newSearch)});
    },
    'nav:stop-find':s=>{const wc=activeTab(s)?.view.webContents;if(wc&&!wc.isDestroyed())wc.stopFindInPage('clearSelection');},
    'nav:print':s=>{const t=activeTab(s);if(t?.engine==='mshtml')return hostCommand(t,'PRINT');if(t?.url)t.view.webContents.print({printBackground:true},()=>{});},
    'ui:panel':(s,shown)=>setPanel(s,shown),
    'ui:chrome-height':(s,px)=>{
      const value=Math.round(Number(px));
      if(!Number.isFinite(value))return;
      const next=Math.max(60,Math.min(320,value));
      if(next!==s.shellHeight){s.shellHeight=next;layout(s);}
    },
    'ui:menu':s=>mainMenu(s),
    'ui:shield-menu':s=>shieldMenu(s),
    'site:popup-topmost':(s,mode)=>{
      const origin=activeOriginRequired(s);
      if(!['default','yes','no'].includes(mode))throw new Error('Choix invalide.');
      if(mode==='default')delete settings.popupTopmost[origin];else settings.popupTopmost[origin]=mode==='yes';
      saveSettings();broadcast();
    },
    'site:popups':(s,mode)=>{
      const origin=activeOriginRequired(s);
      if(!['allow','block','default'].includes(mode))throw new Error('Mode pop-up incorrect.');
      if(mode==='default')delete settings.popupModes[origin];
      else settings.popupModes[origin]=mode;
      saveSettings();broadcast();
    },
    'privacy:adblock-toggle':(_s,enabled)=>{
      if(typeof enabled!=='boolean')throw new Error('Réglage de protection publicitaire invalide.');
      settings.adblockEnabled=enabled;
      if(adBlocker)adBlocker.setEnabled(enabled);
      saveSettings();broadcast();
      return adBlocker?.state() || null;
    },
    'privacy:adblock-refresh':()=>{
      if(!adBlocker)throw new Error('Moteur de blocage non disponible.');
      adBlocker.refresh().catch(()=>{});
      return adBlocker.state();
    },
    'privacy:adblock-site':(s,allowed)=>{
      const t=activeTab(s);if(!t?.url||!adBlocker)throw new Error('Ouvre d’abord un site.');
      adBlocker.setAllowed(currentHost(s),Boolean(allowed));saveSettings();t.view.webContents.reload();broadcast();
    },
    'privacy:adblock-remove':(_s,host)=>{if(!adBlocker)return;adBlocker.setAllowed(String(host||''),false);saveSettings();broadcast();},
    'site:privacy':(s,key,mode)=>{
      const origin=activeOriginRequired(s);
      if(!['camera','microphone','notifications','geolocation'].includes(key)||!['ask','block','allow'].includes(mode))throw new Error('Autorisation invalide.');
      settings.sitePrivacy[origin]={...(settings.sitePrivacy[origin]||{}),[key]:mode};
      if(['camera','microphone'].includes(key)){
        const temp=ephemeralMedia.get(origin)||{};delete temp[key];ephemeralMedia.set(origin,temp);
        if(settings.mediaGrants[origin])delete settings.mediaGrants[origin][key];
      }
      saveSettings();broadcast();
    },
    'site:reset':s=>{
      const origin=activeOriginRequired(s);
      delete settings.popupModes[origin];delete settings.sitePrivacy[origin];delete settings.mediaGrants[origin];ephemeralMedia.delete(origin);
      saveSettings();broadcast();
    },
    'nav:zoom':(s,direction)=>setZoom(s,Number(direction)),
    'privacy:clear-cache':async()=>{await browsingSession.clearCache();broadcast();},
    'privacy:clear-site-data':async()=>{
      await browsingSession.clearStorageData({storages:['cookies','localstorage','indexdb','serviceworkers','cachestorage']});
      ephemeralMedia.clear();broadcast();
    },
    'downloads:folder':async(s)=>{
      const res=await dialog.showOpenDialog(s.win,{title:'Choisir le dossier des téléchargements',properties:['openDirectory','createDirectory'],defaultPath:settings.downloads.folder||app.getPath('downloads')});
      if(!res.canceled && res.filePaths?.[0]){settings.downloads.folder=res.filePaths[0];saveSettings();broadcast();}
    },
    'downloads:ask':(_s,value)=>{settings.downloads.askEachTime=Boolean(value);saveSettings();broadcast();},
    'downloads:open-folder':()=>shell.openPath(settings.downloads.folder||app.getPath('downloads')),
    'performance:save':(_s,mode,hardwareAcceleration)=>{
      if(!['balanced','eco'].includes(mode)||typeof hardwareAcceleration!=='boolean')throw new Error('Réglage de performance invalide.');
      const changedGpu=settings.performance.hardwareAcceleration!==hardwareAcceleration;
      settings.performance={mode,hardwareAcceleration};saveSettings();resetSyncTimer();broadcast();
      return {restartRequired:changedGpu};
    },
    'site:revoke-media':s=>{
      const origin=activeOriginRequired(s);delete settings.mediaGrants[origin];ephemeralMedia.delete(origin);
      const saved=settings.sitePrivacy[origin]||{};saved.camera='ask';saved.microphone='ask';settings.sitePrivacy[origin]=saved;
      saveSettings();broadcast();
    },
    'prefs:set':(_s,key,value)=>setPreference(String(key),value),
    'app:welcomed':()=>{settings.welcomed=true;saveSettings();broadcast();},
    'xmode:setup':(s,confirmAge,code)=>{
      if(confirmAge!==true)throw new Error('Ce mode est réservé aux personnes majeures.');
      const pin=String(code||'');
      if(pin && !/^\d{4,8}$/.test(pin))throw new Error('Le code d’accès doit contenir 4 à 8 chiffres.');
      settings.xmodeAge=true; settings.xmodeCode=pin?hashCode(pin):''; saveSettings();
      s.xmode=true; broadcast(); return true;
    },
    'xmode:enter':(s,code)=>{
      if(!settings.xmodeAge)throw new Error('Confirmation de majorité requise.');
      if(Date.now()<xmodeBlockedUntil)throw new Error('Trop d’essais. Réessaie dans une minute.');
      if(settings.xmodeCode && !checkCode(code)){ if(++xmodeFailures>=5){xmodeFailures=0;xmodeBlockedUntil=Date.now()+60_000;} throw new Error('Code d’accès incorrect.'); }
      xmodeFailures=0; s.xmode=true; broadcast(); return true;
    },
    'xmode:exit':s=>exitXmode(s),
    'weather:set-city':async(_s,name)=>{
      const q=String(name||'').trim();
      if(!q){settings.weatherCity=null;saveSettings();weatherNow=null;broadcast();return null;}
      settings.weatherCity=await weather.findCity(webFetch,q);saveSettings();
      await refreshWeather();return settings.weatherCity;
    },
    'weather:refresh':()=>refreshWeather(),
    'admin:unlock':(s,key)=>{
      adminLimiter.check();
      if(!admin.verifySecret(admin.normalizeKey(key),adminKeyHash())){adminLimiter.fail();logger.warn('Admin : clé refusée');throw new Error('Clé admin incorrecte.');}
      adminLimiter.ok(); s.adminOpen=true; broadcast(); adminWatchLoop(); return true;
    },
    'admin:recover':(_s,words)=>{
      adminLimiter.check();
      if(!Array.isArray(words)||words.length!==3||!admin.verifySecret(admin.recoveryPhrase(words),admin.RECOVERY_HASH)){adminLimiter.fail();throw new Error('Mots de sécurité incorrects.');}
      adminLimiter.ok(); const key=admin.generateKey(); settings.adminKey=admin.hashSecret(key); saveSettings();
      logger.info('Admin : nouvelle clé générée'); return key;
    },
    'admin:close':s=>{s.adminOpen=false;broadcast();return true;},
    'admin:stats':async s=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      const token=readStatsToken();
      const [github,server]=await Promise.allSettled([admin.fetchStats(webFetch), token&&telemetry?.available?telemetry.adminStats(token):Promise.reject(new Error(telemetry?.available?'NO_TOKEN':'NO_SERVER'))]);
      if(github.status==='rejected'&&server.status==='rejected'&&!/^NO_/.test(server.reason?.message))throw github.reason;
      return {github:github.status==='fulfilled'?github.value:null, githubError:github.status==='rejected'?github.reason.message:'',
        server:server.status==='fulfilled'?server.value:null, serverError:server.status==='rejected'?server.reason.message:'', serverUrl:STATS_URL};
    },
    'admin:server-stats':async s=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      const token=readStatsToken();if(!token||!telemetry?.available)return null;
      return telemetry.adminStats(token);
    },
    'admin:remote':async(s,action,arg,arg2)=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      const token=readStatsToken();if(!token||!telemetry?.available)throw new Error('Enregistre d’abord le jeton du serveur.');
      const call=(p,o={})=>telemetry.api(p,{...o,token,timeout:20_000,maxBytes:20*1024*1024}).catch(e=>outdatedServer(e,token));
      if(action==='config')return call('/v1/admin/config');
      if(action==='lockdown'){const r=await call('/v1/admin/lockdown',{method:'PUT',body:{active:arg?.active===true,versions:String(arg?.versions||''),message:String(arg?.message||'')}});remote?.refresh().catch(()=>{});return r;}
      if(action==='features'){const r=await call('/v1/admin/features',{method:'PUT',body:{features:Array.isArray(arg)?arg:[]}});return r;}
      if(action==='message')return call('/v1/admin/messages',{method:'POST',body:arg&&typeof arg==='object'?arg:{}});
      if(action==='bugs')return (await call('/v1/admin/bugs'))?.bugs||[];
      if(action==='message-delete'){if(arg==='all')return call('/v1/admin/messages',{method:'DELETE'});const n=Number(arg);if(!Number.isSafeInteger(n)||n<0)throw new Error('Message inconnu.');return call('/v1/admin/messages/'+n,{method:'DELETE'});}
      if(action==='bugs-delete')return call('/v1/admin/bugs'+(arg==='fixed'?'?status=fixed':''),{method:'DELETE'});
      const id=String(arg||'');if(!/^[a-f0-9]{16}$/.test(id))throw new Error('Rapport inconnu.');
      if(action==='bug-status'&&['new','seen','fixed'].includes(arg2))return call('/v1/admin/bugs/'+id,{method:'PATCH',body:{status:arg2}});
      if(action==='bug-delete'){const w=supportWins.get('admin:'+id);if(w&&!w.isDestroyed())w.destroy();await call('/v1/admin/bugs/'+id,{method:'DELETE'});return true;}
      if(action==='support-open'){const r=await adminSupportCall(id,'open',{welcome:String(arg2||'').slice(0,1000)});openSupportWindow('admin',id);setTimeout(()=>sendSupport('admin',id,r),600).unref?.();return r;}
      if(action==='support-window'){openSupportWindow('admin',id);return true;}
      throw new Error('Action inconnue.');
    },
    'admin:set-token':(s,value)=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      const v=String(value||'').trim(); if(v && !/^[A-Za-z0-9]{24,128}$/.test(v))throw new Error('Jeton invalide.');
      if(!v){statsTokenMemory='';try{fs.rmSync(userDataFile('stats-token.dat'),{force:true});}catch{}return true;}
      storeStatsToken(v); return true;
    },
    'store:catalog':async(_s,force)=>{const list=await fetchStoreCatalog(force===true);return list.map(e=>({...e,installed:settings.store[e.id]?.version||'',update:Boolean(settings.store[e.id]&&settings.store[e.id].sha256!==e.sha256)}));},
    'store:details':async(_s,id)=>{
      // Autorisations demandées, lues dans le paquet vérifié, affichées avant l'installation.
      const entry=(await fetchStoreCatalog(false)).find(e=>e.id===id);if(!entry)throw new Error('Extension inconnue.');
      const bundle=store.parseBundle(await telemetry.api('/v1/store/package/'+id,{raw:true,maxBytes:40*1024*1024,timeout:120_000}),entry.sha256,id);
      return {id,name:bundle.manifest.name,version:String(bundle.manifest.version),permissions:store.permissionsOf(bundle.manifest)};
    },
    'store:install':(_s,id)=>installStoreExtension(String(id||'')),
    'store:uninstall':(_s,id)=>{if(!store.validId(String(id||'')))throw new Error('Extension inconnue.');return uninstallStoreExtension(String(id));},
    'store:publish':async(s,wantedId)=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      const token=readStatsToken();if(!token)throw new Error('Enregistre d’abord le jeton du serveur (section Utilisateurs dans le monde).');
      const pick=await dialog.showOpenDialog(s.win,{title:'Dossier de l’extension à publier (contenant manifest.json)',properties:['openDirectory']});
      if(pick.canceled||!pick.filePaths[0])return null;
      const id=wantedId?String(wantedId):'';
      if(id&&!store.validId(id))throw new Error('Identifiant invalide (minuscules, chiffres et tirets).');
      const bundle=store.buildBundle(pick.filePaths[0],id||undefined);
      if(RESERVED_STORE_IDS.has(bundle.id))throw new Error('Ce nom est réservé aux extensions intégrées.');
      const result=await telemetry.api('/v1/store/publish',{method:'POST',body:bundle,token,timeout:180_000});
      storeCatalog=null;logger.info('Store : publication',bundle.id,result?.version);return result;
    },
    'store:unpublish':async(s,id)=>{
      if(!s.adminOpen)throw new Error('Panneau admin verrouillé.');
      if(!store.validId(String(id||'')))throw new Error('Extension inconnue.');
      await telemetry.api('/v1/store/'+id,{method:'DELETE',token:readStatsToken()});storeCatalog=null;return true;
    },
    'telemetry:consent':(_s,yes)=>{setTelemetry(yes===true);return settings.telemetry;},
    'telemetry:rate':async(_s,stars)=>{
      const n=Number(stars); if(!telemetry)throw new Error('Notation indisponible.');
      await telemetry.rate(n); settings.rating=n; saveSettings(); ach('atLeast','rated',1); broadcast(); return n;
    },
    'xmode:reset-code':(s,code,next)=>{
      if(!s.xmode)throw new Error('Ouvre d’abord le mode DGBx.');
      if(settings.xmodeCode && !checkCode(code))throw new Error('Code actuel incorrect.');
      const pin=String(next||''); if(pin && !/^\d{4,8}$/.test(pin))throw new Error('Le code d’accès doit contenir 4 à 8 chiffres.');
      settings.xmodeCode=pin?hashCode(pin):''; saveSettings(); broadcast(); return true;
    },
    'xmode:open':(s,url)=>{
      if(!s.xmode)throw new Error('Mode DGBx fermé.');
      if(typeof url!=='string'||!isWebUrl(url))throw new Error('Adresse invalide.');
      const id=newTab(s,url); const t=s.tabs.get(id); if(t){t.xTab=true; sendState(s);} return id;
    },
    'app:open-log':()=>shell.openPath(logger.path()||app.getPath('userData')),
    'app:repair':async(s,what)=>{
      if(what==='filters'){adBlocker?.refresh().catch(()=>{});phishing?.refresh().catch(()=>{});return 'Mise à jour des filtres lancée.';}
      if(what==='cache'){await browsingSession.clearCache();await browsingSession.clearCodeCaches?.({}).catch?.(()=>{});return 'Cache vidé.';}
      if(what==='settings'){
        const keep={github:settings.github,welcomed:true,adblockAllowlist:settings.adblockAllowlist};
        settings={...defaultSettings(),...keep};saveSettings();applySecureDns();await restoreDirectProxy().catch(()=>{});broadcast();
        return 'Réglages réinitialisés (favoris, historique, mots de passe et extensions conservés).';
      }
      throw new Error('Action inconnue.');
    },
    // ---- Mots de passe
    'pw:create':async(_s,master)=>{const st=await vault.create(String(master||''));ach('atLeast','vaultCreated',1);broadcast();return st;},
    'pw:unlock':async(_s,master)=>{const st=await vault.unlock(String(master||''));broadcast();return st;},
    'pw:lock':()=>{vault.lock();broadcast();},
    'pw:list':(_s,q)=>{const entries=vault.list(String(q||'').slice(0,100));if(!q)ach('atLeast','passwords',entries.length);return {entries,audit:vault.audit()};},
    'pw:reveal':(_s,id)=>vault.reveal(String(id||'')),
    'pw:copy':(_s,id,field='password')=>{const e=vault.entries?.find(x=>x.id===id);if(!vault.isUnlocked()||!e)throw new Error('Identifiant introuvable.');copySecret(field==='username'?e.username:e.password);return true;},
    'pw:save':(_s,data)=>{const r=vault.save({origin:String(data?.origin||''),username:String(data?.username||''),password:String(data?.password||''),note:String(data?.note||'')});broadcast();return r;},
    'pw:update':(_s,id,data)=>{vault.update(String(id||''),{username:data?.username,password:data?.password,note:data?.note});broadcast();},
    'pw:delete':(_s,id)=>{vault.remove(String(id||''));broadcast();},
    'pw:generate':(_s,len,opts)=>generatePassword(Number(len)||20,{symbols:opts?.symbols!==false,digits:opts?.digits!==false}),
    'pw:breach':async()=>{const r=await vault.breachCheck(webFetch);ach('bump','breachChecks');broadcast();return r;},
    'pw:import-csv':async(s,removeAfter)=>{
      if(!vault.isUnlocked())throw new Error('Déverrouille d’abord le coffre.');
      const pick=await dialog.showOpenDialog(s.win,{title:'Fichier CSV exporté depuis ton ancien navigateur',properties:['openFile'],filters:[{name:'Mots de passe (CSV)',extensions:['csv']}]});
      if(pick.canceled||!pick.filePaths[0])return null;
      const file=pick.filePaths[0];const st=fs.statSync(file);if(st.size>10*1024*1024)throw new Error('Fichier trop volumineux.');
      const result=vault.importCsv(fs.readFileSync(file,'utf8'));
      // Le CSV contient les mots de passe en clair : suppression sur demande de l'utilisateur.
      if(removeAfter===true){try{fs.rmSync(file,{force:true});result.removed=true;}catch{result.removed=false;}}
      logger.info('Import CSV mots de passe',result.added,result.updated,result.skipped);if(result.added||result.updated)ach('bump','imports');broadcast();return result;
    },
    'pw:profiles':()=>vault.listProfiles(),
    'pw:profile-save':(_s,data)=>{const list=vault.saveProfile(data&&typeof data==='object'?data:{});ach('atLeast','profiles',list.length);return list;},
    'pw:profile-delete':(_s,id)=>{vault.removeProfile(String(id||''));return vault.listProfiles();},
    'remote:dismiss':(_s,id)=>{const n=Number(id);liveMessages=liveMessages.filter(m=>m.id!==n);broadcast();},
    'bug:preview':()=>{
      let log='';try{log=fs.readFileSync(logger.path(),'utf8');}catch{}
      return {log:remoteLib.sanitizeLog(logger.redact(log)),info:{version:app.getVersion(),os:`${process.platform} ${os.release()}`,electron:process.versions.electron}};
    },
    'bug:send':async(_s,data)=>{
      if(!telemetry?.available)throw new Error('Aucun serveur DevGit configuré dans cette version.');
      const text=String(data?.text||'').trim().slice(0,3000);if(text.length<5)throw new Error('Décris le problème en quelques mots.');
      let log='';if(data?.withLog===true){try{log=fs.readFileSync(logger.path(),'utf8');}catch{}log=remoteLib.sanitizeLog(logger.redact(log));}
      const cc=(()=>{try{return app.getLocaleCountryCode();}catch{return '';}})();
      const header=`DevGitBrowser ${app.getVersion()} · Electron ${process.versions.electron} · ${process.platform} ${os.release()} · ${os.arch()}\n`;
      // Clé secrète du tchat de support : seule son empreinte part au serveur ; elle reste sur ce PC.
      const chatKey=require('crypto').randomBytes(32).toString('hex');
      const r=await telemetry.api('/v1/bug',{method:'POST',body:{text,contact:String(data?.contact||'').slice(0,120),v:app.getVersion(),os:telemetryLib.osName(process.platform),cc:/^[A-Z]{2}$/.test(cc)?cc:'ZZ',log:log?header+log:header,chatKey},timeout:30_000});
      if(/^[a-f0-9]{16}$/.test(r?.id||''))addSupportChat(r.id,chatKey,text);
      logger.info('Rapport de bug envoyé',r?.id);ach('bump','bugs');return r?.id||'';
    },
    'ref:info':async()=>{
      if(!settings.refCode){settings.refCode=remoteLib.newRefCode();saveSettings();}
      const code=settings.refCode;let count=null;
      if(telemetry?.available)try{count=(await telemetry.api('/v1/referral/'+code,{timeout:10_000}))?.count??null;}catch{}
      if(Number.isFinite(count))ach('atLeast','referrals',count);
      return {code,link:'https://hempreur.github.io/DevGitBrowser/?ref='+code,count,badge:count==null?null:remoteLib.badgeFor(count),next:count==null?null:remoteLib.nextBadge(count),referredBy:settings.referredBy,badges:remoteLib.BADGES};
    },
    'ref:claim':(_s,raw)=>claimReferral(raw),
    'ach:summary':s=>achievements?achievements.summary({includeSecret:Boolean(s.xmode)}):null,
    'ach:seen':s=>{ach('markSeen',Boolean(s.xmode));ach('flush');broadcast();return true;},
    'ach:event':(_s,name)=>{if(['generated'].includes(name))ach('bump',name);return true;},
    'ref:share':(s,channel)=>shareInvite(s,String(channel||'')),
    'trackers:report':s=>{
      ach('bump','trackerReports');
      const t=activeTab(s);const wc=t?.view?.webContents;
      if(!t?.url||!wc||wc.isDestroyed())return {host:'',rows:[],total:0,enabled:Boolean(adBlocker?.enabled),paused:false};
      const counts=adBlocker?adBlocker.trackersFor(wc.id):new Map();
      const pageBase=trackerDb.baseDomain(currentHost(s));
      for(const h of [...counts.keys()])if(trackerDb.baseDomain(h)===pageBase&&!trackerDb.lookup(h))counts.delete(h); // le site lui-même
      const rows=trackerDb.report(counts);
      return {host:currentHost(s),rows,total:[...counts.values()].reduce((a,b)=>a+b,0),companies:rows.filter(r=>r.known).length,
        enabled:Boolean(adBlocker?.enabled),paused:Boolean(adBlocker?.isAllowlisted(t.url))};
    },
    'import:sources':()=>process.platform==='win32'?importer.detectSources().map(({id,kind,browser,profile})=>({id,kind,browser,profile,help:importer.PASSWORD_EXPORT_HELP[browser]||''})):[],
    'import:run':(_s,id,opts)=>{
      if(remote?.disabled('import'))throw new Error('L’import est temporairement désactivé (maintenance).');
      const src=importer.detectSources().find(x=>x.id===String(id||''));if(!src)throw new Error('Navigateur introuvable.');
      const r=importer.importFrom(src,browsing,{bookmarks:opts?.bookmarks!==false,history:opts?.history!==false});browsing.flush?.();broadcast();
      logger.info('Import',src.browser,r.bookmarks,r.history);if(r.bookmarks||r.history)ach('bump','imports');return r;
    },
    'pw:change-master':async(_s,oldMaster,newMaster)=>{const st=await vault.changeMaster(String(oldMaster||''),String(newMaster||''));broadcast();return st;},
    'pw:menu':s=>passwordMenu(s),
    'pw:fill':(s,id)=>{const t=activeTab(s);const e=vault.isUnlocked()&&vault.entries.find(x=>x.id===id);if(!t?.url||!e)throw new Error('Identifiant introuvable.');fillCredentials(t,e);},
    'pw:offer':async(s,action,master)=>{
      const offer=pendingPassword;
      if(!offer||offer.windowId!==s.id)return;
      if(action==='dismiss'){pendingPassword=null;broadcast();return;}
      if(!vault.isUnlocked()){
        if(!master)throw new Error('Saisis ton mot de passe maître pour enregistrer.');
        if(vault.exists())await vault.unlock(String(master));else await vault.create(String(master));
      }
      if(action==='never'){vault.neverFor(offer.origin);pendingPassword=null;broadcast();return 'Ce site ne proposera plus d’enregistrer.';}
      vault.save({origin:offer.origin,username:offer.username,password:offer.password});
      pendingPassword=null;broadcast();return 'Mot de passe enregistré dans le coffre chiffré.';
    },
    'pw:fill-first':async(s,master)=>{
      if(!vault.isUnlocked())await vault.unlock(String(master||''));
      broadcast();passwordMenu(s);
    },
    // ---- Radio, VPN, performances
    'radio:open':()=>openRadio(),
    'vpn:menu':s=>vpnMenu(s),
    'vpn:connect':(s,country='')=>{if(!VPN_COUNTRIES.some(c=>c.code===country))throw new Error('Pays inconnu.');settings.vpnCountry=country;saveSettings();startVpn(s,country);},
    'vpn:disconnect':()=>disconnectVpn(),
    'tab:new-menu':s=>newTabMenu(s),
    'tab:new-private':(s,url='')=>openPrivateTab(s,typeof url==='string'?url:''),
    'perf:metrics':()=>perfMetrics(),
    'perf:gaming':(_s,value)=>setGamingMode(Boolean(value)),
    'perf:sleep-tab':(_s,id)=>{const t=findTab(id);if(!t||!sleepTab(t))throw new Error('Impossible de mettre cet onglet en veille (onglet actif, son en cours ou mode IE).');},
    'perf:sleep-all':()=>{let n=0;for(const s of windows.values())for(const t of s.tabs.values())if(sleepTab(t))n++;return n;},
    // ---- Historique et favoris
    'history:list':(_s,query='',offset=0)=>browsing.listHistory({query:String(query||'').slice(0,200),offset:Number(offset)||0,limit:150}),
    'history:remove':(_s,url)=>{browsing.removeHistory(String(url||''));broadcast();},
    'history:clear':(_s,range)=>{const ms={hour:3600e3,day:86400e3,week:7*86400e3,all:0}[range];if(ms===undefined)throw new Error('Période invalide.');browsing.clearHistory(ms);broadcast();},
    'history:suggest':(_s,query)=>browsing.suggestions(String(query||'').slice(0,200),8),
    'bookmarks:toggle':s=>toggleBookmark(s),
    'bookmarks:add':(_s,url,title)=>{const b=browsing.addBookmark(String(url||''),String(title||''));broadcast();return b;},
    'bookmarks:remove':(_s,id)=>{browsing.removeBookmark(String(id||''));broadcast();},
    'bookmarks:rename':(_s,id,title)=>{browsing.renameBookmark(String(id||''),String(title||''));broadcast();},
    'bookmarks:move':(_s,id,index)=>{browsing.moveBookmark(String(id||''),Number(index));broadcast();},
    'bookmarks:list':()=>browsing.bookmarks,
    'bookmarks:context':(s,id)=>bookmarkContextMenu(s,String(id||'')),
    'link:open':(s,url,mode='current')=>{
      if(typeof url!=='string'||!isWebUrl(url))throw new Error('Adresse invalide.');
      if(mode==='tab')return newTab(s,url,{background:true});
      if(mode==='window')return void createWindow({tabs:[url]});
      navigate(s,url);
    },
    // ---- À propos et mises à jour
    'app:about':()=>aboutInfo(),
    'app:copy-diagnostics':()=>{const info=aboutInfo();clipboard.writeText(Object.entries({...info,extensions:info.extensions.map(e=>`${e.name} ${e.version}`).join(', '),shield:info.shield?.quality,update:info.update?.status}).map(([k,v])=>`${k}: ${v}`).join('\n'));},
    'app:open-repository':(s,page='')=>{const target=REPOSITORY_URL+({releases:'/releases',changelog:'/blob/main/CHANGELOG.md',issues:'/issues'}[page]||'');newTab(s,target);},
    'update:check':async()=>{if(!updater)throw new Error('Service de mise à jour indisponible.');await updater.check();return updater.state;},
    'update:install':()=>{if(!updater)throw new Error('Service de mise à jour indisponible.');settings.restoreAfterUpdate=true;saveSettings();saveSessionNow();updater.install();},
    'proxy:set':(_s,proxy)=>configureProxy(proxy),
    'github:connect':(_s,personaltoken)=>connectGitHub(personaltoken),
    'github:choose-repo':(_s,name,branch)=>selectRepository(name,branch),
    'github:sync':()=>syncGithub(),
    'github:disconnect':()=>disconnectGitHub()
  };
  for(const [name,fn] of Object.entries(h)){
    ipcMain.handle(`dgb:${name}`,(event,...args)=>fn(stateForSender(event.sender),...args));
  }
  registerPasswordCapture();
  ipcMain.on('dgb-radio:now',(event,name)=>{
    if(!radioWin||event.sender!==radioWin.webContents)return;
    radioNow=String(name||'').slice(0,120);broadcast();
  });
  ipcMain.handle('dgb-radio:theme',event=>(radioWin&&event.sender===radioWin.webContents)?settings.theme:'');
  // Scriptlets anti-publicités synchrones, demandés par le preload des pages.
  ipcMain.on('dgb-i18n:get',event=>{ event.returnValue=i18nPayload(); });
  // Fenêtres de support : la discussion est déduite de la fenêtre appelante, jamais des arguments.
  const supportOf=event=>supportOwner.get(event.sender.id)||null;
  ipcMain.handle('dgb-support:get',async event=>{
    const o=supportOf(event);if(!o)throw new Error('Fenêtre inconnue.');
    if(o.mode==='admin'){const v=await adminSupportCall(o.bugId);adminSupportCall(o.bugId,'read').catch(()=>{});return {mode:'admin',...v};}
    const chat=supportChatList().find(c=>c.bugId===o.bugId);const v=supportViews.get(o.bugId);
    return {mode:'user',bugId:o.bugId,subject:v?.subject||chat?.subject||'',open:v?v.open:true,messages:v?.messages||[],seq:v?.seq||0};
  });
  ipcMain.handle('dgb-support:send',async(event,raw)=>{
    const o=supportOf(event);if(!o)throw new Error('Fenêtre inconnue.');
    const text=String(raw||'').replace(/\u0000/g,'').trim().slice(0,1000);if(!text)throw new Error('Message vide.');
    if(o.mode==='admin'){const v=await adminSupportCall(o.bugId,'messages',{text});return {mode:'admin',...v};}
    const chat=supportChatList().find(c=>c.bugId===o.bugId);if(!chat)throw new Error('Cette discussion est terminée.');
    const v=await telemetry.api('/v1/support/'+o.bugId+'/messages',{method:'POST',body:{key:chat.key,text},timeout:20_000,maxBytes:1024*1024});
    const clean=remoteLib.cleanSupport([v])[0];if(clean){supportViews.set(o.bugId,clean);if(remote)remote.chatSeq.set(o.bugId,clean.seq);}
    return {mode:'user',...(clean||{})};
  });
  ipcMain.handle('dgb-support:end',async event=>{
    const o=supportOf(event);if(!o||o.mode!=='admin')throw new Error('Action réservée au support.');
    return {mode:'admin',...await adminSupportCall(o.bugId,'close')};
  });
  ipcMain.on('dgb-share:choose',(event,id,audio)=>{
    if(!sharePicker||sharePicker.win.isDestroyed()||event.sender!==sharePicker.win.webContents)return;
    if(!id){sharePicker.finish(null);return;}
    sharePicker.onChoose(String(id),audio===true);
  });
  ipcMain.on('dgb-lock:get',event=>{ event.returnValue={message:lockInfo.message, version:app.getVersion()}; });
  ipcMain.on('dgb-lock:action',(event,action,arg)=>{
    if(!lockWin||event.sender!==lockWin.webContents)return;
    if(action==='quit'){quitting=true;app.quit();}
    else if(action==='admin')adminUnlockLockScreen(arg);
    else recheckLock();
  });
  ipcMain.on('dgb-update:ready',event=>{ if(updateWin&&event.sender===updateWin.webContents)sendUpdateState(); });
  ipcMain.on('dgb-update:action',(event,action)=>{
    if(!updateWin||event.sender!==updateWin.webContents)return;
    if(action==='install'){ try{ settings.restoreAfterUpdate=true; saveSettings(); saveSessionNow(); updater.install(); }catch(e){ logger.warn('Mise à jour',e.message); sendUpdateState(); } }
    else { updateFlow?.postpone(updater?.state?.version); updateWin.close(); }
  });
  ipcMain.on('dgb-shield:early',(event,url)=>{
    try{
      if(event.sender.session!==browsingSession){event.returnValue={enabled:false};return;}
      event.returnValue=adBlocker?adBlocker.earlyScripts(String(url||'').slice(0,4096)):{enabled:false};
    }catch{event.returnValue={enabled:false,scripts:[],css:''};}
  });
}

// The packaged browser must not identify itself as "Electron": Google sign-in,
// YouTube and Twitch serve degraded pages to Electron user agents.
app.userAgentFallback=cleanUserAgent(app.userAgentFallback);
// GPU acceleration defaults to ON because disabling it often makes video calls
// use more CPU. Users can switch it off for broken GPU drivers (next launch).
try {
  const early=JSON.parse(fs.readFileSync(userDataFile('preferences.json'),'utf8'));
  if(early.performance?.hardwareAcceleration===false)app.disableHardwareAcceleration();
} catch {}
if(!app.requestSingleInstanceLock()){app.quit();}
else {
  app.on('second-instance',(_e,argv)=>{
    if(locked){ openLockWindow(); return; }
    const url=(argv||[]).find(a=>/^https?:\/\//i.test(a));
    const s=focusedState();
    if(!s){createWindow(url?{tabs:[url]}:{});return;}
    if(s.win.isMinimized())s.win.restore();s.win.focus();
    if(url){try{newTab(s,url);}catch{}}
  });
  app.on('web-contents-created',(_e,wc)=>wc.on('will-attach-webview',e=>e.preventDefault()));
  app.whenReady().then(async()=>{
    logger.init(path.join(app.getPath('userData'),'logs'));
    logger.info('Démarrage DevGitBrowser',app.getVersion(),process.versions.electron);
    process.on('uncaughtException',err=>logger.error('Exception non gérée',err));
    process.on('unhandledRejection',err=>logger.error('Promesse rejetée',err));
    app.on('child-process-gone',(_e,d)=>{ if(d?.reason!=='clean-exit'){ logger.warn('Processus arrêté',d?.type,d?.reason);
      if(d?.type==='GPU' && d.reason!=='killed') for(const s of windows.values()) notice(s,'Le processus graphique a redémarré. Si l’affichage scintille, désactive l’accélération graphique dans Paramètres → Performances.',true); } });
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('inc.codexhempreur.devgitbrowser');
    settings=loadSettings();
    applyLanguage();
    browsing=new BrowsingData({read:()=>readJson('browsing-data.json'),write:data=>writeAtomic(userDataFile('browsing-data.json'),JSON.stringify(data))});
    // Electron's userData path and persistent partition are isolated per OS user profile.
    browsingSession=session.fromPartition('persist:devgitbrowser-user');
    browsingSession.setUserAgent(cleanUserAgent(browsingSession.getUserAgent()));
    try{browsingSession.setSpellCheckerLanguages(['fr','en-US']);}catch{}
    // Early main-world scriptlets (YouTube/Twitch) run before any page script.
    try{browsingSession.registerPreloadScript({type:'frame',id:'devgitshield-early',filePath:path.join(__dirname,'lib','shield-preload.js')});}
    catch(err){console.error('DevGitShield preload:',err?.message||err);}
    try{browsingSession.registerPreloadScript({type:'frame',id:'devgitvideo-local',filePath:path.join(__dirname,'lib','video-bridge-preload.js')});}
    catch(err){console.error('DevGit Video preload:',err?.message||err);}
    applySecureDns();
    vault=new PasswordVault({read:()=>{try{return fs.readFileSync(userDataFile('passwords.vault'));}catch{return null;}},
      write:buf=>writeAtomic(userDataFile('passwords.vault'),buf),protect:vaultProtect,unprotect:vaultUnprotect,onLock:()=>broadcast()});
    // Verrouillage du coffre quand la session Windows est verrouillée ou en veille.
    for(const ev of ['lock-screen','suspend'])powerMonitor.on(ev,()=>{if(vault?.isUnlocked()){vault.lock();broadcast();}});
    tor=new TorService({torDir:app.isPackaged?path.join(process.resourcesPath,'tor'):path.join(__dirname,'vendor','tor'),dataDir:userDataFile('vpn-data'),
      onState:()=>broadcast(),applyProxy:applyVpnProxy,restoreProxy:restoreDirectProxy});
    phishing=new PhishingGuard({dataFolder:app.getPath('userData'),enabled:settings.phishingProtection,onState:()=>broadcast(),
      fetcher:(url,opts)=>(typeof browsingSession.fetch==='function'?browsingSession.fetch(url,opts):fetch(url,opts))});
    registerIpc();registerNetworkIpc();
    // Native network + cosmetic ad filtering in the Chromium partition only.
    // The separate Windows MSHTML host cannot share Electron's request hooks.
    adBlocker=new AdBlockService({webSession:browsingSession,dataFolder:app.getPath('userData'),
      enabled:settings.adblockEnabled,allowlist:settings.adblockAllowlist,onState:()=>broadcast(),
      annoyances:settings.shieldAnnoyances,boost:settings.shieldBoost,
      fetcher:(url,opts)=>(typeof browsingSession.fetch==='function'?browsingSession.fetch(url,opts):fetch(url,opts)),
      resolveTopUrl:id=>{try{const wc=allWebContents.fromId(Number(id));return wc&&!wc.isDestroyed()?wc.getURL():'';}catch{return '';}}});
    try{await adBlocker.start();}catch(err){console.error('DevGitShield:',err?.message||err);}
    adBlockTimer=setInterval(()=>adBlocker?.refresh().catch(()=>{}),24*60*60*1000);
    adBlockTimer.unref?.();
    configurePermissionPolicy();configureDownloads();configurePrivacyHeaders();
    phishing.load();
    setInterval(()=>phishing?.refresh().catch(()=>{}),24*60*60*1000).unref?.();
    // Mise en veille des onglets inactifs (mode gaming / éco) et priorité des processus.
    perfTimer=setInterval(()=>{sleepIdleTabs();if(settings.gamingMode)applyProcessPriority();},20_000);perfTimer.unref?.();
    try{await browsingSession.setProxy(proxyForElectron(settings.proxy));}
    catch{settings.proxy={...DEFAULT_PROXY};}
    const fakeUpdate=!app.isPackaged&&/^\d+\.\d+\.\d+$/.test(process.env.DGB_TEST_UPDATER||'')?process.env.DGB_TEST_UPDATER:'';
    updateFlow=new UpdateFlow({notify:notifyUpdate,openWindow:()=>openUpdateWindow()});
    updater=new UpdateService({app,enabled:settings.autoUpdate,force:Boolean(fakeUpdate),...(fakeUpdate?{loadUpdater:()=>testUpdater(fakeUpdate)}:{}),onState:state=>{
      broadcast(); sendUpdateState();
      updateFlow.handle(state);
    }});
    startWeather();
    achievements=new achLib.Achievements({read:()=>readJson('achievements.json'),write:data=>writeAtomic(userDataFile('achievements.json'),JSON.stringify(data)),onUnlock:onAchievementsUnlocked});
    achLastAds=adBlocker?.totalBlocked||0;
    ach('addDistinct','themes',settings.theme);ach('addDistinct','languages',i18nLang);if(settings.discordPresence)ach('atLeast','discord',1);if(vault?.exists?.())ach('atLeast','vaultCreated',1);
    achTimer=setInterval(achievementsMinute,60_000);achTimer.unref?.();
    setTimeout(refreshReferralCount,60_000).unref?.();setInterval(refreshReferralCount,6*3_600_000).unref?.();
    // Module DRM Widevine (Electron castLabs) : installé et mis à jour en arrière-plan
    // par le Component Updater, sans retarder l'ouverture du navigateur.
    initWidevine();
    telemetry=new Telemetry({url:STATS_URL,pin:STATS_PIN,fetcher:webFetch,getSettings:()=>remote?.disabled('telemetry')?{...settings,telemetry:false}:settings,version:app.getVersion(),
      country:()=>{try{return app.getLocaleCountryCode();}catch{return '';}},platform:process.platform,
      isActive:()=>Boolean(BrowserWindow.getFocusedWindow())});
    telemetry.start();
    startupLock=readLockdown();
    remote=new remoteLib.RemoteConfig({telemetry,version:app.getVersion(),country:()=>{try{return app.getLocaleCountryCode();}catch{return '';}},
      initialLock:startupLock,
      onLock:(lock,{reached})=>{ if(lock.blocked)engageLockdown(lock); else if(reached)liftLockdown(); },
      onMessage:onLiveMessage,onRetract:onLiveRetract,onSupport:onSupportView,getChats:supportChatList,
      onFeatures:list=>{ if(list.includes('preview'))closeLinkPreview(); broadcast(); }});
    remote.start();
    setTimeout(()=>autoReferral().catch(e=>logger.warn('Parrainage auto',e.message)),3_000).unref?.();
    discord=new DiscordPresence({clientId:DISCORD_APP_ID,onError:e=>logger.warn('Discord',e.message)});
    updateDiscord();
    token=restoreToken();
    // Built-in extensions work for every Windows profile, with or without GitHub.
    await loadBundledExtensions();
    loadStoreExtensions().then(startStore).catch(e=>logger.warn('Store',e.message));
    if(startupLock){ engageLockdown(startupLock); }
    if(!locked){
    restoreSession();
    if(settings.vpnAtStartup&&tor?.state?.available){const first=windows.values().next().value;if(first)startVpn(first,settings.vpnCountry);}
    if(settings.gamingMode)applyProcessPriority();
    }
    updater.start();
    if(token){api().getUser().then(u=>{account={id:u.id,login:u.login};broadcast();if(settings.github)syncGithub().catch(()=>{});})
      .catch(()=>{token='';account=null;lastError='Session GitHub expirée. Reconnecte-toi.';broadcast();});}
    resetSyncTimer();
  }).catch(err=>{dialog.showErrorBox('Démarrage impossible',String(err.stack||err));app.quit();});
  app.on('before-quit',()=>{
    if(!quitting && windows.size)saveSessionNow();
    quitting=true;
    try{discord?.stop();}catch{}remote?.stop();
    if(adBlockTimer)clearInterval(adBlockTimer);if(syncTimer)clearInterval(syncTimer);updater?.stop();
    if(perfTimer)clearInterval(perfTimer);
    if(achTimer)clearInterval(achTimer);ach('flush');
    closeLinkPreview();
    tor?.stop(false).catch(()=>{});vault?.lock();
    for(const inspector of networkWindows.values())inspector.monitor.stop();
    if(browsing){if(settings?.clearHistoryOnExit)browsing.clearHistory(0);browsing.flush();}
  });
  app.on('window-all-closed',()=>{ if(locked && lockWin && !lockWin.isDestroyed()) return; app.quit(); });
}
