'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// Lecteur radio : seule l'information « en cours de lecture » remonte au navigateur.
contextBridge.exposeInMainWorld('DGBLang',Object.freeze({initial:(()=>{try{return ipcRenderer.sendSync('dgb-i18n:get');}catch{return {lang:'fr',dict:{}};}})(),onChange:fn=>{ipcRenderer.on('dgb-i18n:changed',(_e,v)=>fn(v));}}));
contextBridge.exposeInMainWorld('RadioHost', Object.freeze({
  nowPlaying: (name) => ipcRenderer.send('dgb-radio:now', typeof name === 'string' ? name.slice(0, 120) : ''),
  theme: () => ipcRenderer.invoke('dgb-radio:theme'),
  onTheme: (cb) => ipcRenderer.on('dgb-radio:theme', (_e, value) => cb(value))
}));
