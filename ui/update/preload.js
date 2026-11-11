'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('DevGitUpdate', Object.freeze({
  ready: () => ipcRenderer.send('dgb-update:ready'),
  install: () => ipcRenderer.send('dgb-update:action', 'install'),
  later: () => ipcRenderer.send('dgb-update:action', 'later'),
  onState: fn => ipcRenderer.on('dgb-update:state', (_e, st) => fn(st))
}));
