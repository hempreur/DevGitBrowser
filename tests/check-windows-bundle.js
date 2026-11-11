'use strict';
// Windows GitHub Actions: assert that Chromium can access unpacked extension files.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..','dist','win-unpacked','resources','app.asar.unpacked','extensions','matchpulse');
for(const item of ['manifest.json','core.js','dom-reader.js','content.js','background.js','style.css']){
  assert.ok(fs.existsSync(path.join(root,item)), `MatchPulse manquant dans l'installateur : ${item}`);
}
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.name,'MatchPulse — DevGitBrowser');
console.log('OK — MatchPulse unpacked et embarqué dans DevGitBrowser Windows.');

// Ensure the filtering engine is inside the final Electron app, not just the build machine.
const packed=fs.readFileSync(path.join(__dirname,'..','dist','win-unpacked','resources','app.asar'));
assert.ok(packed.includes(Buffer.from('adblocker-electron')), 'Le moteur DevGitShield doit être inclus dans app.asar.');
console.log('OK — moteur DevGitShield présent dans app.asar.');

// Automatic updates: electron-updater needs app-update.yml in the package and
// latest.yml next to the installer (uploaded to the GitHub release).
const resources=path.join(__dirname,'..','dist','win-unpacked','resources');
const updateConfig=fs.readFileSync(path.join(resources,'app-update.yml'),'utf8');
assert.match(updateConfig,/provider: github/);
assert.match(updateConfig,/owner: hempreur/);
assert.match(updateConfig,/repo: DevGitBrowser/);
const latest=fs.readFileSync(path.join(__dirname,'..','dist','latest.yml'),'utf8');
assert.match(latest,new RegExp('version: '+require('../package.json').version.replace(/\./g,'\\.')));
assert.ok(packed.includes(Buffer.from('electron-updater')), 'electron-updater doit être inclus dans app.asar.');
console.log('OK — configuration de mise à jour automatique présente (app-update.yml + latest.yml).');

// VPN DevGit : tor.exe embarqué (avertissement seulement si le téléchargement a échoué).
const torExe=path.join(resources,'tor','tor','tor.exe');
if(fs.existsSync(torExe)) console.log('OK — VPN DevGit : tor.exe présent dans les ressources.');
else console.warn('::warning::tor.exe absent : le VPN DevGit sera indisponible dans cet installateur.');

// Lecteur protégé (Netflix & co) : moteur castLabs d'origine + signature VMP.
const unpacked=path.join(__dirname,'..','dist','win-unpacked');
assert.ok(fs.existsSync(path.join(unpacked,'DevGitMedia.exe')),'DevGitMedia.exe (lecteur protégé) absent du paquet.');
if(fs.existsSync(path.join(unpacked,'DevGitMedia.exe.sig'))) console.log('OK — lecteur protégé DevGitMedia.exe signé VMP (Netflix).');
else console.warn('::warning::DevGitMedia.exe.sig absent : Netflix refusera la lecture (secrets EVS manquants ?).');
