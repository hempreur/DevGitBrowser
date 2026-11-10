'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {VideoLocal,validateRequest,isYoutubeWatchUrl}=require('../lib/video-local');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dgb-video-'));
for(const file of ['ffmpeg.exe','ffprobe.exe','deno.exe'])fs.writeFileSync(path.join(dir,file),'test');
const script=path.join(dir,'fake.js');
fs.writeFileSync(script,`const fs=require('fs');const a=process.argv.slice(2);
if(a.includes('--dump-single-json')){console.log(JSON.stringify({title:'Démo',formats:[{vcodec:'avc1',height:360},{vcodec:'vp9',height:720},{vcodec:'none',height:1080}]}));process.exit(0);}
const ix=a.indexOf('-o');if(ix<0)process.exit(1);
const filename=a[ix+1].replace('%(ext)s',a.includes('--audio-format')?'mp3':'mp4');fs.writeFileSync(filename,'OK');
`);
const tool=()=>new VideoLocal({toolDir:dir,command:process.execPath,prefixArgs:[script]});
test('origine et identifiant YouTube stricts',()=>{
  assert.equal(isYoutubeWatchUrl('https://www.youtube.com/watch?v=abcdEFG-123','abcdEFG-123'),true);
  assert.equal(isYoutubeWatchUrl('https://evil.invalid/watch?v=abcdEFG-123','abcdEFG-123'),false);
  assert.throws(()=>validateRequest('invalid','mp4',720),/Identifiant/);
  assert.throws(()=>validateRequest('abcdEFG-123','mp3',111),/Qualité/);
});
test('liste locale des qualités',async()=>{
  const info=await tool().formats('abcdEFG-123');
  assert.deepEqual(info.heights,[360,720]);
  assert.deepEqual(info.audioBitrates,[128,192,320]);
});
test('MP4 et MP3 créés sur le disque local',async()=>{
  const engine=tool();
  for(const kind of ['mp4','mp3']){
    const file=path.join(dir,'capture.'+kind);
    const value=await engine.download({videoId:'abcdEFG-123',kind,quality:kind==='mp4'?720:192,savePath:file});
    assert.equal(value.filename,path.basename(file));
    assert.equal(fs.readFileSync(file,'utf8'),'OK');
  }
  assert.equal(engine.busy,false);
});
test('outils manquants refusés',async()=>{
  await assert.rejects(new VideoLocal({toolDir:path.join(dir,'missing')}).formats('abcdEFG-123'),/Moteur local manquant/);
});
