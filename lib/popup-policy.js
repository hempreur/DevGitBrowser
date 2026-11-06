'use strict';

// All decisions are scoped to exact HTTPS origins; the marketing integration does
// not silently trust unrelated domains, HTTP, or lookalike hostnames.
const MODES = Object.freeze(['allow', 'block']);
const POPUP_LIMITS = Object.freeze({ babelvisioPerMinute: 24, allowedPerMinute: 8, openPerOrigin: 24, openGlobal: 64 });
function parseOrigin(raw) {
  try {
    const u = new URL(raw);
    if (u.origin !== raw) return '';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname))) return '';
    return u.origin;
  } catch { return ''; }
}
function isBabelVisio(raw) {
  const origin = parseOrigin(raw);
  if (!origin) return false;
  const hostname = new URL(origin).hostname;
  return hostname === 'babelvisio.com' || hostname.endsWith('.babelvisio.com');
}
function popupMode(origin, overrides={}) {
  if (!parseOrigin(origin)) return 'block';
  if (Object.hasOwn(overrides,origin) && MODES.includes(overrides[origin])) return overrides[origin];
  return isBabelVisio(origin) ? 'allow' : 'block';
}
function allowedPopupDestination(raw, openerOrigin) {
  if (!parseOrigin(openerOrigin) || typeof raw !== 'string') return false;
  if (raw === 'about:blank') return true; // window.open('', name) is common for video widgets.
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    // Do not grant arbitrary blob/data/javascript/file schemes; a same-origin
    // blob document is a legitimate programmatically generated video window.
    return url.protocol === 'blob:' && url.origin === openerOrigin;
  } catch { return false; }
}
class PopupLimiter {
  constructor(limits=POPUP_LIMITS) { this.limits=limits;this.events=new Map();this.open=new Map(); }
  admit(origin, target, overrides={}, now=Date.now()) {
    if (popupMode(origin,overrides)!=='allow' || !allowedPopupDestination(target,origin)) return false;
    // The automatic BabelVisio exception must not silently become an ad
    // exception for external destinations. Explicit approval removes this
    // restriction, still keeping the per-site rate and window count caps.
    if (isBabelVisio(origin) && !Object.hasOwn(overrides,origin) && /^https?:/i.test(target)) {
      if(!isBabelVisio(new URL(target).origin))return false;
    }
    const records=(this.events.get(origin)||[]).filter(x=>now-x<60000);
    const perMinute=isBabelVisio(origin)?this.limits.babelvisioPerMinute:this.limits.allowedPerMinute;
    const total=[...this.open.values()].reduce((a,b)=>a+b,0);
    if (records.length>=perMinute || (this.open.get(origin)||0)>=this.limits.openPerOrigin || total>=this.limits.openGlobal) {
      this.events.set(origin,records); return false;
    }
    records.push(now);this.events.set(origin,records);
    this.open.set(origin,(this.open.get(origin)||0)+1);
    return true;
  }
  release(origin) { const n=this.open.get(origin)||0; if(n<=1)this.open.delete(origin);else this.open.set(origin,n-1); }
  active(origin) { return this.open.get(origin)||0; }
}
module.exports={parseOrigin,isBabelVisio,popupMode,allowedPopupDestination,PopupLimiter,POPUP_LIMITS};
