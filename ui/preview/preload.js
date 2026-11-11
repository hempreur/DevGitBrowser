'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('DevGitPreview', {
  action: a => ipcRenderer.send('dgb-preview:action', String(a)),
  onInfo: fn => ipcRenderer.on('dgb-preview:info', (_e, info) => fn(info))
});
