const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const R=require('../lib/referral-source');const {UpdateFlow}=require('../lib/update-flow');

test('réglages : chaque interrupteur de l’interface est renvoyé par le navigateur',()=>{
  const html=read('ui/index.html'),main=read('main.js');
  const blk=main.slice(main.indexOf('preferences: {'));const prefs=blk.slice(0,blk.indexOf('},\n'));
  const keys=new Set([...prefs.matchAll(/(\w+):settings\./g)].map(m=>m[1]));
  const ui=[...new Set([...html.matchAll(/data-pref="(\w+)"/g)].map(m=>m[1]))];
  assert.ok(ui.length>=16);
  for(const k of ui)assert.ok(keys.has(k),`interrupteur « ${k} » jamais renvoyé à l’interface : il se décoche tout seul`);
});

test('parrainage automatique : marque du web de l’installateur, puis presse-papiers',()=>{
  const zone='[ZoneTransfer]\r\nZoneId=3\r\nReferrerUrl=https://hempreur.github.io/DevGitBrowser/?ref=ABCD2345\r\nHostUrl=https://objects.githubusercontent.com/x/DevGitBrowser-Setup-1.16.0.exe\r\n';
  assert.equal(R.codeFromZoneIdentifier(zone),'ABCD2345');
  assert.equal(R.codeFromZoneIdentifier('ReferrerUrl=https://hempreur.github.io/DevGitBrowser/#installation'),null);
  assert.equal(R.codeFromZoneIdentifier('ReferrerUrl=https://evil.example/?ref=ABCD2345'),null,'seulement le site officiel');
  assert.equal(R.codeFromZoneIdentifier('ReferrerUrl=https://hempreur.github.io/DevGitBrowser/?ref=ABCD2345X'),null,'code de 8 caractères exactement');
  assert.equal(R.codeFromClipboard('DevGitBrowser ref:WXYZ6789'),'WXYZ6789');
  assert.equal(R.codeFromClipboard('https://hempreur.github.io/DevGitBrowser/?ref=WXYZ6789'),'WXYZ6789');
  assert.equal(R.codeFromClipboard('un texte quelconque WXYZ6789'),null,'presse-papiers : format exact uniquement');
  const files={[path.join('C:\\D','DevGitBrowser-Setup-1.15.0.exe')+':Zone.Identifier']:'ZoneId=3',[path.join('C:\\D','DevGitBrowser-Setup-1.16.0.exe')+':Zone.Identifier']:zone};
  const fake={readFile:f=>{if(f in files)return files[f];throw new Error('ENOENT');},readdir:()=>['photo.jpg','DevGitBrowser-Setup-1.15.0.exe','DevGitBrowser-Setup-1.16.0.exe'],stat:f=>({mtimeMs:f.includes('1.16')?2:1})};
  const r=R.findReferralCode({downloadsDir:'C:\\D',clipboardText:()=>'DevGitBrowser ref:WXYZ6789',...fake,});
  assert.deepEqual(r,{code:'ABCD2345',source:'download'},'la marque du web passe avant le presse-papiers');
  assert.deepEqual(R.findReferralCode({downloadsDir:'C:\\none',clipboardText:()=>'DevGitBrowser ref:WXYZ6789',readFile:()=>{throw new Error();},readdir:()=>[]}),{code:'WXYZ6789',source:'clipboard'});
  assert.equal(R.findReferralCode({clipboardText:()=>'bonjour'}),null);
  const main=read('main.js');
  assert.match(main,/if \(settings\.welcomed \|\| settings\.referredBy \|\| settings\.refAutoChecked\) return;/,'uniquement au premier lancement, une seule fois');
  assert.match(read('installer/referral.nsh'),/WriteRegStr HKCU "Software\\DevGitBrowser" "InstallerPath" "\$EXEPATH"/);
  assert.equal(JSON.parse(read('package.json')).build.nsis.include,'installer/referral.nsh');
});

test('mises à jour : fenêtre au lancement, notifications pendant l’utilisation, une seule fois',()=>{
  let now=0;const events=[];
  const f=new UpdateFlow({now:()=>now,notify:(k,s)=>events.push(k+':'+s.version),openWindow:(s,o)=>events.push('window:'+s.version+(o.autoInstall?':auto':':manuel'))});
  // au lancement : la fenêtre s'ouvre et installe toute seule après le compte à rebours
  now=5_000;assert.equal(f.handle({status:'downloading',version:'1.16.0'}),'window');
  assert.equal(f.handle({status:'downloaded',version:'1.16.0'}),null);
  f.setWindowOpen(false);f.postpone('1.16.0');assert.equal(f.handle({status:'downloaded',version:'1.16.0'}),null,'« Plus tard » respecté');
  // pendant l'utilisation (1.18.5) : la fenêtre s'ouvre aussi tout de suite, sans installation automatique, + notification
  now=4*3_600_000;
  assert.equal(f.handle({status:'downloading',version:'1.17.0'}),'window');
  assert.equal(f.handle({status:'downloading',version:'1.17.0',progress:50}),null);
  assert.equal(f.handle({status:'downloaded',version:'1.17.0'}),null,'la fenêtre suit le téléchargement');
  f.setWindowOpen(false);
  assert.equal(f.handle({status:'downloaded',version:'1.17.0'}),'ready','fenêtre fermée sans « Plus tard » : notification « prête »');
  assert.equal(f.handle({status:'downloaded',version:'1.17.0'}),null);
  assert.equal(f.handle({status:'none'}),null);assert.equal(f.handle({status:'error',version:'1.17.0'}),null);
  assert.deepEqual(events,['window:1.16.0:auto','window:1.17.0:manuel','available:1.17.0','ready:1.17.0']);
  const main=read('main.js');
  assert.match(main,/settings\.restoreAfterUpdate=true; saveSettings\(\); saveSessionNow\(\); updater\.install\(\);/,'onglets rouverts après la mise à jour');
  assert.match(main,/settings\.restoreSession \|\| afterUpdate \? readJson\('session\.json'\)/);
  assert.match(read('ui/update/update.js'),/const COUNTDOWN = 10;/);
});
