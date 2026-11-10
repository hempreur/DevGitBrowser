/* DevGit Video 2.0 — aucun média, cookie ou lien envoyé au VPS DevGit. */
(() => {
  'use strict';
  if(window!==top||document.getElementById('devgit-video-local-root'))return;
  let videoId='',info=null,busy=false,seq=0;
  const ID=/^[A-Za-z0-9_-]{11}$/;
  const host=document.createElement('div');
  host.id='devgit-video-local-root';
  host.style.cssText='position:fixed;right:20px;bottom:26px;z-index:2147483646';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML=`<style>
    :host{all:initial}*{box-sizing:border-box}.ui{font:13px/1.45 system-ui,Segoe UI,sans-serif;color:#eafaff}
    button,select{font:inherit}button{cursor:pointer}
    #toggle{padding:11px 16px;border-radius:12px;border:1px solid #73d7ef;background:#103044;color:white;font-weight:bold;box-shadow:0 8px 24px #0009}
    #panel{width:294px;margin-bottom:10px;border:1px solid #45d0e5;background:#112635;border-radius:13px;padding:15px;box-shadow:0 15px 30px #000a}
    #panel[hidden]{display:none}h3{margin:0 0 8px;color:#85edff;font-size:16px}p{margin:7px 0}
    label{display:block;margin:10px 0 4px;font-weight:bold}select{width:100%;border:1px solid #638096;border-radius:7px;background:#233d4e;color:white;padding:8px}
    #start{width:100%;margin:13px 0 8px;border:0;border-radius:8px;padding:10px;background:#24cfe4;color:#05222f;font-weight:700}#start:disabled{opacity:.5;cursor:wait}
    #status{overflow-wrap:anywhere;color:#c9e9f5;min-height:26px}small{color:#a5bccb;font-size:11px;display:block;margin-top:7px}
  </style><div class="ui"><div id="panel" hidden role="dialog" aria-label="DevGit Video local">
    <h3>⬇ DevGit Video</h3><p>Téléchargement et conversion sur ton PC.</p>
    <label for="kind">Format</label><select id="kind"><option value="mp4">MP4 — vidéo</option><option value="mp3">MP3 — audio</option></select>
    <label for="quality">Qualité</label><select id="quality"><option>Chargement…</option></select>
    <button id="start" type="button" disabled>Télécharger sur mon PC</button>
    <p id="status" role="status"></p><small>Utilise uniquement des contenus dont le téléchargement est autorisé. Ton VPS sert seulement à distribuer l'extension.</small>
  </div><button id="toggle" type="button" aria-expanded="false">⬇ MP4 / MP3</button></div>`;
  const el=id=>root.getElementById(id);
  const status=s=>{el('status').textContent=s;};
  function getId(){
    try{
      const u=new URL(location.href);
      const candidate=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})(?:\/|$)/)?.[1];
      return ID.test(candidate||'')?candidate:'';
    }catch{return '';}
  }
  function request(action,data={}){
    return new Promise((resolve,reject)=>{
      const id=Date.now()+'-'+(++seq);
      function onMessage(event){
        const m=event.data;
        if(event.source!==window||event.origin!==location.origin||m?.channel!=='dgb-video-v2'||m?.type!=='response'||m.id!==id)return;
        clearTimeout(timer);window.removeEventListener('message',onMessage);
        m.error?reject(new Error(m.error)):resolve(m.result);
      }
      const timer=setTimeout(()=>{
        window.removeEventListener('message',onMessage);
        reject(new Error('Le navigateur ne répond pas : installe la mise à jour DevGitBrowser avec le moteur local.'));
      },action==='download'?46*60*1000:80000);
      window.addEventListener('message',onMessage);
      window.postMessage({channel:'dgb-video-v2',type:'request',id,action,videoId,...data},location.origin);
    });
  }
  function renderQualities(){
    const kind=el('kind').value;
    const values=kind==='mp4'?info?.heights:info?.audioBitrates;
    const select=el('quality');select.replaceChildren();
    for(const quality of values||[]){
      const opt=document.createElement('option');opt.value=String(quality);
      opt.textContent=kind==='mp4'?quality+'p maximum':quality+' kb/s (encodage)';
      select.append(opt);
    }
    if(values?.length)select.value=String(values[values.length-1]);
    el('start').disabled=busy||!values?.length;
  }
  async function refresh(){
    if(!videoId)return;
    const id=videoId;info=null;renderQualities();status('Recherche des qualités disponibles…');
    try{const result=await request('formats');if(videoId!==id)return;info=result;renderQualities();status(String(result.title||'Choisis une qualité').slice(0,90));}
    catch(e){if(videoId===id){status(e.message);info=null;renderQualities();}}
  }
  function update(){
    const id=getId();if(videoId===id)return;
    videoId=id;info=null;busy=false;renderQualities();
    if(!id){host.remove();el('panel').hidden=true;el('toggle').setAttribute('aria-expanded','false');}
    else{if(!host.isConnected)document.documentElement.append(host);if(!el('panel').hidden)refresh();}
  }
  el('toggle').addEventListener('click',()=>{
    const open=el('panel').hidden;el('panel').hidden=!open;
    el('toggle').setAttribute('aria-expanded',String(open));if(open)refresh();
  });
  el('kind').addEventListener('change',renderQualities);
  el('start').addEventListener('click',async()=>{
    if(busy||!videoId)return;
    busy=true;renderQualities();const original=videoId;
    status('Choisis le nom du fichier dans la fenêtre Windows. La conversion sera faite sur ton PC…');
    try{
      const result=await request('download',{kind:el('kind').value,quality:Number(el('quality').value)});
      if(videoId===original)status(result.cancelled?'Opération annulée.':'Terminé : '+result.filename);
    }catch(e){if(videoId===original)status(e.message);}
    finally{busy=false;renderQualities();}
  });
  update();window.addEventListener('yt-navigate-finish',update);window.addEventListener('popstate',update);setInterval(update,1300);
})();
