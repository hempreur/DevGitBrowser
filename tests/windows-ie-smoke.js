'use strict';
// Windows-only integration smoke test. It launches a real native MSHTML WebBrowser
// control as a child of a real HWND and serves a local HTML document over HTTP.
const {spawn}=require('node:child_process');
const http=require('node:http');
const path=require('node:path');
const {decodeEvent,encodeCommand}=require('../lib/legacy-embedded');
if(process.platform!=='win32'){console.error('Windows required');process.exit(1);}
const server=http.createServer((_req,res)=>{
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
  res.end('<!doctype html><html><head><title>MSHTML smoke test</title></head><body><h1>MSHTML loaded</h1></body></html>');
});
let parent=null,helper=null,deadline=null;
function stop(){clearTimeout(deadline);try{helper?.stdin?.write(encodeCommand('QUIT'));}catch{}
  try{helper?.kill();}catch{}try{parent?.kill();}catch{}server.close();}
function fail(reason){console.error('MSHTML integration failure: '+reason);stop();process.exitCode=1;}
function lines(stream,onLine){let buffer='';stream.setEncoding('utf8');stream.on('data',data=>{
  buffer+=data; if(buffer.length>65536){fail('event stream overflow');return;}
  let i;while((i=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,i).trimEnd();buffer=buffer.slice(i+1);onLine(line);}
});}
server.listen(0,'127.0.0.1',()=>{
  const url='http://127.0.0.1:'+server.address().port+'/';
  parent=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-parent.ps1')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  deadline=setTimeout(()=>fail('timeout waiting for child window and page load'),35000);
  let booted=false,attached=false,loaded=false;
  lines(parent.stdout,line=>{
    if(booted||!line.startsWith('PARENT\t'))return;
    booted=true;
    const handle=line.split('\t')[1];
    console.log('Native parent HWND acquired.');
    helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-WindowStyle','Hidden',
      '-File',path.resolve(__dirname,'../legacy/embedded-ie.ps1'),'-ParentHandle',handle,'-InitialUrl',url,
      '-X','0','-Y','118','-Width','850','-Height','540'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    helper.on('error',e=>fail(e.message));
    let stderr='';helper.stderr.setEncoding('utf8');helper.stderr.on('data',c=>{stderr+=c.slice(0,400);});
    helper.on('exit',code=>{if(!loaded)fail('helper quit: '+code+' '+stderr.slice(0,300));});
    lines(helper.stdout,line=>{
      const m=decodeEvent(line);if(!m){if(line.trim())console.log('Helper: '+line.slice(0,150));return;}
      console.log('MSHTML event: '+m.event);
      if(m.event==='ERROR'){fail(m.value);return;}
      if(m.event==='ATTACHED')attached=true;
      if(m.event==='READY' && m.value===url){
        if(!attached){fail('document loaded before native parent attachment');return;}
        loaded=true;console.log('PASS: MSHTML attached to native parent and loaded localhost document');stop();
      }
    });
  });
  parent.on('error',e=>fail(e.message));
  parent.on('exit',code=>{if(!loaded)fail('native parent exited: '+code);});
  lines(parent.stderr,line=>{if(line)console.error('Parent: '+line.slice(0,300));});
});
