'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const C=require('../extensions/matchpulse/core');
const dir=path.join(__dirname,'..','extensions','matchpulse');
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));

test('Reconnaît uniquement les quatre bookmakers et les domaines officiels ciblés',()=>{
  assert.equal(C.detectBookmaker('betclic.fr').name,'Betclic');
  assert.equal(C.detectBookmaker('www.winamax.fr').name,'Winamax');
  assert.equal(C.detectBookmaker('www.unibet.fr').region,'France');
  assert.equal(C.detectBookmaker('sports.unibet.be').region,'Belgique');
  assert.equal(C.detectBookmaker('www.unibetsports.be').region,'Belgique');
  for(const fake of ['winamax.fr.evil.com','mybetclic.fr','fakeunibet.be','unibet.com','example.com',''])assert.equal(C.detectBookmaker(fake),null);
});

test('Cotes françaises, probabilités et combiné mathématique',()=>{
  assert.equal(C.parseOdds('2,50'),2.5);
  assert.equal(C.parseOdds('1.01'),1.01);
  assert.equal(C.parseOdds('0,99'),null);
  assert.equal(C.parseOdds('25%'),null);
  assert.equal(C.parseOdds('501'),null);
  assert.equal(C.impliedProbability('2,00'),0.5);
  const p=C.combinedImplied([{odds:2},{odds:'4,00'}]);
  assert.equal(p.probability,0.125);
  assert.equal(p.decimalOdds,8);
  assert.equal(p.isIndependentAssumption,true);
  assert.equal(C.combinedImplied([{odds:2},{odds:0}]),null);
});

test('Ne confond pas mise, montant et sélections',()=>{
  assert.deepEqual(C.extractOddsAndLabel('Paris SG – Lyon 2,10'),{label:'Paris SG – Lyon',odds:2.1});
  assert.equal(C.extractOddsAndLabel('Mise totale 35,00'),null);
  assert.equal(C.extractOddsAndLabel('Gain potentiel 3,10'),null);
  assert.equal(C.extractOddsAndLabel('Équipe A 12'),null);
});

test('Classification des événements football et fautes agrégées',()=>{
  assert.equal(C.eventKind({type:'Goal',detail:'Normal Goal'}),'goal');
  assert.equal(C.eventKind({type:'Goal',detail:'Penalty'}),'penalty');
  assert.equal(C.eventKind({type:'Card',detail:'Red Card'}),'red-card');
  assert.equal(C.eventKind({type:'Card',detail:'Yellow Card'}),'yellow-card');
  assert.equal(C.eventKind({type:'Var',detail:'Penalty confirmed'}),'penalty');
  assert.equal(C.eventKind({type:'Subst'}),null);
  const ev={time:{elapsed:55,extra:null},team:{id:3,name:'Club A'},player:{id:44,name:'Joueur A'},type:'Goal',detail:'Normal Goal'};
  assert.equal(C.eventId(ev),C.eventId({...ev}));
  assert.match(C.eventText(ev),/But/);
  const stats=[{statistics:[{type:'Fouls',value:8}]},{statistics:[{type:'Fouls',value:11}]}];
  assert.equal(C.foulCount(stats),19);
  assert.equal(C.foulCount([]),null);
});

test('Recherche de rencontres sur nom de club',()=>{
  const fixtures=[{fixture:{id:100,date:'2026-11-07'},teams:{home:{name:'PSG'},away:{name:'Lyon'}},goals:{home:2,away:1}},{fixture:{id:200},teams:{home:{name:'Nice'},away:{name:'Lille'}}}];
  assert.equal(C.matchingFixtures(fixtures,'lyon')[0].id,100);
  assert.equal(C.matchingFixtures(fixtures,'ny').length,0);
  assert.equal(C.matchingFixtures(fixtures,'l').length,0);
});

test('Manifeste chargé uniquement par DevGitBrowser et aux domaines déclarés',()=>{
  assert.equal(manifest.manifest_version,2);
  assert.equal(manifest.background.persistent,true);
  assert.equal(manifest.content_scripts.length,1);
  assert.ok(manifest.content_scripts[0].js.includes('content.js'));
  assert.ok(manifest.content_scripts[0].js.includes('dom-reader.js'));
  assert.ok(manifest.content_scripts[0].css.includes('style.css'));
  assert.deepEqual(manifest.permissions,['https://v3.football.api-sports.io/*','https://site.api.espn.com/*']);
  assert.ok(manifest.content_scripts[0].matches.some(s=>s.includes('unibetsports.be')));
  assert.equal(manifest.content_scripts[0].matches.some(s=>s.includes('<all_urls>')),false);
  for(const relative of ['manifest.json','core.js','background.js','content.js','style.css']) assert.ok(fs.existsSync(path.join(dir,relative)));
});

test('Protection contre les appels tiers arbitraires et stockage des clés',()=>{
  const source=fs.readFileSync(path.join(dir,'background.js'),'utf8');
  assert.match(source,/authorizedSender/);
  assert.match(source,/https:\/\/v3\.football\.api-sports\.io/);
  assert.doesNotMatch(source,/chrome\.storage|localStorage|indexedDB/);
  assert.doesNotMatch(source,/betclic\.fr\/api|winamax\.fr\/api/);
  assert.match(source,/credentials:\s*'omit'/);
});

test('Messagerie : accès limité au bookmaker, API sportive externe et clé en mémoire',async()=>{
  const vm=require('node:vm');
  const source=fs.readFileSync(path.join(dir,'background.js'),'utf8');
  let listener, requests=[];
  const ctx={
    globalThis:{MatchPulseCore:C},
    chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
    URL,AbortController,Promise,Date,Map,Set,Number,String,Object,Error,
    setTimeout,clearTimeout,
    fetch:async(url,opts)=>{
      requests.push({url,opts});
      const resp=String(url).includes('fixtures?')?[{fixture:{id:99,date:'2026-11-07'},teams:{home:{name:'Lyon'},away:{name:'Paris'}}}]:[];
      return {ok:true,status:200,json:async()=>({response:resp,errors:[]})};
    }
  };
  vm.runInNewContext(source,vm.createContext(ctx),{filename:'background.js'});
  function send(action,details={},url='https://www.betclic.fr/paris'){
    return new Promise(resolve=>listener({action,...details},{url},resolve));
  }
  const refused=await send('status',{},'https://www.betclic.fr.evil.com/');
  assert.equal(refused.ok,false);
  let r=await send('set-key',{value:'abc01234567890123456789012'});
  assert.equal(r.ok,true);
  r=await send('fixtures',{date:'2026-11-07',search:'lyon'});
  assert.equal(r.ok,true);assert.equal(r.data.items[0].id,99);
  assert.equal(requests.length,1);
  assert.ok(requests[0].url.startsWith('https://v3.football.api-sports.io/fixtures?date='));
  assert.equal(requests[0].opts.credentials,'omit');
  r=await send('events',{fixture:'../../secret'});assert.equal(r.ok,false);
  r=await send('clear-key');assert.equal(r.data.configured,false);
  r=await send('status');assert.equal(r.data.configured,false);
});

test('Ticket combiné Betclic déjà validé : 4 sélections visibles, 5 attendues, cotes inconnues',()=>{
  const text=`En cours (1)\nTerminés\nGagnés\nCombiné (5)\nUnion Nord\nL’équipe possède 2 buts d’avance ou gagne (t. rég)\n19′ · MT 1\nUnion Nord 0 - 0 Racing Sud\nSporting Est\nL'équipe possède 2 buts d'avance ou gagne (t. rég)\n18′ · MT 1\nSporting Est 1 - 0 Union Ouest\nOlympique Rivage\nL'équipe possède 2 buts d'avance ou gagne (t. rég)\n17′ · MT 1\nOlympique Rivage 0 - 0 Racing Mont\nClub des Pins\nRésultat du match (t. rég)\n19′ · MT 1\nFC Forêt 0 - 2 Club des Pins`;
  const r=C.parsePlacedTicketText(text);
  assert.equal(r.expected,5);assert.equal(r.items.length,4);assert.equal(r.complete,false);
  assert.equal(r.items[0].label,'Union Nord');assert.match(r.items[0].fixture,/Racing Sud/);
  assert.equal(r.items[3].market,'Résultat du match (t. rég)');
  assert.ok(r.items.every(x=>x.odds===null));
  assert.equal(C.combinedImplied(r.items),null);
  assert.equal(C.parsePlacedTicketText('Mise totale 99,00\nGain potentiel 99,00').items.length,0);
});

test('ESPN : conversion des buts, pénaltys et cartons sans inventer des fautes',()=>{
  const mock={id:'401222333',date:'2026-11-07T20:00:00Z',status:{type:{state:'in',description:'En cours'}},competitions:[{
    competitors:[{homeAway:'home',team:{displayName:'Sporting Est',id:'1'},score:'1'},{homeAway:'away',team:{displayName:'Union Ouest',id:'2'},score:'0'}],
    details:[
      {scoringPlay:true,clock:{displayValue:"45'"},team:{id:'1'},athletesInvolved:[{displayName:'Joueur A'}]},
      {redCard:true,clock:{displayValue:"55'"},team:{id:'2'},athletesInvolved:[{displayName:'Joueur B'}]},
      {scoringPlay:true,penaltyKick:true,clock:{displayValue:"75'"},team:{id:'1'},athletesInvolved:[{displayName:'Joueur C'}]},
      {shootout:true,scoringPlay:true,clock:{displayValue:"90'"}}
    ]
  }]};
  const r=C.espnRecord(mock,'mex.1');
  assert.equal(r.score,'1 : 0');assert.equal(r.events.length,3);
  assert.deepEqual(r.events.map(x=>x.kind),['goal','red-card','penalty']);
  assert.match(C.publicEventText(r.events[2]),/pénalty/i);
  assert.equal(C.espnRecord(mock,'private'),null);
  assert.equal(C.allowedEspnLeague('../../api'),false);
  assert.equal(C.searchPublicMatches([r],'Sporting Est')[0].id,r.id);
  assert.equal(C.normalizeTeam('Atlético Étoile'),'etoile');
});

test('ESPN sans clé : messagerie sécurisée, source limitée aux ligues déclarées et cookies absents',async()=>{
  const vm=require('node:vm');let listener;const urls=[];
  const ctx={globalThis:{MatchPulseCore:C},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
    URL,AbortController,Promise,Date,Map,Set,Number,String,Object,Error,setTimeout,clearTimeout,
    fetch:async(url,opts)=>{urls.push({url,opts});return {status:200,ok:true,json:async()=>({events:[{
      id:'888',date:'2026-11-07',competitions:[{competitors:[
        {homeAway:'home',score:'1',team:{displayName:'Union Nord'}},
        {homeAway:'away',score:'1',team:{displayName:'Racing Sud'}}],details:[{scoringPlay:true,clock:{displayValue:"50'"}}]
      }]}]})};}}
  vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),vm.createContext(ctx));
  const send=(action,extra={},url='https://www.betclic.fr/sports')=>new Promise(resolve=>listener({action,...extra},{url},resolve));
  let r=await send('public-fixtures',{date:'2026-11-07',search:'Union Nord'});
  assert.equal(r.ok,true);assert.ok(r.data.items.some(x=>x.home==='Union Nord'));
  assert.ok(urls.length>0);assert.ok(urls.every(x=>x.url.startsWith('https://site.api.espn.com/')));
  assert.ok(urls.every(x=>x.opts.credentials==='omit'));
  r=await send('public-events',{date:'2026-11-07',league:'mex.1',fixture:'888'});
  assert.equal(r.ok,true);assert.equal(r.data.items[0].kind,'goal');
  r=await send('public-events',{date:'2026-11-07',league:'../../../secrets',fixture:'888'});
  assert.equal(r.ok,false);
  r=await send('public-fixtures',{date:'2026-11-07',search:'Union Nord'},'https://betclic.fr.evil.com/');
  assert.equal(r.ok,false);
});
