'use strict';
// Ephemeral in-memory CDP inspector. No traffic capture unless the user opens it.
const LIMIT = 400;
const BODY_LIMIT = 48 * 1024;
const MASK = '[MASQUÉ]';
const SENSITIVE = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const QUERY_SENSITIVE = /^(?:token|access_token|refresh_token|id_token|api_key|apikey|key|password|passwd|secret|code|session|auth|signature)$/i;
function redactUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:','https:','ws:','wss:'].includes(url.protocol)) return '(ressource locale)';
    for(const [key] of url.searchParams) if(QUERY_SENSITIVE.test(key)) url.searchParams.set(key,MASK);
    url.username='';url.password='';url.hash='';
    return url.toString().slice(0,1800);
  } catch { return '(adresse inconnue)'; }
}
function redactHeaders(headers) {
  const output = {};
  for(const [key,val] of Object.entries(headers||{}).slice(0,70)) {
    output[key]= SENSITIVE.test(key) ? MASK : String(val).slice(0,1300);
  }
  return output;
}
function redactBody(body) {
  return String(body || '').slice(0,BODY_LIMIT)
    .replace(/(["']?(?:access_token|refresh_token|id_token|authorization|password|passwd|secret|api_key|token|session)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1'+MASK)
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'$1'+MASK)
    .replace(/(-----BEGIN [A-Z ]+PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]+PRIVATE KEY-----)/g, '$1'+MASK+'$2');
}
function isReadableMime(mime) {return /^(text\/|application\/(?:json|ld\+json|javascript|xml|x-www-form-urlencoded)|image\/svg\+xml)/i.test(mime || '');}
function cleanNumber(n){return Number.isFinite(n)?Math.round(n):null;}
class NetworkMonitor {
  constructor(emit){ this.emit=emit;this.entries=new Map();this.wc=null;this.listener=null;this.detachListener=null;this.seq=0;this.status='En attente'; }
  message(msg){try{this.emit(msg);}catch{}}
  stop(){
    if(this.wc&&!this.wc.isDestroyed()) {
      if(this.listener)this.wc.debugger.removeListener('message',this.listener);
      if(this.detachListener)this.wc.debugger.removeListener('detach',this.detachListener);
      if(this.wc.debugger.isAttached())try{this.wc.debugger.detach();}catch{}
    }
    this.wc=null;this.listener=null;this.detachListener=null;
  }
  start(wc){
    this.stop();this.entries.clear();this.seq=0;this.message({kind:'reset'});
    if(!wc||wc.isDestroyed()){this.status='Aucun onglet web actif';this.message({kind:'status',value:this.status});return;}
    this.wc=wc;
    try{wc.debugger.attach('1.3');}catch(err){this.status='Moniteur indisponible : '+(err.message||err);this.message({kind:'status',value:this.status});return;}
    this.listener=(_event,method,params)=>this.onMessage(method,params);
    this.detachListener=(_event,reason)=>{this.status='Capture interrompue : '+reason;this.message({kind:'status',value:this.status});};
    wc.debugger.on('message',this.listener);wc.debugger.on('detach',this.detachListener);
    this.status='Capture active (uniquement cet onglet)';this.message({kind:'status',value:this.status});
    wc.debugger.sendCommand('Network.enable',{maxTotalBufferSize:8_000_000,maxResourceBufferSize:500_000}).catch(e=>this.message({kind:'status',value:String(e.message||e)}));
  }
  add(id,patch){
    const prev=this.entries.get(id) || {id,order:++this.seq};
    const next={...prev,...patch};this.entries.set(id,next);
    while(this.entries.size>LIMIT)this.entries.delete(this.entries.keys().next().value);
    this.message({kind:'entry',entry:next});
  }
  onMessage(method,p={}){
    const id=String(p.requestId||'');if(!id)return;
    if(method==='Network.requestWillBeSent') {
      this.add(id,{method:p.request?.method||'GET',url:redactUrl(p.request?.url),type:p.type||'',status:null,requestHeaders:redactHeaders(p.request?.headers),responseHeaders:{},started:Date.now(),duration:null,size:null,mime:'',error:'',finished:false});
    } else if(method==='Network.responseReceived') {
      this.add(id,{status:cleanNumber(p.response?.status),mime:String(p.response?.mimeType||'').slice(0,90),type:p.type||'',responseHeaders:redactHeaders(p.response?.headers),fromCache:!!p.response?.fromDiskCache});
    } else if(method==='Network.loadingFinished') {
      const existing=this.entries.get(id);if(existing)this.add(id,{finished:true,duration:Date.now()-(existing.started||Date.now()),size:cleanNumber(p.encodedDataLength)});
    } else if(method==='Network.loadingFailed') {
      this.add(id,{finished:true,error:String(p.errorText||'Interrompue').slice(0,180)});
    } else if(method==='Network.webSocketCreated') {
      this.add(id,{method:'WS',url:redactUrl(p.url),type:'WebSocket',started:Date.now(),status:101,responseHeaders:{},requestHeaders:{},mime:'websocket',finished:false});
    } else if(method==='Network.webSocketClosed') {
      this.add(id,{finished:true});
    }
  }
  clear(){this.entries.clear();this.seq=0;this.message({kind:'reset'});}
  async body(id){
    const entry=this.entries.get(String(id));
    if(!entry||!this.wc||this.wc.isDestroyed()||!this.wc.debugger.isAttached())throw new Error('Requête indisponible.');
    if(!entry.finished||entry.error)throw new Error('La réponse n’est pas encore terminée.');
    if(!isReadableMime(entry.mime))throw new Error('Réponse binaire ou média : aperçu désactivé.');
    const response=await this.wc.debugger.sendCommand('Network.getResponseBody',{requestId:entry.id});
    if(response.base64Encoded)throw new Error('Réponse binaire non affichée.');
    return {text:redactBody(response.body),truncated:(response.body?.length||0)>BODY_LIMIT};
  }
}
module.exports={NetworkMonitor,redactHeaders,redactUrl,redactBody,isReadableMime};
