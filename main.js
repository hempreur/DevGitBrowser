'use strict';

const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu, safeStorage, desktopCapturer } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_PROXY, normalizeAddress, isWebUrl, normalizeProxy, proxyForElectron } = require('./lib/validation');
const { GitHubAPI, cleanRepoName, cleanBranch, groupExtensions, revision, extensionPath, verifyPrivateOwnedRepo } = require('./lib/github-source');
const { popupMode, PopupLimiter, parseOrigin } = require('./lib/popup-policy');

const SHELL_HEIGHT = 118;
const MAX_TABS = 30;

const popupLimiter = new PopupLimiter();
const windows = new Map();
const installed = new Map(); // key -> {id, name, fingerprint, directory, error}
const popupOrigins = new WeakMap(); // popup webContents -> opener origin for about:blank windows
const ephemeralMedia = new Map();
let nextWindowId = 0, nextTabId = 0;
let browsingSession, settings, account = null, token = '', syncTimer = null;
let syncing = false, lastSync = null, lastError = '';
let syncTimerCadence = 90_000;

function userDataFile(name) { return path.join(app.getPath('userData'), name); }
function cacheFolder() { return userDataFile('github-extension-cache'); }
function writeAtomic(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, contents, { mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
}
function loadSettings() {
  const fallback = () => ({ proxy: { ...DEFAULT_PROXY }, github: null, popupModes: {}, mediaGrants: {}, sitePrivacy: {}, performance:{mode:'balanced',hardwareAcceleration:true}, downloads:{folder:''}, zoomByOrigin:{} });
  try {
    const raw = JSON.parse(fs.readFileSync(userDataFile('preferences.json'), 'utf8'));
    const p = fallback();
    try { p.proxy = normalizeProxy(raw.proxy || DEFAULT_PROXY); } catch {}
    if (raw.popupModes && typeof raw.popupModes === 'object' && !Array.isArray(raw.popupModes)) {
      for (const [origin, mode] of Object.entries(raw.popupModes).slice(0,100)) {
        if (isSecureOrigin(origin) && ['allow','block'].includes(mode)) p.popupModes[origin]=mode;
      }
    }
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
    if (raw.performance?.mode==='eco') p.performance.mode='eco';
    if (raw.performance?.hardwareAcceleration===false) p.performance.hardwareAcceleration=false;
    if (raw.downloads && typeof raw.downloads.folder==='string' && raw.downloads.folder.length<=600 && path.isAbsolute(raw.downloads.folder))p.downloads.folder=raw.downloads.folder;
    if(raw.zoomByOrigin && typeof raw.zoomByOrigin==='object')for(const [origin,scale] of Object.entries(raw.zoomByOrigin).slice(0,100)) {
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
function saveSettings() { writeAtomic(userDataFile('preferences.json'), JSON.stringify(settings, null, 2)); }
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
function activeTab(s) { return s.tabs.get(s.activeId) || null; }
function tabState(t) {
  const wc = t.view.webContents;
  let back = false, forward = false;
  if (!wc.isDestroyed()) {
    try { back = wc.navigationHistory.canGoBack(); forward = wc.navigationHistory.canGoForward(); } catch {}
  }
  return { id: t.id, title: t.title, url: t.url, loading: t.loading, back, forward };
}
function currentOrigin(s) { return siteOrigin(activeTab(s)?.url || ''); }
function publicState(s) {
  const origin = currentOrigin(s);
  return {
    windowId: s.id, activeId: s.activeId, tabs: [...s.tabs.values()].map(tabState),
    proxy: settings.proxy, popupModeHere: origin ? popupMode(origin,settings.popupModes) : 'block',
    popupOverrideHere:origin ? settings.popupModes[origin]||'default':'default',
    popupDefaultBabel: Boolean(origin && !Object.hasOwn(settings.popupModes,origin) && popupMode(origin)==='allow'),
    performance: settings.performance, downloads: {folder: settings.downloads.folder || app.getPath('downloads')},
    zoom:activeTab(s)?.url && !activeTab(s).view.webContents.isDestroyed() ? activeTab(s).view.webContents.getZoomFactor():1,
    privacyHere:origin ? sitePermissions(origin) : sitePermissions(''),
    currentOrigin: origin, blockedPopups: s.blockedPopups,
    mediaHere: { camera:origin?mediaGranted(origin,'camera'):false, microphone:origin?mediaGranted(origin,'microphone'):false },
    github: { connected: Boolean(token && account), user: account?.login || '', avatar: '',
      repo: settings.github?.repo || '', branch: settings.github?.branch || 'main',
      lastSync, syncing, lastError },
    extensions: [...installed.entries()].map(([key, info]) => ({key, name:info.name, version:info.version || '', error:info.error || null, loaded:Boolean(info.id)}))
  };
}
function sendState(s) {
  if (s && !s.win.isDestroyed() && !s.win.webContents.isDestroyed()) s.win.webContents.send('dgb:state', publicState(s));
}
function broadcast() { for (const s of windows.values()) sendState(s); }
function layout(s) {
  if (s.win.isDestroyed()) return;
  const t = activeTab(s);
  if (!t || !t.url) return;
  const [w,h] = s.win.getContentSize();
  t.view.setBounds({ x:0, y:SHELL_HEIGHT, width:Math.max(1,w), height:Math.max(1,h-SHELL_HEIGHT-27) });
}
function selectTab(s, id) {
  const next = s.tabs.get(Number(id)); if (!next) return;
  const prev = activeTab(s);
  if (prev && prev !== next) {
    try { s.win.contentView.removeChildView(prev.view); } catch {}
  }
  s.activeId = next.id;
  if (next.url) {
    if (!s.win.contentView.children.includes(next.view)) s.win.contentView.addChildView(next.view);
    next.view.setVisible(!s.panelOpen);
    layout(s);
  }
  sendState(s);
}
function newTab(s, url = '') {
  if (s.tabs.size >= MAX_TABS) throw new Error(`Maximum de ${MAX_TABS} onglets par fenêtre.`);
  const view = new WebContentsView({ webPreferences: {
    session: browsingSession, nodeIntegration:false, contextIsolation:true, sandbox:true,
    webSecurity:true, allowRunningInsecureContent:false, webviewTag:false, backgroundThrottling:true
  }});
  view.setBackgroundColor('#f5f7fa');
  const t = { id:++nextTabId, owner:s, view, url:'', title:'Nouvel onglet', loading:false };
  s.tabs.set(t.id, t);
  const wc = view.webContents;
  const update = () => {
    if (wc.isDestroyed() || !t.owner.tabs.has(t.id)) return;
    const value = wc.getURL(); if (isWebUrl(value)) t.url = value;
    const title = wc.getTitle(); if (title && title !== 'about:blank') t.title = title.slice(0,90);
    sendState(t.owner);
  };
  wc.on('page-title-updated', (_event, title) => { t.title = String(title).slice(0,90); sendState(t.owner); });
  wc.on('did-navigate', () => { update(); applySiteZoom(t); }); wc.on('did-navigate-in-page', update);
  wc.setBackgroundThrottling(true);
  if(typeof wc.setZoomMode==='function')wc.setZoomMode('isolated');
  wc.on('did-start-loading', () => { t.loading=true; sendState(t.owner); });
  wc.on('did-stop-loading', () => { t.loading=false; update(); });
  wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { t.loading=false; t.title=`Erreur de chargement (${code})`; sendState(t.owner); }
  });
  wc.on('will-navigate', (event, target) => { if (!isWebUrl(typeof target === 'string' ? target : target.url)) event.preventDefault(); });
  wc.on('will-redirect', (event, target) => { if (!isWebUrl(typeof target === 'string' ? target : target.url)) event.preventDefault(); });
  installPopupHandler(wc, () => siteOrigin(wc.getURL()), () => t.owner, 0);
  wc.on('before-input-event', (event,input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = String(input.key).toLowerCase();
    if (mod && key === 'l') { event.preventDefault(); t.owner.win.webContents.send('dgb:focus-address'); }
    else if (mod && key === 't') { event.preventDefault(); try { newTab(t.owner); } catch {} }
    else if (mod && key === 'w') { event.preventDefault(); closeTab(t.owner,t.id); }
    else if (mod && key === 'r') { event.preventDefault(); wc.reload(); }
    else if (mod && ['+','='].includes(key)) { event.preventDefault(); setZoom(t.owner,1); }
    else if (mod && key === '-') { event.preventDefault(); setZoom(t.owner,-1); }
    else if (mod && key === '0') { event.preventDefault(); setZoom(t.owner,0); }
    else if (mod && key === 'f') { event.preventDefault(); t.owner.win.webContents.send('dgb:focus-find'); }
    else if (mod && key === 'p') { event.preventDefault(); wc.print({printBackground:true},()=>{}); }
    else if (input.alt && key === 'left') { event.preventDefault(); if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
    else if (input.alt && key === 'right') { event.preventDefault(); if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
  });
  selectTab(s,t.id);
  if (url) navigate(s,url);
  return t.id;
}
function closeTab(s,id) {
  const t = s.tabs.get(Number(id)); if (!t) return;
  const active = s.activeId === t.id;
  if (active && t.url) { try { s.win.contentView.removeChildView(t.view); } catch {} }
  s.tabs.delete(t.id);
  if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
  if (active) { s.activeId=null; if (s.tabs.size) selectTab(s,[...s.tabs.keys()].at(-1)); else newTab(s); }
  else sendState(s);
}
function navigate(s,text) {
  const t = activeTab(s); if (!t) return;
  const url = normalizeAddress(text); if (!url) return;
  t.url=url; t.title=(new URL(url)).hostname;
  if (!s.win.contentView.children.includes(t.view)) s.win.contentView.addChildView(t.view);
  t.view.setVisible(!s.panelOpen); layout(s);
  sendState(s);
  t.view.webContents.loadURL(url).then(()=>applySiteZoom(t)).catch(() => {});
}
function home(s) {
  const t=activeTab(s); if (!t) return;
  if (t.url) { try { s.win.contentView.removeChildView(t.view); } catch {} }
  t.url='';t.title='Nouvel onglet';t.loading=false;
  t.view.webContents.loadURL('about:blank').catch(()=>{});
  sendState(s);
}
function createWindow(initialTab=true) {
  const win = new BrowserWindow({
    width:1320,height:850,minWidth:740,minHeight:520,
    title:'DevGitBrowser — CodexHempreur INC',
    icon:path.join(__dirname,'assets','icon.png'),
    autoHideMenuBar:true, backgroundColor:'#0b1020',
    webPreferences:{ preload:path.join(__dirname,'preload.js'), nodeIntegration:false,
      contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false }
  });
  const s={id:++nextWindowId,win,tabs:new Map(),activeId:null,panelOpen:false,blockedPopups:0};
  windows.set(s.id,s);
  win.setMenu(null);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('did-finish-load',()=>sendState(s));
  win.on('resize',()=>layout(s));
  win.on('closed',()=>{
    for (const t of s.tabs.values()) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
    s.tabs.clear(); windows.delete(s.id);
  });
  win.loadFile(path.join(__dirname,'ui','index.html'));
  if (initialTab) newTab(s);
  return s;
}
function detachTab(s) {
  const t=activeTab(s); if(!t) return;
  const next=createWindow(false);
  if(t.url) {try{s.win.contentView.removeChildView(t.view);}catch{}}
  s.tabs.delete(t.id); s.activeId=null;
  t.owner=next;
  next.tabs.set(t.id,t); next.activeId=t.id;
  if (t.url) {
    next.win.contentView.addChildView(t.view); t.view.setVisible(true); layout(next);
  }
  if (s.tabs.size) selectTab(s,[...s.tabs.keys()].at(-1)); else newTab(s);
  sendState(next);
  next.win.focus();
}
function setPanel(s,value) {
  s.panelOpen=Boolean(value);
  const t=activeTab(s); if(t?.url)t.view.setVisible(!s.panelOpen);
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
function dialogParentFor(wc) {
  for(const s of windows.values())if([...s.tabs.values()].some(t=>t.view.webContents===wc))return s.win;
  try {return BrowserWindow.fromWebContents(wc)||undefined;} catch {return undefined;}
}
function permissionDialog(wc, options) {
  const win=dialogParentFor(wc);
  return win?dialog.showMessageBox(win,options):dialog.showMessageBox(options);
}
function configurePermissionPolicy() {
  browsingSession.setPermissionCheckHandler((wc,permission,origin,details={})=>{
    if(permission==='media')return mediaPermissionCheck(wc,origin,details);
    if(permission==='display-capture')return Boolean(siteOrigin(origin)); // picker still must ask explicitly
    if(permission==='clipboard-sanitized-write'||permission==='fullscreen')return true;
    if(permission==='notifications'||permission==='geolocation')return Boolean(privacyOriginAllowed(wc,siteOrigin(origin),permission));
    return false;
  });
  browsingSession.setPermissionRequestHandler((wc,permission,callback,details={})=>{
    if(permission==='clipboard-sanitized-write'||permission==='fullscreen'){callback(true);return;}
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
  // No screen, window or tab is shared without a deliberate system-side choice.
  browsingSession.setDisplayMediaRequestHandler((request,callback)=>{
    const origin=siteOrigin(request.securityOrigin||'');
    if(!origin || !request.userGesture || !request.videoRequested){callback(null);return;}
    desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}})
      .then(sources=>{
        const options=sources.slice(0,15);
        if(!options.length){callback(null);return;}
        return permissionDialog(request.frame?.webContents,{type:'question',title:'Partager un écran ou une fenêtre',
          message:`${origin} souhaite afficher ton écran. Choisis explicitement ce que tu souhaites partager :`,
          buttons:['Annuler',...options.map((s,i)=>`${i+1}. ${String(s.name).slice(0,65)}`)],defaultId:0,cancelId:0,noLink:true})
          .then(({response})=>callback(response>0?{video:options[response-1]}:null));
      }).catch(()=>callback(null));
  });
}
function installPopupHandler(wc, originProvider, ownerProvider, depth) {
  if(depth>4)return;
  const icon=path.join(__dirname,'assets','icon.png');
  wc.setWindowOpenHandler(details=>{
    const origin=originProvider();
    const s=ownerProvider();
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
    popup.once('closed',()=>popupLimiter.release(origin));
    popup.webContents.setBackgroundThrottling(true);
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
  wc.setZoomFactor(value); settings.zoomByOrigin[origin]=value;saveSettings();sendState(s);
}
function configureDownloads() {
  browsingSession.on('will-download',(_event,item)=>{
    const folder=settings.downloads.folder || app.getPath('downloads');
    const safeName=path.basename(item.getFilename()||'telechargement');
    item.setSaveDialogOptions({title:'Enregistrer le téléchargement — DevGitBrowser',defaultPath:path.join(folder,safeName),buttonLabel:'Enregistrer'});
  });
}
function resetSyncTimer() {
  if(syncTimer)clearInterval(syncTimer);
  syncTimerCadence=settings.performance.mode==='eco'?300_000:90_000;
  syncTimer=setInterval(()=>{if(token&&settings.github)syncGithub().catch(()=>{});},syncTimerCadence);
}
async function configureProxy(proxy) {
  const safe=normalizeProxy(proxy);
  await browsingSession.setProxy(proxyForElectron(safe));
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
function activeOriginRequired(s){const value=currentOrigin(s);if(!value)throw new Error('Ouvre un site HTTPS avant de modifier ses autorisations.');return value;}
function registerIpc(){
  const h={
    'initial':s=>publicState(s),
    'tab:new':(s,url='')=>newTab(s,typeof url==='string'?url:''),
    'tab:select':(s,id)=>selectTab(s,id),
    'tab:close':(s,id)=>closeTab(s,id),
    'tab:detach':s=>detachTab(s),
    'nav:go':(s,address)=>navigate(s,address),
    'nav:back':s=>{const wc=activeTab(s)?.view.webContents;if(wc?.navigationHistory.canGoBack())wc.navigationHistory.goBack();},
    'nav:forward':s=>{const wc=activeTab(s)?.view.webContents;if(wc?.navigationHistory.canGoForward())wc.navigationHistory.goForward();},
    'nav:reload':s=>{const t=activeTab(s);if(t?.url)t.view.webContents.reload();},
    'nav:home':s=>home(s),
    'nav:inspect':s=>{const t=activeTab(s);if(t?.url)t.view.webContents.openDevTools({mode:'detach'});},
    'nav:find':(s,query,forward=true)=>{
      const wc=activeTab(s)?.view.webContents;
      if(!wc || !activeTab(s).url || typeof query!=='string' || query.length>150)return;
      if(!query){wc.stopFindInPage('clearSelection');return;}
      wc.findInPage(query,{forward:Boolean(forward),findNext:true});
    },
    'nav:stop-find':s=>{const wc=activeTab(s)?.view.webContents;if(wc&&!wc.isDestroyed())wc.stopFindInPage('clearSelection');},
    'nav:print':s=>{const t=activeTab(s);if(t?.url)t.view.webContents.print({printBackground:true},()=>{});},
    'ui:panel':(s,shown)=>setPanel(s,shown),
    'site:popups':(s,mode)=>{
      const origin=activeOriginRequired(s);
      if(!['allow','block','default'].includes(mode))throw new Error('Mode pop-up incorrect.');
      if(mode==='default')delete settings.popupModes[origin];
      else settings.popupModes[origin]=mode;
      saveSettings();broadcast();
    },
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
    'proxy:set':(_s,proxy)=>configureProxy(proxy),
    'github:connect':(_s,personaltoken)=>connectGitHub(personaltoken),
    'github:choose-repo':(_s,name,branch)=>selectRepository(name,branch),
    'github:sync':()=>syncGithub(),
    'github:disconnect':()=>disconnectGitHub()
  };
  for(const [name,fn] of Object.entries(h)){
    ipcMain.handle(`dgb:${name}`,(event,...args)=>fn(stateForSender(event.sender),...args));
  }
}

// GPU acceleration defaults to ON because disabling it often makes video calls
// use more CPU. Users can switch it off for broken GPU drivers (next launch).
try {
  const early=JSON.parse(fs.readFileSync(userDataFile('preferences.json'),'utf8'));
  if(early.performance?.hardwareAcceleration===false)app.disableHardwareAcceleration();
} catch {}
if(!app.requestSingleInstanceLock()){app.quit();}
else {
  app.on('second-instance',()=>{const s=[...windows.values()][0];if(s){if(s.win.isMinimized())s.win.restore();s.win.focus();}});
  app.on('web-contents-created',(_e,wc)=>wc.on('will-attach-webview',e=>e.preventDefault()));
  app.whenReady().then(async()=>{
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('inc.codexhempreur.devgitbrowser');
    settings=loadSettings();
    // Electron's userData path and persistent partition are isolated per OS user profile.
    browsingSession=session.fromPartition('persist:devgitbrowser-user');
    configurePermissionPolicy();configureDownloads();
    try{await browsingSession.setProxy(proxyForElectron(settings.proxy));}
    catch{settings.proxy={...DEFAULT_PROXY};}
    token=restoreToken();
    if(token){try{const u=await api().getUser();account={id:u.id,login:u.login};}
      catch{token='';account=null;lastError='Session GitHub expirée. Reconnecte-toi.';}}
    registerIpc();createWindow();
    if(token&&settings.github) syncGithub().catch(()=>{});
    resetSyncTimer();
  }).catch(err=>{dialog.showErrorBox('Démarrage impossible',String(err.stack||err));app.quit();});
  app.on('before-quit',()=>{if(syncTimer)clearInterval(syncTimer);});
  app.on('window-all-closed',()=>app.quit());
}
