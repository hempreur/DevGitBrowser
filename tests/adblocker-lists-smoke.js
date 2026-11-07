'use strict';
// Exécuté sur le runner Windows (accès Internet réel) : télécharge les vraies
// listes, compile le moteur Ghostery et vérifie les règles YouTube / Twitch.
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
const {ElectronBlocker}=require('@ghostery/adblocker-electron');
const {Request}=require('@ghostery/adblocker');
const {AdBlockService}=require('../lib/adblocker');
// Le navigateur télécharge les listes avec le réseau de Chromium (session.fetch).
// Ici on utilise le module https de Node (le fetch/undici de Node 22 peut
// planter sur certaines fermetures TLS des serveurs de listes).
const https=require('node:https');
function nodeFetch(url,opts={},redirects=5){
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{headers:{'user-agent':'Mozilla/5.0 DevGitShield-CI','accept-encoding':'identity'},signal:opts.signal},res=>{
      if(res.statusCode>=300&&res.statusCode<400&&res.headers.location&&redirects>0){res.resume();resolve(nodeFetch(new URL(res.headers.location,url).href,opts,redirects-1));return;}
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);
      res.on('end',()=>{const text=Buffer.concat(chunks).toString('utf8');
        resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,text:async()=>text,body:{cancel:async()=>{}}});});
    });
    req.on('error',reject);
    req.setTimeout(20000,()=>req.destroy(new Error('timeout')));
  });
}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-lists-'));
  const fakeSession={registerPreloadScript:()=> 'id',unregisterPreloadScript(){},webRequest:{onBeforeRequest(){},onHeadersReceived(){}}};
  const service=new AdBlockService({webSession:fakeSession,dataFolder:dir,Engine:ElectronBlocker,enabled:false,fetcher:nodeFetch});
  await service.refresh();
  const state=service.state();
  console.log('Listes :',state.quality,'· échecs :',state.lists.failed.join(', ')||'aucun');
  assert.ok(service.engine,'moteur compilé');
  assert.equal(state.error,'',state.error);
  const blocked=url=>service.engine.match(Request.fromRawDetails({url,sourceUrl:'https://www.youtube.com/watch?v=x',type:'xmlhttprequest'})).match;
  assert.ok(blocked('https://www.youtube.com/pagead/viewthroughconversion/123'),'pagead YouTube bloqué');
  assert.ok(blocked('https://googleads.g.doubleclick.net/pagead/id'),'doubleclick bloqué');
  const yt=service.earlyScripts('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  console.log('Scriptlets YouTube :',yt.scripts.length);
  assert.ok(yt.scripts.length>=2,'scriptlets uBlock + protection dédiée YouTube');
  const tw=service.earlyScripts('https://www.twitch.tv/directory');
  console.log('Scriptlets Twitch :',tw.scripts.length);
  assert.ok(tw.scripts.some(s=>s.includes('__devgitTwitchShield')));
  console.log('OK — DevGitShield : listes réelles et protections YouTube/Twitch opérationnelles.');
})().catch(err=>{console.error(err);process.exit(1);});
