const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const os=require('os');const path=require('path');const crypto=require('crypto');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {PasswordVault,generatePassword,parseCsv,csvCredentials,pwnedCount,cleanProfile}=require('../lib/vault');
const {BrowsingData}=require('../lib/browsing-data');
const importer=require('../lib/importer');
const FAST={N:1<<12,r:8,p:1,keylen:32,maxmem:64<<20};
const memVault=()=>{let disk=null;return new PasswordVault({read:()=>disk,write:b=>{disk=b;},kdf:FAST});};

test('générateur : longueur et jeux de caractères',()=>{
  const a=generatePassword(32,{symbols:false,digits:false});
  assert.equal(a.length,32);assert.match(a,/^[A-Za-z]+$/);
  const b=generatePassword(40);assert.equal(b.length,40);assert.match(b,/[0-9]/);assert.match(b,/[!#$%&*+\-=?@_~]/);
  assert.equal(generatePassword(4).length,12,'minimum 12');assert.equal(generatePassword(500).length,64,'maximum 64');
});

test('CSV : guillemets, virgules, retours ligne, BOM, formats Chrome et Firefox',()=>{
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","l1\nl2"\n"say ""hi""",\n'),[['a','b'],['x,1','l1\nl2'],['say "hi"','']]);
  const chrome=csvCredentials('name,url,username,password,note\nGitHub,https://github.com/login,bob,p@ss,perso\n');
  assert.deepEqual(chrome[0],{url:'https://github.com/login',username:'bob',password:'p@ss',note:'GitHub'});
  const ff=csvCredentials('"url","username","password","httpRealm","formActionOrigin","guid"\n"https://x.fr","al","pw1","","",""\n');
  assert.equal(ff[0].username,'al');assert.equal(ff[0].password,'pw1');
  assert.throws(()=>csvCredentials('foo,bar\n1,2'),/introuvables/);assert.throws(()=>csvCredentials(''),/vide/);
});

test('coffre : import CSV sans doublon, fiches de coordonnées chiffrées',async()=>{
  const v=memVault();await v.create('MonMaitre!2026');
  const csv='url,username,password\nhttps://a.fr/login,bob,one!\nhttps://a.fr/autre,bob,two!\nhttps://b.fr,,x\nftp://bad,z,y\n';
  const r=v.importCsv(csv);
  assert.equal(r.total,4);assert.ok(r.added>=2);assert.ok(r.skipped>=1,'adresse non web ignorée');
  assert.equal(v.list().filter(e=>e.username==='bob').length,1,'même site + identifiant = mise à jour');
  const again=v.importCsv(csv);assert.equal(again.added,0);
  assert.throws(()=>v.saveProfile({label:'vide'}),/au moins/);
  const list=v.saveProfile({label:'Maison',givenName:'Ana',email:'ana@exemple.fr',city:'Lisboa',evil:'<x>'});
  assert.equal(list.length,1);assert.equal(list[0].evil,undefined);assert.ok(list[0].id);
  v.saveProfile({...list[0],city:'Porto'});assert.equal(v.listProfiles()[0].city,'Porto');assert.equal(v.listProfiles().length,1);
  v.lock();assert.throws(()=>v.listProfiles());
  await v.unlock('MonMaitre!2026');assert.equal(v.listProfiles()[0].givenName,'Ana','coordonnées conservées dans le coffre');
  v.removeProfile(v.listProfiles()[0].id);assert.equal(v.listProfiles().length,0);
  assert.equal(cleanProfile({tel:'+351\u0000 123'}).tel,'+351 123');
});

test('Have I Been Pwned : k-anonymat, seul le préfixe SHA-1 part',async()=>{
  const sha=crypto.createHash('sha1').update('motdepasse').digest('hex').toUpperCase();
  let asked='',headers=null;
  const fetcher=async(url,opts)=>{asked=url;headers=opts.headers;return {ok:true,text:async()=>`0000000000000000000000000000000000A:3\r\n${sha.slice(5)}:4242\r\n`};};
  assert.equal(await pwnedCount('motdepasse',fetcher),4242);
  assert.equal(asked,'https://api.pwnedpasswords.com/range/'+sha.slice(0,5));assert.ok(!asked.includes(sha.slice(5)));
  assert.equal(headers['Add-Padding'],'true');
  assert.equal(await pwnedCount('autre',async()=>({ok:true,text:async()=>'ABC:1'})),0);
  await assert.rejects(pwnedCount('x',async()=>({ok:false,status:503})),/indisponible/);
  const v=memVault();await v.create('MonMaitre!2026');v.save({url:'https://a.fr',username:'u',password:'motdepasse'});
  const res=await v.breachCheck(fetcher);assert.deepEqual(Object.values(res),[4242]);
});

test('import navigateurs : Chrome (favoris + historique SQLite) et Firefox',async t=>{
  let sqlite;try{sqlite=require('node:sqlite');}catch{t.skip('node:sqlite absent');return;}
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-imp-'));
  const local=path.join(tmp,'Local'),roaming=path.join(tmp,'Roaming');
  const prof=path.join(local,'Google','Chrome','User Data','Default');fs.mkdirSync(prof,{recursive:true});
  fs.writeFileSync(path.join(local,'Google','Chrome','User Data','Local State'),JSON.stringify({profile:{info_cache:{Default:{name:'Perso'}}}}));
  fs.writeFileSync(path.join(prof,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{type:'folder',name:'Barre',children:[{type:'url',name:'GitHub',url:'https://github.com/'},{type:'url',name:'js',url:'javascript:alert(1)'}]}}}));
  const h=new sqlite.DatabaseSync(path.join(prof,'History'));
  h.exec('CREATE TABLE urls(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INT,last_visit_time INT,hidden INT)');
  const when=BigInt(Date.UTC(2026,0,2))*1000n+11644473600000000n;
  h.prepare('INSERT INTO urls(url,title,visit_count,last_visit_time,hidden) VALUES(?,?,?,?,0)').run('https://exemple.fr/','Exemple',5,when);
  h.close();
  const ff=path.join(roaming,'Mozilla','Firefox','Profiles','abc123.default-release');fs.mkdirSync(ff,{recursive:true});
  const p=new sqlite.DatabaseSync(path.join(ff,'places.sqlite'));
  p.exec('CREATE TABLE moz_places(id INTEGER PRIMARY KEY,url TEXT,title TEXT,visit_count INT,last_visit_date INT,hidden INT);CREATE TABLE moz_bookmarks(id INTEGER PRIMARY KEY,type INT,fk INT,title TEXT,dateAdded INT)');
  p.prepare('INSERT INTO moz_places(id,url,title,visit_count,last_visit_date,hidden) VALUES(1,?,?,2,?,0)').run('https://mozilla.org/','Mozilla',Date.UTC(2026,0,3)*1000);
  p.exec("INSERT INTO moz_bookmarks(type,fk,title,dateAdded) VALUES(1,1,'Moz',1)");p.close();
  const sources=importer.detectSources({LOCALAPPDATA:local,APPDATA:roaming});
  assert.deepEqual(sources.map(s=>s.browser),['Google Chrome','Mozilla Firefox']);
  assert.equal(sources[0].profile,'Perso');assert.equal(sources[1].profile,'default-release');
  let saved=null;const browsing=new BrowsingData({read:()=>saved,write:v=>{saved=v;},debounceMs:5});
  const r1=importer.importFrom(sources[0],browsing);assert.deepEqual(r1,{bookmarks:1,history:1});
  assert.equal(browsing.history[0].url,'https://exemple.fr/');assert.equal(browsing.history[0].visitedAt,Date.UTC(2026,0,2));
  const r2=importer.importFrom(sources[1],browsing);assert.equal(r2.bookmarks,1);assert.equal(r2.history,1);
  assert.equal(importer.importFrom(sources[0],browsing).bookmarks,0,'pas de doublon de favoris');
  assert.equal(importer.webkitToMs('0'),0);
  assert.throws(()=>importer.importFrom({kind:'chromium',dir:path.join(tmp,'nope')},browsing),/introuvable/);
  fs.rmSync(tmp,{recursive:true,force:true});
});

test('assistant de bienvenue en 5 étapes + coffre + autofill câblés',()=>{
  const html=read('ui/index.html'),js=read('ui/renderer.js'),pre=read('preload.js'),main=read('main.js'),shield=read('lib/shield-preload.js');
  for(let i=0;i<=5;i++)assert.match(html,new RegExp(`class="welcome-step[^"]*" data-step="${i}"`));
  for(const id of ['welcome-engines','welcome-adblock','welcome-vpn','welcome-import','vault-breach','vault-import-go','vault-import-remove','gen-len','profile-form','settings-import'])assert.match(html,new RegExp(`id="${id}"`),id);
  for(const fn of ['pwBreach','pwImportCsv','pwProfiles','pwProfileSave','pwProfileDelete','importSources','importRun'])assert.match(pre,new RegExp(fn+':'),fn);
  for(const ch of ['pw:breach','pw:import-csv','pw:profiles','pw:profile-save','pw:profile-delete','import:sources','import:run'])assert.match(main,new RegExp(`'${ch}':`),ch);
  assert.match(js,/WELCOME_LAST=5/);assert.match(main,/vpnAtStartup:false/);
  assert.match(main,/dgb-autofill:fill/);assert.match(shield,/dgb-autofill:fill/);
  assert.match(main,/removeAfter===true/,'le CSV n’est supprimé que si l’utilisateur l’a demandé');
});
