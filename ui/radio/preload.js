'use strict';
const {contextBridge, ipcRenderer} = require('electron');
// Lecteur radio : seule l'information « en cours de lecture » remonte au navigateur.
contextBridge.exposeInMainWorld('RadioHost', Object.freeze({
  nowPlaying: (name) => ipcRenderer.send('dgb-radio:now', typeof name === 'string' ? name.slice(0, 120) : ''),
  theme: () => ipcRenderer.invoke('dgb-radio:theme'),
  onTheme: (cb) => ipcRenderer.on('dgb-radio:theme', (_e, value) => cb(value))
}));
