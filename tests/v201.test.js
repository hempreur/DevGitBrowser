const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
test('contenu non chiffré : bloqué par défaut, autorisable par site, jamais transmis à un autre site',()=>{
  const main=read('main.js');
  assert.match(main,/allowRunningInsecureContent:Boolean\(t\.insecureView\)/);
  assert.match(main,/insecure: saved\.insecure === 'allow' \? 'allow' : 'block'/,'bloqué par défaut');
  assert.match(main,/if \(!\/\^https:\/i\.test\(String\(url\|\|''\)\)\) return false;/);
  assert.match(main,/const viewMismatch = \(t, url\) => t\.engine === 'chromium' && isWebUrl\(url\) && insecureAllowed\(url\) !== Boolean\(t\.insecureView\);/);
  assert.match(main,/if \(event\?\.isMainFrame !== false && viewMismatch\(t, url\)\) \{ event\.preventDefault\(\); setImmediate\(\(\) => swapTabView\(t, url\)\); return; \}/,'liens et redirections vers un autre site');
  assert.match(main,/if \(viewMismatch\(t, url\)\) \{ swapTabView\(t, url\); return; \}/,'adresse saisie');
  assert.match(main,/if\(values\.insecure==='allow'\)p\.sitePrivacy\[origin\]\.insecure='allow';/);
  assert.match(main,/!message\.startsWith\('Mixed Content:'\)/);
  const html=read('ui/index.html');for(const id of ['site-insecure','mixed-banner','mixed-allow','mixed-no'])assert.ok(html.includes(`id="${id}"`),id);
  const en=JSON.parse(read('i18n/en.json'));assert.ok(en['Autoriser pour ce site']);
});
