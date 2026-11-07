'use strict';
// DevGitShield — protections exécutées dans le monde principal de la page,
// AVANT les scripts du site (YouTube, Twitch). Elles complètent les scriptlets
// uBlock Origin chargés depuis les listes : si YouTube ou Twitch modifient
// leur code, les listes mises à jour quotidiennement restent la première ligne.

function isHost(hostname, domain) {
  const h=String(hostname||'').toLowerCase();
  return h===domain || h.endsWith('.'+domain);
}

// ---------------------------------------------------------------- YouTube --
function youtubeShield() {
  if (window.__devgitYouTubeShield) return;
  Object.defineProperty(window,'__devgitYouTubeShield',{value:true});
  const AD_KEYS=['adPlacements','playerAds','adSlots','adBreakHeartbeatParams','adBreakParams','adParams'];
  const prune=obj=>{
    if(!obj || typeof obj!=='object') return obj;
    try {
      for(const key of AD_KEYS) if(Object.prototype.hasOwnProperty.call(obj,key)) delete obj[key];
      if(obj.playerResponse && typeof obj.playerResponse==='object') prune(obj.playerResponse);
      if(obj.playerConfig?.adRequestConfig) delete obj.playerConfig.adRequestConfig;
      if(Array.isArray(obj)) for(const item of obj) if(item && item.playerResponse) prune(item.playerResponse);
    } catch {}
    return obj;
  };
  const looksLikePlayer=obj=>obj && typeof obj==='object' && (AD_KEYS.some(k=>k in obj) || 'playerResponse' in obj);
  // 1. JSON.parse (réponses texte de l'API interne et données intégrées).
  const nativeParse=JSON.parse;
  JSON.parse=new Proxy(nativeParse,{apply(target,thisArg,args){
    const result=Reflect.apply(target,thisArg,args);
    return looksLikePlayer(result)?prune(result):result;
  }});
  // 2. Response.json pour /youtubei/v1/player, next, reel.
  const nativeJson=Response.prototype.json;
  Response.prototype.json=new Proxy(nativeJson,{apply(target,thisArg,args){
    return Reflect.apply(target,thisArg,args).then(result=>{
      try { if(/\/youtubei\/v1\/(?:player|next|reel|get_watch)/.test(thisArg.url||'')) prune(result); } catch {}
      return result;
    });
  }});
  // 3. Données injectées dans la page (var ytInitialPlayerResponse = {...}).
  for(const name of ['ytInitialPlayerResponse','playerResponse']) {
    try {
      let value;
      Object.defineProperty(window,name,{configurable:true,enumerable:true,get(){return value;},set(next){value=prune(next);}});
    } catch {}
  }
  // 4. Filet de sécurité : si une publicité vidéo démarre malgré tout, elle est
  // coupée, accélérée jusqu'à la fin et le bouton « Ignorer » est actionné.
  let adActive=false,savedMuted=false,savedRate=1;
  const skipSelectors='.ytp-skip-ad-button,.ytp-ad-skip-button,.ytp-ad-skip-button-modern,.ytp-ad-skip-button-slot button,.videoAdUiSkipButton,[id^="skip-button"] button,.ytp-ad-overlay-close-button';
  const tick=()=>{
    try {
      const player=document.querySelector('#movie_player,.html5-video-player');
      if(!player) return;
      const video=player.querySelector('video');
      const showing=player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
      if(showing) {
        if(!adActive && video){adActive=true;savedMuted=video.muted;savedRate=video.playbackRate||1;}
        if(video){
          video.muted=true;
          if(Number.isFinite(video.duration) && video.duration>0 && video.currentTime<video.duration-0.1) video.currentTime=video.duration-0.05;
          try{video.playbackRate=16;}catch{}
          if(video.paused) video.play().catch(()=>{});
        }
        for(const button of document.querySelectorAll(skipSelectors)) try{button.click();}catch{}
      } else if(adActive) {
        adActive=false;
        if(video){video.muted=savedMuted;try{video.playbackRate=savedRate;}catch{}}
      }
      // Fenêtre « Les bloqueurs de publicités ne sont pas autorisés ».
      const enforcement=document.querySelector('ytd-enforcement-message-view-model');
      if(enforcement){
        const dialog=enforcement.closest('tp-yt-paper-dialog,ytd-popup-container > *')||enforcement;
        dialog.remove();
        document.querySelector('tp-yt-iron-overlay-backdrop')?.remove();
        if(video && video.paused) video.play().catch(()=>{});
      }
    } catch {}
  };
  setInterval(tick,250);
  const watch=()=>{
    try{new MutationObserver(tick).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});}catch{}
  };
  if(document.documentElement) watch(); else document.addEventListener('readystatechange',watch,{once:true});
}

// ----------------------------------------------------------------- Twitch --
// Twitch insère les publicités directement dans le flux HLS (SSAI) : un filtre
// d'URL ne suffit pas. Le lecteur tourne dans un Worker ; on intercepte ses
// playlists .m3u8. Pendant une coupure, une variante sans publicité est
// demandée (types de lecteur « embed », « popout », « autoplay ») ; sinon les
// segments publicitaires sont retirés de la playlist.
function twitchWorkerHook() {
  if (self.__devgitTwitchHook) return;
  self.__devgitTwitchHook=true;
  const realFetch=self.fetch.bind(self);
  const CLIENT_ID='kimne78kx3ncx6brgo4mv6wki5h1ko';
  const PLAYER_TYPES=['embed','popout','autoplay'];
  const streams=new Map(); // media playlist url -> {channel, resolution}
  const backups=new Map(); // channel|resolution -> {url, type, at}
  const AD_RE=/stitched-ad|twitch-stitched-ad|X-TV-TWITCH-AD|EXT-X-CUE-OUT|EXT-X-SCTE35|"MIDROLL"|"PREROLL"/i;
  const hasAd=text=>AD_RE.test(text) || /#EXTINF:[\d.]+,(?!live)[^\n]+/i.test(text);
  const parseMaster=(text,base)=>{
    const out=[];const lines=text.split('\n');
    for(let i=0;i<lines.length;i++){
      if(!lines[i].startsWith('#EXT-X-STREAM-INF'))continue;
      const resolution=(lines[i].match(/RESOLUTION=(\d+x\d+)/)||[])[1]||'';
      const frame=(lines[i].match(/FRAME-RATE=([\d.]+)/)||[])[1]||'';
      const uri=(lines[i+1]||'').trim();
      if(uri && !uri.startsWith('#')) out.push({resolution,frame,url:new URL(uri,base).href});
    }
    return out;
  };
  const stripAds=text=>{
    const lines=text.split('\n');const out=[];let removed=0;
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(/^#EXT-X-DATERANGE:.*(?:stitched-ad|twitch-ad|CLASS="twitch-)/i.test(line)) continue;
      if(/^#EXTINF:[\d.]+,(?!live)/i.test(line) && !/^#EXTINF:[\d.]+,\s*$/.test(line)){
        i++;removed++;continue; // saute la ligne d'URI du segment publicitaire
      }
      out.push(line);
    }
    return removed?out.join('\n'):text;
  };
  async function accessToken(channel,playerType){
    const body={operationName:'PlaybackAccessToken_Template',
      query:'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) { value signature __typename } videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) { value signature __typename } }',
      variables:{isLive:true,login:channel,isVod:false,vodID:'',playerType}};
    const res=await realFetch('https://gql.twitch.tv/gql',{method:'POST',headers:{'Client-ID':CLIENT_ID,'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(body)});
    if(!res.ok)throw new Error('gql '+res.status);
    const data=await res.json();
    const token=data?.data?.streamPlaybackAccessToken;
    if(!token?.value||!token?.signature)throw new Error('token');
    return token;
  }
  async function backupPlaylist(channel,resolution){
    const key=channel+'|'+resolution;
    const cached=backups.get(key);
    const tryUrl=async url=>{const r=await realFetch(url);if(!r.ok)return null;const t=await r.text();return hasAd(t)?null:t;};
    if(cached && Date.now()-cached.at<60000){const t=await tryUrl(cached.url).catch(()=>null);if(t)return t;}
    for(const type of PLAYER_TYPES){
      try{
        const token=await accessToken(channel,type);
        const usher=new URL('https://usher.ttvnw.net/api/channel/hls/'+encodeURIComponent(channel)+'.m3u8');
        const params={allow_source:'true',fast_bread:'true',p:String(Math.floor(Math.random()*1e7)),player_backend:'mediaplayer',
          playlist_include_framerate:'true',reassignments_supported:'true',supported_codecs:'avc1',sig:token.signature,token:token.value,cdm:'wv'};
        for(const [k,v] of Object.entries(params))usher.searchParams.set(k,v);
        const master=await realFetch(usher.href);if(!master.ok)continue;
        const variants=parseMaster(await master.text(),usher.href);if(!variants.length)continue;
        const target=Number((resolution||'0x0').split('x')[1])||0;
        variants.sort((a,b)=>Math.abs((Number(a.resolution.split('x')[1])||0)-target)-Math.abs((Number(b.resolution.split('x')[1])||0)-target));
        const text=await tryUrl(variants[0].url);
        if(text){backups.set(key,{url:variants[0].url,type,at:Date.now()});return text;}
      }catch{}
    }
    return null;
  }
  self.fetch=async function(input,init){
    const url=typeof input==='string'?input:(input&&input.url)||'';
    if(!/\.m3u8(?:\?|$)/i.test(url) || !/ttvnw\.net|twitch\.tv/i.test(url)) return realFetch(input,init);
    const response=await realFetch(input,init);
    try{
      const usher=url.match(/usher\.ttvnw\.net\/api\/channel\/hls\/([^/.?]+)\.m3u8/i);
      const text=await response.clone().text();
      if(usher){
        const channel=decodeURIComponent(usher[1]).toLowerCase();
        for(const v of parseMaster(text,url))streams.set(v.url.split('?')[0],{channel,resolution:v.resolution});
        return response;
      }
      if(!hasAd(text)) return response;
      const info=streams.get(url.split('?')[0]);
      let replacement=info?await backupPlaylist(info.channel,info.resolution):null;
      if(!replacement) replacement=stripAds(text);
      return new Response(replacement,{status:response.status,statusText:response.statusText,headers:response.headers});
    }catch{return response;}
  };
}
function twitchShield(hookSource) {
  if (window.__devgitTwitchShield) return;
  Object.defineProperty(window,'__devgitTwitchShield',{value:true});
  const NativeWorker=window.Worker;
  if(typeof NativeWorker!=='function') return;
  const prelude='('+hookSource+')();\n';
  class DevGitWorker extends NativeWorker {
    constructor(url,options){
      let target=url;
      try{
        const href=String(url instanceof URL?url.href:url);
        if(!(options&&options.type==='module') && /^(?:blob:|https:\/\/[^/]*(?:twitch\.tv|ttvnw\.net|twitchcdn\.net|amazon-ivs))/i.test(href)){
          const absolute=new URL(href,location.href).href;
          // Twitch révoque souvent l'URL blob juste après la création du Worker :
          // lire son code immédiatement plutôt que de l'importer plus tard.
          let source='';
          if(absolute.startsWith('blob:')){
            try{const xhr=new XMLHttpRequest();xhr.open('GET',absolute,false);xhr.send();if(xhr.status===200||xhr.status===0)source=xhr.responseText||'';}catch{}
          }
          const blob=new Blob([prelude+(source||'importScripts('+JSON.stringify(absolute)+');')],{type:'text/javascript'});
          target=URL.createObjectURL(blob);
        }
      }catch{target=url;}
      super(target,options);
    }
  }
  try{Object.defineProperty(window,'Worker',{configurable:true,writable:true,value:DevGitWorker});}catch{window.Worker=DevGitWorker;}
}

const YOUTUBE_CSS=[
  'ytd-ad-slot-renderer','ytd-in-feed-ad-layout-renderer','ytd-banner-promo-renderer','ytd-statement-banner-renderer',
  'ytd-promoted-sparkles-web-renderer','ytd-promoted-video-renderer','ytd-display-ad-renderer','ytd-compact-promoted-video-renderer',
  'ytd-action-companion-ad-renderer','ytd-player-legacy-desktop-watch-ads-renderer','ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
  '#masthead-ad','#player-ads','#panels > ytd-ads-engagement-panel-content-renderer','.ytd-merch-shelf-renderer','ytd-merch-shelf-renderer',
  'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)','ytd-rich-section-renderer:has(ytd-statement-banner-renderer)',
  '.ytp-ad-overlay-container','.ytp-ad-image-overlay','.ytp-suggested-action-badge','.ytp-featured-product',
  'ytm-promoted-sparkles-web-renderer','ad-slot-renderer','ytm-companion-ad-renderer'
].join(',')+'{display:none!important}';
const TWITCH_CSS=[
  '[data-a-target="video-ad-label"]','[data-test-selector="sad-overlay"]','.stream-display-ad__wrapper','[data-a-target="outstream-ax-overlay"]',
  'div[aria-label="Publicité"]','.top-bar--pbyp','[data-test-selector="ad-banner-default-text"]'
].join(',')+'{display:none!important}';

function earlyMainWorldScripts(hostname) {
  const scripts=[];
  if(isHost(hostname,'youtube.com') || isHost(hostname,'youtube-nocookie.com')) scripts.push(`(${youtubeShield.toString()})();`);
  if(isHost(hostname,'twitch.tv')) scripts.push(`(${twitchShield.toString()})(${JSON.stringify(twitchWorkerHook.toString())});`);
  return scripts;
}
function earlyCss(hostname) {
  if(isHost(hostname,'youtube.com')) return YOUTUBE_CSS;
  if(isHost(hostname,'twitch.tv')) return TWITCH_CSS;
  return '';
}
module.exports={earlyMainWorldScripts,earlyCss,youtubeShield,twitchShield,twitchWorkerHook,isHost};
