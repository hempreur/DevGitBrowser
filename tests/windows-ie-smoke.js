'use strict';
// Windows-only integration smoke test. It launches a real native MSHTML WebBrowser
// control as an owned native overlay above a real HWND and serves a local HTML document over HTTP.
const {spawn}=require('node:child_process');
const http=require('node:http');
const path=require('node:path');
const {decodeEvent,encodeCommand}=require('../lib/legacy-embedded');
if(process.platform!=='win32'){console.error('Windows required');process.exit(1);}
const executable=process.argv[2]||'DevGitLegacyHost.exe';
if(!['DevGitLegacyHost.exe','DevGitLegacyHost32.exe'].includes(executable))throw new Error('Unexpected host name');
const expectedBitness=executable==='DevGitLegacyHost32.exe'?'32 bits':'64 bits';
const server=http.createServer((_req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end(_req.url==='/popup'?'<html><head><title>MSHTML popup</title></head><body>POPUP CHILD</body></html>':'<!doctype html><html><head><title>MSHTML smoke test</title></head><body><h1>MSHTML loaded</h1><a id=\"popup\" href=\"/popup\" target=\"_blank\">Open IE popup</a></body></html>');
});
let parent=null,helper=null,deadline=null,finished=false;
function stop(){clearTimeout(deadline);try{helper?.stdin?.end();}catch{}try{helper?.kill();}catch{}try{parent?.kill();}catch{}server.close();}
function fail(reason){if(finished)return;finished=true;console.error('MSHTML integration failure: '+reason);process.exitCode=1;stop();}
function pass(){if(finished)return;finished=true;console.log('PASS: IE11 '+expectedBitness+' overlay and native popup child both loaded within MSHTML');stop();}
function lines(stream,onLine){let buffer='';stream.setEncoding('utf8');stream.on('data',data=>{
  buffer+=data; if(buffer.length>65536){fail('event stream overflow');return;}
  let i;while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i).replace(/\r$/, '');buffer=buffer.slice(i+1);onLine(line);}
});}
server.listen(0,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+server.address().port+'/';
  parent=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-parent.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  deadline=setTimeout(()=>fail('timeout waiting for MSHTML parent display and IE popup load'),45000);
  let booted=false,attached=false,loaded=false,displayed=false,popupOpened=false,popupLoaded=false,documentMode=0,hostBits='';
  lines(parent.stdout,line=>{
    if(booted||!line.startsWith('PARENT\t'))return;
    booted=true;
    const handle=line.split('\t')[1];
    console.log('Native parent HWND acquired.');
    helper=spawn(path.resolve(__dirname,'../legacy',executable),['-ParentHandle',handle,'-InitialUrl',url,
      '-X','40','-Y','140','-Width','850','-Height','540'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    helper.on('error',e=>fail(e.message));
    let stderr='';helper.stderr.setEncoding('utf8');helper.stderr.on('data',c=>{stderr+=c.slice(0,400);});
    helper.on('exit',code=>{if(!loaded)fail('helper quit: '+code+' '+stderr.slice(0,300));});
    lines(helper.stdout,line=>{
      const m=decodeEvent(line);if(!m){if(line.trim())console.log('Helper: '+line.slice(0,150));return;}
      console.log('MSHTML event: '+m.event);
      if(m.event==='ERROR'){fail(m.value);return;}
      if(m.event==='ATTACHED')attached=(m.value==='OWNED_OVERLAY');
      if(m.event==='HOSTARCH')hostBits=m.value;
      if(m.event==='MODE')documentMode=Number(m.value)||0;
      if(m.event==='INCOMPATIBLE'){fail(m.value);return;}
      if(m.event==='POPUP'){popupOpened=true; if(loaded && displayed && popupLoaded)pass();}
      if(m.event==='POPUPREADY'){popupLoaded=true; if(loaded && displayed && popupOpened)pass();}
      if(m.event==='DISPLAY'){displayed=true; if(loaded && popupOpened && popupLoaded)pass();}
      if(m.event==='READY' && m.value===url){
        if(!attached){fail('document loaded before native parent attachment');return;}
        if(documentMode<11){fail('IE11 standards mode required, found: '+documentMode);return;}
        if(hostBits!==expectedBitness){fail('Wrong native host bitness: '+hostBits+' instead of '+expectedBitness);return;}
        loaded=true;helper.stdin.write(encodeCommand('TESTPOPUP'));if(displayed && popupOpened && popupLoaded)pass();
      }
    });
  });
  parent.on('error',e=>fail(e.message));
  parent.on('exit',code=>{if(!loaded)fail('native parent exited: '+code);});
  lines(parent.stderr,line=>{if(line)console.error('Parent: '+line.slice(0,300));});
});
