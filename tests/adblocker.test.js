'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AdBlockService,FILTER_SOURCES,OFFLINE_FILTERS,assertEnabled}=require('../lib/adblocker');

class FakeEngine {
  static parse(text) { assert.match(text,/doubleclick/); return new FakeEngine('offline'); }
  static deserialize(bytes) {return new FakeEngine(Buffer.from(bytes).toString('utf8'));}
  static async fromLists(fetcher,sources,config) {
    assert.ok(sources.length>=7);
    assert.equal(config.loadCosmeticFilters,true);
    const response=await fetcher(sources[0]);
    assert.equal(response.ok,true);
    return new FakeEngine('strong');
  }
  constructor(name) {this.name=name;this.contexts=new Set();}
  enableBlockingInSession(session) {this.contexts.add(session);session.engines.add(this);}
  disableBlockingInSession(session) {this.contexts.delete(session);session.engines.delete(this);}
  serialize() {return Buffer.from(this.name);}
}
const session=()=>({engines:new Set()});
function fixture(t,{fetcher=async()=>({ok:true,status:200})}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-adblock-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const webSession=session();
  return {dir,webSession,service:new AdBlockService({dataFolder:dir,webSession,enabled:true,Engine:FakeEngine,fetcher})};
}
test('Strong protection lists cover ads, tracking, uBlock fixes and French ads',()=>{
  assert.ok(FILTER_SOURCES.some(url=>url.includes('easyprivacy')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('annoyances')));
  assert.ok(FILTER_SOURCES.some(url=>url.includes('liste_fr')));
  assert.ok(FILTER_SOURCES.every(url=>url.startsWith('https://')));
  assert.match(OFFLINE_FILTERS,/taboola\.com/);
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
  assert.match(f.service.state().error,/Connexion absente/);
});
test('Online refresh updates the blocker and writes a reusable offline cache',async t=>{
  const f=fixture(t);
  await f.service.start();
  if(f.service.updatePromise)await f.service.updatePromise;
  assert.equal(f.service.engine.name,'strong');
  assert.equal(f.webSession.engines.size,1);
  const binary=fs.readFileSync(path.join(f.dir,'devgitshield-filters.bin'));
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
test('The blocker is wired into the browser security panel and main session',()=>{
  const root=path.join(__dirname,'..');
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  const html=fs.readFileSync(path.join(root,'ui','index.html'),'utf8');
  const preload=fs.readFileSync(path.join(root,'preload.js'),'utf8');
  const renderer=fs.readFileSync(path.join(root,'ui','renderer.js'),'utf8');
  assert.match(main,/new AdBlockService\(/);
  assert.match(main,/privacy:adblock-toggle/);
  assert.match(html,/id="adblock-enabled"/);
  assert.match(preload,/adblockToggle/);
  assert.match(renderer,/adblockRefresh/);
  assert.match(html,/MSHTML/);
});
