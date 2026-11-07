'use strict';
const {validateLegacyTarget}=require('./legacy');
// Deliberately do not enable the obsolete IE engine for arbitrary websites.
// A user must explicitly trust an origin once by clicking the IE control.
const MODERN_VIDEO_HOSTS=['babelvisio.com','monvisio.com'];
// Only this legacy chat site uses the dedicated 32-bit COM host. The regular IE host stays x64.
function needs32BitActiveX(url){try{const h=new URL(url).hostname.toLowerCase();return h==='monvisiocam.com'||h.endsWith('.monvisiocam.com');}catch{return false;}}
function legacyHostFilename(url){return needs32BitActiveX(url)?'DevGitLegacyHost32.exe':'DevGitLegacyHost.exe';}
function requiresModernVideo(url){try{const h=new URL(url).hostname.toLowerCase();return MODERN_VIDEO_HOSTS.some(x=>h===x||h.endsWith('.'+x));}catch{return false;}}
const strongHint=(hints=[])=>Array.isArray(hints)&&hints.some(h=>/ActiveX|VBScript|Script lié à Internet Explorer/i.test(String(h)));
function originOf(url){try{return new URL(validateLegacyTarget(url)).origin;}catch{return '';}}
function shouldAutoEmbed({url, hints, trustedOrigins, platform='win32'}){
  const origin=originOf(url);
  if(!origin||platform!=='win32'||!trustedOrigins||trustedOrigins[origin]!==true)return false;
  if(requiresModernVideo(url))return false;
  // The site was approved explicitly once. Reopen directly in IE for this origin on future visits.
  return true;
}
function encodeCommand(command,payload=''){
  if(!/^(?:NAV|RELOAD|BACK|FORWARD|PRINT|BOUNDS|SHOW|HIDE|TESTPOPUP|QUIT)$/.test(command))throw new Error('Commande du moteur ancien invalide.');
  return command+'\t'+Buffer.from(String(payload),'utf8').toString('base64')+'\n';
}
function decodeEvent(line){
  if(typeof line!=='string'||line.length>12000)return null;
  const at=line.indexOf('\t');if(at===-1)return null;
  const event=line.slice(0,at);
  if(!/^(ATTACHED|READY|DISPLAY|URL|TITLE|READYURL|ERROR|CLOSED|EXTERNAL|MODE|INCOMPATIBLE|POPUP|POPUPCLOSED|POPUPREADY|POPUPBLOCKED|HOSTARCH|PLUGIN)$/.test(event))return null;
  try{return {event,value:Buffer.from(line.slice(at+1),'base64').toString('utf8')};}catch{return null;}
}
function preserveIEInSession(target){
  try {return Boolean(originOf(target)) && !requiresModernVideo(target);}
  catch {return false;}
}
module.exports={strongHint,originOf,shouldAutoEmbed,encodeCommand,decodeEvent,requiresModernVideo,preserveIEInSession,needs32BitActiveX,legacyHostFilename};
