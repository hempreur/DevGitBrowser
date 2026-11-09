'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BUILTIN_KEYS,reservedGitHubKey,bundledDescriptor}=require('../lib/bundled-extensions');
const root=path.join(__dirname,'..');
test('MatchPulse is part of the shipped application and its assets are complete',()=>{
  assert.deepEqual(BUILTIN_KEYS,['matchpulse']);
  const ext=bundledDescriptor(root,'matchpulse');
  assert.equal(ext.key,'matchpulse');
  assert.equal(ext.version,'0.6.0');
  assert.ok(ext.name.includes('MatchPulse'));
  assert.throws(()=>bundledDescriptor(root,'other'),/inconnue/);
});
test('Bundled extensions ship inside Windows installer',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.ok(pkg.build.files.includes('extensions/**/*'));
  assert.ok(pkg.build.asarUnpack.includes('extensions/**/*'));
  assert.match(fs.readFileSync(path.join(root,'main.js'),'utf8'),/app\.asar\.unpacked/);
  assert.match(fs.readFileSync(path.join(root,'main.js'),'utf8'),/await loadBundledExtensions\(\)/);
  assert.match(fs.readFileSync(path.join(root,'main.js'),'utf8'),/browsingSession\.extensions\.loadExtension\(descriptor\.directory/);
});
test('Private GitHub cannot replace a built-in and disconnect does not remove it',()=>{
  assert.equal(reservedGitHubKey('matchpulse'),true);
  assert.equal(reservedGitHubKey('my-extension'),false);
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(main,/if\(reservedGitHubKey\(key\)\)continue/);
  assert.match(main,/function clearExtensions\(\) \{\s*for\(const ext of installed\.values\(\)\)/);
  assert.match(main,/const bundledInstalled = new Map/);
});
test('UI identifies bundled extensions separately from private GitHub extensions',()=>{
  const src=fs.readFileSync(path.join(root,'ui','renderer.js'),'utf8');
  assert.match(src,/ext\.source==='included'/);
});
