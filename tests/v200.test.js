const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const {bundledDescriptor,hostWanted,lazyHosts}=require('../lib/bundled-extensions');
test('MatchPulse : démarré seulement sur les sites de paris sportifs',()=>{
  const d=bundledDescriptor(root,'matchpulse');
  assert.deepEqual(d.hosts.sort(),['betclic.fr','unibet.be','unibet.fr','unibetsports.be','winamax.fr']);
  for(const u of ['https://www.betclic.fr/football','https://winamax.fr/','http://m.unibet.be/x','https://www.unibetsports.be/'])assert.equal(hostWanted(u,d.hosts),true,u);
  for(const u of ['https://www.google.com/search?q=betclic.fr','https://betclic.fr.evil.com/','https://notbetclic.fr/','file:///betclic.fr','chrome-extension://betclic.fr/','','https://youtube.com/'])assert.equal(hostWanted(u,d.hosts),false,u);
  assert.deepEqual(lazyHosts({content_scripts:[{matches:['<all_urls>','*://*/*','https://*.exemple.fr/*']}]}),['exemple.fr'],'motifs trop larges ignorés');
  const main=read('main.js');
  assert.ok(!/async function loadBundledExtensions\(\) \{[\s\S]{0,700}loadExtension\(/.test(main),'plus de chargement au démarrage');
  assert.match(main,/if \(bundledFor\(url\)\) \{ event\.preventDefault\(\); loadWhenReady\(wc, url\)\.catch\(\(\)=>\{\}\); \}/,'liens et redirections');
  assert.match(main,/loadWhenReady\(t\.view\.webContents, url\)\.then\(\(\)=>applySiteZoom\(t\)\)/,'adresse saisie');
  assert.match(main,/if \(busy\) \{ info\.idleSince = Date\.now\(\); continue; \}/,'jamais mise en veille pendant un suivi de match');
  assert.match(main,/perfTimer=setInterval\(\(\)=>\{sleepIdleTabs\(\);reapBundled\(\)/);
  assert.match(read('extensions/matchpulse/background.js'),/globalThis\.MatchPulseBusy = \(\) => running && tracked\.length > 0;/);
});
test('2.0 Bêta : étiquette, release et logos allégés',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.match(pkg.version,/^2\.\d+\.\d+$/);assert.equal(pkg.devgitChannel,'Bêta');
  assert.match(read('.github/workflows/windows-installer.yml'),/\$title = if \(\$pkg\.devgitChannel\)/);
  assert.match(read('ui/renderer.js'),/info\.channel\?' · '\+info\.channel:''/);
  const {buildPayload}=require('../scripts/discord-announce');
  assert.match(buildPayload('2.0.0','## 2.0.0\n- x','Bêta').embeds[0].title,/2\.0\.0 Bêta/);
  assert.ok(fs.statSync(path.join(root,'assets','logo-mark.png')).size<80_000);assert.ok(fs.statSync(path.join(root,'assets','logo-dgbx.png')).size<400_000);
});
