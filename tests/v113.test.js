const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');const net=require('net');
process.env.ADMIN_TOKEN='A'.repeat(40);process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgs113-'));
const srv=require('../server/stats/server.js');
const R=require('../lib/remote');const D=require('../lib/discord');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const id=n=>String(n).repeat(32).slice(0,32);

test('serveur : versions ciblées (*, exacte, <, >=, plusieurs conditions)',()=>{
  const m=srv.versionMatches;
  assert.ok(m('*','1.13.0'));assert.ok(!m('','1.13.0'));
  assert.ok(m('1.12.0','1.12.0'));assert.ok(!m('1.12.0','1.12.1'));
  assert.ok(m('<1.13.0','1.12.9'));assert.ok(!m('<1.13.0','1.13.0'));assert.ok(m('<1.13.0','1.9.0'),'comparaison numérique, pas alphabétique');
  assert.ok(m('>=1.10.0, <1.12.0','1.11.5'));assert.ok(!m('>=1.10.0, <1.12.0','1.12.0'));
  assert.ok(!m('<1.13.0','?'));
  assert.throws(()=>srv.cleanConfig({kill:{versions:'tout'}}),/versions/);
  assert.throws(()=>srv.cleanConfig({messages:[{text:'x',url:'http://pas-https'}]}),/https/);
});

test('serveur : config publique filtrée par version, pays et date',()=>{
  srv._setConfig(srv.cleanConfig({kill:{versions:'<1.13.0',message:'Faille corrigée',features:['store','inconnue']},messages:[
    {id:'msg-all1',text:'Bonjour à tous',versions:'*'},
    {id:'msg-fr01',text:'Salut la France',versions:'*',countries:'fr, be'},
    {id:'msg-old1',text:'Expiré',versions:'*',until:'2000-01-01'},
    {id:'msg-v112',text:'Pour 1.12',versions:'1.12.0',level:'warning',url:'https://exemple.fr/x'}]}));
  const a=srv.publicConfig('1.12.0','FR');
  assert.equal(a.kill.blocked,true);assert.deepEqual(a.kill.features,['store']);
  assert.deepEqual(a.messages.map(m=>m.id),['msg-all1','msg-fr01','msg-v112']);
  assert.equal(a.messages[2].level,'warning');assert.equal(a.messages[0].versions,undefined,'règles de ciblage non divulguées');
  const b=srv.publicConfig('1.13.0','PT');assert.equal(b.kill.blocked,false);assert.deepEqual(b.messages.map(m=>m.id),['msg-all1']);
});

test('serveur : routes HTTP config, bug, parrainage, admin protégé, en ligne',async()=>{
  await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${srv.server.address().port}`,auth={authorization:'Bearer '+'A'.repeat(40)};
  const j=(u,o={})=>fetch(base+u,{...o,headers:{'content-type':'application/json',...(o.headers||{})}});
  try{
    assert.equal((await (await j('/v1/config?v=1.12.0&cc=FR')).json()).kill.blocked,true);
    // rapport de bug
    assert.equal((await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'x'})})).status,400);
    const bug=await (await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'La radio plante',v:'1.13.0',os:'win',cc:'FR',contact:'bob#1',log:'ligne\n'.repeat(5)})})).json();
    assert.match(bug.id,/^[a-f0-9]{16}$/);
    assert.equal((await j('/v1/admin/bugs')).status,401);
    const bugs=(await (await j('/v1/admin/bugs',{headers:auth})).json()).bugs;assert.equal(bugs[0].text,'La radio plante');assert.equal(bugs[0].status,'new');
    assert.equal((await (await j('/v1/admin/bugs/'+bug.id,{method:'PATCH',headers:auth,body:'{"status":"fixed"}'})).json()).status,'fixed');
    assert.equal((await j('/v1/admin/bugs/'+bug.id,{method:'DELETE',headers:auth})).status,204);
    for(let i=0;i<5;i++)await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'spam spam '+i})});
    assert.equal((await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'encore un'})})).status,429,'limite par heure');
    // parrainage
    srv.ping({id:id(1),v:'1.13.0',cc:'FR',os:'win',min:5,pages:1,rc:'ABCD2345'});
    srv.ping({id:id(2),v:'1.13.0',cc:'PT',os:'win',min:5,pages:1});
    assert.equal((await j('/v1/referral/claim',{method:'POST',body:JSON.stringify({code:'ABCD2345',id:id(1)})})).status,409,'pas soi-même');
    assert.equal((await j('/v1/referral/claim',{method:'POST',body:JSON.stringify({code:'ABCD2345',id:id(2)})})).status,204);
    assert.equal((await j('/v1/referral/claim',{method:'POST',body:JSON.stringify({code:'ABCD2345',id:id(2)})})).status,409,'une seule fois');
    assert.equal((await j('/v1/referral/claim',{method:'POST',body:JSON.stringify({code:'abc',id:id(3)})})).status,400);
    assert.equal((await (await j('/v1/referral/ABCD2345')).json()).count,1);
    // configuration admin
    assert.equal((await j('/v1/admin/config',{method:'PUT',body:'{}'})).status,401);
    const saved=await (await j('/v1/admin/config',{method:'PUT',headers:auth,body:JSON.stringify({kill:{versions:'',features:[]},messages:[{text:'Nouvelle version !',versions:'<1.14.0'}]})})).json();
    assert.equal(saved.messages.length,1);assert.equal((await (await j('/v1/config?v=1.13.0')).json()).messages[0].text,'Nouvelle version !');
    assert.equal((await j('/v1/admin/config',{method:'PUT',headers:auth,body:JSON.stringify({kill:{versions:'n importe'}})})).status,400);
    // statistiques : en ligne + parrainages
    const st=await (await j('/v1/stats',{headers:auth})).json();
    assert.equal(st.live.total,2);assert.deepEqual(st.live.countries,{FR:1,PT:1});assert.equal(st.referrals.total,1);assert.deepEqual(st.referrals.top[0],['ABCD2345',1]);
    assert.ok(fs.existsSync(path.join(process.env.DATA_DIR,'config.json')));
  } finally { await new Promise(r=>srv.server.close(r)); }
});

test('navigateur : config distante nettoyée, badges, codes de parrainage',async()=>{
  const c=R.cleanRemote({kill:{blocked:true,message:'x'.repeat(500),features:['store','rm -rf']},messages:[{id:'ok-1',text:'hi',url:'javascript:alert(1)'},{id:'../x',text:'bad'}]});
  assert.equal(c.kill.message.length,300);assert.deepEqual(c.kill.features,['store']);assert.equal(c.messages.length,1);assert.equal(c.messages[0].url,'');
  let changes=0;const tm={available:true,api:async u=>{assert.match(u,/^\/v1\/config\?v=1\.13\.0&cc=FR$/);return {kill:{blocked:false,features:['vpn']},messages:[]};}};
  const rc=new R.RemoteConfig({telemetry:tm,version:'1.13.0',country:()=>'fr',onChange:()=>changes++});
  await rc.refresh();await rc.refresh();assert.equal(changes,1,'notifié seulement si ça change');assert.ok(rc.disabled('vpn'));assert.ok(!rc.disabled('store'));
  const failing=new R.RemoteConfig({telemetry:{available:true,api:async()=>{throw new Error('hors ligne');}},version:'1.13.0',country:()=>'',onChange(){}});
  await failing.refresh();assert.equal(failing.lastError,'hors ligne');assert.equal(failing.state.kill.blocked,false,'hors ligne = rien de bloqué');
  const code=R.newRefCode();assert.ok(R.validRefCode(code));assert.ok(!R.validRefCode('abcd2345'));assert.ok(!/[01IO]/.test(code));
  assert.equal(R.badgeFor(0),null);assert.equal(R.badgeFor(1).id,'bronze');assert.equal(R.badgeFor(12).id,'gold');assert.equal(R.nextBadge(3).id,'gold');assert.equal(R.nextBadge(99),null);
});

test('rapport de bug : journal anonymisé',()=>{
  const log=['2026 [INFO] C:\\Users\\Jean Dupont\\AppData\\Roaming\\DevGitBrowser ok','erreur sur https://www.banque.fr/compte?id=123 et http://x.com/a/b',
    'contact jean.dupont@mail.fr depuis 192.168.1.20','/home/jean/.config/x'].join('\n');
  const out=R.sanitizeLog(log);
  for(const leak of ['Jean Dupont','compte?id','/a/b','jean.dupont@mail.fr','192.168.1.20','/home/jean'])assert.ok(!out.includes(leak),leak);
  assert.match(out,/https:\/\/www\.banque\.fr\/…/);assert.match(out,/C:\\Users\\\*\*\*/);
  assert.equal(R.sanitizeLog('a\n'.repeat(1000),200).split('\n').length,200);
});

test('Discord : trames, nettoyage de l’activité, poignée de main avec un faux Discord',async()=>{
  const {frames,rest}=D.decode(Buffer.concat([D.encode(1,{a:1}),D.encode(3,{p:2}).subarray(0,10)]));
  assert.deepEqual(frames,[{op:1,data:{a:1}}]);assert.equal(rest.length,10);
  const a=D.cleanActivity({details:'x'.repeat(300),state:' ',buttons:[{label:'ok',url:'https://a.fr'},{label:'bad',url:'javascript:x'},{label:'b',url:'https://b'},{label:'c',url:'https://c'}],timestamps:{start:5.7}});
  assert.equal(a.details.length,128);assert.equal(a.state,undefined);assert.equal(a.buttons.length,2);assert.equal(a.timestamps.start,5);
  assert.equal(D.pipePath(3,'win32'),'\\\\?\\pipe\\discord-ipc-3');assert.equal(D.pipePath(0,'linux',{XDG_RUNTIME_DIR:'/run/u'}),'/run/u/discord-ipc-0');
  // faux client Discord local
  const seen=[];let pending=Buffer.alloc(0);
  const fake=net.createServer(sock=>sock.on('data',c=>{const r=D.decode(Buffer.concat([pending,c]));pending=r.rest;for(const f of r.frames){seen.push(f);if(f.op===0)sock.write(D.encode(1,{cmd:'DISPATCH',evt:'READY',data:{}}));}}));
  await new Promise(r=>fake.listen(0,'127.0.0.1',r));
  const port=fake.address().port;
  const p=new D.DiscordPresence({clientId:'1570092370903437352',connect:()=>net.createConnection(port,'127.0.0.1'),pid:42,minIntervalMs:0});
  p.setActivity({details:'Navigue avec DevGitBrowser',state:'Sur exemple.fr'});
  for(let i=0;i<40&&seen.length<2;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(seen[0].op,0);assert.equal(seen[0].data.client_id,'1570092370903437352');
  assert.equal(seen[1].data.cmd,'SET_ACTIVITY');assert.equal(seen[1].data.args.pid,42);assert.equal(seen[1].data.args.activity.state,'Sur exemple.fr');
  p.setActivity({details:'Navigue avec DevGitBrowser',state:'Sur exemple.fr'});await new Promise(r=>setTimeout(r,60));
  assert.equal(seen.length,2,'activité identique : rien de renvoyé');
  p.stop();for(let i=0;i<20&&seen.length<3;i++)await new Promise(r=>setTimeout(r,25));
  assert.equal(seen[2].data.args.activity,null,'arrêt = statut effacé');
  fake.close();
});

test('1.13 câblé : opt-in Discord, réglages protégés, admin, carte',()=>{
  const main=read('main.js'),html=read('ui/index.html'),js=read('ui/renderer.js'),map=read('ui/world-map.js');
  assert.match(main,/discordPresence:false/);assert.match(main,/DISCORD_APP_ID = '1570092370903437352'/);
  assert.match(main,/'refCode','referredBy','dismissedMessages'\]\.includes\(key\)/);
  assert.match(main,/if\(!s\.adminOpen\)throw new Error\('Panneau admin verrouillé\.'\);\s*const token=readStatsToken\(\);if\(!token\|\|!telemetry\?\.available\)/);
  assert.match(main,/data\?\.withLog===true/,'journal joint seulement si coché');
  assert.match(main,/remote\?\.disabled\('store'\)/);assert.match(main,/remote\?\.disabled\('vpn'\)/);assert.match(main,/remote\?\.disabled\('import'\)/);
  for(const id of ['kill-banner','remote-banner','ref-card','bug-card','discord-section','admin-map','admin-bug-list','admin-msg-form','welcome-ref'])assert.match(html,new RegExp(`id="${id}"`),id);
  assert.match(html,/src="world-map\.js"/);assert.match(js,/renderMap\(res\.server\)/);
  global.window={};new Function('window',map)(global.window);const W=global.window.DGB_WORLD;
  assert.equal(W.w,1000);assert.ok(W.d.startsWith('M'));for(const cc of ['FR','PT','US','BR','JP','BE','DZ','MA','SG'])assert.ok(Array.isArray(W.points[cc]),cc);
  assert.ok(W.points.FR[0]>450&&W.points.FR[0]<560,'France au bon endroit (pas la Guyane)');
});
