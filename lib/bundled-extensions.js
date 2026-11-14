'use strict';
// Built-in extension identities are defined by the publisher, not by user input.
const fs = require('node:fs');
const path = require('node:path');

const BUILTIN_KEYS = Object.freeze(['matchpulse']);
function reservedGitHubKey(key) { return BUILTIN_KEYS.includes(key); }
function bundledDescriptor(applicationRoot, key) {
  if(!reservedGitHubKey(key))throw new Error('Extension officielle inconnue.');
  const directory=path.join(applicationRoot,'extensions',key);
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  if(![2,3].includes(manifest.manifest_version) || typeof manifest.name!=='string' || typeof manifest.version!=='string') {
    throw new Error('Manifeste officiel invalide.');
  }
  const files=[...(manifest.background?.scripts||[])];
  for(const content of manifest.content_scripts||[])files.push(...(content.js||[]),...(content.css||[]));
  for(const file of files) {
    if(typeof file!=='string' || file.startsWith('/') || file.includes('..') || file.includes('\\'))throw new Error('Chemin officiel invalide.');
    const absolute=path.resolve(directory,file);
    if(!absolute.startsWith(path.resolve(directory)+path.sep) || !fs.statSync(absolute).isFile())throw new Error('Ressource officielle manquante.');
  }
  return {key,directory,name:manifest.name,version:manifest.version,hosts:lazyHosts(manifest)};
}
// Démarrage à la demande (2.0) : domaines visés par les scripts de contenu (« *://*.betclic.fr/* » → betclic.fr).
function lazyHosts(manifest) {
  const hosts=new Set();
  for(const content of manifest.content_scripts||[])for(const pattern of content.matches||[]){
    const m=String(pattern).match(/^(?:\*|https?):\/\/(?:\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\/\*$/i);
    if(m)hosts.add(m[1].toLowerCase());
  }
  return [...hosts];
}
function hostWanted(url, hosts) {
  let host='';try{const u=new URL(String(url||''));if(!/^https?:$/.test(u.protocol))return false;host=u.hostname.toLowerCase().replace(/\.$/,'');}catch{return false;}
  return (hosts||[]).some(h=>host===h||host.endsWith('.'+h));
}
module.exports={BUILTIN_KEYS,reservedGitHubKey,bundledDescriptor,lazyHosts,hostWanted};
