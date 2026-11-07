'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BrowsingData}=require('../lib/browsing-data');
function store(initial=null){let saved=initial;let now=1_700_000_000_000;
  const data=new BrowsingData({read:()=>saved,write:v=>{saved=JSON.parse(JSON.stringify(v));},now:()=>(now+=1000),debounceMs:5});
  return {data,saved:()=>saved};}

test('History records web pages only, deduplicates and keeps the latest visit first',()=>{
  const {data}=store();
  data.record('https://example.com/a','Page A');
  data.record('https://example.com/b','Page B');
  data.record('https://example.com/a','Page A bis');
  data.record('file:///C:/secret.txt','x');data.record('javascript:alert(1)','x');data.record('https://user:pass@example.com/','x');
  const list=data.listHistory();
  assert.equal(list.total,2);
  assert.equal(list.items[0].url,'https://example.com/a');
  assert.equal(list.items[0].visits,2);
  assert.equal(list.items[0].title,'Page A bis');
  assert.equal(data.listHistory({query:'page b'}).items[0].url,'https://example.com/b');
  data.removeHistory('https://example.com/b');
  assert.equal(data.listHistory().total,1);
  data.clearHistory(0);
  assert.equal(data.listHistory().total,0);
});
test('Bookmarks toggle, rename, reorder and persist across restarts',()=>{
  const s=store();
  const {data}=s;
  assert.equal(data.toggleBookmark('https://twitch.tv/','Twitch'),true);
  data.addBookmark('https://youtube.com/','YouTube');
  data.addBookmark('https://youtube.com/','Doublon');
  assert.equal(data.bookmarks.length,2);
  assert.equal(data.isBookmarked('https://twitch.tv/'),true);
  const yt=data.bookmarks.find(b=>b.url==='https://youtube.com/');
  data.renameBookmark(yt.id,'  Vidéos  ');
  data.moveBookmark(yt.id,0);
  assert.equal(data.bookmarks[0].title,'Vidéos');
  assert.throws(()=>data.addBookmark('chrome://settings'),/http/);
  assert.equal(data.toggleBookmark('https://twitch.tv/'),false);
  data.flush();
  const again=new BrowsingData({read:()=>s.saved()});
  assert.equal(again.bookmarks.length,1);
  assert.equal(again.bookmarks[0].title,'Vidéos');
});
test('Address suggestions put bookmarks first, then frequently visited pages',()=>{
  const {data}=store();
  data.record('https://news.example.com/','Actualités');
  data.record('https://www.example.com/','Example');data.record('https://www.example.com/','Example');
  data.addBookmark('https://docs.example.com/','Documentation');
  const s=data.suggestions('exam');
  assert.equal(s[0].kind,'favori');
  assert.equal(s[1].url,'https://www.example.com/');
  assert.deepEqual(data.suggestions(''),[]);
  assert.ok(data.topSites(3).length<=3);
});
test('Corrupted storage is ignored safely',()=>{
  const data=new BrowsingData({read:()=>({history:[{url:'javascript:x',visitedAt:1},{url:'https://ok.example/',visitedAt:5,title:'<b>'+'x'.repeat(500)}],bookmarks:[{id:'../../x',url:'https://a.example/'},{id:'b123456',url:'https://b.example/'}]})});
  assert.equal(data.history.length,1);
  assert.ok(data.history[0].title.length<=160);
  assert.equal(data.bookmarks.length,1);
});
