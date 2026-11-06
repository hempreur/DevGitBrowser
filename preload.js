'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Expose only narrowly scoped operations to the local trusted interface.
// No Node.js, filesystem, token, or shell APIs are exposed to websites.
const invoke = (channel,...args) => ipcRenderer.invoke(`dgb:${channel}`,...args);
contextBridge.exposeInMainWorld('DevGit',Object.freeze({
  initial:()=>invoke('initial'),
  newTab:url=>invoke('tab:new',url||''),selectTab:id=>invoke('tab:select',id),closeTab:id=>invoke('tab:close',id),detachTab:()=>invoke('tab:detach'),
  go:url=>invoke('nav:go',url),back:()=>invoke('nav:back'),forward:()=>invoke('nav:forward'),
  reload:()=>invoke('nav:reload'),home:()=>invoke('nav:home'),inspect:()=>invoke('nav:inspect'),
  panel:value=>invoke('ui:panel',value),
  allowPopups:value=>invoke('site:popups',value),revokeMedia:()=>invoke('site:revoke-media'),
  proxy:value=>invoke('proxy:set',value),
  githubConnect:token=>invoke('github:connect',token),
  githubRepo:(repo,branch)=>invoke('github:choose-repo',repo,branch),
  githubSync:()=>invoke('github:sync'),githubDisconnect:()=>invoke('github:disconnect'),
  onState:cb=>{
    const fn=(_event,value)=>cb(value);
    ipcRenderer.on('dgb:state',fn);return()=>ipcRenderer.off('dgb:state',fn);
  },
  onFocusAddress:cb=>{
    const fn=()=>cb();ipcRenderer.on('dgb:focus-address',fn);return()=>ipcRenderer.off('dgb:focus-address',fn);
  }
}));
