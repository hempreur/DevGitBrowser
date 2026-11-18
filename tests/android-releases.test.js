const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');
process.env.ADMIN_TOKEN='E'.repeat(40);process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgsand-'));process.env.RELEASES_POLL='0';
const srv=require('../server/stats/server.js');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
let base='';
test.before(async()=>{await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${srv.server.address().port}`;});
test.after(async()=>{for(const w of srv._waiters())try{w.res.destroy();}catch{}await new Promise(r=>srv.server.close(r));});
const j=u=>fetch(base+u).then(r=>r.json());
const apk=v=>({name:`DevGitBrowser-Android-${v}.apk`});

test('serveur : dernière version Android lue dans ses propres releases',async()=>{
  assert.equal(srv._setLatestAndroid([{tag_name:'v2.2.0',assets:[{name:'latest.yml'}]}]),false,'release Windows ignorée');
  assert.equal(srv._setLatestAndroid([{tag_name:'android-v1.0.2',assets:[]}]),false,'pas encore d’APK');
  assert.equal(srv._setLatestAndroid([{tag_name:'android-v1.1.0',prerelease:true,assets:[apk('1.1.0')]}]),false);
  assert.equal(srv._setLatestAndroid([{tag_name:'android-v1.0.1',assets:[apk('1.0.1')]},{tag_name:'android-v1.0.3',assets:[apk('1.0.3')]},{tag_name:'v2.2.0',assets:[]}]),true);
  const live=await j('/v1/live?after=-1&lock=0&v=1.0.1&os=android&bg=1');
  assert.equal(live.latestAndroid,'1.0.3');
});

test('serveur : un ciblage par version vise Windows, pas les versions Android (1.x)',()=>{
  srv.postMessage({text:'Pour les anciens navigateurs Windows',versions:'<1.17.0'});
  srv.postMessage({text:'Pour tout le monde',versions:'*'});
  const w=srv._messagesFor(0,'1.0.1','FR',undefined,'windows').map(m=>m.text);
  const a=srv._messagesFor(0,'1.0.1','FR',undefined,'android').map(m=>m.text);
  assert.deepEqual(w,['Pour les anciens navigateurs Windows','Pour tout le monde']);
  assert.deepEqual(a,['Pour tout le monde']);
  srv._setConfig({lockdown:{active:true,versions:'<1.17.0',message:'x',since:'',rev:1},features:{}});
  assert.equal(srv._publicLockdown('1.0.1','windows').blocked,true);
  assert.equal(srv._publicLockdown('1.0.1','android').blocked,false);
  srv._setConfig({lockdown:{active:true,versions:'',message:'tout',since:'',rev:2},features:{}});
  assert.equal(srv._publicLockdown('1.0.1','android').blocked,true,'verrou sans version : tout le monde');
});

test('Android : version propre, releases séparées non marquées « latest »',()=>{
  const v=JSON.parse(read('android/version.json'));
  assert.match(v.version,/^1\.\d+\.\d+$/);assert.equal(v.channel,'Bêta');
  const wf=read('.github/workflows/android.yml');
  assert.match(wf,/android-v\$V/);assert.match(wf,/--latest=false/);
  assert.doesNotMatch(read('android/app/src/main/java/inc/codexhempreur/devgitbrowser/Vault.kt'),/releases\/latest/);
  assert.match(read('android/app/build.gradle.kts'),/versionCode = 100000 \+/);
});
