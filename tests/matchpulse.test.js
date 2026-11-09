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
  assert.deepEqual(manifest.permissions,['https://site.api.espn.com/*','https://v3.football.api-sports.io/*']);
  assert.ok(manifest.permissions.every(p=>p.startsWith('https://')&&!p.includes('<all_urls>')));
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

function backgroundContext(fetchImpl,extra={}){
  const vm=require('node:vm');let listener;
  const ctx={globalThis:{MatchPulseCore:C},chrome:{runtime:{onMessage:{addListener(fn){listener=fn;}}}},
    URL,AbortController,Promise,Date,Map,Set,Number,String,Object,Error,Math,setTimeout:(fn,ms)=>({ms}),clearTimeout(){},fetch:fetchImpl,...extra};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'background.js'),'utf8'),vm.createContext(ctx),{filename:'background.js'});
  return (action,details={},url='https://www.betclic.fr/paris')=>new Promise(resolve=>listener({action,...details},{url},resolve));
}
const json=body=>({ok:true,status:200,json:async()=>body});
test('Messagerie : accès limité au bookmaker, API sportive externe et clé en mémoire',async()=>{
  const requests=[];
  const send=backgroundContext(async(url,opts)=>{requests.push({url,opts});
    const resp=String(url).includes('fixtures?')?[{fixture:{id:99,date:'2026-11-07'},teams:{home:{name:'Lyon'},away:{name:'Paris'}}}]:[];
    return json({response:resp,errors:[]});});
  const refused=await send('status',{},'https://www.betclic.fr.evil.com/');
  assert.equal(refused.ok,false);
  let r=await send('set-key',{value:'abc01234567890123456789012'});
  assert.equal(r.ok,true);
  r=await send('search',{date:'2026-11-07',search:'lyon',source:'api-football'});
  assert.equal(r.ok,true);assert.equal(r.data.items[0].id,99);
  assert.equal(requests.length,1);
  assert.ok(requests[0].url.startsWith('https://v3.football.api-sports.io/fixtures?date='));
  assert.equal(requests[0].opts.credentials,'omit');
  r=await send('track',{match:{id:'../../secret',source:'api-football'}});assert.equal(r.ok,false);
  r=await send('track',{match:{id:'../../x',source:'espn'}});assert.equal(r.ok,false);
  r=await send('clear-key');assert.equal(r.data.configured,false);
  r=await send('status');assert.equal(r.data.configured,false);
  r=await send('rm -rf');assert.equal(r.ok,false);
});
function espnEvent({id='401',home='Paris Saint-Germain',homeShort='PSG',away='Lyon',state='in',details=[],date='2026-11-07T20:00:00Z',odds=null}={}){
  return {id,date,season:{slug:'2026-27-ligue-1'},status:{type:{state,shortDetail:state==='in'?"55'":'FT'}},competitions:[{competitors:[
    {homeAway:'home',score:'1',form:'WWDWW',team:{id:'1',displayName:home,shortDisplayName:homeShort}},{homeAway:'away',score:'0',form:'LLDLW',team:{id:'2',displayName:away}}],details,odds}]};
}
test('ESPN gratuit (toutes compétitions) : recherche, suivi du ticket et alertes buts / cartons / fautes / corners',async()=>{
  const calls=[];let keyEvents=[],fouls=[10,8];
  const notes=[];
  function FakeNotification(title,opts){notes.push(title+' | '+opts.body);}FakeNotification.permission='granted';
  let now=Date.parse('2026-11-07T20:00:00Z');class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
  const events=[espnEvent(),espnEvent({id:'402',home:'Lille',homeShort:'LIL',away:'Nice',state:'pre'})];
  const send=backgroundContext(async(url,opts)=>{calls.push(url);assert.equal(opts.credentials,'omit');
    if(url.includes('/all/scoreboard?dates=20261107'))return json({events});
    if(url.includes('/all/scoreboard'))return json({events:[]});
    if(url.includes('/all/summary?event=401'))return json({header:{competitions:[{competitors:[{homeAway:'home',team:{id:'1'}},{homeAway:'away',team:{id:'2'}}]}]},keyEvents,
      boxscore:{teams:[{team:{id:'1'},statistics:[{name:'foulsCommitted',displayValue:String(fouls[0])},{name:'wonCorners',displayValue:'3'}]},{team:{id:'2'},statistics:[{name:'foulsCommitted',displayValue:String(fouls[1])},{name:'wonCorners',displayValue:'1'}]}]}});
    return {ok:false,status:404,json:async()=>({})};},{Notification:FakeNotification,Date:FakeDate});
  let r=await send('search',{date:'2026-11-07',search:'Lille',source:'espn'});
  assert.equal(r.ok,true);assert.equal(r.data.source,'espn');assert.equal(r.data.items[0].id,'402');assert.equal(r.data.items[0].leagueName,'Ligue 1');
  r=await send('search',{date:'2026-11-07',search:'PSG'});assert.equal(r.data.items[0].id,'401');
  r=await send('diagnose',{date:'2026-11-07'});assert.equal(r.data.espn.ok,true);assert.equal(r.data.espn.matches,2);
  r=await send('track-ticket',{date:'2026-11-07',items:[{label:'PSG',fixture:'PSG 0 - 0 Lyon',market:'Résultat du match'},{label:'Inconnu',fixture:'Équipe X - Équipe Y'}]});
  assert.equal(r.ok,true);assert.deepEqual([...r.data.matched],['Paris Saint-Germain – Lyon']);assert.equal(r.data.missing.length,1);
  assert.ok(calls.every(u=>u.startsWith('https://site.api.espn.com/apis/site/v2/sports/soccer/all/')),'une seule source, sans clé');
  for(let i=0;i<50;i++){const st=await send('state');if(st.data.lastPoll)break;await new Promise(res=>setImmediate(res));} // premier passage = référence
  keyEvents=[{id:'k1',type:{text:'Goal'},clock:{displayValue:"12'"},team:{id:'1'},participants:[{athlete:{displayName:'Joueur A'}}]},
    {id:'k2',type:{text:'Yellow Card'},clock:{displayValue:"30'"},team:{id:'2'},participants:[{athlete:{displayName:'Joueur B'}}]},
    {id:'k3',type:{text:'Penalty - Missed'},clock:{displayValue:"40'"},team:{id:'1'},participants:[{athlete:{displayName:'Joueur C'}}]}];
  fouls=[12,9];
  now+=60_000;
  r=await send('start');assert.equal(r.ok,true);
  r=await send('state');
  const texts=r.data.alerts.map(a=>a.text).join('\n');
  assert.match(texts,/But — Joueur A/);assert.match(texts,/Carton jaune — Joueur B/);assert.match(texts,/Pénalty manqué/);
  assert.match(texts,/Fautes : 18 → 21/);
  assert.ok(notes.length>=3,'notifications Windows envoyées');
  assert.equal(r.data.tracked[0].league,'Ligue 1');
  r=await send('untrack',{id:'401'});assert.equal(r.data.tracked.length,0);assert.equal(r.data.running,false);
});
test('Probabilité du ticket avec les cotes et la forme publiées par ESPN',async()=>{
  const odds=[{provider:{displayName:'DraftKings'},overUnder:2.5,moneyline:{home:{close:{odds:'-150'}},away:{close:{odds:'+380'}},draw:{close:{odds:'+300'}}},
    total:{over:{close:{line:'o2.5',odds:'-160'}},under:{close:{line:'u2.5',odds:'+125'}}}}];
  const send=backgroundContext(async url=>json({events:url.includes('dates=20261107')?[espnEvent({state:'pre',odds})]:[]}));
  const r=await send('analyze-slip',{date:'2026-11-07',items:[{label:'Paris Saint-Germain',market:'Résultat du match',fixture:'PSG - Lyon',odds:1.6},{label:'Plus de 2,5',market:'Nombre de buts',fixture:'PSG - Lyon',odds:1.7}]});
  assert.equal(r.ok,true);
  const [win,goals]=r.data.results;
  assert.match(win.source,/cotes du marché \+ forme \(DraftKings\)/);
  assert.ok(win.probability>0.55&&win.probability<0.65);
  assert.match(goals.source,/cotes du marché/);assert.ok(Math.abs(goals.probability-0.5806)<0.01);
  assert.equal(r.data.sameMatch,true);
  assert.ok(r.data.combined>0);
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

test('ESPN injoignable : message clair et origine vérifiée',async()=>{
  const send=backgroundContext(async()=>{throw new TypeError('Failed to fetch');});
  let r=await send('search',{date:'2026-11-07',search:'Union Nord'});
  assert.equal(r.ok,false);assert.match(r.error,/Connexion impossible/);
  r=await send('diagnose',{date:'2026-11-07'});assert.equal(r.data.espn.ok,false);
  r=await send('search',{date:'2026-11-07',search:'Union Nord'},'https://betclic.fr.evil.com/');
  assert.equal(r.ok,false);
});
test('Lecture des données SofaScore et rapprochement ticket → match',()=>{
  const inc=C.sofaIncidents({incidents:[{id:9,incidentType:'goal',incidentClass:'penalty',time:90,addedTime:3,isHome:false,player:{name:'X'},homeScore:1,awayScore:1},{incidentType:'substitution'},{id:8,incidentType:'card',incidentClass:'yellowRed',time:70}]});
  assert.deepEqual(inc.map(i=>i.kind),['second-yellow','penalty']);
  assert.match(C.liveEventText(inc[1],'A','B'),/90\+3′ .*pénalty — X \(B\) · 1–1/);
  assert.deepEqual(C.sofaStatistics({statistics:[{period:'ALL',groups:[{statisticsItems:[{name:'Fouls',home:'7',away:'5'}]}]}]}).fouls,{home:7,away:5,total:12});
  assert.deepEqual(C.statChanges({fouls:{total:12}},{fouls:{home:7,away:6,total:13}},['fouls']).map(x=>x.key),['fouls']);
  assert.equal(C.sofaRecord({id:'1;drop'}),null);
  assert.deepEqual(C.parseFixtureTeams('Real Madrid vs FC Barcelone'),{home:'Real Madrid',away:'FC Barcelone'});
  assert.equal(C.parseFixtureTeams('Résultat du match'),null);
  assert.equal(C.teamSimilarity('OM','Olympique de Marseille'),1);
  assert.equal(C.bestFixtureMatch([{home:'Lille',away:'Nice'}],{home:'Lens',away:'Brest'}),null);
  assert.equal(C.isBetConfirmation('Votre pari a bien été enregistré'),true);
  assert.equal(C.isBetConfirmation('Pari placé'),true);
  assert.equal(C.isBetConfirmation('Paris sportifs en direct'),false);
});
