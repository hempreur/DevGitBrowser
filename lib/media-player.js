'use strict';
// Lecteur protégé DevGit (DevGitMedia.exe).
// C'est le moteur castLabs d'ORIGINE (signé VMP, sans fusibles modifiés), qui
// ne sert qu'aux plateformes de streaming exigeant la signature Widevine VMP
// (Netflix, Prime Video, Disney+…). DevGitBrowser.exe garde tous ses verrous.
// Profil séparé, aucune API exposée aux pages, navigation limitée aux sites de streaming :
// tout autre lien est renvoyé vers DevGitBrowser.
const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');

// Domaines pris en charge par le lecteur protégé (correspondance exacte ou sous-domaine).
const STREAMING_DOMAINS = Object.freeze([
  'netflix.com', 'nflxext.com', 'nflximg.net', 'nflxvideo.net', 'nflxso.net',
  'disneyplus.com', 'disney-plus.net', 'bamgrid.com', 'dssott.com',
  'primevideo.com', 'amazonvideo.com',
  'max.com', 'hbomax.com',
  'canalplus.com', 'mycanal.fr', 'canal-plus.com',
  'tv.apple.com',
  'paramountplus.com',
  'crunchyroll.com'
]);
// Pages d'entrée qui déclenchent l'ouverture du lecteur depuis DevGitBrowser
// (on n'y redirige pas les domaines techniques : images, vidéos, API).
const ENTRY_DOMAINS = Object.freeze(['netflix.com', 'disneyplus.com', 'primevideo.com', 'max.com', 'hbomax.com', 'canalplus.com', 'mycanal.fr', 'tv.apple.com', 'paramountplus.com', 'crunchyroll.com']);
// Connexions et paiements des plateformes (comptes Amazon, Google, Apple, Disney…).
const AUTH_DOMAINS = Object.freeze(['amazon.com', 'amazon.fr', 'amazon.de', 'amazon.co.uk', 'media-amazon.com', 'ssl-images-amazon.com', 'accounts.google.com', 'appleid.apple.com', 'idmsa.apple.com', 'apple.com', 'disney.com', 'go.com', 'paypal.com', 'canal-plus.net']);

const hostMatches = (host, list) => list.some(d => host === d || host.endsWith('.' + d));
function hostOf(url) { try { const u = new URL(String(url)); return u.protocol === 'https:' ? u.hostname.toLowerCase() : ''; } catch { return ''; } }
const isStreamingEntry = url => { const h = hostOf(url); return Boolean(h) && hostMatches(h, ENTRY_DOMAINS); };
const isAllowedInPlayer = url => { const h = hostOf(url); return Boolean(h) && (hostMatches(h, STREAMING_DOMAINS) || hostMatches(h, AUTH_DOMAINS)); };

const MEDIA_EXE = 'DevGitMedia.exe';
const isMediaExecutable = execPath => /^devgitmedia(\.exe)?$/i.test(String(execPath || '').split(/[\\/]/).pop());
// Chemin du lecteur à côté de DevGitBrowser.exe (installation Windows uniquement).
function mediaExecutable(execPath = process.execPath) {
  const candidate = path.join(path.dirname(execPath), MEDIA_EXE);
  return process.platform === 'win32' && fs.existsSync(candidate) ? candidate : '';
}
// Ouvre une adresse de streaming dans le lecteur protégé (processus séparé).
function openInMediaPlayer(url, execPath = process.execPath, spawnImpl = spawn) {
  const exe = mediaExecutable(execPath);
  if (!exe || !isStreamingEntry(url)) return false;
  const child = spawnImpl(exe, [String(url)], {detached: true, stdio: 'ignore', windowsHide: false});
  child.unref?.();
  return true;
}

// ----------------------------------------------------------- Application lecteur
function run() {
  const {app, BrowserWindow, Menu, session, components, shell} = require('electron');
  // Profil et verrou d'instance propres au lecteur : il ne partage rien avec le navigateur.
  app.setName('DevGitBrowser Media');
  app.setPath('userData', path.join(app.getPath('appData'), 'DevGitBrowser Media'));
  try { app.setAppUserModelId('inc.codexhempreur.devgitbrowser.media'); } catch {}
  const urlFromArgv = argv => (argv || []).find(a => isAllowedInPlayer(a)) || 'https://www.netflix.com/';
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  const browserExe = path.join(path.dirname(process.execPath), 'DevGitBrowser.exe');
  // Lien hors streaming : ouvert dans DevGitBrowser (jamais dans le lecteur).
  const openInBrowser = url => {
    if (!/^https?:\/\//i.test(String(url))) return;
    if (fs.existsSync(browserExe)) spawn(browserExe, [String(url)], {detached: true, stdio: 'ignore'}).unref();
    else shell.openExternal(String(url)).catch(() => {});
  };
  let win = null;
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.png');
  function createWindow(url) {
    const ses = session.fromPartition('persist:devgit-media');
    ses.setUserAgent(ses.getUserAgent().replace(/\s(?:Electron|DevGitBrowser(?: Media)?)\/\S+/g, ''));
    ses.setPermissionCheckHandler((_wc, permission) => ['mediaKeySystem', 'fullscreen', 'clipboard-sanitized-write'].includes(permission));
    ses.setPermissionRequestHandler((_wc, permission, callback) => callback(['mediaKeySystem', 'fullscreen', 'clipboard-sanitized-write'].includes(permission)));
    win = new BrowserWindow({
      width: 1280, height: 780, minWidth: 640, minHeight: 400, backgroundColor: '#000000', icon: iconPath, autoHideMenuBar: true,
      title: 'Lecteur protégé DevGit',
      webPreferences: {session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false, spellcheck: false}
    });
    win.setMenu(null);
    const wc = win.webContents;
    const guard = (event, target) => {
      const next = typeof target === 'string' ? target : target?.url;
      if (!isAllowedInPlayer(next)) { event.preventDefault(); openInBrowser(next); }
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({url: next}) => {
      if (isAllowedInPlayer(next)) { wc.loadURL(next).catch(() => {}); } else openInBrowser(next);
      return {action: 'deny'};
    });
    wc.on('page-title-updated', (e, title) => { e.preventDefault(); win.setTitle(`${title} · Lecteur protégé DevGit`); });
    wc.on('enter-html-full-screen', () => win.setFullScreen(true));
    wc.on('leave-html-full-screen', () => win.setFullScreen(false));
    // Raccourcis : Alt+← / Alt+→, F5, F11, Échap (quitter le plein écran).
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = String(input.key || '');
      if (input.alt && key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); event.preventDefault(); }
      else if (input.alt && key === 'ArrowRight' && wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); event.preventDefault(); }
      else if (key === 'F5') { wc.reload(); event.preventDefault(); }
      else if (key === 'F11') { win.setFullScreen(!win.isFullScreen()); event.preventDefault(); }
      else if (key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); }
    });
    win.on('closed', () => { win = null; });
    wc.loadURL(url).catch(() => {});
  }
  app.on('second-instance', (_e, argv) => {
    const url = urlFromArgv(argv);
    if (!win) { createWindow(url); return; }
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.loadURL(url).catch(() => {});
  });
  app.on('web-contents-created', (_e, wc) => wc.on('will-attach-webview', e => e.preventDefault()));
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Le module Widevine doit être prêt avant la première lecture.
    if (components && typeof components.whenReady === 'function') {
      try { await Promise.race([components.whenReady(), new Promise(r => setTimeout(r, 20000))]); } catch {}
    }
    createWindow(urlFromArgv(process.argv));
  });
}

module.exports = {STREAMING_DOMAINS, ENTRY_DOMAINS, AUTH_DOMAINS, MEDIA_EXE, isStreamingEntry, isAllowedInPlayer, isMediaExecutable, mediaExecutable, openInMediaPlayer, run};
