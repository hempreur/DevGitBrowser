'use strict';
// Preload du navigateur : transmet les messages DevGit Video au processus local.
// Aucun accès réseau, jeton, chemin, cookie ou shell exposé à la page.
const {ipcRenderer}=require('electron');
try {
  if(window===window.top && /^https:\/\/(?:www\.|m\.)?youtube\.com(?:[:/]|$)/i.test(String(location.href))){
    window.addEventListener('message',async event=>{
      if(event.source!==window||event.origin!==location.origin)return;
      const d=event.data;
      if(!d||d.channel!=='dgb-video-v2'||d.type!=='request'||typeof d.id!=='string'||!/^[a-zA-Z0-9_-]{8,48}$/.test(d.id))return;
      if(!['formats','download'].includes(d.action)||typeof d.videoId!=='string'||!/^[a-zA-Z0-9_-]{11}$/.test(d.videoId))return;
      const id=d.id;
      try{
        const result=await ipcRenderer.invoke('dgb-video:local',{action:d.action,videoId:d.videoId,kind:d.kind,quality:d.quality});
        window.postMessage({channel:'dgb-video-v2',type:'response',id,result},location.origin);
      }catch(error){
        window.postMessage({channel:'dgb-video-v2',type:'response',id,error:String(error?.message||error).slice(0,400)},location.origin);
      }
    });
  }
}catch{}
