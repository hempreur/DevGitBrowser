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
