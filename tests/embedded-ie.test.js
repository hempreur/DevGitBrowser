'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {originOf,shouldAutoEmbed,encodeCommand,decodeEvent}=require('../lib/legacy-embedded');

test('legacy engine is only automatic after per-site explicit approval',()=>{
  const url='https://legacy.example.com/old/';
  const hints=['Contrôle ActiveX détecté'];
  assert.equal(shouldAutoEmbed({url,hints,trustedOrigins:{}}),false);
  assert.equal(shouldAutoEmbed({url,hints,trustedOrigins:{'https://legacy.example.com':true}}),true);
  assert.equal(shouldAutoEmbed({url,hints:[],trustedOrigins:{'https://legacy.example.com':true}}),true);
  assert.equal(shouldAutoEmbed({url,hints,trustedOrigins:{'https://legacy.example.com':true},platform:'linux'}),false);
  assert.equal(shouldAutoEmbed({url:'https://babelvisio.com/chat',hints,trustedOrigins:{'https://babelvisio.com':true}}),false);
  assert.equal(shouldAutoEmbed({url:'https://evilbabelvisio.com',hints,trustedOrigins:{}}),false);
});
test('rejects invalid targets and encodes native commands as base64 lines',()=>{
  assert.equal(originOf('https://example.com/test'),'https://example.com');
  assert.equal(originOf('file:///C:/secret'), '');
  assert.throws(()=>encodeCommand('EXEC','hello'));
  const x=encodeCommand('NAV','https://example.com/f?c=é&x=1');
  const value=x.trimEnd().split('\t')[1];
  assert.equal(Buffer.from(value,'base64').toString('utf8'),'https://example.com/f?c=é&x=1');
  const packet=decodeEvent('TITLE\t'+Buffer.from('Éléments IE','utf8').toString('base64'));
  assert.deepEqual(packet,{event:'TITLE',value:'Éléments IE'});
  assert.equal(decodeEvent('RUN\tZXZpbA=='),null);
});
test('MSHTML stays hosted inside the current tab client area, not an external window',()=>{
  const root=path.resolve(__dirname,'..');
  const helper=fs.readFileSync(path.join(root,'legacy/embedded-ie.ps1'),'utf8');
  assert.match(helper,/SetParent\(Handle,parent\)/);
  assert.match(helper,/MSHTML WinForms helper compiled/);
  assert.match(helper,/GetParent\(Handle\)!=parent/);
  assert.match(helper,/ShowInTaskbar=false/);
  assert.match(helper,/browser\.Navigate\(address\)/);
  const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
  assert.match(main,/const handle=s\.win\.getNativeWindowHandle\(\)/);
  assert.match(main,/legacyHostFilename\(url\)/);
  assert.doesNotMatch(main,/async function launchLegacyWindow\(/);
  assert.match(main,/dgb:legacy-error/);
  const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
  assert.match(html,/dans le même onglet/);
});

test('native process protocol accepts events with an empty payload',()=>{
  assert.deepEqual(decodeEvent('ATTACHED\t'),{event:'ATTACHED',value:''});
  assert.deepEqual(decodeEvent('READY\t'+Buffer.from('http://127.0.0.1/').toString('base64')),{event:'READY',value:'http://127.0.0.1/'});
});

test('Dedicated IE11 host and modern webcam fallback',()=>{
  const {requiresModernVideo,shouldAutoEmbed,decodeEvent}=require('../lib/legacy-embedded');
  assert.equal(requiresModernVideo('https://www.monvisio.com'),true);
  assert.equal(requiresModernVideo('https://www.babelvisio.com'),true);
  assert.equal(requiresModernVideo('https://classic.example.org'),false);
  assert.equal(shouldAutoEmbed({url:'https://www.monvisio.com',trustedOrigins:{'https://www.monvisio.com':true},platform:'win32'}),false);
  const cs=fs.readFileSync(path.join(__dirname,'../legacy/DevGitLegacyHost.cs'),'utf8');
  assert.match(cs,/FEATURE_BROWSER_EMULATION/);
  assert.match(cs,/Path.GetFileName\(Application.ExecutablePath\), 11001/);
  assert.match(cs,/document\.documentMode/);
  assert.equal(decodeEvent('MODE\t'+Buffer.from('11').toString('base64')).value,'11');
  assert.equal(decodeEvent('POPUPREADY\t'+Buffer.from('https://site.test/popup').toString('base64')).event,'POPUPREADY');
});

test('IE Tab-style navigation is retained in the legacy session for links and windows',()=>{
  const {preserveIEInSession}=require('../lib/legacy-embedded');
  assert.equal(preserveIEInSession('https://old.example.com/a'),true);
  assert.equal(preserveIEInSession('https://other.example.org/b'),true);
  assert.equal(preserveIEInSession('https://www.monvisio.com/video'),false);
  assert.equal(preserveIEInSession('javascript:alert(1)'),false);
  const cs=fs.readFileSync(path.join(__dirname,'../legacy/DevGitLegacyHost.cs'),'utf8');
  assert.match(cs,/GWLP_HWNDPARENT/); // owned overlay paints above Chromium
  assert.match(cs,/GetWindow\(Handle,GW_OWNER\)/);
  assert.match(cs,/NewWindow3/); // native window.open / target=_blank
  assert.match(cs,/ppDisp=popup\.Browser\.ComObject/);
  assert.match(cs,/new BrowserPopupSink\(this,browser\)/);
  assert.match(cs,/popupTimes\.Count>=18/);
  const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  assert.match(main,/preserveIEInSession\(url\)/);
  assert.match(main,/const bounds=s\.win\.getContentBounds\(\)/);
  assert.match(main,/event==='DISPLAY'/);
});


test('CamfrogWeb ActiveX uses a dedicated 32-bit MSHTML COM host with diagnostics',()=>{
  const {legacyHostFilename,needs32BitActiveX,decodeEvent}=require('../lib/legacy-embedded');
  assert.equal(needs32BitActiveX('https://www.monvisiocam.com/'),true);
  assert.equal(legacyHostFilename('https://www.monvisiocam.com/salon/'), 'DevGitLegacyHost32.exe');
  assert.equal(legacyHostFilename('https://babelvisio.com/'),'DevGitLegacyHost.exe');
  assert.equal(legacyHostFilename('https://fake-monvisiocam.com/'),'DevGitLegacyHost.exe');
  assert.equal(decodeEvent('HOSTARCH\t'+Buffer.from('32 bits').toString('base64')).value,'32 bits');
  assert.equal(decodeEvent('PLUGIN\t'+Buffer.from('CamfrogWeb non trouvé').toString('base64')).event,'PLUGIN');
  const cs=fs.readFileSync(path.join(__dirname,'../legacy/DevGitLegacyHost.cs'),'utf8');
  const main=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
  const yaml=fs.readFileSync(path.join(__dirname,'../.github/workflows/windows-installer.yml'),'utf8');
  assert.match(cs,/SetWindowLong32/);
  assert.match(cs,/RegistryView.Registry32/);
  assert.match(cs,/Path.GetFileName\(Application.ExecutablePath\)/);
  assert.match(main,/legacyHostFilename\(url\)/);
  assert.match(yaml,/platform:x86/);
  assert.match(yaml,/windows-ie-smoke.js DevGitLegacyHost32.exe/);
});
