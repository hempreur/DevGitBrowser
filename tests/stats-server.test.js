const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');
process.env.ADMIN_TOKEN='T'.repeat(40);process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgs-'));
const srv=require('../server/stats/server.js');
const {Telemetry,cleanUrl}=require('../lib/telemetry');
const id=n=>String(n).repeat(32).slice(0,32);
test('serveur : mesures anonymes agrégées, aucune donnée brute',()=>{
  assert.ok(srv.ping({id:id(1),v:'1.8.0',cc:'FR',os:'win',min:30,pages:12}));
  assert.ok(srv.ping({id:id(1),v:'1.8.0',cc:'FR',os:'win',min:30,pages:3}));
  assert.ok(srv.ping({id:id(2),v:'1.7.0',cc:'PT',os:'win',min:999,pages:1}));
  assert.ok(!srv.ping({id:'abc',cc:'FR'}));
  assert.ok(srv.rate({id:id(1),stars:5,v:'1.8.0'}));assert.ok(srv.rate({id:id(2),stars:4}));assert.ok(!srv.rate({id:id(2),stars:9}));
  const st=srv.stats();
  assert.equal(st.active.today,2);assert.equal(st.totalUsers,2);assert.equal(st.pages.today,16);
  assert.equal(st.hours.today,3);// 30+30+120 (plafonné) = 180 min
  assert.deepEqual(st.countries.map(c=>c[0]).sort(),['FR','PT']);
  assert.equal(st.rating.average,4.5);assert.equal(st.rating.count,2);
  const raw=JSON.stringify(srv._db());assert.ok(!raw.includes(id(1)),'identifiant client jamais stocké tel quel');
});
test('serveur : HTTP, jeton admin obligatoire',async t=>{
  await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));t.after(()=>srv.server.close());const base='http://127.0.0.1:'+srv.server.address().port;
  assert.equal((await fetch(base+'/v1/ping',{method:'POST',body:JSON.stringify({id:id(3),v:'1.8.0',cc:'BR',os:'win',min:5,pages:2})})).status,204);
  assert.equal((await fetch(base+'/v1/ping',{method:'POST',body:'x'.repeat(5000)})).status,400);
  assert.equal((await fetch(base+'/v1/stats')).status,401);
  assert.equal((await fetch(base+'/v1/stats',{headers:{authorization:'Bearer mauvais'}})).status,401);
  const r=await fetch(base+'/v1/stats',{headers:{authorization:'Bearer '+'T'.repeat(40)}});assert.equal(r.status,200);assert.equal((await r.json()).active.today,3);
});
test('client : rien envoyé sans accord, https obligatoire',async()=>{
  assert.equal(cleanUrl('http://exemple.fr'),'');assert.equal(cleanUrl('https://a.b/x'),'https://a.b');
  const sent=[];const settings={telemetry:false,telemetryId:''};
  const t=new Telemetry({url:'https://stats.test',fetcher:async(u,o)=>{sent.push([u,JSON.parse(o.body)]);return {ok:true};},getSettings:()=>settings,version:'1.8.0',country:()=>'fr',platform:'win32',isActive:()=>true});
  t.countPage();assert.equal(await t.ping(),false);assert.equal(sent.length,0);
  settings.telemetry=true;settings.telemetryId=id(7);t.countPage();t.countPage();t.minutes=12;
  assert.equal(await t.ping(),true);assert.deepEqual(sent[0],['https://stats.test/v1/ping',{id:id(7),v:'1.8.0',cc:'FR',os:'win',min:12,pages:2}]);
  assert.equal(t.pages,0);assert.equal(t.minutes,0);
});
