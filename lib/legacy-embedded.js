'use strict';
const {validateLegacyTarget}=require('./legacy');
// Deliberately do not enable the obsolete IE engine for arbitrary websites.
// A user must explicitly trust an origin once by clicking the IE control.
const strongHint=(hints=[])=>Array.isArray(hints)&&hints.some(h=>/ActiveX|VBScript|Script lié à Internet Explorer/i.test(String(h)));
function originOf(url){try{return new URL(validateLegacyTarget(url)).origin;}catch{return '';}}
function shouldAutoEmbed({url, hints, trustedOrigins, platform='win32'}){
  const origin=originOf(url);
  if(!origin||platform!=='win32'||!trustedOrigins||trustedOrigins[origin]!==true)return false;
  if(/(^|\.)babelvisio\.com$/i.test(new URL(url).hostname))return false;
  // The site was approved explicitly once. Reopen directly in IE for this origin on future visits.
  return true;
}
function encodeCommand(command,payload=''){
  if(!/^(?:NAV|RELOAD|BACK|FORWARD|PRINT|BOUNDS|SHOW|HIDE|QUIT)$/.test(command))throw new Error('Commande du moteur ancien invalide.');
  return command+'\t'+Buffer.from(String(payload),'utf8').toString('base64')+'\n';
}
function decodeEvent(line){
  if(typeof line!=='string'||line.length>12000)return null;
  const at=line.indexOf('\t');if(at===-1)return null;
  const event=line.slice(0,at);
  if(!/^(READY|URL|TITLE|READYURL|ERROR|CLOSED|EXTERNAL)$/.test(event))return null;
  try{return {event,value:Buffer.from(line.slice(at+1),'base64').toString('utf8')};}catch{return null;}
}
module.exports={strongHint,originOf,shouldAutoEmbed,encodeCommand,decodeEvent};
