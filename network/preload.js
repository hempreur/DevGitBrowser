'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('NetworkPanel',Object.freeze({
 initial:()=>ipcRenderer.invoke('dgb-network:initial'),
 clear:()=>ipcRenderer.invoke('dgb-network:clear'),
 reconnect:()=>ipcRenderer.invoke('dgb-network:reconnect'),
 body:id=>ipcRenderer.invoke('dgb-network:body',id),
 onEvent:fn=>{const cb=(_event,item)=>fn(item);ipcRenderer.on('dgb-network:event',cb);return()=>ipcRenderer.off('dgb-network:event',cb);}
}));
