'use strict';
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('DevGitPreview', {
  action: a => ipcRenderer.send('dgb-preview:action', String(a)),
  onInfo: fn => ipcRenderer.on('dgb-preview:info', (_e, info) => fn(info))
});
