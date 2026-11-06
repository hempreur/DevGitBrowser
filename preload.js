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
  network:()=>invoke('nav:network'),legacy:()=>invoke('nav:legacy'),topmost:mode=>invoke('site:popup-topmost',mode),
  find:(query,forward)=>invoke('nav:find',query,forward),stopFind:()=>invoke('nav:stop-find'),print:()=>invoke('nav:print'),
  panel:value=>invoke('ui:panel',value),
  allowPopups:value=>invoke('site:popups',value),sitePrivacy:(key,value)=>invoke('site:privacy',key,value),siteReset:()=>invoke('site:reset'),revokeMedia:()=>invoke('site:revoke-media'),
  proxy:value=>invoke('proxy:set',value),
  performance:(mode,gpu)=>invoke('performance:save',mode,gpu),
  zoom:value=>invoke('nav:zoom',value),
  downloadFolder:()=>invoke('downloads:folder'),
  clearCache:()=>invoke('privacy:clear-cache'),clearSiteData:()=>invoke('privacy:clear-site-data'),
  githubConnect:token=>invoke('github:connect',token),
  githubRepo:(repo,branch)=>invoke('github:choose-repo',repo,branch),
  githubSync:()=>invoke('github:sync'),githubDisconnect:()=>invoke('github:disconnect'),
  onLegacyReady:cb=>{const fn=(_event,value)=>cb(String(value));ipcRenderer.on('dgb:legacy-ready',fn);
    return()=>ipcRenderer.off('dgb:legacy-ready',fn);},
  onLegacyError:cb=>{const fn=(_event,value)=>cb(String(value));ipcRenderer.on('dgb:legacy-error',fn);
    return()=>ipcRenderer.off('dgb:legacy-error',fn);},
  onState:cb=>{
    const fn=(_event,value)=>cb(value);
    ipcRenderer.on('dgb:state',fn);return()=>ipcRenderer.off('dgb:state',fn);
  },
  onFocusFind:cb=>{const fn=()=>cb();ipcRenderer.on('dgb:focus-find',fn);return()=>ipcRenderer.off('dgb:focus-find',fn);},
  onFocusAddress:cb=>{
    const fn=()=>cb();ipcRenderer.on('dgb:focus-address',fn);return()=>ipcRenderer.off('dgb:focus-address',fn);
  }
}));
