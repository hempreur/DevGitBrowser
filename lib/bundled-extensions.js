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
  return {key,directory,name:manifest.name,version:manifest.version};
}
module.exports={BUILTIN_KEYS,reservedGitHubKey,bundledDescriptor};
