'use strict';
// DevGitShield: Chromium-session ad blocker using the Ghostery filter engine.
// This is not a redistribution of the uBlock Origin extension. Network and
// cosmetic filters follow the EasyList/uBlock filter syntax.
const fs = require('node:fs');
const path = require('node:path');

const FILTER_SOURCES = Object.freeze([
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
  'https://ublockorigin.github.io/uAssets/filters/annoyances.txt',
  'https://ublockorigin.github.io/uAssets/filters/badware.txt',
  'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
  'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
  'https://easylist-downloads.adblockplus.org/liste_fr.txt'
]);
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
  '||google-analytics.com^', '||analytics.twitter.com^'
].join('\n');
const MAX_CACHE_BYTES = 40 * 1024 * 1024;
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 18_000;

function assertEnabled(value) {
  if (typeof value !== 'boolean') throw new Error('État du bloqueur de publicités invalide.');
  return value;
}
function validateCachePath(dataFolder) {
  return path.join(dataFolder, 'devgitshield-filters.bin');
}
function publicStatus(service) {
  return {
    enabled:service.enabled,
    ready:Boolean(service.engine),
    quality:service.quality,
    updating:Boolean(service.updatePromise),
    lastUpdated:service.lastUpdated || null,
    error:service.error || '',
    scope:'chromium'
  };
}
class AdBlockService {
  constructor({webSession,dataFolder,enabled=true,onState=()=>{},Engine,fetcher=globalThis.fetch,clock=()=>Date.now()}) {
    if (!webSession) throw new Error('Session Chromium manquante.');
    this.webSession=webSession;
    this.dataFolder=dataFolder;
    this.enabled=assertEnabled(enabled);
    this.Engine=Engine;
    this.fetcher=fetcher;
    this.clock=clock;
    this.onState=onState;
    this.engine=null;
    this.quality='initialisation';
    this.lastUpdated=null;
    this.error='';
    this.updatePromise=null;
  }
  state() { return publicStatus(this); }
  notify() { try { this.onState(this.state()); } catch {} }
  replace(next,quality) {
    // Ghostery owns the onBeforeRequest/onHeadersReceived and cosmetic IPC
    // handlers for one session. Always remove the old context before swapping.
    const previous=this.engine;
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
      const file=validateCachePath(this.dataFolder);
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
      this.replace(this.Engine.parse(OFFLINE_FILTERS),'protection de base hors ligne');
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
  refresh() {
    if(this.updatePromise) return this.updatePromise;
    const run=async()=>{
      if(typeof this.fetcher!=='function') throw new Error('Téléchargement de listes indisponible.');
      // Every remote list is independent. Fail closed to existing rules when
      // a host is unavailable: never replace working full lists with a partial set.
      const guardedFetch=async (url,...args)=>{
        const validated=new URL(String(url));
        if(validated.protocol!=='https:') throw new Error('Les listes doivent utiliser HTTPS.');
        const controller=new AbortController();
        const timeout=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
        try {
          const response=await this.fetcher(validated.href,{...args[0],signal:controller.signal});
          if(!response.ok) throw new Error('Échec du téléchargement de filtres ('+response.status+').');
          return response;
        } finally {clearTimeout(timeout);}
      };
      const newer=await this.Engine.fromLists(guardedFetch,FILTER_SOURCES,{loadNetworkFilters:true,loadCosmeticFilters:true,enableMutationObserver:true});
      const bytes=Buffer.from(newer.serialize());
      if(bytes.length===0 || bytes.length>MAX_CACHE_BYTES) throw new Error('Taille du cache de filtres invalide.');
      // A successfully fetched engine replaces the previous one atomically.
      this.replace(newer,'mode maximal · publicités, traceurs et nuisances');
      fs.mkdirSync(this.dataFolder,{recursive:true,mode:0o700});
      const filename=validateCachePath(this.dataFolder);
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
module.exports={AdBlockService,FILTER_SOURCES,OFFLINE_FILTERS,assertEnabled,validateCachePath,publicStatus};
