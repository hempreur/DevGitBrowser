'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('DevGitLock', Object.freeze({
  info: (() => { try { return ipcRenderer.sendSync('dgb-lock:get'); } catch { return {message: '', version: ''}; } })(),
  retry: () => ipcRenderer.send('dgb-lock:action', 'retry'),
  quit: () => ipcRenderer.send('dgb-lock:action', 'quit'),
  admin: key => ipcRenderer.send('dgb-lock:action', 'admin', String(key || '').slice(0, 64)),
  onStatus: fn => ipcRenderer.on('dgb-lock:status', (_e, st) => fn(st))
}));
