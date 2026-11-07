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
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-lists-'));
  const fakeSession={registerPreloadScript:()=> 'id',unregisterPreloadScript(){},webRequest:{onBeforeRequest(){},onHeadersReceived(){}}};
  const service=new AdBlockService({webSession:fakeSession,dataFolder:dir,Engine:ElectronBlocker,enabled:false});
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
