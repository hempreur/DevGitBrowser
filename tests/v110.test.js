const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const U=require('../lib/browser-utils');const {AdBlockService,FILTER_LISTS,ENGINE_OPTIONS,validateCachePath}=require('../lib/adblocker');

test('thèmes : vraies palettes, plus de filtre global, anciens choix repris',()=>{
  const css=read('ui/themes.css'),style=read('ui/style.css'),radio=read('ui/radio/radio.css');
  for(const t of U.THEMES){assert.equal(t.colors.length,4,t.id);for(const c of t.colors)assert.match(c,/^#[0-9a-f]{6}$/i);}
  for(const t of U.THEMES.filter(t=>t.id!=='neon')){assert.match(css,new RegExp(`:root\\[data-theme="${t.id}"\\]\\{--t-bg:`));assert.match(radio,new RegExp(`:root\\[data-theme="${t.id}"\\]\\{--r-bg:`));}
  assert.doesNotMatch(style,/data-theme="[a-z]+"\]\{filter:/);assert.doesNotMatch(radio,/hue-rotate/);
  for(const [old,now] of Object.entries(U.LEGACY_THEMES))assert.ok(U.THEMES.some(t=>t.id===now),old);
  assert.match(read('ui/index.html'),/href="themes\.css"/);
});
test('DevGitShield : moins de casse sur les sites',()=>{
  assert.equal(ENGINE_OPTIONS.guessRequestTypeFromUrl,false);
  const svc=new AdBlockService({webSession:{},dataFolder:'/tmp/x',enabled:true});
  const ids=svc.activeLists().map(l=>l.id);
  assert.ok(!ids.some(id=>id.includes('annoyances')),'listes anti-nuisances désactivées par défaut');
  assert.ok(FILTER_LISTS.some(l=>l.id==='ubo-unbreak')&&ids.includes('ubo-quick-fixes'));
  svc.annoyances=true;assert.ok(svc.activeLists().some(l=>l.id.includes('annoyances')));
  assert.notEqual(validateCachePath('/d',false),validateCachePath('/d',true));
});
test('DevGitShield : scriptlets injectés une seule fois, protections maison facultatives',()=>{
  const calls=[];
  const engine={getCosmeticsFilters:o=>{calls.push(o);return {active:true,scripts:['/*ubo*/'],styles:''};},onBeforeRequest(){},onHeadersReceived(){},onInjectCosmeticFilters(){}};
  const svc=new AdBlockService({webSession:{},dataFolder:'/tmp/x',enabled:true});
  svc.instrument(engine);svc.engine=engine;
  engine.getCosmeticsFilters({url:'https://www.youtube.com/',getInjectionRules:true});
  assert.equal(calls.at(-1).getInjectionRules,false,'Ghostery ne réinjecte plus les scriptlets');
  let early=svc.earlyScripts('https://www.youtube.com/watch?v=x');
  assert.deepEqual(early.scripts,['/*ubo*/'],'seuls les scriptlets uBlock, sans protections maison');
  assert.equal(calls.at(-1).getInjectionRules,true);
  svc.setBoost(true);early=svc.earlyScripts('https://www.youtube.com/watch?v=x');
  assert.ok(early.scripts.length===2,'mode renforcé : protection maison ajoutée');
});
test('DevGitShield : session privée branchée sur le moteur actif',()=>{
  const handlers={};const ses={webRequest:{onBeforeRequest:(f,h)=>{handlers.req=h;},onHeadersReceived:(f,h)=>{handlers.head=h;}},registerPreloadScript(){}};
  const svc=new AdBlockService({webSession:{},dataFolder:'/tmp/x',enabled:true});
  svc.attachSession(ses);
  let out;handlers.req({url:'https://a.test/'},r=>{out=r;});assert.deepEqual(out,{},'sans moteur : requête laissée passer');
  svc.engine={onBeforeRequest:(d,cb)=>cb({cancel:true}),onHeadersReceived:(d,cb)=>cb({})};
  handlers.req({url:'https://ads.test/'},r=>{out=r;});assert.deepEqual(out,{cancel:true});
  svc.enabled=false;handlers.req({url:'https://ads.test/'},r=>{out=r;});assert.deepEqual(out,{});
});
test('onglets privés : VPN obligatoire, rien de conservé',()=>{
  const main=read('main.js');
  assert.match(main,/PRIVATE_FAIL_CLOSED = \{proxyRules: 'socks5:\/\/127\.0\.0\.1:9'/);
  assert.match(main,/session\.fromPartition\('devgit-private-'/);
  assert.doesNotMatch(main,/fromPartition\('persist:devgit-private/);
  assert.match(main,/clearStorageData\(\); await ses\.clearCache\(\)/);
  assert.match(main,/t\.private \|\| vpnActive\(\)\) \{ try \{ view\.webContents\.setWebRTCIPHandlingPolicy\('disable_non_proxied_udp'\)/);
  assert.match(main,/'tab:new-menu'/);assert.match(read('ui/renderer.js'),/add-tab'\)\.addEventListener\('contextmenu'/);
  assert.match(main,/!t\.xTab && !t\.private/);
});
test('Netflix : Widevine (castLabs) et permission DRM',()=>{
  const pkg=require('../package.json');
  assert.match(pkg.devDependencies.electron,/castlabs\/electron-releases#v45\.\d+\.\d+\+wvcus/);
  assert.equal(pkg.build.electronDist,'node_modules/electron/dist');
  assert.match(pkg.build.electronVersion,/^45\./);
  const main=read('main.js');assert.match(main,/permission==='mediaKeySystem'\)return true/);assert.match(main,/permission==='mediaKeySystem'\)\{callback\(true\)/);
  const wf=read('.github/workflows/windows-installer.yml');
  assert.match(wf,/build:win:dir[\s\S]*castlabs_evs\.vmp sign-pkg dist\/win-unpacked[\s\S]*build:win:installer/);
});
test('météo : nom de la ville affiché',()=>{assert.match(read('ui/index.html'),/id="weather-place"/);assert.match(read('ui/renderer.js'),/\$\('weather-place'\)\.textContent=w\.city/);});
