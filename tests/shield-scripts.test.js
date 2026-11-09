'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {earlyMainWorldScripts,earlyCss,twitchWorkerHook,isHost}=require('../lib/shield-scripts');

test('Scriptlets are generated only for YouTube and Twitch, never for lookalike domains',()=>{
  assert.equal(earlyMainWorldScripts('www.youtube.com').length,1);
  assert.equal(earlyMainWorldScripts('m.youtube.com').length,1);
  assert.equal(earlyMainWorldScripts('www.twitch.tv').length,1);
  assert.equal(earlyMainWorldScripts('youtube.com.evil.net').length,0);
  assert.equal(earlyMainWorldScripts('notyoutube.com').length,0);
  assert.equal(earlyCss('example.com'),'');
  assert.equal(isHost('a.twitch.tv','twitch.tv'),true);
  for(const code of [...earlyMainWorldScripts('www.youtube.com'),...earlyMainWorldScripts('www.twitch.tv')])new vm.Script(code);
});
test('YouTube player responses lose their ad placements before the player reads them',()=>{
  const intervals=[];
  const sandbox={JSON:{parse:JSON.parse,stringify:JSON.stringify},Response:function(){},setInterval:fn=>intervals.push(fn),
    document:{documentElement:null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){}},MutationObserver:function(){this.observe=()=>{};},
    Object,Reflect,Proxy,Array};
  sandbox.Response.prototype.json=async function(){return {adPlacements:[1],playerAds:[2],streamingData:{ok:true}};};
  sandbox.window=sandbox;
  vm.createContext(sandbox);
  vm.runInContext(earlyMainWorldScripts('www.youtube.com')[0],sandbox);
  const parsed=vm.runInContext('JSON.parse(\'{"adPlacements":[1],"playerAds":[2],"adSlots":[3],"videoDetails":{"id":"x"}}\')',sandbox);
  assert.equal(parsed.adPlacements,undefined);assert.equal(parsed.playerAds,undefined);assert.equal(parsed.adSlots,undefined);
  assert.equal(parsed.videoDetails.id,'x');
  vm.runInContext('window.ytInitialPlayerResponse={adPlacements:[1],videoDetails:{title:"t"}}',sandbox);
  const initial=vm.runInContext('window.ytInitialPlayerResponse',sandbox);
  assert.equal(initial.adPlacements,undefined);assert.equal(initial.videoDetails.title,'t');
  assert.equal(vm.runInContext('JSON.parse("[1,2]").length',sandbox),2);
  assert.ok(intervals.length>=1,'filet de sécurité « Ignorer la pub » installé');
});
test('Twitch worker hook removes stitched ad segments when no ad-free variant is available',async()=>{
  const ad='#EXTM3U\n#EXT-X-DATERANGE:ID="x",CLASS="twitch-stitched-ad"\n#EXTINF:2.000,Amazon|123\nhttps://video/ad1.ts\n#EXTINF:2.000,live\nhttps://video/live1.ts\n';
  const calls=[];
  const scope={fetch:async(input)=>{const url=String(input?.url||input);calls.push(url);
      if(url.includes('gql.twitch.tv'))return new Response('{}',{status:500});
      return new Response(url.includes('usher')?'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\nhttps://video-weaver.hls.ttvnw.net/v1/playlist/abc.m3u8\n':ad);},
    Response,URL,Map,Date,Math,JSON,encodeURIComponent,decodeURIComponent,Promise};
  scope.self=scope;
  vm.createContext(scope);
  vm.runInContext('('+twitchWorkerHook.toString()+')()',scope);
  await scope.fetch('https://usher.ttvnw.net/api/channel/hls/streamer.m3u8?token=x');
  const res=await scope.fetch('https://video-weaver.hls.ttvnw.net/v1/playlist/abc.m3u8');
  const text=await res.text();
  assert.doesNotMatch(text,/ad1\.ts/);
  assert.match(text,/live1\.ts/);
  assert.ok(calls.some(u=>u.includes('gql.twitch.tv')),'une variante sans publicité a été demandée');
  const other=await scope.fetch('https://static.twitchcdn.net/app.js');
  assert.ok(other instanceof Response);
});
