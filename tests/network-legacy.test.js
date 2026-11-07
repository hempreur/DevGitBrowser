'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {redactHeaders,redactUrl,redactBody,isReadableMime,NetworkMonitor}=require('../lib/network-monitor');
const {DETECTOR_SOURCE,validateLegacyTarget}=require('../lib/legacy');

test('Network inspector masks authorization, cookies, query tokens and redacts text bodies',()=>{
  assert.deepEqual(redactHeaders({Authorization:'Bearer secret',Cookie:'id=secret','x-api-key':'123','content-type':'application/json'}),{
    Authorization:'[MASQUÉ]',Cookie:'[MASQUÉ]','x-api-key':'[MASQUÉ]','content-type':'application/json'
  });
  const uri=redactUrl('https://example.org/api?a=b&token=secret&api_key=abc#fragment');
  assert.match(uri,/token=%5BMASQU%C3%89%5D/);assert.ok(!uri.includes('secret'));assert.ok(!uri.includes('fragment'));
  const body=redactBody('{"access_token":"secret","password":"abc","user":"hello"}');
  assert.ok(!body.includes('secret'));assert.ok(!body.includes('abc'));assert.ok(body.includes('hello'));
  assert.equal(isReadableMime('application/json'),true);assert.equal(isReadableMime('image/png'),false);
});
test('Inspector collects only ephemeral bounded records, reports request-response lifecycle',()=>{
  const emitted=[];const monitor=new NetworkMonitor(e=>emitted.push(e));
  monitor.onMessage('Network.requestWillBeSent',{requestId:'1',request:{method:'POST',url:'https://foo.test/api?token=a',headers:{Cookie:'secret'}}});
  monitor.onMessage('Network.responseReceived',{requestId:'1',response:{status:200,mimeType:'application/json',headers:{'Set-Cookie':'private'}}});
  monitor.onMessage('Network.loadingFinished',{requestId:'1',encodedDataLength:250});
  assert.equal(monitor.entries.get('1').status,200);
  assert.equal(monitor.entries.get('1').size,250);
  assert.equal(monitor.entries.get('1').finished,true);
  assert.equal(monitor.entries.get('1').responseHeaders['Set-Cookie'],'[MASQUÉ]');
  for(let i=0;i<415;i++)monitor.onMessage('Network.webSocketCreated',{requestId:'ws'+i,url:'wss://example.test/ws'});
  assert.equal(monitor.entries.size,400);monitor.clear();assert.equal(monitor.entries.size,0);
});
test('Legacy supports only HTTP(S) addresses and is opt-in',()=>{
  assert.equal(validateLegacyTarget('http://intranet.local/index.htm'),'http://intranet.local/index.htm');
  for(const value of ['file:///C:/bad','javascript:alert(1)','https://user:secret@example.org','ftp://example.org']){
    assert.throws(()=>validateLegacyTarget(value));
  }
  assert.match(DETECTOR_SOURCE,/ActiveXObject/);
  assert.match(DETECTOR_SOURCE,/X-UA-Compatible/);
  const main=fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
  assert.match(main,/startEmbeddedLegacy/);
  assert.match(main,/toggleLegacyInTab/);
  assert.match(main,/legacyHostFilename\(url\)/);
  assert.match(main,/setAlwaysOnTop\(true,'floating'\)/);
  assert.match(main,/app\.asar\.unpacked/);
});
test('Independent network panel files and Windows legacy launcher are bundled',()=>{
  const root=path.resolve(__dirname,'..');
  const build=require('../package.json').build;
  assert.ok(build.files.includes('network/**/*'));
  assert.ok(build.files.includes('legacy/**/*'));
  assert.ok(build.asarUnpack.includes('legacy/**/*'));
  for(const file of ['network/index.html','network/preload.js','network/renderer.js','network/style.css','legacy/embedded-ie.ps1']) {
    assert.ok(fs.statSync(path.join(root,file)).size>400,file);
  }
  const html=fs.readFileSync(path.join(root,'ui/index.html'),'utf8');
  for(const id of ['home','network-button','settings-legacy','popup-topmost','card-network'])assert.match(html,new RegExp(`id="${id}"`));
});
