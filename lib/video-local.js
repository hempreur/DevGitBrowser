'use strict';
// Téléchargement et conversion entièrement sur le PC Windows, jamais sur le VPS.
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const AUDIO_RATES=Object.freeze([128,192,320]);
function videoUrl(id){if(typeof id!=='string'||!VIDEO_ID.test(id))throw new Error('Identifiant YouTube invalide.');return 'https://www.youtube.com/watch?v='+id;}
function isYoutubeWatchUrl(raw,id){
  if(!VIDEO_ID.test(id))return false;
  try{
    const u=new URL(raw);
    if(u.protocol!=='https:'||!['youtube.com','www.youtube.com','m.youtube.com'].includes(u.hostname))return false;
    return u.pathname==='/watch'?u.searchParams.get('v')===id:u.pathname==='/shorts/'+id||u.pathname==='/shorts/'+id+'/';
  }catch{return false;}
}
function validateRequest(id,kind,quality){
  videoUrl(id);
  if(!['mp4','mp3'].includes(kind))throw new Error('Format inconnu.');
  const q=Number(quality);
  if(!Number.isInteger(q)||(kind==='mp4'?(q<144||q>2160):!AUDIO_RATES.includes(q)))throw new Error('Qualité invalide.');
  return q;
}
class VideoLocal{
  constructor({toolDir,command,prefixArgs=[],spawnImpl=spawn}={}){
    this.toolDir=toolDir||'';
    this.command=command||path.join(this.toolDir,'yt-dlp.exe');
    this.prefixArgs=prefixArgs;this.spawnImpl=spawnImpl;this.busy=false;
  }
  checkTools(){
    for(const file of [this.command,path.join(this.toolDir,'ffmpeg.exe'),path.join(this.toolDir,'ffprobe.exe')])
      if(!fs.existsSync(file))throw new Error('Moteur local manquant : mets à jour DevGitBrowser (yt-dlp et FFmpeg intégrés).');
  }
  run(args,timeoutMs){
    this.checkTools();
    return new Promise((resolve,reject)=>{
      let proc,done=false,timeout=false,out='',err='';
      try{proc=this.spawnImpl(this.command,[...this.prefixArgs,...args],{windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});}
      catch{reject(new Error('Impossible de démarrer le moteur local.'));return;}
      const timer=setTimeout(()=>{timeout=true;proc.kill();},timeoutMs);
      const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
      proc.stdout.on('data',c=>{out+=c.toString('utf8');if(Buffer.byteLength(out)>8*1024*1024){proc.kill();finish(new Error('Sortie du moteur vidéo trop volumineuse.'));}});
      proc.stderr.on('data',c=>{err=(err+c.toString('utf8')).slice(-16000);});
      proc.on('error',()=>finish(new Error('Impossible de démarrer le moteur local.')));
      proc.on('close',code=>finish(code===0&&!timeout?null:new Error(timeout?'Opération locale expirée.':'Téléchargement impossible : '+(err.trim().slice(-300)||'erreur yt-dlp')),out));
    });
  }
  async formats(id){
    const stdout=await this.run(['--ignore-config','--no-playlist','--skip-download','--dump-single-json','--no-warnings','--ffmpeg-location',this.toolDir,videoUrl(id)],70000);
    let info;try{info=JSON.parse(stdout);}catch{throw new Error('Réponse vidéo illisible.');}
    const heights=[...new Set((Array.isArray(info.formats)?info.formats:[]).filter(f=>f?.vcodec&&f.vcodec!=='none').map(f=>Number(f.height)).filter(n=>Number.isInteger(n)&&n>=144&&n<=2160))].sort((a,b)=>a-b);
    if(!heights.length)throw new Error('Aucune qualité disponible.');
    return {title:String(info.title||'Vidéo YouTube').slice(0,120),heights,audioBitrates:AUDIO_RATES};
  }
  async download({videoId,kind,quality,savePath}){
    const q=validateRequest(videoId,kind,quality);
    if(typeof savePath!=='string'||!path.isAbsolute(savePath))throw new Error('Destination invalide.');
    if(this.busy)throw new Error('Un téléchargement est déjà en cours.');
    this.busy=true;
    try{
      const base=savePath.replace(/\.(mp4|mp3)$/i,'');
      const args=['--ignore-config','--no-playlist','--no-overwrites','--no-warnings','--no-progress','--max-filesize','2147483648',
        '--ffmpeg-location',this.toolDir,'-o',base+'.%(ext)s'];
      if(kind==='mp4')args.push('-f','bv*[height<='+q+'][ext=mp4]+ba[ext=m4a]/b[height<='+q+'][ext=mp4]/bv*[height<='+q+']+ba/b[height<='+q+']','--merge-output-format','mp4','--recode-video','mp4');
      else args.push('-f','ba/b','-x','--audio-format','mp3','--audio-quality',q+'K');
      await this.run([...args,videoUrl(videoId)],45*60*1000);
      const file=base+'.'+kind;
      if(!fs.existsSync(file))throw new Error('Le fichier final est introuvable après la conversion.');
      return {filename:path.basename(file),format:kind};
    }finally{this.busy=false;}
  }
}
module.exports={VideoLocal,validateRequest,isYoutubeWatchUrl,videoUrl,AUDIO_RATES};
