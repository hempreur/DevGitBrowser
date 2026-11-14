const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('économie CPU/GPU : aucune animation décorative permanente au repos',()=>{
  const css=read('ui/style.css')+read('ui/home.css')+read('ui/themes.css');
  // Seules animations infinies autorisées : chargement d'onglet, panneau admin, et les variantes « au survol ».
  const rules=[...css.matchAll(/([^{}]+)\{[^{}]*animation:[^;}]*infinite[^{}]*\}/g)].map(m=>m[1].trim());
  for(const sel of rules)assert.ok(/:hover|tab-spinner|admin-live|map-pulse/.test(sel),'animation infinie au repos : '+sel);
  assert.match(css,/mix-blend-mode:screen;animation:logo-shine 3\.6s ease-in-out 2\}/);
  assert.match(css,/body\.win-idle \*,body\.win-idle \*::before,body\.win-idle \*::after\{animation-play-state:paused!important\}/);
  assert.match(read('ui/renderer.js'),/window\.addEventListener\('blur',\(\)=>document\.body\.classList\.add\('win-idle'\)\);/);
});
test('onglets inutilisés mis en veille (sauf son, webcam, micro, partage)',()=>{
  const main=read('main.js');
  assert.match(main,/settings\.performance\.mode === 'eco' \? 10 \* 60_000 : 30 \* 60_000;/);
  assert.match(main,/if \(t\.view && mediaContents\.has\(t\.view\.webContents\)\) return false;/);
  assert.match(main,/const callback=v=>\{if\(v&&wc&&\['media','display-capture'\]\.includes\(permission\)\)mediaContents\.add\(wc\);callback0\(v\);\};/);
  assert.match(main,/if \(!t\.url \|\| t\.sleeping \|\| s\.activeId===t\.id \|\| t\.audible \|\| t\.engine!=='chromium'\) return false;/);
});
