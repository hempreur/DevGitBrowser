const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const T=require('../lib/trackers');const {AdBlockService}=require('../lib/adblocker');

test('Qui me piste : sous-domaines, entreprises, catégories',()=>{
  assert.equal(T.lookup('securepubads.g.doubleclick.net').company,'Google');
  assert.equal(T.lookup('www.google-analytics.com').category,'analytics');
  assert.equal(T.lookup('connect.facebook.net').company,'Meta (Facebook)');
  assert.equal(T.lookup('exemple.fr'),null);assert.equal(T.lookup('net'),null);
  assert.equal(T.baseDomain('a.b.exemple.co.uk'),'exemple.co.uk');assert.equal(T.baseDomain('cdn.x.fr'),'x.fr');
  const r=T.report(new Map([['www.google-analytics.com',2],['securepubads.g.doubleclick.net',3],['bat.bing.com',1],['pixel.inconnu.io',4]]));
  assert.equal(r[0].company,'Google');assert.equal(r[0].count,5);assert.deepEqual(r[0].categories.sort(),['ads','analytics']);
  assert.match(r[0].label,/Publicité/);assert.match(r[0].label,/audience/);
  assert.equal(r.at(-1).company,'inconnu.io');assert.equal(r.at(-1).known,false,'les inconnus passent après les entreprises connues');
  for(const [,cat,domains] of T.COMPANIES){assert.ok(T.CATEGORIES[cat],cat);for(const d of domains)assert.match(d,/^[a-z0-9.-]+\.[a-z]{2,}$/);}
});
test('DevGitShield : domaines bloqués mémorisés par onglet, remis à zéro à la navigation',()=>{
  const svc=new AdBlockService({webSession:{},dataFolder:'/tmp/x',enabled:true});
  svc.recordBlocked(7,'https://www.google-analytics.com/a.js');svc.recordBlocked(7,'https://www.google-analytics.com/b');svc.recordBlocked(7,'pas une url');svc.recordBlocked(0,'https://x.com/');
  assert.equal(svc.blockedFor(7),3);assert.equal(svc.trackersFor(7).get('www.google-analytics.com'),2);assert.equal(svc.totalBlocked,4);
  svc.resetTab(7);assert.equal(svc.trackersFor(7).size,0);
  for(let i=0;i<400;i++)svc.recordBlocked(8,`https://h${i}.t.com/`);assert.equal(svc.trackersFor(8).size,300,'taille bornée');
});
test('Mica/Acrylic et aperçu des liens : réglages validés et câblés',()=>{
  const main=read('main.js'),html=read('ui/index.html'),css=read('ui/style.css'),pre=read('lib/shield-preload.js');
  assert.match(main,/windowMaterial:'none'/);assert.match(main,/linkPreview:'shift'/);assert.match(main,/build >= 22621/);
  assert.match(main,/setBackgroundMaterial\(m\)/);assert.match(css,/html\[data-material\] #chrome/);
  for(const id of ['window-material','link-preview','panel-trackers','trackers-list'])assert.match(html,new RegExp(`id="${id}"`));
  // jamais d'aperçu depuis un onglet privé / DGBx ; page aperçue muette, sans boîtes de dialogue
  assert.match(main,/mode === 'off' \|\| t\.private \|\| t\.xTab/);assert.match(main,/setAudioMuted\(true\)/);assert.match(main,/disableDialogs: true/);
  assert.match(pre,/process\.isMainFrame/);assert.match(pre,/dgb-preview:hover/);
  const prev=read('ui/preview/index.html');assert.match(prev,/Content-Security-Policy/);assert.doesNotMatch(prev,/unsafe-inline/);
});
