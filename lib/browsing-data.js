'use strict';
// Historique de navigation et favoris, stockés localement dans le profil
// Windows de l'utilisateur (userData). Aucune synchronisation externe.
const {isWebUrl} = require('./validation');

const HISTORY_LIMIT = 5000;
const BOOKMARK_LIMIT = 1000;
const TITLE_LIMIT = 160;

function cleanTitle(value, fallback='') {
  const text=String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,TITLE_LIMIT);
  return text || fallback;
}
function cleanUrl(value) {
  if(typeof value!=='string' || value.length>2048 || !isWebUrl(value)) return '';
  try { const u=new URL(value); u.hash=u.hash.length>200?'':u.hash; return u.href; } catch { return ''; }
}
function hostLabel(url) { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return url; } }
function normalizeQuery(q) { return String(q||'').toLocaleLowerCase('fr-FR').normalize('NFD').replace(/[̀-ͯ]/g,'').trim().slice(0,200); }
function haystack(entry) { return normalizeQuery(entry.title+' '+entry.url); }

class BrowsingData {
  constructor({read=()=>null, write=()=>{}, now=()=>Date.now(), debounceMs=1500}={}) {
    this.read=read; this.write=write; this.now=now; this.debounceMs=debounceMs;
    this.history=[]; this.bookmarks=[]; this.timer=null; this.dirty=false;
    this.load();
  }
  load() {
    let raw=null;
    try { raw=this.read(); } catch { raw=null; }
    const data=raw && typeof raw==='object' ? raw : {};
    const seen=new Set();
    this.history=(Array.isArray(data.history)?data.history:[]).map(e=>({
      url:cleanUrl(e?.url), title:cleanTitle(e?.title), visitedAt:Number(e?.visitedAt)||0, visits:Math.max(1,Math.min(1e6,Number(e?.visits)||1))
    })).filter(e=>e.url && e.visitedAt>0 && !seen.has(e.url) && seen.add(e.url)).sort((a,b)=>b.visitedAt-a.visitedAt).slice(0,HISTORY_LIMIT);
    const ids=new Set();
    this.bookmarks=(Array.isArray(data.bookmarks)?data.bookmarks:[]).map(b=>({
      id:String(b?.id||'').slice(0,40), url:cleanUrl(b?.url), title:cleanTitle(b?.title), createdAt:Number(b?.createdAt)||0
    })).filter(b=>b.url && /^[a-z0-9-]{4,40}$/i.test(b.id) && !ids.has(b.id) && ids.add(b.id)).slice(0,BOOKMARK_LIMIT);
    for(const b of this.bookmarks) if(!b.title) b.title=hostLabel(b.url);
  }
  snapshot() { return {version:1, history:this.history, bookmarks:this.bookmarks}; }
  scheduleSave() {
    this.dirty=true;
    if(this.timer) return;
    this.timer=setTimeout(()=>this.flush(),this.debounceMs);
    this.timer.unref?.();
  }
  flush() {
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(!this.dirty) return;
    this.dirty=false;
    try { this.write(this.snapshot()); } catch {}
  }
  // ---- Historique
  record(url, title='') {
    const clean=cleanUrl(url);
    if(!clean) return null;
    const index=this.history.findIndex(e=>e.url===clean);
    const previous=index>=0?this.history.splice(index,1)[0]:null;
    const entry={url:clean,title:cleanTitle(title,previous?.title||hostLabel(clean)),visitedAt:this.now(),visits:(previous?.visits||0)+1};
    this.history.unshift(entry);
    if(this.history.length>HISTORY_LIMIT) this.history.length=HISTORY_LIMIT;
    this.scheduleSave();
    return entry;
  }
  updateTitle(url, title) {
    const clean=cleanUrl(url), text=cleanTitle(title);
    if(!clean || !text) return;
    const entry=this.history.find(e=>e.url===clean);
    if(entry && entry.title!==text){entry.title=text;this.scheduleSave();}
  }
  listHistory({query='', limit=200, offset=0}={}) {
    const q=normalizeQuery(query);
    const items=q?this.history.filter(e=>haystack(e).includes(q)):this.history;
    const start=Math.max(0,Number(offset)||0), size=Math.max(1,Math.min(500,Number(limit)||200));
    return {total:items.length, items:items.slice(start,start+size)};
  }
  removeHistory(url) {
    const before=this.history.length;
    this.history=this.history.filter(e=>e.url!==url);
    if(this.history.length!==before) this.scheduleSave();
  }
  clearHistory(sinceMs=0) {
    const limit=Number(sinceMs)>0 ? this.now()-Number(sinceMs) : 0;
    this.history=limit?this.history.filter(e=>e.visitedAt<limit):[];
    this.scheduleSave();
  }
  // ---- Favoris
  isBookmarked(url) { const clean=cleanUrl(url); return Boolean(clean && this.bookmarks.some(b=>b.url===clean)); }
  addBookmark(url, title='', id=null) {
    const clean=cleanUrl(url);
    if(!clean) throw new Error('Seules les pages web http(s) peuvent être ajoutées aux favoris.');
    const existing=this.bookmarks.find(b=>b.url===clean);
    if(existing) return existing;
    if(this.bookmarks.length>=BOOKMARK_LIMIT) throw new Error(`Maximum de ${BOOKMARK_LIMIT} favoris.`);
    const bookmark={id:id||('b'+this.now().toString(36)+Math.random().toString(36).slice(2,8)),url:clean,title:cleanTitle(title,hostLabel(clean)),createdAt:this.now()};
    this.bookmarks.push(bookmark);this.scheduleSave();
    return bookmark;
  }
  removeBookmark(idOrUrl) {
    const before=this.bookmarks.length;
    this.bookmarks=this.bookmarks.filter(b=>b.id!==idOrUrl && b.url!==idOrUrl);
    if(before!==this.bookmarks.length) this.scheduleSave();
    return before!==this.bookmarks.length;
  }
  toggleBookmark(url, title='') {
    const clean=cleanUrl(url);
    if(this.isBookmarked(clean)){this.removeBookmark(clean);return false;}
    this.addBookmark(clean,title);return true;
  }
  renameBookmark(id, title) {
    const b=this.bookmarks.find(x=>x.id===id);
    if(!b) throw new Error('Favori introuvable.');
    b.title=cleanTitle(title,hostLabel(b.url));this.scheduleSave();return b;
  }
  moveBookmark(id, index) {
    const from=this.bookmarks.findIndex(x=>x.id===id);
    if(from<0) return;
    const [item]=this.bookmarks.splice(from,1);
    const to=Math.max(0,Math.min(this.bookmarks.length,Number(index)||0));
    this.bookmarks.splice(to,0,item);this.scheduleSave();
  }
  // ---- Suggestions de la barre d'adresse : favoris d'abord, puis historique
  suggestions(query, limit=8) {
    const q=normalizeQuery(query);
    if(q.length<1) return [];
    const out=[];const seen=new Set();
    const push=(entry,kind)=>{if(out.length<limit && !seen.has(entry.url)){seen.add(entry.url);out.push({url:entry.url,title:entry.title,kind});}};
    for(const b of this.bookmarks) if(haystack(b).includes(q)) push(b,'favori');
    const ranked=this.history.filter(e=>haystack(e).includes(q))
      .sort((a,b)=>(normalizeQuery(b.url).replace(/^https?:\/\/(www\.)?/,'').startsWith(q)-normalizeQuery(a.url).replace(/^https?:\/\/(www\.)?/,'').startsWith(q)) || (b.visits-a.visits) || (b.visitedAt-a.visitedAt));
    for(const e of ranked) push(e,'historique');
    return out;
  }
  topSites(limit=8) {
    const byHost=new Map();
    for(const e of this.history){
      const host=hostLabel(e.url);
      const prev=byHost.get(host);
      if(!prev) byHost.set(host,{url:e.url,title:e.title,visits:e.visits});
      else prev.visits+=e.visits;
    }
    return [...byHost.values()].sort((a,b)=>b.visits-a.visits).slice(0,limit).map(({url,title})=>({url,title}));
  }
}
module.exports={BrowsingData,cleanUrl,cleanTitle,hostLabel,HISTORY_LIMIT,BOOKMARK_LIMIT};
