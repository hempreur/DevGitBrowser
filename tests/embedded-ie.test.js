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
  assert.match(main,/embedded-ie\.ps1/);
  assert.doesNotMatch(main,/async function launchLegacyWindow\(/);
  assert.match(main,/dgb:legacy-error/);
  const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
  assert.match(html,/dans le même onglet/);
});
