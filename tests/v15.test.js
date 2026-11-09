'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PasswordVault,generatePassword,masterStrength}=require('../lib/vault');
const {parseBootstrap,torArgs,validCountry,COUNTRIES,TorService}=require('../lib/tor');
const {PhishingGuard,parseHosts}=require('../lib/phishing');
const U=require('../lib/browser-utils');
const C=require('../extensions/matchpulse/core.js');
const FAST={N:1<<12,r:8,p:1,keylen:32,maxmem:64<<20};

test('Coffre : chiffrement AES-GCM, mot de passe maître requis, enveloppe système et verrouillage',async()=>{
  let disk=null;
  const protect=b=>Buffer.concat([Buffer.from('OS:'),Buffer.from(b.toString('base64'))]);
  const unprotect=b=>Buffer.from(b.subarray(3).toString(),'base64');
  const v=new PasswordVault({read:()=>disk,write:b=>{disk=b;},protect,unprotect,kdf:FAST});
  await assert.rejects(v.create('court'),/8 caractères/);
  await v.create('MonMaitre!2026');
  v.save({url:'https://www.betclic.fr/connexion',username:'bob',password:'s3cret!X'});
  v.save({url:'https://www.betclic.fr/autre',username:'bob',password:'nouveau!Y'}); // même origine + identifiant = mise à jour
  assert.equal(v.list().length,1);
  assert.ok(!disk.includes('s3cret')&&!disk.includes('nouveau')&&!disk.includes('bob'));
  assert.throws(()=>v.save({url:'http://exemple.fr/',username:'a',password:'b'}),/HTTPS/);
  v.lock();
  assert.equal(v.forOrigin('https://www.betclic.fr/').length,0);
  assert.throws(()=>v.list(),/verrouillé/);
  await assert.rejects(v.unlock('mauvais'),/incorrect/);
  await v.unlock('MonMaitre!2026');
  assert.equal(v.reveal(v.list()[0].id),'nouveau!Y');
  assert.equal(v.forOrigin('https://www.betclic.fr/x').length,1);
  assert.equal(v.forOrigin('https://betclic.fr.evil.com/').length,0);
  // Altération du fichier détectée (GCM).
  const json=JSON.parse(unprotect(disk).toString());json.box.data=Buffer.from('x'.repeat(40)).toString('base64');
  const tampered=new PasswordVault({read:()=>protect(Buffer.from(JSON.stringify(json))),write(){},protect,unprotect,kdf:FAST});
  await assert.rejects(tampered.unlock('MonMaitre!2026'),/incorrect/);
  await v.changeMaster('MonMaitre!2026','NouveauMaitre#99');
  v.lock();await assert.rejects(v.unlock('MonMaitre!2026'),/incorrect/);await v.unlock('NouveauMaitre#99');
  assert.equal(v.list().length,1);
});
test('Coffre : anti force brute, audit et générateur',async()=>{
  let disk=null,now=1000;
  const v=new PasswordVault({read:()=>disk,write:b=>{disk=b;},kdf:FAST,now:()=>now});
  await v.create('Correct#Horse9');
  v.save({url:'https://a.example/',username:'x',password:'azerty'});
  v.save({url:'https://b.example/',username:'y',password:'azerty'});
  assert.ok(v.audit().every(a=>a.reused&&a.weak));
  v.lock();
  for(let i=0;i<5;i++)await assert.rejects(v.unlock('faux'+i),/incorrect/);
  await assert.rejects(v.unlock('Correct#Horse9'),/Trop d’essais/);
  now+=60_000;await v.unlock('Correct#Horse9');
  const pw=generatePassword(24);
  assert.equal(pw.length,24);assert.ok(/[A-Z]/.test(pw)&&/[a-z]/.test(pw)&&/\d/.test(pw)&&/[^A-Za-z0-9]/.test(pw));
  assert.equal(masterStrength('Tr0ub4dor&3xyz'),4);
});
test('VPN Tor : progression, arguments, pays et absence du composant',async()=>{
  assert.deepEqual(parseBootstrap('Nov 09 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors'),{progress:45,step:'Asking for relay descriptors'});
  assert.equal(parseBootstrap('rien'),null);
  const args=torArgs({socksPort:9150,controlPort:9151,dataDir:'/d',country:'fr'});
  assert.ok(args.includes('{fr}')&&args.includes('1'));
  assert.ok(args.join(' ').includes('127.0.0.1:9150'));
  assert.ok(!torArgs({socksPort:1,controlPort:2,dataDir:'/d',country:''}).includes('--ExitNodes'));
  assert.equal(validCountry('fr'),true);assert.equal(validCountry('xx'),false);
  assert.ok(COUNTRIES.length>=15);
  const empty=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-tor-'));
  const svc=new TorService({torDir:empty,dataDir:path.join(empty,'d')});
  if(process.platform==='win32' || !fs.existsSync('/usr/bin/tor')){
    assert.equal(svc.available(),false);
    await assert.rejects(svc.start('fr'),/absent/);
  }
  await assert.rejects(svc.start('zz'),/inconnu/);
});
test('Anti-hameçonnage : listes hosts, domaines parents, sites voisins non bloqués',()=>{
  assert.deepEqual(parseHosts('# commentaire\n0.0.0.0 evil.example\n0.0.0.0 localhost\nbad.test\n'),['evil.example','bad.test']);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-ph-'));
  fs.writeFileSync(path.join(dir,'devgit-phishing-domains.txt'),'evil.example\npaypal-secure-login.test');
  const g=new PhishingGuard({dataFolder:dir,fetcher:async()=>({ok:false}),now:()=>Date.now()});
  g.load();
  assert.equal(g.match('https://login.evil.example/x'),'evil.example');
  assert.equal(g.match('https://notevil.example/'),'');
  assert.equal(g.match('https://www.paypal.com/'),'');
  g.allow('login.evil.example');assert.equal(g.match('https://login.evil.example/x'),'');
  g.enabled=false;assert.equal(g.match('https://paypal-secure-login.test/'),'');
});
test('Pages internes et thèmes',()=>{
  const page=decodeURIComponent(U.warningPage({url:'https://evil.example/"><script>',domain:'evil.example'}).split(',')[1]);
  assert.match(page,/Site dangereux bloqué/);assert.doesNotMatch(page,/<script>/);
  assert.match(page,new RegExp(U.INTERNAL_HOST.replace('.','\\.')+'/back'));
  assert.match(decodeURIComponent(U.crashPage({url:'https://x.example/',reason:'oom'}).split(',')[1]),/planté/);
  assert.ok(U.THEMES.length>=6 && U.THEMES.some(t=>t.id==='clair'));
  assert.ok(Object.values(U.DNS_PROVIDERS).every(d=>d.url.startsWith('https://')));
  const css=fs.readFileSync(path.join(__dirname,'..','ui','style.css'),'utf8');
  for(const t of U.THEMES.filter(t=>t.id!=='neon'))assert.match(css,new RegExp(`:root\\[data-theme="${t.id}"\\]`));
});
test('MatchPulse : panier avant validation et probabilité estimée',()=>{
  const slip=C.parseBetslipText('Mon panier\nParis Saint-Germain\nRésultat du match\nPSG - Lyon\n1,85\nPlus de 2,5\nNombre de buts\nLille - Nice\n2,10\nCote totale 3,89');
  assert.equal(slip.items.length,2);assert.equal(slip.totalOdds,3.89);
  assert.deepEqual(C.classifySelection(slip.items[0],{home:'Paris Saint-Germain',away:'Olympique Lyonnais'}),{type:'1x2',outcome:'home'});
  assert.deepEqual(C.classifySelection(slip.items[1],C.parseFixtureTeams(slip.items[1].fixture)),{type:'goals',line:2.5,outcome:'over'});
  const markets=C.marketProbabilities({markets:[{marketName:'Full time',choices:[{name:'1',fractionalValue:'4/5'},{name:'X',fractionalValue:'13/5'},{name:'2',fractionalValue:'3/1'}]},
    {marketName:'Match goals',choiceGroup:'2.5',choices:[{name:'Over',fractionalValue:'4/5'},{name:'Under',fractionalValue:'1/1'}]}]});
  const total=markets['1x2'].home+markets['1x2'].draw+markets['1x2'].away;
  assert.ok(Math.abs(total-1)<1e-9,'marge retirée');
  const good=C.estimateSelection(slip.items[0],{teams:{home:'Paris Saint-Germain',away:'Olympique Lyonnais'},markets,form:{home:['W','W','W','W','W'],away:['L','L','L','L','L']}});
  const neutral=C.estimateSelection(slip.items[0],{teams:{home:'Paris Saint-Germain',away:'Olympique Lyonnais'},markets});
  assert.ok(good.probability>neutral.probability,'la forme récente est prise en compte');
  const goals=C.estimateSelection(slip.items[1],{teams:{home:'Lille',away:'Nice'},markets});
  assert.ok(Math.abs(goals.probability-0.5263)<0.001);
  const fallback=C.estimateSelection({label:'Joueur X buteur',market:'Buteur',fixture:'A - B',odds:4});
  assert.match(fallback.source,/cote du ticket/);assert.ok(fallback.probability<0.25);
  assert.ok(Math.abs(C.combineProbabilities([good,goals])-good.probability*goals.probability)<1e-12);
  assert.equal(C.combineProbabilities([good,{probability:null}]),null);
  assert.equal(C.fractionalToDecimal('6/5'),2.2);
});
