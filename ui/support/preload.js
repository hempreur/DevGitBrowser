'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('DevGitSupport', Object.freeze({
  get: () => ipcRenderer.invoke('dgb-support:get'),
  send: text => ipcRenderer.invoke('dgb-support:send', String(text || '').slice(0, 1000)),
  end: () => ipcRenderer.invoke('dgb-support:end'),
  onUpdate: fn => ipcRenderer.on('dgb-support:update', (_e, v) => fn(v))
}));
