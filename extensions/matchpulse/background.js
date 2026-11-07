/* Les données de pari et les cookies ne transitent jamais par ce script. */
(function () {
  'use strict';
  const Core = globalThis.MatchPulseCore;
  const BASE = 'https://v3.football.api-sports.io';
  const PUBLIC_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  const publicCache=new Map();
  const publicPending=new Map();
  let sessionKey = null; // Clé API gardée en mémoire ; jamais écrite sur disque.
  let keyGeneration = 0;
  const cache = new Map();
  const pending = new Map();
  function authorizedSender(sender) {
    try { const u = new URL(sender?.url || ''); return u.protocol === 'https:' && Boolean(Core.detectBookmaker(u.hostname)); }
    catch { return false; }
  }
  function assertDate(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date invalide.');
    if (new Date(date + 'T00:00:00Z').toISOString().slice(0,10) !== date) throw new Error('Date invalide.');
    return date;
  }
  async function getJSON(path, minInterval) {
    if (!sessionKey) throw new Error('Configure une clé personnelle API-Football avant de suivre les matchs.');
    const now = Date.now();
    const entry = cache.get(path);
    if (entry && now - entry.at < minInterval) return entry.value;
    if (pending.has(path)) return pending.get(path);
    const key = sessionKey;
    const generation = keyGeneration;
    const promise = (async () => {
      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch(BASE + path, {
          method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit',
          redirect: 'error', signal: ctrl.signal, headers: { 'x-apisports-key': key }
        });
        if (res.status === 429) throw new Error('Quota API atteint. Réduis le suivi ou consulte ton abonnement.');
        if (!res.ok) throw new Error(`API-Football : erreur HTTP ${res.status}.`);
        const data = await res.json();
        if (data.errors && Object.keys(data.errors).length) throw new Error('API-Football : clé, quota ou paramètres invalides.');
        if (!Array.isArray(data.response)) throw new Error('Réponse du fournisseur non reconnue.');
        if (generation !== keyGeneration) throw new Error('Clé API modifiée pendant la requête.');
        cache.set(path, { at: Date.now(), value: data.response });
        return data.response;
      } catch (e) {
        if (e?.name === 'AbortError') throw new Error('Le fournisseur ne répond pas (délai dépassé).');
        throw e;
      } finally { clearTimeout(abortTimer); }
    })();
    pending.set(path, promise);
    try { return await promise; } finally { pending.delete(path); }
  }
  // Flux ESPN sans clé, non officiel : uniquement les tableaux de scores sportifs publics.
  // Les tickets, cotes, identifiants et cookies des bookmakers ne sont jamais envoyés.
  async function getPublicBoard(league,date,ttl=120000){
    if(!Core.allowedEspnLeague(league))throw new Error('Championnat non autorisé.');
    const day=assertDate(date).replace(/-/g,'');
    const path=league+'/scoreboard?dates='+day;
    const previous=publicCache.get(path);
    if(previous && Date.now()-previous.at<ttl)return previous.events;
    if(publicPending.has(path))return publicPending.get(path);
    const task=(async()=>{
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),11000);
      try{
        const response=await fetch(PUBLIC_BASE+path,{
          method:'GET',mode:'cors',redirect:'error',cache:'no-store',credentials:'omit',signal:ctrl.signal
        });
        if(response.status===429)throw new Error('Source ESPN temporairement limitée.');
        if(!response.ok)throw new Error('Source ESPN indisponible : HTTP '+response.status);
        const body=await response.json();
        if(!Array.isArray(body?.events))throw new Error('Format de données ESPN non reconnu.');
        const records=body.events.slice(0,350).map(e=>Core.espnRecord(e,league)).filter(Boolean);
        publicCache.set(path,{at:Date.now(),events:records});
        if(publicCache.size>50)publicCache.delete(publicCache.keys().next().value);
        return records;
      }catch(e){if(e?.name==='AbortError')throw new Error('ESPN ne répond pas.');throw e;}
      finally{clearTimeout(timer);}
    })();
    publicPending.set(path,task);
    try{return await task;}finally{publicPending.delete(path);}
  }
  async function searchPublic(date,search){
    if(String(search||'').trim().length<2)throw new Error('Nom d’équipe trop court.');
    const results=await Promise.allSettled(Core.ESPN_LEAGUES.map(l=>getPublicBoard(l.id,date,180000)));
    const all=[];let available=0;
    results.forEach(r=>{if(r.status==='fulfilled'){available++;all.push(...r.value);}});
    if(!available)throw new Error('Source ESPN inaccessible : réessaie plus tard ou utilise API-Football.');
    return {items:Core.searchPublicMatches(all,search), partial:available<Core.ESPN_LEAGUES.length,
      source:'public',checkedLeagues:available};
  }

  async function handle(message) {
    if (!message || typeof message !== 'object') throw new Error('Requête non reconnue.');
    switch(message.action) {
      case 'set-key': {
        const key = String(message.value || '').trim();
        if (!/^[a-zA-Z0-9_-]{20,128}$/.test(key)) throw new Error('Clé API invalide (20 à 128 caractères alphanumériques).');
        sessionKey = key;keyGeneration++;cache.clear();return { configured:true };
      }
      case 'clear-key': sessionKey=null;keyGeneration++;cache.clear();return { configured:false };
      case 'status': return { configured:Boolean(sessionKey), publicAvailable:true };
      case 'public-fixtures': return searchPublic(assertDate(message.date),message.search);
      case 'public-events': {
        const fixture=String(message.fixture||'');
        if(!/^\d{1,12}$/.test(fixture))throw new Error('Identifiant ESPN invalide.');
        const board=await getPublicBoard(message.league,assertDate(message.date),115000);
        const match=board.find(x=>x.id===fixture);
        if(!match)throw new Error('Match absent du flux ESPN pour ce championnat ou cette date.');
        return {items:match.events,score:match.score,status:match.status,source:'public',fouls:null};
      }
      case 'fixtures': {
        const date=assertDate(message.date);
        return { items:Core.matchingFixtures(await getJSON('/fixtures?date='+date, 10*60*1000),message.search) };
      }
      case 'events': {
        if (!Core.validFixtureId(message.fixture)) throw new Error('Identifiant de match invalide.');
        return { items:await getJSON('/fixtures/events?fixture='+Number(message.fixture), 90*1000) };
      }
      case 'fouls': {
        if (!Core.validFixtureId(message.fixture)) throw new Error('Identifiant de match invalide.');
        return { total:Core.foulCount(await getJSON('/fixtures/statistics?fixture='+Number(message.fixture), 3*60*1000)) };
      }
      default: throw new Error('Commande API non autorisée.');
    }
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if (!authorizedSender(sender)) {sendResponse({ok:false,error:'Origine de page non autorisée.'});return false;}
    Promise.resolve().then(()=>handle(message)).then(data=>sendResponse({ok:true,data}),
      error=>sendResponse({ok:false,error:String(error?.message||'Erreur fournisseur').slice(0,200)}));
    return true;
  });
})();
