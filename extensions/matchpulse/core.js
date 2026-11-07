/* MatchPulse 0.2 — fonctions déterministes partagées, sans dépendance externe. */
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
        if(candidate.length>=2 && candidate.length<=80 && /[A-Za-zÀ-ÿ]/.test(candidate)) {label=candidate;break;}
      }
      let fixture='';
      let odds=null;
      for(let j=i+1;j<Math.min(lines.length,i+9);j++){
        if(j>i+1 && marketPattern.test(lines[j]))break;
        const line=lines[j];
        if(!fixture && scorePattern.test(line) && /[A-Za-zÀ-ÿ]/.test(line)) fixture=niceLabel(line,120);
        const explicit=line.match(/\bcote(?:\s+(?:du pari|s[eé]lection))?\s*[:：]?\s*(\d{1,3}[.,]\d{1,3})\b/i);
        if(explicit)odds=parseOdds(explicit[1]);
      }
      // Ne pas intégrer des libellés isolés hors d'un ticket sportif structuré.
      if(!label || (!fixture && !expected))continue;
      const item={label,market,fixture,odds};
      if(!items.some(s=>s.label===item.label&&s.market===item.market&&s.fixture===item.fixture))items.push(item);
    }
    return {items,expected,complete:expected!==null && items.length===expected};
  }
  const ESPN_LEAGUES=Object.freeze([
    {id:'mex.1',name:'Mexique · Liga MX'}, {id:'arg.1',name:'Argentine · Primera'},
    {id:'bra.1',name:'Brésil · Série A'}, {id:'usa.1',name:'États-Unis · MLS'},
    {id:'eng.1',name:'Angleterre · Premier League'}, {id:'esp.1',name:'Espagne · Liga'},
    {id:'fra.1',name:'France · Ligue 1'}, {id:'ger.1',name:'Allemagne · Bundesliga'},
    {id:'ita.1',name:'Italie · Serie A'}, {id:'uefa.champions',name:'Ligue des champions'}
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

  return { parsePlacedTicketText, ESPN_LEAGUES, allowedEspnLeague, normalizeTeam, espnRecord, publicEventText, searchPublicMatches, detectBookmaker, parseOdds, impliedProbability, combinedImplied,
    niceLabel, extractOddsAndLabel, eventKind, eventText, eventId, foulCount,
    validFixtureId, matchingFixtures };
});
