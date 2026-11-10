const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const os=require('os');const path=require('path');
const store=require('../lib/store');
function makeExt(name,version){const d=fs.mkdtempSync(path.join(os.tmpdir(),'ext-'));
  fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({manifest_version:3,name,version,description:'Test',permissions:['storage'],host_permissions:['https://*.exemple.fr/*'],content_scripts:[{matches:['https://exemple.fr/*'],js:['c.js']}]}));
  fs.writeFileSync(path.join(d,'c.js'),'console.log(1)');fs.mkdirSync(path.join(d,'img'));fs.writeFileSync(path.join(d,'img','a.png'),Buffer.from([1,2,3]));
  fs.writeFileSync(path.join(d,'.secret'),'x');fs.mkdirSync(path.join(d,'.git'));fs.writeFileSync(path.join(d,'.git','config'),'x');return d;}
test('chemins de fichiers : traversée et fichiers cachés refusés',()=>{
  for(const ok of ['manifest.json','img/a.png','js/lib (1).js'])assert.ok(store.validPath(ok),ok);
  for(const bad of ['../x','a/../../x','/etc/passwd','a\\b','.env','a/.git/x','','a//b','C:/x'.replace(':','')+'/../y'])assert.ok(!store.validPath(bad),bad);
});
test('paquet : création, vérification, décompression',()=>{
  const b=store.buildBundle(makeExt('Mon Extension Été','1.2.0'));
  assert.equal(b.id,'mon-extension-ete');assert.deepEqual(b.files.map(f=>f.path).sort(),['c.js','img/a.png','manifest.json']);
  const buf=Buffer.from(JSON.stringify(b));const sha=store.sha256(buf);
  assert.throws(()=>store.parseBundle(buf,'0'.repeat(64),b.id),/Empreinte/);
  assert.throws(()=>store.parseBundle(buf,sha,'autre-id'),/invalide/);
  const parsed=store.parseBundle(buf,sha,b.id);const dir=store.unpack(parsed,fs.mkdtempSync(path.join(os.tmpdir(),'out-'))+'/x');
  assert.deepEqual(fs.readFileSync(path.join(dir,'img','a.png')),Buffer.from([1,2,3]));
  assert.deepEqual(store.permissionsOf(parsed.manifest),['storage','https://*.exemple.fr/*','https://exemple.fr/*']);
  const evil={...b,files:[...b.files,{path:'../../evil.js',data:'eA=='}]};const eb=Buffer.from(JSON.stringify(evil));
  assert.throws(()=>store.parseBundle(eb,store.sha256(eb),b.id),/refusé/);
  assert.equal(store.compareVersions('1.10.0','1.9.9'),1);assert.equal(store.compareVersions('1.0','1.0.0'),0);
});
test('manifest invalide refusé',()=>{
  const d=makeExt('X','1.0');fs.writeFileSync(path.join(d,'manifest.json'),JSON.stringify({manifest_version:1,name:'X',version:'1'}));
  assert.throws(()=>store.buildBundle(d),/manifest_version/);
});
test('boutique de bout en bout : publication, catalogue, téléchargement épinglé, retrait',async t=>{
  process.env.ADMIN_TOKEN=process.env.ADMIN_TOKEN||'T'.repeat(40);process.env.DATA_DIR=process.env.DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'dgs-'));
  const srv=require('../server/stats/server.js');const {Telemetry}=require('../lib/telemetry');
  const {execFileSync}=require('child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pin-'));
  execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-days','2','-subj','/CN=s','-keyout',dir+'/k.pem','-out',dir+'/c.pem'],{stdio:'ignore'});
  const fp=execFileSync('openssl',['x509','-in',dir+'/c.pem','-noout','-fingerprint','-sha256']).toString().split('=')[1].replace(/[:\s]/g,'').toLowerCase();
  const s=require('https').createServer({key:fs.readFileSync(dir+'/k.pem'),cert:fs.readFileSync(dir+'/c.pem')},srv.handler);
  await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>s.close());
  const tm=new Telemetry({url:'https://127.0.0.1:'+s.address().port,pin:fp,getSettings:()=>({}),version:'1.9.0',country:()=>'FR',platform:'win32',isActive:()=>true});
  const bundle=store.buildBundle(makeExt('Super Outil','2.0.1'));
  await assert.rejects(tm.api('/v1/store/publish',{method:'POST',body:bundle,token:'mauvais'}),/refusé/);
  const pub=await tm.api('/v1/store/publish',{method:'POST',body:bundle,token:process.env.ADMIN_TOKEN});
  assert.equal(pub.id,'super-outil');assert.equal(pub.version,'2.0.1');
  const cat=await tm.api('/v1/store/catalog');const entry=cat.extensions.find(e=>e.id==='super-outil');assert.ok(entry);
  const raw=await tm.api('/v1/store/package/super-outil',{raw:true,maxBytes:40e6});
  const parsed=store.parseBundle(raw,entry.sha256,'super-outil');assert.equal(parsed.manifest.version,'2.0.1');
  await tm.api('/v1/store/installed',{method:'POST',body:{id:'super-outil'}});
  assert.equal((await tm.api('/v1/store/catalog')).extensions.find(e=>e.id==='super-outil').installs,1);
  const bad={...bundle,id:'piege',files:[{path:'manifest.json',data:bundle.files.find(f=>f.path==='manifest.json').data},{path:'../x.js',data:'eA=='}]};
  await assert.rejects(tm.api('/v1/store/publish',{method:'POST',body:bad,token:process.env.ADMIN_TOKEN}),/fichiers invalides/);
  await tm.api('/v1/store/super-outil',{method:'DELETE',token:process.env.ADMIN_TOKEN});
  assert.equal((await tm.api('/v1/store/catalog')).extensions.length,0);
});
