'use strict';

const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, Menu, safeStorage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_PROXY, normalizeAddress, isWebUrl, normalizeProxy, proxyForElectron } = require('./lib/validation');
const { GitHubAPI, cleanRepoName, cleanBranch, groupExtensions, revision, extensionPath, verifyPrivateOwnedRepo } = require('./lib/github-source');

const SHELL_HEIGHT = 118;
const MAX_TABS = 30;
const SYNC_INTERVAL_MS = 90_000;
const MAX_POPUPS_PER_ORIGIN_MINUTE = 3;
const windows = new Map();
const installed = new Map(); // key -> {id, name, fingerprint, directory, error}
const popupTraffic = new Map();
const ephemeralMedia = new Map();
let nextWindowId = 0, nextTabId = 0;
let browsingSession, settings, account = null, token = '', syncTimer = null;
let syncing = false, lastSync = null, lastError = '';

function userDataFile(name) { return path.join(app.getPath('userData'), name); }
function cacheFolder() { return userDataFile('github-extension-cache'); }
function writeAtomic(target, contents) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  try { fs.writeFileSync(tmp, contents, { mode: 0o600 }); fs.renameSync(tmp, target); }
  finally { try { fs.rmSync(tmp, { force: true }); } catch {} }
}
function loadSettings() {
  const fallback = () => ({ proxy: { ...DEFAULT_PROXY }, github: null, popupAllowed: [], mediaGrants: {} });
  try {
    const raw = JSON.parse(fs.readFileSync(userDataFile('preferences.json'), 'utf8'));
    const p = fallback();
    try { p.proxy = normalizeProxy(raw.proxy || DEFAULT_PROXY); } catch {}
    if (Array.isArray(raw.popupAllowed)) p.popupAllowed = raw.popupAllowed.filter(isSecureOrigin).slice(0, 80);
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
    proxy: settings.proxy, popupAllowedHere: origin ? settings.popupAllowed.includes(origin) : false,
    currentOrigin: origin, blockedPopups: s.blockedPopups,
    mediaHere: origin ? (settings.mediaGrants[origin] || {camera:false,microphone:false}) : {camera:false,microphone:false},
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
    webSecurity:true, allowRunningInsecureContent:false, webviewTag:false
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
  wc.on('did-navigate', update); wc.on('did-navigate-in-page', update);
  wc.on('did-start-loading', () => { t.loading=true; sendState(t.owner); });
  wc.on('did-stop-loading', () => { t.loading=false; update(); });
  wc.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { t.loading=false; t.title=`Erreur de chargement (${code})`; sendState(t.owner); }
  });
  wc.on('will-navigate', (event, target) => { if (!isWebUrl(typeof target === 'string' ? target : target.url)) event.preventDefault(); });
  wc.on('will-redirect', (event, target) => { if (!isWebUrl(typeof target === 'string' ? target : target.url)) event.preventDefault(); });
  wc.setWindowOpenHandler(details => {
    const origin = siteOrigin(wc.getURL());
    const target = details.url;
    const now = Date.now();
    const entries = (popupTraffic.get(origin) || []).filter(time => now - time < 60_000);
    const allowed = origin && settings.popupAllowed.includes(origin) && isWebUrl(target)
      && entries.length < MAX_POPUPS_PER_ORIGIN_MINUTE;
    entries.push(now); popupTraffic.set(origin, entries.slice(-10));
    if (!allowed) { t.owner.blockedPopups++; sendState(t.owner); return { action:'deny' }; }
    return { action:'allow', overrideBrowserWindowOptions: {
      width:950, height:720, autoHideMenuBar:true, backgroundColor:'#121b2b',
      webPreferences: { session:browsingSession, nodeIntegration:false, contextIsolation:true,
        sandbox:true, webSecurity:true, allowRunningInsecureContent:false, webviewTag:false }
    }};
  });
  wc.on('did-create-window', popup => {
    popup.setMenu(null);
    popup.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    popup.webContents.on('will-navigate', (event, detail) => {
      if (!isWebUrl(typeof detail === 'string' ? detail : detail.url)) event.preventDefault();
    });
  });
  wc.on('before-input-event', (event,input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = String(input.key).toLowerCase();
    if (mod && key === 'l') { event.preventDefault(); t.owner.win.webContents.send('dgb:focus-address'); }
    else if (mod && key === 't') { event.preventDefault(); try { newTab(t.owner); } catch {} }
    else if (mod && key === 'w') { event.preventDefault(); closeTab(t.owner,t.id); }
    else if (mod && key === 'r') { event.preventDefault(); wc.reload(); }
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
  t.view.webContents.loadURL(url).catch(() => {});
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
function grantMedia(origin, type, permanent) {
  if (permanent) {
    const current=settings.mediaGrants[origin] || {camera:false,microphone:false};
    for(const p of type) current[p]=true;
    settings.mediaGrants[origin]=current;saveSettings();
  } else {
    const current=ephemeralMedia.get(origin)||{camera:false,microphone:false};
    for(const p of type) current[p]=true;
    ephemeralMedia.set(origin,current);
  }
}
function mediaGranted(origin,type) {return Boolean(settings.mediaGrants[origin]?.[type] || ephemeralMedia.get(origin)?.[type]);}
function installPermissionPolicy() {
  browsingSession.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if(permission!=='media'||!isSecureOrigin(origin))return false;
    const requested=details?.mediaType;
    if(requested==='video')return mediaGranted(origin,'camera');
    if(requested==='audio')return mediaGranted(origin,'microphone');
    return mediaGranted(origin,'camera') && mediaGranted(origin,'microphone');
  });
  browsingSession.setPermissionRequestHandler((wc, permission, callback, details={}) => {
    if(permission!=='media') {callback(false);return;}
    const origin=siteOrigin(details.requestingUrl || wc.getURL());
    if(!origin||siteOrigin(wc.getURL())!==origin) {callback(false);return;}
    const requested=Array.isArray(details.mediaTypes) ? details.mediaTypes : [];
    const types=[...new Set(requested.filter(x=>x==='audio'||x==='video').map(x=>x==='video'?'camera':'microphone'))];
    if (!types.length){callback(false);return;}
    if(types.every(type=>mediaGranted(origin,type))){callback(true);return;}
    const labels=types.map(x=>x==='camera'?'caméra':'microphone').join(' et ');
    const parent=[...windows.values()].find(s=>[...s.tabs.values()].some(t=>t.view.webContents===wc))?.win;
    const options={type:'question',title:'Autorisation caméra / microphone',
      message:`${origin} demande l'accès à : ${labels}.`,
      detail:'Cette autorisation est demandée par le site, jamais accordée automatiquement. Un site autorisé pourra enregistrer le son ou l’image pendant son utilisation.',
      buttons:['Refuser','Autoriser une fois','Toujours autoriser pour ce site'],defaultId:0,cancelId:0,noLink:true};
    Promise.resolve(parent?dialog.showMessageBox(parent,options):dialog.showMessageBox(options))
      .then(({response})=>{ if(response===1||response===2)grantMedia(origin,types,response===2);callback(response===1||response===2);broadcast(); })
      .catch(()=>callback(false));
  });
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
    'ui:panel':(s,shown)=>setPanel(s,shown),
    'site:popups':(s,allowed)=>{
      const origin=activeOriginRequired(s);
      settings.popupAllowed=settings.popupAllowed.filter(o=>o!==origin);
      if(Boolean(allowed))settings.popupAllowed.push(origin);
      saveSettings();broadcast();
    },
    'site:revoke-media':s=>{
      const origin=activeOriginRequired(s);delete settings.mediaGrants[origin];ephemeralMedia.delete(origin);saveSettings();broadcast();
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
    installPermissionPolicy();
    try{await browsingSession.setProxy(proxyForElectron(settings.proxy));}
    catch{settings.proxy={...DEFAULT_PROXY};}
    token=restoreToken();
    if(token){try{const u=await api().getUser();account={id:u.id,login:u.login};}
      catch{token='';account=null;lastError='Session GitHub expirée. Reconnecte-toi.';}}
    registerIpc();createWindow();
    if(token&&settings.github) syncGithub().catch(()=>{});
    syncTimer=setInterval(()=>{if(token&&settings.github)syncGithub().catch(()=>{});},SYNC_INTERVAL_MS);
  }).catch(err=>{dialog.showErrorBox('Démarrage impossible',String(err.stack||err));app.quit();});
  app.on('before-quit',()=>{if(syncTimer)clearInterval(syncTimer);});
  app.on('window-all-closed',()=>app.quit());
}
