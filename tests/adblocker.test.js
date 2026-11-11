'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AdBlockService,FILTER_SOURCES,FILTER_LISTS,OFFLINE_FILTERS,assertEnabled,allowlisted,normalizeHost,validateCachePath}=require('../lib/adblocker');

class FakeEngine {
  static parse(text) { return new FakeEngine(/DevGitShield - minimal offline/.test(text)?'offline':'strong',text); }
  static deserialize(bytes) {return new FakeEngine(Buffer.from(bytes).toString('utf8'),'');}
  constructor(name,text) {this.name=name;this.text=text;this.contexts=new Set();this.listeners={};this.resources=null;
    this.onBeforeRequest=(details,cb)=>cb({cancel:true});this.onInjectCosmeticFilters=()=> 'injected';this.onHeadersReceived=(d,cb)=>cb({});}
  enableBlockingInSession(session) {this.contexts.add(session);session.engines.add(this);}
  disableBlockingInSession(session) {this.contexts.delete(session);session.engines.delete(this);}
  updateResources(text) {this.resources=text;}
  on(event,fn){this.listeners[event]=fn;}
  serialize() {return Buffer.from(this.name);}
  getCosmeticsFilters({hostname}) {return {active:true,scripts:hostname.endsWith('youtube.com')?['/*ubo-scriptlet*/']:[],styles:''};}
}
const session=()=>({engines:new Set()});
const ok=text=>({ok:true,status:200,text:async()=>text});
function fixture(t,{fetcher=async url=>ok('! liste '+url+'\n||ads.example^\n'.repeat(3)),allowlist=[],resolveTopUrl}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-adblock-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const webSession=session();
  return {dir,webSession,service:new AdBlockService({dataFolder:dir,webSession,enabled:true,Engine:FakeEngine,fetcher,allowlist,resolveTopUrl})};
}
test('Strong protection lists cover ads, tracking, uBlock yearly filters, fixes and French ads',()=>{
  assert.ok(FILTER_SOURCES.some(url=>url.includes('easyprivacy')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('annoyances')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('liste_fr')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('quick-fixes')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('filters-2025')));
  assert.ok(FILTER_LISTS.every(list=>list.urls.every(url=>url.startsWith('https://'))));
  assert.ok(FILTER_LISTS.filter(l=>l.required).length>=2);
  assert.match(OFFLINE_FILTERS,/taboola\.com/);
  assert.match(OFFLINE_FILTERS,/youtube\.com\/pagead/);
  assert.equal(assertEnabled(true),true);
  assert.throws(()=>assertEnabled('on'),/invalide/);
});
test('Offline first launch enables fallback and failed updates never disable filtering',async t=>{
  const f=fixture(t,{fetcher:async()=>{throw new Error('Connexion absente');}});
  await f.service.start();
  await f.service.updatePromise;
  assert.equal(f.service.state().enabled,true);
  assert.match(f.service.state().quality,/hors ligne/);
  assert.equal(f.webSession.engines.size,1);
  assert.match(f.service.state().error,/principales indisponibles/);
});
test('One unreachable list or host no longer drops the whole update (mirror fallback)',async t=>{
  const asked=[];
  const f=fixture(t,{fetcher:async url=>{
    asked.push(url);
    if(url.includes('liste_fr'))throw new Error('hôte indisponible');
    if(url.startsWith('https://ublockorigin.github.io/uAssets/filters/filters.txt'))return {ok:false,status:503,text:async()=>''};
    return ok('! liste\n||ads.example^\n'.repeat(4));
  }});
  await f.service.start();await f.service.updatePromise;
  assert.equal(f.service.engine.name,'strong');
  assert.ok(asked.some(u=>u.includes('ghostery/adblocker')&&u.endsWith('ublock-origin/filters.txt')),'miroir Ghostery utilisé');
  assert.deepEqual(f.service.state().lists.failed,['easylist-france']);
  assert.ok(f.service.engine.resources,'ressources des scriptlets chargées');
  assert.match(f.service.state().quality,/scriptlets actifs/);
});
test('HTML error pages are never accepted as filter lists',async t=>{
  const f=fixture(t,{fetcher:async()=>ok('<!doctype html><html><body>captive portal</body></html>')});
  await f.service.start();await f.service.updatePromise;
  assert.match(f.service.state().quality,/hors ligne/);
});
test('Online refresh updates the blocker and writes a reusable offline cache',async t=>{
  const f=fixture(t);
  await f.service.start();
  if(f.service.updatePromise)await f.service.updatePromise;
  assert.equal(f.service.engine.name,'strong');
  assert.equal(f.webSession.engines.size,1);
  const binary=fs.readFileSync(validateCachePath(f.dir));
  assert.equal(binary.toString(),'strong');
  const second=new AdBlockService({webSession:session(),dataFolder:f.dir,enabled:true,Engine:FakeEngine,clock:()=>Date.now(),fetcher:async()=>{throw Error('Unreachable');}});
  await second.start();
  assert.match(second.state().quality,/cache/);
});
test('Toggle immediately disables and re-enables the session blocker',async t=>{
  const f=fixture(t);
  await f.service.start();
  if(f.service.updatePromise)await f.service.updatePromise;
  f.service.setEnabled(false);
  assert.equal(f.webSession.engines.size,0);
  f.service.setEnabled(true);
  assert.equal(f.webSession.engines.size,1);
  assert.throws(()=>f.service.setEnabled(1),/invalide/);
});
test('Per-site pause bypasses network and cosmetic filtering only for that site',async t=>{
  const f=fixture(t,{allowlist:['betclic.fr'],resolveTopUrl:id=>id===7?'https://www.betclic.fr/live':'https://news.example.com/'});
  await f.service.start();await f.service.updatePromise;
  const engine=f.service.engine;
  const results=[];
  engine.onBeforeRequest({webContentsId:7,url:'https://ads.example/x'},r=>results.push(r));
  engine.onBeforeRequest({webContentsId:8,url:'https://ads.example/x'},r=>results.push(r));
  assert.deepEqual(results,[{},{cancel:true}]);
  assert.equal(engine.onInjectCosmeticFilters({}, 'https://sport.betclic.fr/'),undefined);
  assert.equal(engine.onInjectCosmeticFilters({}, 'https://news.example.com/'),'injected');
  assert.equal(allowlisted('evilbetclic.fr',['betclic.fr']),false);
  assert.equal(normalizeHost('WWW.Twitch.TV'),'twitch.tv');
  f.service.setAllowed('twitch.tv',true);
  assert.ok(f.service.state().allowlist.includes('twitch.tv'));
  assert.throws(()=>f.service.setAllowed('not a host',true),/invalide/);
});
test('Blocked requests are counted per tab and reset on navigation',async t=>{
  const f=fixture(t);
  await f.service.start();await f.service.updatePromise;
  f.service.engine.listeners['request-blocked']({tabId:12});
  f.service.engine.listeners['request-blocked']({tabId:12});
  assert.equal(f.service.blockedFor(12),2);
  assert.equal(f.service.state().totalBlocked,2);
  f.service.resetTab(12);
  assert.equal(f.service.blockedFor(12),0);
});
test('Early scriptlets: uBlock rules (+ YouTube/Twitch protections in boost mode), nothing on paused sites',async t=>{
  const f=fixture(t,{allowlist:['example.org']});
  await f.service.start();await f.service.updatePromise;
  const yt=f.service.earlyScripts('https://www.youtube.com/watch?v=abc');
  assert.equal(yt.enabled,true);
  assert.ok(yt.scripts.includes('/*ubo-scriptlet*/'));
  assert.ok(!yt.scripts.some(s=>s.includes('__devgitYouTubeShield')),'protections maison désactivées par défaut');
  f.service.setBoost(true);
  assert.ok(f.service.earlyScripts('https://www.youtube.com/watch?v=abc').scripts.some(s=>s.includes('__devgitYouTubeShield')));
  assert.match(yt.css,/ytd-ad-slot-renderer/);
  const tw=f.service.earlyScripts('https://www.twitch.tv/somechannel');
  assert.ok(tw.scripts.some(s=>s.includes('__devgitTwitchShield')));
  assert.equal(f.service.earlyScripts('https://example.org/').enabled,false);
  assert.equal(f.service.earlyScripts('file:///C:/x.html').enabled,false);
  f.service.setEnabled(false);
  assert.equal(f.service.earlyScripts('https://www.youtube.com/').enabled,false);
});
test('The blocker is wired into the browser security panel and main session',()=>{
  const root=path.join(__dirname,'..');
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'ui','index.html'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
  const renderer=fs.readFileSync(path.join(root,'ui','renderer.js'),'utf8');
  assert.match(main,/new AdBlockService\(/);
  assert.match(main,/privacy:adblock-toggle/);
  assert.match(main,/registerPreloadScript\(\{type:'frame',id:'devgitshield-early'/);
  assert.match(main,/ipcMain\.on\('dgb-shield:early'/);
  assert.match(html,/id="adblock-enabled"/);
  assert.match(html,/id="shield-button"/);
  assert.match(preload,/adblockToggle/);
  assert.match(renderer,/adblockRefresh/);
  assert.match(html,/MSHTML/);
});

test('DevGitShield : une page HTML (portail Wi-Fi) ne remplace jamais une liste de filtres',async()=>{
  const {fetchText}=require('../lib/adblocker');
  const mk=(body,type='text/plain')=>async()=>({ok:true,status:200,headers:{get:()=>type},text:async()=>body});
  for(const [body,type] of [['<title>Portail Wi-Fi</title><p>Connecte-toi pour accéder à Internet.</p>','text/plain'],['<!doctype html><html><body>'+'x'.repeat(60),'text/plain'],['﻿  <head><meta charset="utf-8">'+'x'.repeat(60),'text/plain'],['! Title: EasyList\n||ads.example^\n'+'x'.repeat(40),'text/html; charset=utf-8']])
    await assert.rejects(fetchText(mk(body,type),'https://exemple.fr/liste.txt'),/HTML/);
  assert.match(await fetchText(mk('[Adblock Plus 2.0]\n! Title: EasyList\n||ads.example^\n'),'https://exemple.fr/liste.txt'),/^\[Adblock/);
});
