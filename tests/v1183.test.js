const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');

test('partage d’écran : sélecteur façon Chrome au lieu de la boîte de boutons',()=>{
  const main=read('main.js');
  assert.ok(!main.includes("buttons:['Annuler',...options.map("),'ancienne boîte en longueur retirée');
  assert.match(main,/openSharePicker\(request\.frame\?\.webContents,origin,request\.audioRequested===true\)/);
  assert.match(main,/if\(!origin \|\| !request\.userGesture \|\| !request\.videoRequested\)\{callback\(null\);return;\}/,'geste utilisateur toujours exigé');
  assert.match(main,/thumbnailSize:thumbs\?\{width:320,height:200\}:\{width:0,height:0\},fetchWindowIcons:true/);
  assert.match(main,/const audio=audioRequested&&process\.platform==='win32';/);
  assert.match(main,/picker\.finish\(src\?\{video:src,\.\.\.\(withAudio&&audio\?\{audio:'loopback'\}:\{\}\)\}:null\)/,'seule une source proposée peut être choisie');
  assert.match(main,/event\.sender!==sharePicker\.win\.webContents\)return;/,'choix accepté seulement depuis le sélecteur');
  assert.match(main,/t\.view\?\.webContents===wc/,'onglets en veille sans vue : pas de plantage');
  const html=read('ui/share/index.html'),js=read('ui/share/share.js'),pre=read('ui/share/preload.js');
  assert.match(html,/default-src 'self'; script-src 'self'; style-src 'self'; img-src data:/);
  for(const id of ['tab-window','tab-screen','grid','audio','share','cancel'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(!/innerHTML/.test(js));assert.ok(!/require\('(fs|child_process)'\)/.test(pre));
  const en=JSON.parse(read('i18n/en.json'));for(const k of ['Fenêtre','Écran complet','Partager l’audio système','Écran entier'])assert.ok(en[k],k);
});
