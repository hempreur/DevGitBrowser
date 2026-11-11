const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');
process.env.ADMIN_TOKEN='B'.repeat(40);process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgs117-'));
const srv=require('../server/stats/server.js');const R=require('../lib/remote');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const AUTH={authorization:'Bearer '+'B'.repeat(40)};
let base='';
test.before(async()=>{await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${srv.server.address().port}`;});
test.after(async()=>{for(const w of srv._waiters())try{w.res.destroy();}catch{}await new Promise(r=>srv.server.close(r));});
const j=(u,o={})=>fetch(base+u,{...o,headers:{'content-type':'application/json',...(o.headers||{})}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
const waitFor=async(fn,ms=2000)=>{const t=Date.now();while(Date.now()-t<ms){if(fn())return true;await new Promise(r=>setTimeout(r,20));}return false;};

test('messages en direct : instantanés, seulement pour les navigateurs ouverts',async()=>{
  // un navigateur démarre : curseur de départ, aucun ancien message
  const first=await j('/v1/live?after=-1&lock=0&v=1.17.0&cc=FR');
  assert.equal(first.status,200);assert.deepEqual(first.body.messages,[]);assert.ok(Number.isSafeInteger(first.body.cursor));
  // il écoute : la requête reste ouverte…
  const t0=Date.now();
  const pending=j(`/v1/live?after=${first.body.cursor}&lock=0&v=1.17.0&cc=FR`);
  const other=j(`/v1/live?after=${first.body.cursor}&lock=0&v=1.12.0&cc=FR`); // version non ciblée
  assert.ok(await waitFor(()=>srv._waiters().size===2),'deux navigateurs en écoute');
  // …l'admin envoie un message ciblé « >=1.17.0 »
  const sent=await j('/v1/admin/messages',{method:'POST',headers:AUTH,body:JSON.stringify({text:'Maintenance du serveur à 22 h',level:'alert',versions:'>=1.17.0'})});
  assert.equal(sent.status,200);assert.equal(sent.body.delivered,1,'remis au seul navigateur ciblé');assert.equal(sent.body.listening,2);
  const got=await pending;
  assert.ok(Date.now()-t0<1500,'reçu immédiatement, sans attendre la fin de l’écoute');
  assert.equal(got.body.messages.length,1);assert.equal(got.body.messages[0].text,'Maintenance du serveur à 22 h');assert.equal(got.body.messages[0].level,'alert');
  assert.ok(srv._waiters().size===1,'l’autre version attend toujours');
  // un navigateur qui démarre APRÈS l'envoi ne reçoit rien
  const late=await j('/v1/live?after=-1&lock=0&v=1.17.0&cc=FR');assert.deepEqual(late.body.messages,[]);
  // admin : liste des derniers messages avec le nombre de navigateurs atteints
  const cfg=await j('/v1/admin/config',{headers:AUTH});assert.equal(cfg.body.recent[0].delivered,1);
  assert.equal((await j('/v1/admin/messages',{method:'POST',headers:AUTH,body:JSON.stringify({text:''})})).status,400);
  // libère l'autre écoute
  await j('/v1/admin/features',{method:'PUT',headers:AUTH,body:JSON.stringify({features:[]})});
  const o=await other;assert.deepEqual(o.body.messages,[]);
});

test('arrêt d’urgence : verrou instantané pour les ouverts, au lancement pour les fermés, persistant',async()=>{
  const start=await j('/v1/live?after=-1&lock=0&v=1.17.0&cc=FR');
  const listening=j(`/v1/live?after=${start.body.cursor}&lock=0&v=1.17.0&cc=FR`);
  assert.ok(await waitFor(()=>srv._waiters().size===1));
  const t0=Date.now();
  const on=await j('/v1/admin/lockdown',{method:'PUT',headers:AUTH,body:JSON.stringify({active:true,versions:'',message:'Faille de sécurité'})});
  assert.equal(on.status,200);assert.equal(on.body.lockdown.active,true);assert.ok(on.body.lockdown.since);
  const got=await listening;assert.ok(Date.now()-t0<1500,'navigateur ouvert bloqué immédiatement');
  assert.equal(got.body.lockdown.blocked,true);assert.equal(got.body.lockdown.message,'Faille de sécurité');
  // navigateur fermé qui démarre : /v1/config le bloque, toutes versions
  for(const v of ['1.13.0','1.17.0','2.0.0']){const c=await j(`/v1/config?v=${v}&cc=PT`);assert.equal(c.body.lockdown.blocked,true,v);assert.equal(c.body.kill.blocked,true,'anciennes versions : bandeau + mise à jour');}
  // conservé sur le serveur (redémarrage du service)
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR,'config.json'),'utf8')).lockdown.active,true);
  // un navigateur déjà bloqué reste en écoute et est débloqué dès la levée
  const blockedListen=j(`/v1/live?after=${got.body.cursor}&lock=1&v=1.17.0&cc=FR`);
  assert.ok(await waitFor(()=>srv._waiters().size===1),'le navigateur bloqué écoute');
  await j('/v1/admin/lockdown',{method:'PUT',headers:AUTH,body:JSON.stringify({active:false})});
  const lifted=await blockedListen;assert.equal(lifted.body.lockdown.blocked,false);
  assert.equal((await j('/v1/config?v=1.17.0')).body.lockdown.blocked,false);
  // ciblage par version
  await j('/v1/admin/lockdown',{method:'PUT',headers:AUTH,body:JSON.stringify({active:true,versions:'<1.17.0'})});
  assert.equal((await j('/v1/config?v=1.16.0')).body.lockdown.blocked,true);assert.equal((await j('/v1/config?v=1.17.0')).body.lockdown.blocked,false);
  await j('/v1/admin/lockdown',{method:'PUT',headers:AUTH,body:JSON.stringify({active:false})});
  assert.equal((await j('/v1/admin/lockdown',{method:'PUT',headers:AUTH,body:JSON.stringify({active:true,versions:'nimporte'})})).status,400);
});

test('navigateur : écoute en continu, messages seulement après le démarrage, verrou hors ligne conservé',async()=>{
  const calls=[];let lockState=false;const queue=[];
  const fake={available:true,api:async u=>{calls.push(u);
    if(u.startsWith('/v1/config'))return {lockdown:{blocked:lockState,message:'m'},features:['vpn']};
    if(queue.length)return queue.shift();
    await new Promise(r=>setTimeout(r,30));return {cursor:100,messages:[],lockdown:{blocked:lockState},features:['vpn']};}};
  const locks=[],msgs=[];
  const rc=new R.RemoteConfig({telemetry:fake,version:'1.17.0',country:()=>'fr',onLock:(l,o)=>locks.push(l.blocked+':'+o.reached),onMessage:m=>msgs.push(m.text)});
  queue.push({cursor:100,messages:[{id:99,text:'ancien',level:'info'}],lockdown:{blocked:false},features:[]}); // 1er appel : ignoré
  queue.push({cursor:101,messages:[{id:101,text:'Bonjour !',level:'info'}],lockdown:{blocked:false},features:['vpn']});
  rc.start();
  assert.ok(await waitFor(()=>msgs.length>=1));
  assert.deepEqual(msgs,['Bonjour !'],'les messages d’avant le démarrage ne sont pas affichés');
  assert.ok(rc.disabled('vpn'));assert.match(calls.find(c=>c.startsWith('/v1/live?after=100')),/lock=0&v=1\.17\.0&cc=FR/);
  lockState=true;queue.push({cursor:101,messages:[],lockdown:{blocked:true,message:'stop'},features:[]});
  assert.ok(await waitFor(()=>locks.includes('true:true')));
  rc.stop();
  // hors ligne avec un verrou local : aucun déblocage
  const off=new R.RemoteConfig({telemetry:{available:true,api:async()=>{throw new Error('hors ligne');}},version:'1.17.0',country:()=>'',initialLock:{message:'x'},onLock:(l,o)=>locks.push('offline:'+l.blocked+':'+o.reached)});
  await off.refresh();assert.equal(off.lock.blocked,true);assert.ok(!locks.some(x=>x.startsWith('offline:false')),'jamais débloqué sans réponse du serveur');
  assert.deepEqual(R.cleanMessages([{id:1,text:'a',level:'alert',url:'javascript:x'},{id:'x',text:'b'}]),[{id:1,text:'a',level:'alert',url:''}]);
});

test('verrouillage câblé dans le navigateur : persistant, fail-closed, admin jamais enfermé',()=>{
  const main=read('main.js');
  assert.match(main,/function readLockdown\(\) \{ const d = readJson\('lockdown\.json'\)/);
  assert.match(main,/onLock:\(lock,\{reached\}\)=>\{ if\(lock\.blocked\)engageLockdown\(lock\); else if\(reached\)liftLockdown\(\); \}/,'déblocage seulement sur réponse du serveur');
  assert.match(main,/const lockExempt = \(\) => adminOverride \|\| Boolean\(readStatsToken\(\)\);/,'PC administrateur jamais bloqué');
  assert.match(main,/function createWindow\(\{[^}]*\}=\{\}\) \{\n  if \(locked\) \{ openLockWindow\(\); return null; \}/,'aucune fenêtre tant que c’est bloqué');
  assert.match(main,/if\(startupLock\)\{ engageLockdown\(startupLock\); \}\n    if\(!locked\)\{\n    restoreSession\(\);/,'navigateur fermé : bloqué dès le lancement');
  assert.match(main,/if\(locked\)\{ openLockWindow\(\); return; \}/,'second lancement : écran de blocage');
  assert.match(main,/if \(!admin\.verifySecret\(admin\.normalizeKey\(key\), adminKeyHash\(\)\)\)/,'accès admin par la clé, avec limitation des essais');
  const html=read('ui/index.html');
  for(const id of ['admin-msg-form','admin-listening','admin-lockdown-card','ak-engage','ak-lift','ak-confirm-input'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.ok(html.indexOf('admin-messages-card')<html.indexOf('admin-lockdown-card'),'deux cartes séparées');
  assert.doesNotMatch(read('ui/renderer.js'),/prompt\(`⛔/,'pas de prompt() (non pris en charge par Electron)');
  assert.match(read('ui/lock/index.html'),/id="admin-form"/);
});
