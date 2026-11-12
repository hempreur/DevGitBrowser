'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('DevGitShare', Object.freeze({
  onSources: fn => ipcRenderer.on('dgb-share:sources', (_e, v) => fn(v)),
  choose: (id, audio) => ipcRenderer.send('dgb-share:choose', String(id || ''), audio === true),
  cancel: () => ipcRenderer.send('dgb-share:choose', '', false)
}));
