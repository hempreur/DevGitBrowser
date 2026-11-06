'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseOrigin,isBabelVisio,popupMode,allowedPopupDestination,PopupLimiter}=require('../lib/popup-policy');
const babel='https://www.babelvisio.com';
test('BabelVisio (including room subdomains) permits useful popups by default; unrelated sites do not',()=>{
  assert.equal(popupMode(babel), 'allow');
  assert.equal(popupMode('https://room.babelvisio.com'),'allow');
  for(const origin of ['https://babelvisio.com.attacker.test','http://www.babelvisio.com','https://fakebabelvisio.com','https://unrelated.site'])assert.equal(popupMode(origin),'block');
  assert.equal(popupMode(babel,{[babel]:'block'}),'block');
  assert.equal(popupMode('https://example.com',{'https://example.com':'allow'}),'allow');
  assert.equal(parseOrigin('https://www.babelvisio.com/path'),'');
  assert.equal(isBabelVisio('https://babelvisio.com'),true);
});
test('Allows about:blank webcam windows and same-site blobs but rejects dangerous protocols',()=>{
  for(const target of ['about:blank','https://www.babelvisio.com/room','https://accounts.example.com/login','blob:https://www.babelvisio.com/1'])assert.equal(allowedPopupDestination(target,babel),true,target);
  for(const target of ['javascript:alert(1)','data:text/html,abc','file:///etc/passwd','blob:https://attacker.example/abc','https://name:pw@example.org/','about:config','chrome://settings'])assert.equal(allowedPopupDestination(target,babel),false,target);
});
test('Webcam popup burst is allowed but capped per minute, origin, and open windows',()=>{
 const lim=new PopupLimiter();const now=1_700_000_000_000;
 for(let i=0;i<24;i++) assert.equal(lim.admit(babel,'about:blank',{},now),true,i);
 assert.equal(lim.admit(babel,'about:blank',{},now),false);
 lim.release(babel);assert.equal(lim.active(babel),23);
 assert.equal(lim.admit(babel,'about:blank',{},now+60001),true);
});
test('Untrusted popup is denied even if volume cap has room; allowlisted sites have smaller cap',()=>{
 const lim=new PopupLimiter();const site='https://example.com';
 assert.equal(lim.admit(site,'https://example.com'),false);
 const overrides={[site]:'allow'};
 for(let i=0;i<8;i++)assert.equal(lim.admit(site,'https://example.com',overrides,1000),true);
 assert.equal(lim.admit(site,'https://example.com',overrides,1000),false);
});

test('BabelVisio auto-exception cannot launch external advertising popups; explicit user permission can',()=>{
  const limiter=new PopupLimiter();
  assert.equal(limiter.admit(babel,'https://ads.example.net/'),false);
  assert.equal(limiter.admit(babel,'https://room.babelvisio.com/video'),true);
  assert.equal(limiter.admit(babel,'https://accounts.example.net/login',{[babel]:'allow'}),true);
});
