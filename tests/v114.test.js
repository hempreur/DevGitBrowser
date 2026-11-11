const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const I=require('../ui/i18n.js');const EN=JSON.parse(read('i18n/en.json'));

test('dictionnaire anglais : complet, cohérent, sans trou',()=>{
  assert.ok(Object.keys(EN).length>1200);
  for(const [fr,en] of Object.entries(EN)){
    assert.ok(typeof en==='string'&&en.trim(),'traduction vide : '+fr);
    const ph=s=>(s.match(/\{\d*\}/g)||[]).sort().join();
    assert.equal(ph(en),ph(fr),'variables différentes : '+fr);
  }
  for(const k of ['Paramètres','Nouvel onglet','Mots de passe','Signaler un bug'.replace('Signaler','🐞 Signaler')])assert.ok(EN[k],k);
});

test('traducteur : exact, modèles à variables, icônes, morceaux, inconnu',()=>{
  const tr=I.createTranslator(EN);
  assert.equal(tr.t('Paramètres'),'Settings');
  assert.equal(tr.t('  Nouvel onglet '),'  New tab ','espaces conservés');
  assert.equal(tr.t('3 onglet(s) mis en veille.'),'3 tab(s) put to sleep.');
  assert.equal(tr.t('Effacer l’historique (Dernière heure) ? Les favoris sont conservés.'),'Clear history (Last hour)? Bookmarks are kept.','variable elle-même traduite');
  assert.equal(tr.t('🔒 Coffre verrouillé'),'🔒 Vault locked');
  assert.equal(tr.t('Activé · protection de base hors ligne · 12 requêtes bloquées'),'On · basic offline protection · 12 requêtes bloquées','morceaux connus seulement');
  assert.equal(tr.translate('Bonjour le monde inconnu'),null);assert.equal(tr.t('www.exemple.fr'),'www.exemple.fr');
  assert.equal(tr.t('12'),'12');assert.equal(tr.t(''),'');
  const fr=I.createTranslator({});assert.equal(fr.t('Paramètres'),'Paramètres','français = aucun changement');
});

test('pages HTML générées : texte traduit, balisage et adresses intacts',()=>{
  const tr=I.createTranslator(EN);
  const out=tr.html('<!doctype html><title>Ce site est inaccessible</title><h1>Ce site est inaccessible</h1><p><code>https://x.fr/a</code></p><a href="https://x.fr">Continuer en HTTP non chiffré</a>');
  assert.match(out,/<title>This site can’t be reached<\/title>/);assert.match(out,/<h1>This site can’t be reached<\/h1>/);
  assert.match(out,/href="https:\/\/x\.fr"/);assert.match(out,/<code>https:\/\/x\.fr\/a<\/code>/);assert.match(out,/Continue over unencrypted HTTP/);
  const {errorPage}=require('../lib/browser-utils');
  const page=decodeURIComponent(errorPage({url:'https://x.fr/',code:-105,description:'ERR_NAME_NOT_RESOLVED'}).split(',').slice(1).join(','));
  const en=tr.html(page);assert.doesNotMatch(en.replace(/<style[\s\S]*?<\/style>/,''),/inaccessible|Résolution/);
});

test('langue : réglage, menus, boîtes de dialogue, toutes les fenêtres',()=>{
  const main=read('main.js');
  assert.match(main,/language:'auto'/);assert.match(main,/LANGUAGES = \['auto','fr','en'\]/);
  assert.match(main,/Menu\.buildFromTemplate = tpl => build\(i18nLang === 'en' \? translateMenuTemplate\(tpl\) : tpl\)/);
  assert.match(main,/'showMessageBox','showMessageBoxSync','showOpenDialog'/);
  assert.match(main,/ipcMain\.on\('dgb-i18n:get'/);assert.match(main,/const errorPage = o => translateDataPage\(errorPageFr\(o\)\)/);
  for(const f of ['preload.js','ui/radio/preload.js','network/preload.js','ui/preview/preload.js'])assert.match(read(f),/exposeInMainWorld\('DGBLang'/,f);
  for(const f of ['ui/index.html','ui/radio/index.html','network/index.html','ui/preview/index.html'])assert.match(read(f),/i18n\.js"><\/script>/,f);
  assert.match(read('ui/index.html'),/id="language"/);assert.match(read('ui/index.html'),/id="welcome-language"/);
  assert.ok(JSON.parse(read('package.json')).build.files.some(f=>/^i18n/.test(f)),'dictionnaire inclus dans l’installateur');
});
