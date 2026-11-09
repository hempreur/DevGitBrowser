/* MatchPulse 0.6 — fonctions déterministes partagées, sans dépendance externe. */
(function (root, build) {
  const api = build();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MatchPulseCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DOMAINS = Object.freeze([
    { name: 'Betclic', region: 'France', domain: 'betclic.fr' },
    { name: 'Winamax', region: 'France', domain: 'winamax.fr' },
    { name: 'Unibet', region: 'France', domain: 'unibet.fr' },
    { name: 'Unibet', region: 'Belgique', domain: 'unibet.be' },
    { name: 'Unibet', region: 'Belgique', domain: 'unibetsports.be' }
  ]);
  function detectBookmaker(host) {
    const value = String(host || '').toLowerCase().replace(/\.$/, '');
    return DOMAINS.find(x => value === x.domain || value.endsWith('.' + x.domain)) || null;
  }
  function parseOdds(input) {
    const str = String(input ?? '').trim().replace(/\s/g, '').replace(',', '.');
    if (!/^(?:\d{1,3})(?:\.\d{1,3})?$/.test(str)) return null;
    const n = Number(str);
    return Number.isFinite(n) && n >= 1.01 && n <= 500 ? n : null;
  }
  function impliedProbability(odds) { const n = parseOdds(odds); return n === null ? null : 1 / n; }
  function combinedImplied(selections) {
    if (!Array.isArray(selections) || !selections.length) return null;
    let p = 1, total = 1;
    for (const sel of selections) {
      const odd = parseOdds(sel.odds);
      if (!odd) return null;
      total *= odd;
      p *= 1 / odd;
    }
    return { probability: p, decimalOdds: total, isIndependentAssumption: selections.length > 1 };
  }
  function niceLabel(value, max=95) {
    return String(value || '').replace(/[\r\n\t ]+/g, ' ').trim().slice(0, max);
  }
  function extractOddsAndLabel(text) {
    const line = niceLabel(text, 230);
    if (!line || /(mise totale|déposer|cashout|solde|montant|identifiant|retrait|gain potentiel)/i.test(line)) return null;
    // Accepte seulement une cote décimale positionnée en fin de ligne, pas un score au milieu.
    const m = line.match(/(?:^|\s)(\d{1,3}[,.]\d{1,3})\s*$/);
    if (!m) return null;
    const odds = parseOdds(m[1]);
    const label = niceLabel(line.slice(0, m.index).trim(), 100);
    if (!odds || label.length < 3 || !/[A-Za-zÀ-ÿ]/.test(label)) return null;
    return { label, odds };
  }
  function eventKind(event) {
    const type = String(event?.type || '').toLowerCase();
    const detail = String(event?.detail || '').toLowerCase();
    if (type === 'goal') return /penalt|penalt/i.test(detail) ? 'penalty' : 'goal';
    if (type === 'card') return detail.includes('red') ? 'red-card' : 'yellow-card';
    if (type === 'var' && detail.includes('penalt')) return 'penalty';
    if (type === 'var') return 'var';
    return null;
  }
  function eventText(event) {
    const kind = eventKind(event);
    const name = niceLabel(event?.player?.name || event?.team?.name || '', 75);
    const minute = Number.isFinite(Number(event?.time?.elapsed)) ? String(event.time.elapsed) + '′ ' : '';
    const pretty = {
      'goal': '⚽ But', 'penalty': '🎯 Pénalty', 'yellow-card': '🟨 Carton jaune',
      'red-card': '🟥 Carton rouge', 'var': '📺 VAR'
    };
    return kind ? `${minute}${pretty[kind]}${name ? ' — ' + name : ''}` : null;
  }
  function eventId(event) {
    return [event?.time?.elapsed, event?.time?.extra, event?.team?.id,
      event?.player?.id, event?.type, event?.detail, event?.comments].map(v => String(v ?? '')).join('|');
  }
  function foulCount(statistics) {
    if (!Array.isArray(statistics)) return null;
    let sum=0, known=false;
    for (const team of statistics) {
      const item = (team?.statistics || []).find(s=>String(s?.type).toLowerCase()==='fouls');
      const v = Number(item?.value);
      if (item && item.value !== null && Number.isFinite(v) && v>=0) { sum+=v;known=true; }
    }
    return known ? sum : null;
  }
  function validFixtureId(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 1e9; }
  function matchingFixtures(response, search) {
    const q = niceLabel(search, 70).toLocaleLowerCase();
    if (q.length < 2) return [];
    return (Array.isArray(response) ? response : []).filter(f => {
      const a = f?.teams?.home?.name || '', b = f?.teams?.away?.name || '';
      return `${a} ${b}`.toLocaleLowerCase().includes(q);
    }).slice(0,30).map(f => ({
      id:f.fixture?.id,
      home:niceLabel(f.teams?.home?.name,70), away:niceLabel(f.teams?.away?.name,70),
      date:f.fixture?.date, score:`${f.goals?.home ?? '-'} : ${f.goals?.away ?? '-'}`,
      status:f.fixture?.status?.short || ''
    })).filter(f=>validFixtureId(f.id));
  }

  // Les tickets déjà validés n'affichent généralement plus leurs cotes.
  // Le parseur n'invente donc aucune cote ni probabilité à partir du score.
  function parsePlacedTicketText(source) {
    const text=String(source || '').slice(0,14000);
    const lines=text.split(/\r?\n/).map(s=>niceLabel(s.replace(/[⚽🏆•]/gu,' '),160)).filter(Boolean);
    const header=lines.find(s=>/\bcombin[eé]\s*\(?\d{1,2}\)?/i.test(s));
    const count=header?.match(/\bcombin[eé]\s*\(?([1-9]\d?)\)?/i);
    const expected=count?Number(count[1]):null;
    const marketPattern=/(?:l['’]équipe possède|r[eé]sultat du match|double chance|les deux [eé]quipes|nombre de buts|total de buts|plus de \d|moins de \d|handicap|but(eur|s)?|cartons?|corners?|r[eé]sultat mi-temps|1x2|remporte (?:le match|la rencontre)|tirs cadr[eé]s|[eé]quipe (?:gagne|marque)|victoire (?:de|du))/i;
    const statusPattern=/^(?:en cours|termin[eé]s?|gagn[eé]s?|perdus?|combin[eé]|cote|mise|gain|retrait|cash.?out|paris|\d{1,2}['’′]\s|MT\b|termin[eé]\b)/i;
    const scorePattern=/(?:^|\s)(\d{1,2})\s*[-:]\s*(\d{1,2})(?=\s|$)/;
    const items=[];
    for(let i=0;i<lines.length && items.length<20;i++){
      const market=lines[i];
      if(!marketPattern.test(market) || market.length>145)continue;
      // Le nom de la sélection précède généralement le marché dans le ticket « En cours ».
      let label='';
      for(let j=i-1;j>=Math.max(0,i-4);j--){
        const candidate=lines[j];
        if(!candidate || statusPattern.test(candidate) || marketPattern.test(candidate) || scorePattern.test(candidate))continue;
        const cleanCandidate=candidate.replace(/(?:\s+\d{1,3}[,.]\d{1,3}){1,3}$/, '').trim();
        if(cleanCandidate.length>=2 && cleanCandidate.length<=80 && /[A-Za-zÀ-ÿ]/.test(cleanCandidate)) {label=cleanCandidate;break;}
      }
      let fixture='';
      let odds=null;
      for(let j=i+1;j<Math.min(lines.length,i+9);j++){
        if(j>i+1 && marketPattern.test(lines[j]))break;
        const line=lines[j];
        if(!fixture && scorePattern.test(line) && /[A-Za-zÀ-ÿ]/.test(line)) fixture=niceLabel(line,120);
        const explicit=line.match(/\bcote(?:\s+(?:du pari|s[eé]lection))?\s*[:：]?\s*(\d{1,3}[.,]\d{1,3})\b/i);
        if(explicit)odds=parseOdds(explicit[1]);
        // Ticket Betclic : ancienne cote barrée, puis cote actuelle. « innerText »
        // expose parfois ces nombres sans la mention « cote ». Un score 0-0 n'en fait pas partie.
        const onlyOdds=line.match(/^(?:\d{1,3}[,.]\d{1,3})(?:\s+\d{1,3}[,.]\d{1,3})*$/);
        if(onlyOdds) for(const value of line.split(/\s+/)) odds=parseOdds(value)||odds;
      }
      // Ne pas intégrer des libellés isolés hors d'un ticket sportif structuré.
      if(!label || (!fixture && !expected))continue;
      const item={label,market,fixture,odds};
      if(!items.some(s=>s.label===item.label&&s.market===item.market&&s.fixture===item.fixture))items.push(item);
    }
    return {items,expected,complete:expected!==null && items.length===expected};
  }
  function scoreFromFixture(fixture){
    const line=niceLabel(fixture,170);
    const m=line.match(/^(.{2,70}?)\s+(\d{1,2})\s*[-:]\s*(\d{1,2})\s+(.{2,70})$/);
    if(!m)return null;
    return {home:niceLabel(m[1],70),away:niceLabel(m[4],70),homeGoals:Number(m[2]),awayGoals:Number(m[3])};
  }
  function scoreChange(prev,next){
    if(!prev||!next||normalizeTeam(prev.home)!==normalizeTeam(next.home)||normalizeTeam(prev.away)!==normalizeTeam(next.away))return null;
    if(prev.homeGoals===next.homeGoals&&prev.awayGoals===next.awayGoals)return null;
    const before=`${prev.homeGoals}–${prev.awayGoals}`,after=`${next.homeGoals}–${next.awayGoals}`;
    const increased=next.homeGoals>=prev.homeGoals&&next.awayGoals>=prev.awayGoals;
    const goalCount=next.homeGoals+next.awayGoals-prev.homeGoals-prev.awayGoals;
    if(increased&&goalCount===1)return `⚽ But signalé sur la page : ${next.home} – ${next.away} (${before} → ${after})`;
    return `Score rectifié sur la page : ${next.home} – ${next.away} (${before} → ${after})`;
  }
  const ESPN_LEAGUES=Object.freeze([
    {id:'mex.1',name:'Mexique · Liga MX'}, {id:'arg.1',name:'Argentine · Primera'},
    {id:'bra.1',name:'Brésil · Série A'}, {id:'usa.1',name:'États-Unis · MLS'},
    {id:'eng.1',name:'Angleterre · Premier League'}, {id:'esp.1',name:'Espagne · Liga'},
    {id:'fra.1',name:'France · Ligue 1'}, {id:'ger.1',name:'Allemagne · Bundesliga'},
    {id:'ita.1',name:'Italie · Serie A'}, {id:'uefa.champions',name:'Ligue des champions'},
    {id:'uefa.europa',name:'Ligue Europa'}, {id:'uefa.europa.conf',name:'Ligue Conférence'}, {id:'fra.2',name:'France · Ligue 2'},
    {id:'eng.2',name:'Angleterre · Championship'}, {id:'por.1',name:'Portugal · Liga'}, {id:'ned.1',name:'Pays-Bas · Eredivisie'},
    {id:'bel.1',name:'Belgique · Pro League'}, {id:'tur.1',name:'Turquie · Süper Lig'}, {id:'sco.1',name:'Écosse · Premiership'}, {id:'ksa.1',name:'Arabie saoudite · Pro League'}
  ]);
  function allowedEspnLeague(value){return ESPN_LEAGUES.some(x=>x.id===value);}
  function normalizeTeam(value){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:fc|cf|ac|club|atletico|athletic|deportivo|futbol|football|calcio|cd|united)\b/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
  function espnRecord(ev,league){
    if(!ev || !/^\d{1,12}$/.test(String(ev.id)) || !allowedEspnLeague(league))return null;
    const comp=ev.competitions?.[0], members=comp?.competitors||[];
    const home=members.find(c=>c.homeAway==='home')||members[0]||{};
    const away=members.find(c=>c.homeAway==='away')||members[1]||{};
    const name=c=>niceLabel(c?.team?.displayName||c?.team?.name,70);
    if(!name(home)||!name(away))return null;
    const formattedScore=`${home.score??'-'} : ${away.score??'-'}`;
    const actions=(comp?.details||[]).map(d=>{
      if(d.shootout)return null;
      const typ=d.scoringPlay?(d.penaltyKick?'penalty':'goal'):d.redCard?'red-card':d.yellowCard?'yellow-card':d.penaltyKick?'penalty-not-scored':null;
      if(!typ)return null;
      const text=String(d.clock?.displayValue||'');
      const minute=parseInt(text,10);
      const player=niceLabel(d.athletesInvolved?.[0]?.displayName,60);
      return {kind:typ, minute:Number.isFinite(minute)?minute:null, team: String(d.team?.id||''), player,
        id:[typ,text,d.team?.id||'',player].join('|')};
    }).filter(Boolean);
    return {id:String(ev.id),league,home:name(home),away:name(away),score:formattedScore,
      status:niceLabel(ev.status?.type?.detail||ev.status?.type?.description||'',40),
      state:String(ev.status?.type?.state||''),date:ev.date||'',events:actions};
  }
  function publicEventText(item){
    const labels={'goal':'⚽ But','penalty':'🎯 But sur pénalty','penalty-not-scored':'🎯 Pénalty signalé (issue non confirmée)','yellow-card':'🟨 Carton jaune','red-card':'🟥 Carton rouge'};
    return labels[item?.kind]?`${item.minute===null?'':item.minute+'′ '}${labels[item.kind]}${item.player?' — '+item.player:''}`:null;
  }
  function searchPublicMatches(records,search){
    const q=normalizeTeam(search);
    if(q.length<2)return [];
    return records.filter(r=>normalizeTeam(r.home).includes(q)||normalizeTeam(r.away).includes(q))
      .slice(0,30).map(r=>({id:r.id,league:r.league,home:r.home,away:r.away,date:r.date,score:r.score,status:r.status,source:'public'}));
  }

  // ------------------------------------------------------------------ SofaScore
  // Flux JSON public utilisé par sofascore.com (sans clé ni compte). Non officiel :
  // les formats sont lus de façon défensive et ESPN reste la source de secours.
  function validSofaId(value){return /^\d{1,12}$/.test(String(value??''));}
  function sofaState(type){const t=String(type||'').toLowerCase();return t==='inprogress'?'live':t==='finished'||t==='afterpenalties'||t==='afterextratime'?'post':t==='notstarted'?'pre':t||'pre';}
  function sofaRecord(ev){
    if(!ev||!validSofaId(ev.id))return null;
    const home=niceLabel(ev.homeTeam?.name||ev.homeTeam?.shortName,70), away=niceLabel(ev.awayTeam?.name||ev.awayTeam?.shortName,70);
    if(!home||!away)return null;
    const hs=ev.homeScore?.current??ev.homeScore?.display, as=ev.awayScore?.current??ev.awayScore?.display;
    const league=niceLabel([ev.tournament?.category?.name,ev.tournament?.uniqueTournament?.name||ev.tournament?.name].filter(Boolean).join(' · '),80);
    return {id:String(ev.id),source:'sofascore',home,away,league,
      score:`${Number.isFinite(Number(hs))?Number(hs):'-'} : ${Number.isFinite(Number(as))?Number(as):'-'}`,
      status:niceLabel(ev.status?.description||'',40),state:sofaState(ev.status?.type),
      date:Number(ev.startTimestamp)>0?new Date(Number(ev.startTimestamp)*1000).toISOString():''};
  }
  function sofaIncidents(body){
    const list=Array.isArray(body?.incidents)?body.incidents:[];
    const out=[];
    for(const inc of list.slice(0,300)){
      const type=String(inc?.incidentType||''), cls=String(inc?.incidentClass||'');
      let kind=null;
      if(type==='goal')kind=cls==='penalty'?'penalty':cls==='ownGoal'?'own-goal':'goal';
      else if(type==='card')kind=cls==='red'?'red-card':cls==='yellowRed'?'second-yellow':'yellow-card';
      else if(type==='inGamePenalty')kind='penalty-missed';
      else if(type==='varDecision')kind='var';
      if(!kind)continue;
      const minute=Number.isFinite(Number(inc.time))?Number(inc.time):null;
      const extra=Number.isFinite(Number(inc.addedTime))&&Number(inc.addedTime)>0?Number(inc.addedTime):0;
      const player=niceLabel(inc.player?.name||inc.player?.shortName||inc.playerName||'',60);
      const side=inc.isHome===true?'home':inc.isHome===false?'away':'';
      const detail=kind==='var'?niceLabel(String(inc.incidentClass||'').replace(/([A-Z])/g,' $1'),40):'';
      const score=Number.isFinite(Number(inc.homeScore))&&Number.isFinite(Number(inc.awayScore))?`${inc.homeScore}–${inc.awayScore}`:'';
      out.push({id:String(inc.id||[kind,minute,extra,player,side,cls].join('|')),kind,minute,extra,player,side,detail,score});
    }
    return out.sort((a,b)=>(a.minute??0)-(b.minute??0)||(a.extra-b.extra));
  }
  function sofaStatistics(body){
    const periods=Array.isArray(body?.statistics)?body.statistics:[];
    const all=periods.find(p=>p?.period==='ALL')||periods[0];
    const wanted={fouls:/^fouls$/i,corners:/^corner/i,yellow:/^yellow/i,red:/^red/i,shotsOnTarget:/shots on target|on target/i,offsides:/^offsides?$/i};
    const keys={fouls:['fouls'],corners:['cornerKicks'],yellow:['yellowCards'],red:['redCards'],shotsOnTarget:['shotsOnGoal','shotsOnTarget'],offsides:['offsides']};
    const result={};
    for(const group of all?.groups||[])for(const item of group?.statisticsItems||[]){
      for(const [name,re] of Object.entries(wanted)){
        if(result[name])continue;
        if(!(keys[name].includes(item?.key)||re.test(String(item?.name||''))))continue;
        const h=Number(item.homeValue??String(item.home).replace(/[^\d.]/g,'')), a=Number(item.awayValue??String(item.away).replace(/[^\d.]/g,''));
        if(Number.isFinite(h)&&Number.isFinite(a))result[name]={home:h,away:a,total:h+a};
      }
    }
    return result;
  }
  const STAT_LABELS=Object.freeze({fouls:'Fautes',corners:'Corners',yellow:'Cartons jaunes',red:'Cartons rouges',shotsOnTarget:'Tirs cadrés',offsides:'Hors-jeu'});
  function statChanges(previous,next,enabled=['fouls','corners']){
    const out=[];
    if(!previous||!next)return out;
    for(const key of enabled){
      const a=previous[key],b=next[key];
      if(!a||!b||b.total<=a.total)continue;
      out.push({key,text:`${STAT_LABELS[key]} : ${a.total} → ${b.total} (${b.home}–${b.away})`});
    }
    return out;
  }
  function liveEventText(item,home='',away=''){
    const labels={'goal':'⚽ But','penalty':'⚽🎯 But sur pénalty','own-goal':'⚽ But contre son camp','penalty-missed':'🎯 Pénalty manqué',
      'penalty-not-scored':'🎯 Pénalty signalé','yellow-card':'🟨 Carton jaune','second-yellow':'🟨🟥 Second jaune (exclusion)','red-card':'🟥 Carton rouge','var':'📺 VAR'};
    if(!labels[item?.kind])return null;
    const minute=item.minute===null||item.minute===undefined?'':`${item.minute}${item.extra?'+'+item.extra:''}′ `;
    const team=item.side==='home'?home:item.side==='away'?away:'';
    const who=[item.player,team&&item.player?`(${team})`:team].filter(Boolean).join(' ');
    return `${minute}${labels[item.kind]}${who?' — '+who:''}${item.detail?' · '+item.detail:''}${item.score?' · '+item.score:''}`;
  }
  // ------------------------------------------------------------- Ticket → matchs
  function parseFixtureTeams(text){
    const line=niceLabel(text,170).replace(/\s+\d{1,2}\s*[-:]\s*\d{1,2}\s+/,' - ');
    const m=line.match(/^(.{2,70}?)\s+(?:-|–|—|vs\.?|v)\s+(.{2,70})$/i);
    if(!m)return null;
    const clean=v=>niceLabel(v.replace(/\b\d{1,2}[:h]\d{2}\b/g,'').replace(/\(.*?\)/g,''),70);
    const home=clean(m[1]),away=clean(m[2]);
    return home&&away&&/[A-Za-zÀ-ÿ]/.test(home)&&/[A-Za-zÀ-ÿ]/.test(away)?{home,away}:null;
  }
  // Abréviations et noms français courants chez les bookmakers.
  const TEAM_ALIASES=Object.freeze({'psg':'paris saint germain','paris sg':'paris saint germain','om':'olympique marseille','marseille':'olympique marseille',
    'ol':'olympique lyonnais','lyon':'olympique lyonnais','losc':'lille','asse':'saint etienne','st etienne':'saint etienne','rcl':'lens','srfc':'rennes',
    'fcn':'nantes','ogc nice':'nice','asm':'monaco','man utd':'manchester','man united':'manchester','man city':'manchester city','barcelone':'barcelona',
    'bayern munich':'bayern','bayern munchen':'bayern','inter':'internazionale','inter milan':'internazionale','milan ac':'milan','naples':'napoli',
    'seville':'sevilla','juventus turin':'juventus','tottenham hotspur':'tottenham','spurs':'tottenham','atletico madrid':'madrid','real madrid':'real madrid',
    'borussia dortmund':'dortmund','bvb':'dortmund','rb leipzig':'leipzig','leverkusen':'bayer leverkusen','benfica lisbonne':'benfica','sporting portugal':'sporting'});
  function canonicalTeam(value){const n=normalizeTeam(value);return TEAM_ALIASES[n]||n;}
  function teamSimilarity(a,b){
    const x=canonicalTeam(a),y=canonicalTeam(b);
    if(!x||!y)return 0;
    if(x===y)return 1;
    if(x.includes(y)||y.includes(x))return 0.85;
    const tx=new Set(x.split(' ').filter(w=>w.length>2)),ty=new Set(y.split(' ').filter(w=>w.length>2));
    if(!tx.size||!ty.size)return 0;
    let common=0;for(const w of tx)if(ty.has(w))common++;
    return common/Math.max(tx.size,ty.size);
  }
  function bestFixtureMatch(records,teams){
    if(!teams||!Array.isArray(records))return null;
    let best=null;
    for(const r of records){
      const sim=(rec,which,name)=>Math.max(teamSimilarity(rec[which],name),rec[which+'Short']?teamSimilarity(rec[which+'Short'],name):0);
      const direct=(sim(r,'home',teams.home)+sim(r,'away',teams.away))/2;
      const swapped=(sim(r,'home',teams.away)+sim(r,'away',teams.home))/2*0.9;
      const score=Math.max(direct,swapped)+(r.state==='live'||r.state==='in'?0.05:0);
      if(score>=0.6&&(!best||score>best.score))best={record:r,score};
    }
    return best?.record||null;
  }
  // Textes affichés par les bookmakers juste après la validation d'un pari.
  const CONFIRMATION=/(?:pari|ticket|coupon|mise)s?\s+(?:a\s+(?:bien\s+)?été\s+)?(?:valid[ée]e?s?|plac[ée]e?s?|enregistr[ée]e?s?|accept[ée]e?s?|confirm[ée]e?s?|pris\s+en\s+compte)|votre\s+(?:pari|ticket)\s+(?:est|a)\b|bet\s+(?:placed|accepted|confirmed)/i;
  function isBetConfirmation(text){return CONFIRMATION.test(String(text||'').slice(0,4000));}

  // ------------------------------------------------- Ticket AVANT validation
  // Panier de paris : « Sélection / Marché / Équipe A - Équipe B / cote ».
  function parseBetslipText(source){
    const lines=String(source||'').slice(0,14000).split(/\r?\n/).map(s=>niceLabel(s,160)).filter(Boolean);
    const marketPattern=/(?:r[eé]sultat|vainqueur|1x2|1n2|double chance|les deux [eé]quipes|deux [eé]quipes marquent|nombre de buts|total de buts|handicap|buteur|but(?:s)?\b|mi-temps|corners?|cartons?|qualifi|remporte|victoire|score exact|draw no bet|rembours)/i;
    const items=[];
    for(let i=0;i<lines.length&&items.length<20;i++){
      if(!marketPattern.test(lines[i])||lines[i].length>120)continue;
      let label='';
      for(let j=i-1;j>=Math.max(0,i-3);j--){
        const c=lines[j].replace(/(?:\s+\d{1,3}[,.]\d{2,3})+$/,'').trim();
        if(c&&!marketPattern.test(c)&&!parseFixtureTeams(c)&&!/^(?:cote|mise|gain|supprimer|retirer|simple|combin|panier|\d)/i.test(c)&&c.length<=80&&/[A-Za-zÀ-ÿ]/.test(c)){label=c;break;}
      }
      let fixture='',odds=null;
      for(let j=i+1;j<Math.min(lines.length,i+6);j++){
        if(j>i+1&&marketPattern.test(lines[j]))break;
        if(!fixture&&parseFixtureTeams(lines[j]))fixture=lines[j];
        const m=lines[j].match(/^(?:cote\s*:?\s*)?(\d{1,3}[,.]\d{1,3})$/i)||lines[j].match(/(?:^|\s)(\d{1,3}[,.]\d{2})$/);
        if(m&&!odds)odds=parseOdds(m[1]);
      }
      if(!odds){const inline=(lines[i-1]||'').match(/(\d{1,3}[,.]\d{2})$/);if(inline)odds=parseOdds(inline[1]);}
      if(!label||!fixture)continue;
      const item={label,market:lines[i],fixture,odds};
      if(!items.some(x=>x.label===item.label&&x.market===item.market&&x.fixture===item.fixture))items.push(item);
    }
    const total=String(source||'').match(/cote\s+(?:totale|combin[eé]e|globale)\s*:?\s*(\d{1,5}[,.]\d{1,3})/i);
    return {items,totalOdds:total?parseOdds(total[1]):null};
  }
  function fractionalToDecimal(value){
    const t=String(value||'').trim();
    const f=t.match(/^(\d{1,5})\/(\d{1,5})$/);
    if(f&&Number(f[2])>0)return 1+Number(f[1])/Number(f[2]);
    const d=Number(t.replace(',','.'));
    return Number.isFinite(d)&&d>1?d:null;
  }
  // Probabilités « sans marge » du marché, à partir des cotes publiées par SofaScore.
  function marketProbabilities(body){
    const out={};
    for(const m of Array.isArray(body?.markets)?body.markets.slice(0,80):[]){
      const name=String(m?.marketName||'').toLowerCase();
      const choices=(m?.choices||[]).map(c=>({name:String(c?.name||''),odds:fractionalToDecimal(c?.fractionalValue??c?.decimalValue)})).filter(c=>c.odds);
      if(choices.length<2)continue;
      const sum=choices.reduce((a,c)=>a+1/c.odds,0);
      const probs=Object.fromEntries(choices.map(c=>[c.name.toLowerCase(),(1/c.odds)/sum]));
      if(/^full time$|1x2/.test(name)&&probs['1']!==undefined)out['1x2']={home:probs['1'],draw:probs['x'],away:probs['2']};
      else if(/double chance/.test(name))out.dc={'1x':probs['1x'],'x2':probs['x2'],'12':probs['12']};
      else if(/both teams to score/.test(name))out.btts={yes:probs.yes,no:probs.no};
      else if(/match goals|total goals/.test(name)){const line=Number(String(m.choiceGroup||'').replace(',','.'));if(Number.isFinite(line))(out.goals||(out.goals={}))[line]={over:probs.over,under:probs.under};}
    }
    return out;
  }
  function formPoints(form){return (Array.isArray(form)?form.slice(-5):[]).reduce((a,r)=>a+(r==='W'?3:r==='D'?1:0),0);}
  function lineFrom(text){const m=String(text||'').match(/(\d{1,2})[,.](5)/);return m?Number(m[1]+'.'+m[2]):null;}
  // Interprète la sélection du ticket par rapport aux équipes du match.
  function classifySelection(item,teams){
    const label=String(item?.label||''), market=String(item?.market||'').toLowerCase(), both=(label+' '+market).toLowerCase();
    if(/double chance/.test(market)||/\bou\s+(?:match\s+)?nul\b|^1x$|^x2$|^12$/i.test(label)){
      if(/^1x$/i.test(label)||(teams&&/nul/i.test(label)&&teamSimilarity(label.replace(/\s+ou\s+.*$/i,''),teams.home)>=0.6))return {type:'dc',outcome:'1x'};
      if(/^x2$/i.test(label)||(teams&&/nul/i.test(label)&&teamSimilarity(label.replace(/\s+ou\s+.*$/i,''),teams.away)>=0.6))return {type:'dc',outcome:'x2'};
      if(/^12$/.test(label)||/pas de (?:match )?nul/i.test(label))return {type:'dc',outcome:'12'};
    }
    if(/les deux [eé]quipes|deux [eé]quipes marquent|btts/.test(both)){
      if(/\boui\b|\byes\b/.test(both))return {type:'btts',outcome:'yes'};
      if(/\bnon\b|\bno\b/.test(both))return {type:'btts',outcome:'no'};
    }
    if(/plus de|moins de|over|under/.test(both)&&/but|goal|total/.test(both)||/^(?:plus|moins) de \d/i.test(label)){
      const line=lineFrom(label)??lineFrom(market);
      if(line!==null)return {type:'goals',line,outcome:/plus|over/i.test(label)?'over':/moins|under/i.test(label)?'under':(/plus|over/.test(market)?'over':'under')};
    }
    if(/r[eé]sultat|vainqueur|1x2|1n2|remporte|victoire|gagne/.test(market)){
      if(/^(?:match\s+)?nul$|^x$|^n$/i.test(label.trim()))return {type:'1x2',outcome:'draw'};
      if(teams){
        const h=teamSimilarity(label,teams.home),a=teamSimilarity(label,teams.away);
        if(Math.max(h,a)>=0.6)return {type:'1x2',outcome:h>=a?'home':'away'};
      }
      if(/^1$/.test(label.trim()))return {type:'1x2',outcome:'home'};
      if(/^2$/.test(label.trim()))return {type:'1x2',outcome:'away'};
    }
    return null;
  }
  // Estimation : consensus du marché (sans marge) ajusté par la forme récente.
  // Sans données de marché, repli sur la cote du bookmaker (marge ~6 % retirée).
  function estimateSelection(item,{teams=null,markets=null,form=null}={}){
    const kind=classifySelection(item,teams);
    const bookOdds=Number(item?.odds)>1?Number(item.odds):null;
    let p=null,source='';
    if(kind&&markets){
      if(kind.type==='1x2'&&markets['1x2']){
        let {home,draw,away}=markets['1x2'];
        if(form&&Number.isFinite(home)&&Number.isFinite(away)){
          const delta=(formPoints(form.home)-formPoints(form.away))/15; // -1..1
          home=Math.max(0.01,home+0.04*delta);away=Math.max(0.01,away-0.04*delta);
          const t=home+(draw||0)+away;home/=t;away/=t;draw=(draw||0)/t;
        }
        p={home,draw,away}[kind.outcome];source=form?'cotes du marché + forme':'cotes du marché';
      }else if(kind.type==='dc'&&markets.dc)p=markets.dc[kind.outcome],source='cotes du marché';
      else if(kind.type==='dc'&&markets['1x2']){const m=markets['1x2'];p={'1x':m.home+m.draw,'x2':m.draw+m.away,'12':m.home+m.away}[kind.outcome];source='cotes du marché';}
      else if(kind.type==='btts'&&markets.btts)p=markets.btts[kind.outcome],source='cotes du marché';
      else if(kind.type==='goals'&&markets.goals?.[kind.line])p=markets.goals[kind.line][kind.outcome],source='cotes du marché';
    }
    if(!(p>0)&&bookOdds){p=Math.min(0.97,(1/bookOdds)*0.94);source='cote du ticket (marge retirée)';}
    if(!(p>0))return {probability:null,source:'données insuffisantes',kind,value:null};
    p=Math.max(0.01,Math.min(0.99,p));
    return {probability:p,source,kind,value:bookOdds?p*bookOdds-1:null};
  }
  function combineProbabilities(list){
    const ps=list.map(x=>x?.probability).filter(x=>x>0);
    if(!ps.length||ps.length!==list.length)return null;
    return ps.reduce((a,b)=>a*b,1);
  }
  function percent(p){return p===null||p===undefined?'—':(p*100>=10?Math.round(p*100):Math.round(p*1000)/10)+' %';}

  // ------------------------------------------------------------ ESPN « all »
  // Source principale : flux public ESPN, toutes compétitions en une requête
  // (soccer/all/scoreboard), détail des matchs via soccer/all/summary. Sans clé.
  function americanToDecimal(value){
    const n=Number(String(value??'').replace(/[^\d.+-]/g,''));
    if(!Number.isFinite(n)||n===0)return null;
    return n>0?1+n/100:1+100/Math.abs(n);
  }
  function leagueLabel(slug){
    const text=String(slug||'').replace(/^\d{4}(?:-\d{2})?-/,'').replace(/-/g,' ').trim();
    return niceLabel(text.replace(/\b\w/g,c=>c.toUpperCase()),60);
  }
  function espnOddsMarkets(oddsList){
    const o=Array.isArray(oddsList)?oddsList.find(x=>x&&(x.homeTeamOdds||x.moneyline||x.drawOdds))||oddsList[0]:null;
    if(!o)return null;
    const ml=(side)=>americanToDecimal(o.moneyline?.[side]?.close?.odds??o.moneyline?.[side]?.open?.odds??(side==='draw'?o.drawOdds?.moneyLine:o[side+'TeamOdds']?.moneyLine));
    const out={};
    const h=ml('home'),d=ml('draw'),a=ml('away');
    if(h&&d&&a){const t=1/h+1/d+1/a;out['1x2']={home:(1/h)/t,draw:(1/d)/t,away:(1/a)/t};}
    const line=Number(o.overUnder??String(o.total?.over?.close?.line||'').replace(/[^\d.]/g,''));
    const ov=americanToDecimal(o.total?.over?.close?.odds??o.overOdds), un=americanToDecimal(o.total?.under?.close?.odds??o.underOdds);
    if(Number.isFinite(line)&&ov&&un){const t=1/ov+1/un;out.goals={[line]:{over:(1/ov)/t,under:(1/un)/t}};}
    if(out['1x2']){const m=out['1x2'];out.dc={'1x':m.home+m.draw,'x2':m.draw+m.away,'12':m.home+m.away};}
    return Object.keys(out).length?{...out,provider:niceLabel(o.provider?.displayName||o.provider?.name||'',30)}:null;
  }
  function espnDetailKind(d){
    if(d?.shootout)return null;
    if(d?.scoringPlay)return d.ownGoal?'own-goal':d.penaltyKick?'penalty':'goal';
    if(d?.redCard)return 'red-card';
    if(d?.yellowCard)return 'yellow-card';
    if(d?.penaltyKick)return 'penalty-missed';
    return null;
  }
  function espnAllRecord(ev){
    if(!ev||!/^\d{1,12}$/.test(String(ev.id)))return null;
    const comp=ev.competitions?.[0], members=comp?.competitors||[];
    const home=members.find(c=>c.homeAway==='home')||members[0]||{}, away=members.find(c=>c.homeAway==='away')||members[1]||{};
    const name=c=>niceLabel(c?.team?.displayName||c?.team?.name,70);
    if(!name(home)||!name(away))return null;
    const homeId=String(home.team?.id||''), awayId=String(away.team?.id||'');
    const events=(comp?.details||[]).map(d=>{
      const kind=espnDetailKind(d);if(!kind)return null;
      const clock=String(d.clock?.displayValue||'');const m=clock.match(/(\d+)'(?:\+(\d+))?/);
      const player=niceLabel(d.athletesInvolved?.[0]?.displayName,60);
      const team=String(d.team?.id||'');
      return {id:[kind,clock,team,player].join('|'),kind,minute:m?Number(m[1]):null,extra:m&&m[2]?Number(m[2]):0,player,side:team===homeId?'home':team===awayId?'away':''};
    }).filter(Boolean);
    const form=s=>String(s||'').toUpperCase().replace(/[^WDL]/g,'').slice(-5).split('').filter(Boolean);
    return {id:String(ev.id),source:'espn',league:'all',leagueName:leagueLabel(ev.season?.slug),home:name(home),away:name(away),
      homeShort:niceLabel(home.team?.shortDisplayName||home.team?.abbreviation||'',40),awayShort:niceLabel(away.team?.shortDisplayName||away.team?.abbreviation||'',40),
      score:`${home.score??'-'} : ${away.score??'-'}`,status:niceLabel(ev.status?.type?.shortDetail||ev.status?.type?.detail||'',40),
      state:String(ev.status?.type?.state||''),date:ev.date||'',form:{home:form(home.form),away:form(away.form)},
      markets:espnOddsMarkets(comp?.odds),events};
  }
  function espnSummaryData(body){
    const header=body?.header?.competitions?.[0]?.competitors||[];
    const sideOf=id=>{const c=header.find(x=>String(x.team?.id||x.id)===String(id));return c?.homeAway||'';};
    const incidents=[];
    for(const k of Array.isArray(body?.keyEvents)?body.keyEvents.slice(0,300):[]){
      const t=String(k?.type?.text||k?.type?.type||'');
      let kind=null;
      if(/own goal/i.test(t))kind='own-goal';
      else if(/penalty - scored/i.test(t))kind='penalty';
      else if(/penalty - (?:missed|saved)/i.test(t))kind='penalty-missed';
      else if(/^goal/i.test(t))kind='goal';
      else if(/red card/i.test(t))kind=/second|yellow/i.test(t)?'second-yellow':'red-card';
      else if(/yellow card/i.test(t))kind='yellow-card';
      else if(/\bvar\b/i.test(t))kind='var';
      if(!kind)continue;
      const clock=String(k.clock?.displayValue||'');const m=clock.match(/(\d+)'(?:\+(\d+))?/);
      const player=niceLabel(k.participants?.[0]?.athlete?.displayName||'',60);
      incidents.push({id:String(k.id||[kind,clock,player].join('|')),kind,minute:m?Number(m[1]):null,extra:m&&m[2]?Number(m[2]):0,player,side:sideOf(k.team?.id),detail:kind==='var'?niceLabel(k.text||'',60):''});
    }
    const stats={};
    const map={foulsCommitted:'fouls',wonCorners:'corners',yellowCards:'yellow',redCards:'red',shotsOnTarget:'shotsOnTarget',offsides:'offsides'};
    for(const team of body?.boxscore?.teams||[]){
      const side=team.homeAway||sideOf(team.team?.id);if(side!=='home'&&side!=='away')continue;
      for(const st of team.statistics||[]){
        const key=map[st.name];if(!key)continue;
        const v=Number(st.displayValue);if(!Number.isFinite(v))continue;
        stats[key]=stats[key]||{home:0,away:0,total:0};stats[key][side]=v;
      }
    }
    for(const v of Object.values(stats))v.total=v.home+v.away;
    return {incidents,stats};
  }
  function searchRecords(records,query){
    const q=normalizeTeam(query);
    if(q.length<2)return [];
    return records.filter(r=>[r.home,r.away,r.homeShort,r.awayShort].some(n=>n&&(normalizeTeam(n).includes(q)||teamSimilarity(n,query)>=0.85)))
      .sort((a,b)=>(b.state==='in')-(a.state==='in')).slice(0,30);
  }

  return { americanToDecimal, leagueLabel, espnOddsMarkets, espnAllRecord, espnSummaryData, searchRecords, parseBetslipText, fractionalToDecimal, marketProbabilities, formPoints, classifySelection, estimateSelection, combineProbabilities, percent, validSofaId, sofaRecord, sofaIncidents, sofaStatistics, statChanges, liveEventText, STAT_LABELS, parseFixtureTeams, teamSimilarity, bestFixtureMatch, isBetConfirmation, parsePlacedTicketText, scoreFromFixture, scoreChange, ESPN_LEAGUES, allowedEspnLeague, normalizeTeam, espnRecord, publicEventText, searchPublicMatches, detectBookmaker, parseOdds, impliedProbability, combinedImplied,
    niceLabel, extractOddsAndLabel, eventKind, eventText, eventId, foulCount,
    validFixtureId, matchingFixtures };
});
