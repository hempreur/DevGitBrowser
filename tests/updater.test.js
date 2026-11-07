'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {UpdateService}=require('../lib/updater');

test('Development builds never try to update',()=>{
  const u=new UpdateService({app:{isPackaged:false,getVersion:()=>'1.4.0'}});
  u.start();
  assert.equal(u.state.status,'disabled');
  assert.throws(()=>u.install(),/Aucune mise à jour/);
});
test('Packaged builds download in the background and install on demand',async()=>{
  const fake=new EventEmitter();let installed=null;
  fake.checkForUpdates=async()=>{fake.emit('checking-for-update');fake.emit('update-available',{version:'1.4.1'});fake.emit('download-progress',{percent:42.4});fake.emit('update-downloaded',{version:'1.4.1'});};
  fake.quitAndInstall=(silent,run)=>{installed={silent,run};};
  const states=[];
  const u=new UpdateService({app:{isPackaged:true,getVersion:()=>'1.4.0'},enabled:false,onState:s=>states.push(s.status),loadUpdater:()=>fake});
  u.start();
  assert.equal(fake.autoDownload,true);assert.equal(fake.autoInstallOnAppQuit,true);
  await u.check();
  assert.ok(states.includes('downloading'));
  assert.equal(u.state.status,'downloaded');assert.equal(u.state.version,'1.4.1');
  u.install();await new Promise(r=>setImmediate(r));
  assert.deepEqual(installed,{silent:true,run:true});
  fake.emit('error',new Error('net::ERR_INTERNET_DISCONNECTED\nstack'));
  assert.equal(u.state.status,'error');assert.equal(u.state.error,'net::ERR_INTERNET_DISCONNECTED');
  u.stop();
});
test('Release publishing is configured for electron-updater',()=>{
  const pkg=require('../package.json');
  assert.equal(pkg.build.publish[0].provider,'github');
  assert.equal(pkg.build.publish[0].owner,'hempreur');
  assert.ok(pkg.dependencies['electron-updater']);
  const wf=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','.github','workflows','windows-installer.yml'),'utf8');
  assert.match(wf,/latest\.yml/);
  assert.match(wf,/gh release create/);
});
