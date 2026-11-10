'use strict';
// DevGitShield: Chromium-session ad blocker using the Ghostery filter engine.
// This is not a redistribution of the uBlock Origin extension. Network and
// cosmetic filters follow the EasyList/uBlock filter syntax.
const fs = require('node:fs');
const path = require('node:path');
const {earlyMainWorldScripts, earlyCss} = require('./shield-scripts');

const GHOSTERY = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets';
const UASSETS = 'https://ublockorigin.github.io/uAssets/filters';
// Each list has an official source and, where it exists, the mirror maintained
// by the Ghostery project. One unreachable host must never drop the whole set.
const FILTER_LISTS = Object.freeze([
  {id:'easylist', required:true, urls:['https://easylist.to/easylist/easylist.txt', `${GHOSTERY}/easylist/easylist.txt`]},
  {id:'easyprivacy', urls:['https://easylist.to/easylist/easyprivacy.txt', `${GHOSTERY}/easylist/easyprivacy.txt`]},
  {id:'ubo-filters', required:true, urls:[`${UASSETS}/filters.txt`, `${GHOSTERY}/ublock-origin/filters.txt`]},
  ...['2020','2021','2022','2023','2024','2025','2026'].map(year=>({id:`ubo-filters-${year}`, urls:[`${UASSETS}/filters-${year}.txt`, `${GHOSTERY}/ublock-origin/filters-${year}.txt`]})),
  {id:'ubo-quick-fixes', urls:[`${UASSETS}/quick-fixes.txt`, `${GHOSTERY}/ublock-origin/quick-fixes.txt`]},
  {id:'ubo-unbreak', urls:[`${UASSETS}/unbreak.txt`, `${GHOSTERY}/ublock-origin/unbreak.txt`]},
  {id:'ubo-privacy', urls:[`${UASSETS}/privacy.txt`, `${GHOSTERY}/ublock-origin/privacy.txt`]},
  {id:'ubo-badware', urls:[`${UASSETS}/badware.txt`, `${GHOSTERY}/ublock-origin/badware.txt`]},
  {id:'ubo-resource-abuse', urls:[`${UASSETS}/resource-abuse.txt`, `${GHOSTERY}/ublock-origin/resource-abuse.txt`]},
  // Listes « anti-nuisances » : utiles mais connues pour casser certains sites
  // (menus, formulaires, lecteurs). Désactivées par défaut, comme dans uBlock Origin.
  {id:'ubo-annoyances-others', optional:'annoyances', urls:[`${UASSETS}/annoyances-others.txt`, `${GHOSTERY}/ublock-origin/annoyances-others.txt`]},
  {id:'ubo-annoyances-cookies', optional:'annoyances', urls:[`${UASSETS}/annoyances-cookies.txt`, `${GHOSTERY}/ublock-origin/annoyances-cookies.txt`]},
  {id:'peter-lowe', urls:[`${GHOSTERY}/peter-lowe/serverlist.txt`]},
  {id:'easylist-france', urls:['https://easylist-downloads.adblockplus.org/liste_fr.txt']}
]);
const FILTER_SOURCES = Object.freeze(FILTER_LISTS.map(list=>list.urls[0]));
const RESOURCES_URL = `${GHOSTERY}/ublock-origin/resources.json`;
// A small offline safety net until the real full-sized lists have been
// downloaded. These are URL filters, NOT page/document blocking policies.
const OFFLINE_FILTERS = [
  '! DevGitShield - minimal offline fallback. Full lists load on first connection.',
  '||doubleclick.net^', '||googlesyndication.com^', '||googleadservices.com^',
  '||adservice.google.com^', '||amazon-adsystem.com^', '||taboola.com^',
  '||outbrain.com^', '||adnxs.com^', '||adsrvr.org^', '||criteo.com^',
  '||criteo.net^', '||pubmatic.com^', '||openx.net^', '||rubiconproject.com^',
  '||smartadserver.com^', '||scorecardresearch.com^', '||quantserve.com^',
  '||moatads.com^', '||yieldmo.com^', '||zedo.com^', '||3lift.com^',
  '||smaato.net^', '||serving-sys.com^', '||adform.net^',
  '||casalemedia.com^', '||bidswitch.net^', '||sharethrough.com^',
  '||advertising.com^', '||contextweb.com^', '||teads.tv^',
  '||google-analytics.com^', '||analytics.twitter.com^',
  '||youtube.com/pagead/', '||youtube.com/api/stats/ads', '||youtube.com/ptracking',
  '||googlevideo.com/initplayback?*&oad=', '||imasdk.googleapis.com^',
  '||twitch.tv/r/s/', '||amazon-adsystem.com^', '||pubads.g.doubleclick.net^',
  'youtube.com##ytd-ad-slot-renderer', 'youtube.com###player-ads', 'youtube.com###masthead-ad',
  'youtube.com##ytd-in-feed-ad-layout-renderer', 'youtube.com##ytd-banner-promo-renderer'
].join('\n');
const MAX_CACHE_BYTES = 60 * 1024 * 1024;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;
const ENGINE_OPTIONS = Object.freeze({loadNetworkFilters:true,loadCosmeticFilters:true,enableMutationObserver:true,loadExtendedSelectors:true,guessRequestTypeFromUrl:false});
// Le type de requête est fourni par Chromium : le « deviner » depuis l'URL
// classait mal des scripts et images et bloquait des sites entiers.

function assertEnabled(value) {
  if (typeof value !== 'boolean') throw new Error('État du bloqueur de publicités invalide.');
  return value;
}
function validateCachePath(dataFolder, annoyances = false) {
  return path.join(dataFolder, annoyances ? 'devgitshield-filters-v3-plus.bin' : 'devgitshield-filters-v3.bin');
}
function normalizeHost(value) {
  const text=String(value||'').trim().toLowerCase().replace(/^www\./,'').replace(/\.$/,'');
  return /^[a-z0-9.-]{1,253}$/.test(text) && text.includes('.') && !text.includes('..') ? text : '';
}
function hostOf(url) {
  try { return normalizeHost(new URL(url).hostname); } catch { return ''; }
}
function allowlisted(hostname, list) {
  const host=normalizeHost(hostname);
  if(!host)return false;
  for(const entry of list||[]) if(host===entry || host.endsWith('.'+entry)) return true;
  return false;
}
function publicStatus(service) {
  return {
    enabled:service.enabled,
    ready:Boolean(service.engine),
    quality:service.quality,
    updating:Boolean(service.updatePromise),
    lastUpdated:service.lastUpdated || null,
    error:service.error || '',
    lists:service.listReport,
    annoyances:Boolean(service.annoyances),
    boost:Boolean(service.boost),
    totalBlocked:service.totalBlocked,
    allowlist:[...service.allowlist],
    scope:'chromium'
  };
}
async function fetchText(fetcher, url) {
  const validated=new URL(String(url));
  if(validated.protocol!=='https:') throw new Error('Les listes doivent utiliser HTTPS.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
  try {
    const response=await fetcher(validated.href,{signal:controller.signal,cache:'no-store'});
    if(!response.ok) {
      // Toujours libérer le corps d'une réponse en erreur (connexion réutilisable).
      try { await response.body?.cancel?.(); } catch {}
      throw new Error('HTTP '+response.status);
    }
    const text=await response.text();
    if(!text || text.length<40) throw new Error('liste vide');
    if(/^\s*<(?:!doctype|html)/i.test(text)) throw new Error('page HTML reçue au lieu d’une liste');
    return text;
  } finally { clearTimeout(timeout); }
}
async function fetchFirst(fetcher, urls) {
  let last;
  for(const url of urls) {
    try { return {text:await fetchText(fetcher,url),url}; }
    catch(err) { last=err; }
  }
  throw last||new Error('source indisponible');
}

class AdBlockService {
  constructor({webSession,dataFolder,enabled=true,allowlist=[],onState=()=>{},Engine,fetcher=globalThis.fetch,clock=()=>Date.now(),resolveTopUrl=()=>'',annoyances=false,boost=false}) {
    if (!webSession) throw new Error('Session Chromium manquante.');
    this.webSession=webSession;
    this.extraSessions=new Set();
    this.annoyances=Boolean(annoyances);
    this.boost=Boolean(boost);
    this.dataFolder=dataFolder;
    this.enabled=assertEnabled(enabled);
    this.Engine=Engine;
    this.fetcher=fetcher;
    this.clock=clock;
    this.onState=onState;
    this.resolveTopUrl=resolveTopUrl;
    this.engine=null;
    this.quality='initialisation';
    this.lastUpdated=null;
    this.error='';
    this.updatePromise=null;
    this.listReport={loaded:0,total:this.activeLists().length,failed:[]};
    this.allowlist=new Set((allowlist||[]).map(normalizeHost).filter(Boolean));
    this.blockedByTab=new Map();
    this.totalBlocked=0;
  }
  state() { return publicStatus(this); }
  activeLists() { return FILTER_LISTS.filter(list=>!list.optional || (list.optional==='annoyances' && this.annoyances)); }
  setAnnoyances(value) {
    this.annoyances=Boolean(value);
    this.notify();
    return this.refresh();
  }
  setBoost(value) { this.boost=Boolean(value); this.notify(); }
  // Session supplémentaire (onglets privés). Ghostery ne gère qu'une session
  // par moteur (ses gestionnaires IPC sont globaux) : on branche ici les mêmes
  // gestionnaires réseau, qui suivent automatiquement le moteur actif.
  attachSession(ses) {
    if(!ses || ses===this.webSession || this.extraSessions.has(ses)) return;
    this.extraSessions.add(ses);
    const pass=(details,callback)=>callback({});
    ses.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,callback)=>{
      const engine=this.engine;
      if(!this.enabled || !engine || typeof engine.onBeforeRequest!=='function') return pass(details,callback);
      try { return engine.onBeforeRequest(details,callback); } catch { return pass(details,callback); }
    });
    ses.webRequest.onHeadersReceived({urls:['<all_urls>']},(details,callback)=>{
      const engine=this.engine;
      if(!this.enabled || !engine || typeof engine.onHeadersReceived!=='function') return pass(details,callback);
      try { return engine.onHeadersReceived(details,callback); } catch { return pass(details,callback); }
    });
    try { ses.registerPreloadScript({type:'frame',id:'ghostery-cosmetics',filePath:require('@ghostery/adblocker-electron/dist/commonjs/preload_path.js').PRELOAD_PATH}); } catch {}
  }
  notify() { try { this.onState(this.state()); } catch {} }
  isAllowlisted(url) { return allowlisted(hostOf(url),this.allowlist); }
  setAllowed(host, allowed) {
    const clean=normalizeHost(host);
    if(!clean) throw new Error('Site invalide pour DevGitShield.');
    if(allowed) this.allowlist.add(clean); else this.allowlist.delete(clean);
    this.notify();
    return [...this.allowlist];
  }
  blockedFor(webContentsId) { return this.blockedByTab.get(webContentsId)||0; }
  resetTab(webContentsId) { this.blockedByTab.delete(webContentsId); }
  instrument(engine) {
    // Per-site exceptions and per-tab counters, without registering a second
    // webRequest listener (Electron only keeps one listener per event).
    if(engine.__devgitInstrumented) return engine;
    engine.__devgitInstrumented=true;
    const service=this;
    const originalRequest=engine.onBeforeRequest;
    if(typeof originalRequest==='function') engine.onBeforeRequest=(details,callback)=>{
      try {
        const top=service.resolveTopUrl(details.webContentsId) || details.referrer || '';
        if(service.isAllowlisted(top)) { callback({}); return; }
      } catch {}
      return originalRequest(details,callback);
    };
    const originalHeaders=engine.onHeadersReceived;
    if(typeof originalHeaders==='function') engine.onHeadersReceived=(details,callback)=>{
      try {
        const top=service.resolveTopUrl(details.webContentsId) || details.url || '';
        if(service.isAllowlisted(top)) { callback({}); return; }
      } catch {}
      return originalHeaders(details,callback);
    };
    // Les scriptlets (##+js) sont injectés UNE seule fois, au plus tôt, par le
    // préchargement DevGitShield. Ghostery les injectait une seconde fois après
    // le chargement : exécutés deux fois, ils faisaient planter YouTube et Twitch.
    const originalGetCosmetics=engine.getCosmeticsFilters;
    if(typeof originalGetCosmetics==='function' && !engine.__devgitCosmetics) {
      engine.__devgitCosmetics=originalGetCosmetics.bind(engine);
      engine.getCosmeticsFilters=options=>engine.__devgitCosmetics({...options,getInjectionRules:false});
    }
    const originalCosmetic=engine.onInjectCosmeticFilters;
    if(typeof originalCosmetic==='function') engine.onInjectCosmeticFilters=(event,url,msg)=>{
      if(service.isAllowlisted(url)) return undefined;
      return originalCosmetic(event,url,msg);
    };
    if(typeof engine.on==='function') engine.on('request-blocked',request=>{
      const id=Number(request?.tabId);
      service.totalBlocked++;
      if(Number.isInteger(id) && id>0) service.blockedByTab.set(id,(service.blockedByTab.get(id)||0)+1);
    });
    return engine;
  }
  replace(next,quality) {
    // Ghostery owns the onBeforeRequest/onHeadersReceived and cosmetic IPC
    // handlers for one session. Always remove the old context before swapping.
    const previous=this.engine;
    this.instrument(next);
    if(previous && this.enabled) previous.disableBlockingInSession(this.webSession);
    try {
      if(this.enabled) next.enableBlockingInSession(this.webSession);
      this.engine=next;
      this.quality=quality;
    } catch (err) {
      // Never leave a site with a half-installed network listener.
      try { next.disableBlockingInSession(this.webSession); } catch {}
      this.engine=null;
      if(previous) {
        try { if(this.enabled) previous.enableBlockingInSession(this.webSession); this.engine=previous; }
        catch { this.engine=null; }
      }
      throw err;
    }
    this.notify();
  }
  async start() {
    if (!this.Engine) this.Engine=require('@ghostery/adblocker-electron').ElectronBlocker;
    let cached=false;
    try {
      const file=validateCachePath(this.dataFolder,this.annoyances);
      const stat=fs.statSync(file);
      if(stat.size>0 && stat.size<=MAX_CACHE_BYTES) {
        const buffer=fs.readFileSync(file);
        this.replace(this.Engine.deserialize(new Uint8Array(buffer)),'listes complètes (cache)');
        this.lastUpdated=stat.mtimeMs;
        cached=true;
      }
    } catch(err) {
      // Missing or corrupted cache: immediately enable offline fallback.
      if (err?.code!=='ENOENT') this.error='Cache des filtres indisponible. Rechargement prévu.';
    }
    if(!cached) {
      this.replace(this.Engine.parse(OFFLINE_FILTERS,ENGINE_OPTIONS),'protection de base hors ligne');
    }
    if(!cached || this.clock()-this.lastUpdated>UPDATE_INTERVAL_MS) {
      // First launch is responsive even when filter-list hosts are slow.
      this.refresh().catch(()=>{});
    }
    return this.state();
  }
  setEnabled(value) {
    assertEnabled(value);
    if(this.enabled===value) return this.state();
    if(this.engine) {
      if(value) this.engine.enableBlockingInSession(this.webSession);
      else this.engine.disableBlockingInSession(this.webSession);
    }
    this.enabled=value;
    this.notify();
    return this.state();
  }
  // Scriptlets (uBlock syntax ##+js) must run BEFORE the page's own scripts on
  // YouTube/Twitch. They are returned synchronously to the frame preload.
  earlyScripts(url) {
    if(!this.enabled || !/^https?:/i.test(String(url||'')) || this.isAllowlisted(url)) return {enabled:false,scripts:[],css:''};
    const scripts=[];
    let hostname='';
    try { hostname=new URL(url).hostname; } catch { return {enabled:false,scripts:[],css:''}; }
    const getCosmetics=this.engine && (this.engine.__devgitCosmetics || (typeof this.engine.getCosmeticsFilters==='function' ? this.engine.getCosmeticsFilters.bind(this.engine) : null));
    if(getCosmetics) {
      try {
        let domain=hostname;
        try { domain=require('tldts-experimental').parse(url).domain||hostname; } catch {}
        const result=getCosmetics({url,hostname,domain,getBaseRules:false,getInjectionRules:true,
          getExtendedRules:false,getRulesFromHostname:true,getRulesFromDOM:false});
        if(result?.active!==false) for(const script of result?.scripts||[]) if(typeof script==='string') scripts.push(script);
      } catch {}
    }
    // Protections maison YouTube/Twitch : uniquement en « mode renforcé » (facultatif),
    // car elles modifient le lecteur et peuvent être détectées par le site.
    if(this.boost) scripts.push(...earlyMainWorldScripts(hostname));
    return {enabled:true,scripts:scripts.slice(0,200),css:earlyCss(hostname)};
  }
  refresh() {
    if(this.updatePromise) return this.updatePromise;
    const run=async()=>{
      if(typeof this.fetcher!=='function') throw new Error('Téléchargement de listes indisponible.');
      const lists=this.activeLists();
      const results=await Promise.allSettled(lists.map(list=>fetchFirst(this.fetcher,list.urls)));
      const texts=[];const failed=[];
      results.forEach((result,i)=>{
        if(result.status==='fulfilled') texts.push(result.value.text);
        else failed.push(lists[i].id);
      });
      const missingRequired=lists.filter((list,i)=>list.required && results[i].status!=='fulfilled');
      if(missingRequired.length) throw new Error('Listes principales indisponibles ('+missingRequired.map(x=>x.id).join(', ')+'). Les règles actuelles sont conservées.');
      const newer=this.Engine.parse(texts.join('\n'),ENGINE_OPTIONS);
      try {
        const resources=await fetchText(this.fetcher,RESOURCES_URL);
        newer.updateResources(resources,String(resources.length));
      } catch {
        // Without resources, network filters still work; scriptlets are skipped.
        failed.push('resources');
      }
      const bytes=Buffer.from(newer.serialize());
      if(bytes.length===0 || bytes.length>MAX_CACHE_BYTES) throw new Error('Taille du cache de filtres invalide.');
      // A successfully fetched engine replaces the previous one atomically.
      this.listReport={loaded:texts.length,total:lists.length,failed};
      this.replace(newer,`mode maximal · ${texts.length}/${lists.length} listes · scriptlets ${failed.includes('resources')?'indisponibles':'actifs'}`);
      fs.mkdirSync(this.dataFolder,{recursive:true,mode:0o700});
      const filename=validateCachePath(this.dataFolder,this.annoyances);
      const tmp=filename+'.tmp';
      try {fs.writeFileSync(tmp,bytes,{mode:0o600});fs.renameSync(tmp,filename);}
      finally {try {fs.rmSync(tmp,{force:true});} catch {}}
      this.lastUpdated=this.clock();
      this.error='';
    };
    this.updatePromise=run().catch(err=>{
      this.error=String(err?.message||err).slice(0,180);
    }).finally(()=>{this.updatePromise=null;this.notify();});
    this.notify();
    return this.updatePromise;
  }
}
module.exports={AdBlockService,FILTER_SOURCES,FILTER_LISTS,RESOURCES_URL,OFFLINE_FILTERS,ENGINE_OPTIONS,assertEnabled,validateCachePath,publicStatus,normalizeHost,allowlisted,hostOf};
