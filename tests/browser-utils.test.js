'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const U=require('../lib/browser-utils');

test('User agent no longer reveals Electron or the app token',()=>{
  const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) devgitbrowser/1.4.0 Chrome/140.0.7339.0 Electron/45.2.3 Safari/537.36';
  const clean=U.cleanUserAgent(ua);
  assert.doesNotMatch(clean,/Electron|devgitbrowser/i);
  assert.match(clean,/Chrome\/140/);
});
test('HTTPS-first upgrades public http URLs only',()=>{
  assert.equal(U.httpsUpgrade('http://example.com/a?b=1'),'https://example.com/a?b=1');
  assert.equal(U.httpsUpgrade('http://example.com:80/'),'https://example.com/');
  assert.equal(U.httpsUpgrade('https://example.com/'),null);
  for(const local of ['http://localhost:3000/','http://127.0.0.1/','http://192.168.1.1/','http://10.0.0.2/','http://routeur/'])assert.equal(U.httpsUpgrade(local),null,local);
});
test('Dangerous downloads and external protocols are recognised',()=>{
  for(const f of ['setup.exe','x.MSI','script.ps1','a.tar.js','facture.pdf.exe','raccourci.lnk'])assert.equal(U.isDangerousFile(f),true,f);
  for(const f of ['photo.jpg','doc.pdf','archive.zip','video.mp4'])assert.equal(U.isDangerousFile(f),false,f);
  assert.equal(U.externalProtocolAllowed('mailto:a@b.c'),true);
  assert.equal(U.externalProtocolAllowed('file:///C:/Windows/system32/calc.exe'),false);
  assert.equal(U.externalProtocolAllowed('ms-msdt:/id'),false);
});
test('Tab order helper and search engines',()=>{
  const m=new Map([[1,'a'],[2,'b'],[3,'c']]);
  U.insertInMap(m,3,'c',0);assert.deepEqual([...m.keys()],[3,1,2]);
  U.insertInMap(m,4,'d',2);assert.deepEqual([...m.keys()],[3,1,4,2]);
  U.insertInMap(m,1,'a',99);assert.deepEqual([...m.keys()],[3,4,2,1]);
  assert.equal(U.searchUrl('google','chat & chien'),'https://www.google.com/search?q=chat%20%26%20chien');
  assert.match(U.searchUrl('inconnu','x'),/duckduckgo/);
});
test('Error page escapes the failing URL and offers the HTTP fallback only when given',()=>{
  const page=decodeURIComponent(U.errorPage({url:'https://x.example/"><script>alert(1)</script>',code:-202,description:'ERR_CERT_AUTHORITY_INVALID'}).split(',')[1]);
  assert.doesNotMatch(page,/<script>alert/);
  assert.match(page,/Connexion non sécurisée/);
  assert.doesNotMatch(page,/Continuer en HTTP/);
  const fb=decodeURIComponent(U.errorPage({url:'https://old.example/',code:-107,httpFallback:'http://old.example/'}).split(',')[1]);
  assert.match(fb,/Continuer en HTTP/);
});
