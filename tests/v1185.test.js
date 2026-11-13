const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');
process.env.ADMIN_TOKEN='D'.repeat(40);process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgs1185-'));
const srv=require('../server/stats/server.js');const R=require('../lib/remote');const {UpdateService,newer,CHECK_INTERVAL_MS}=require('../lib/updater');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let base='';
test.before(async()=>{await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${srv.server.address().port}`;});
test.after(async()=>{for(const w of srv._waiters())try{w.res.destroy();}catch{}await new Promise(r=>srv.server.close(r));});
const j=u=>fetch(base+u).then(r=>r.json());
const waitFor=async(fn,ms=2000)=>{const t=Date.now();while(Date.now()-t<ms){if(fn())return true;await new Promise(r=>setTimeout(r,20));}return false;};

test('serveur : une nouvelle release est poussée tout de suite aux navigateurs ouverts',async()=>{
  const first=await j('/v1/live?after=-1&lock=0&v=1.18.4');assert.equal(first.latest,'');
  const pending=j(`/v1/live?after=${first.cursor}&lock=0&v=1.18.4`);
  assert.ok(await waitFor(()=>srv._waiters().size===1));
  assert.equal(srv._setLatestRelease({tag_name:'v1.18.6',draft:false,prerelease:false,assets:[{name:'DevGitBrowser-Setup-1.18.6.exe'}]}),false,'pas encore de latest.yml : rien');
  const t0=Date.now();
  assert.equal(srv._setLatestRelease({tag_name:'v1.18.6',draft:false,prerelease:false,assets:[{name:'latest.yml'}]}),true);
  const got=await pending;assert.ok(Date.now()-t0<1500,'réveil immédiat');assert.equal(got.latest,'1.18.6');
  assert.equal(srv._setLatestRelease({tag_name:'v1.18.6',assets:[{name:'latest.yml'}]}),false,'pas de doublon');
  assert.equal(srv._setLatestRelease({tag_name:'v1.19.0',prerelease:true,assets:[{name:'latest.yml'}]}),false,'préversion ignorée');
  assert.equal(srv._setLatestRelease({tag_name:'n\'importe quoi',assets:[{name:'latest.yml'}]}),false);
  const s=read('server/stats/server.js');assert.match(s,/'if-none-match': latestEtag/,'requêtes conditionnelles (quota GitHub préservé)');
  assert.match(s,/setInterval\(pollLatestRelease, 2 \* 60_000\)/);
});

test('navigateur : la version annoncée déclenche la vérification, une seule fois',async()=>{
  const seen=[];let n=0;
  const rc=new R.RemoteConfig({telemetry:{available:true,api:async()=>{n++;if(n>2){rc.running=false;}return {cursor:5,latest:'1.18.6',lockdown:{blocked:false,rev:1}};}},version:'1.18.5',country:()=>'FR',onLatest:v=>seen.push(v)});
  rc.running=true;await rc.listen();assert.deepEqual(seen,['1.18.6']);
  assert.equal(newer('1.18.6','1.18.5'),true);assert.equal(newer('1.18.5','1.18.5'),false);assert.equal(newer('1.9.0','1.18.5'),false);assert.equal(newer('2.0.0','1.18.5'),true);
  const checks=[];const app={isPackaged:true,getVersion:()=>'1.18.5'};
  const us=new UpdateService({app,loadUpdater:()=>({on(){},checkForUpdates:async()=>{checks.push(1);}})});us.start();us.stop();
  assert.equal(us.checkFor('1.18.4'),false);assert.equal(us.checkFor('1.18.5'),false);assert.equal(us.checkFor('1.18.6'),true);
  us.set({status:'downloading',version:'1.18.6'});assert.equal(us.checkFor('1.18.6'),false,'déjà en cours');
  assert.equal(CHECK_INTERVAL_MS,30*60_000,'vérification de secours toutes les 30 min');
  const main=read('main.js');assert.match(main,/onLatest:v=>\{if\(updater\?\.checkFor\(v\)\)/);
  assert.match(read('ui/update/update.js'),/if \(st\.autoInstall === false\)/,'pas d’installation automatique pendant l’utilisation');
});
