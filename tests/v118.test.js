const test=require('node:test');const assert=require('node:assert');const os=require('os');const fs=require('fs');const path=require('path');const crypto=require('crypto');
process.env.ADMIN_TOKEN='C'.repeat(40);process.env.TRUST_PROXY='1';process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'dgs118-'));
const srv=require('../server/stats/server.js');const R=require('../lib/remote');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const AUTH={authorization:'Bearer '+'C'.repeat(40)};
let base='';
test.before(async()=>{await new Promise(r=>srv.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${srv.server.address().port}`;});
test.after(async()=>{for(const w of srv._waiters())try{w.res.destroy();}catch{}for(const w of srv._adminWaiters())try{w.res.destroy();}catch{}await new Promise(r=>srv.server.close(r));});
let ipN=0;const j=(u,o={})=>fetch(base+u,{...o,headers:{'content-type':'application/json','x-forwarded-for':'10.0.0.'+(++ipN%250),...(o.headers||{})}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}));
const waitFor=async(fn,ms=2000)=>{const t=Date.now();while(Date.now()-t<ms){if(fn())return true;await new Promise(r=>setTimeout(r,20));}return false;};

test('panneau admin en temps réel : l’écoute admin se réveille à chaque événement',async()=>{
  assert.equal((await j('/v1/admin/watch')).status,401,'jeton obligatoire');
  const start=await j('/v1/admin/watch',{headers:AUTH});assert.equal(start.status,200);assert.ok(Number.isSafeInteger(start.body.rev));
  const t0=Date.now();
  const pending=j('/v1/admin/watch?rev='+start.body.rev,{headers:AUTH});
  assert.ok(await waitFor(()=>srv._adminWaiters().size===1),'le panneau écoute');
  await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'Un rapport pour le temps réel',v:'1.18.0'})});
  const got=await pending;assert.ok(Date.now()-t0<1500,'réveil immédiat');
  assert.deepEqual(got.body.kinds,['bugs']);assert.ok(got.body.rev>start.body.rev);
  // une note et un utilisateur actif sont signalés comme « stats »
  const next=j('/v1/admin/watch?rev='+got.body.rev,{headers:AUTH});
  assert.ok(await waitFor(()=>srv._adminWaiters().size===1));
  await j('/v1/rate',{method:'POST',body:JSON.stringify({id:'b'.repeat(32),stars:4,v:'1.18.0'})});
  assert.deepEqual((await next).body.kinds,['stats']);
  // rev ancien : réponse immédiate avec tous les types manqués
  const late=await j('/v1/admin/watch?rev='+start.body.rev,{headers:AUTH});assert.deepEqual(late.body.kinds.sort(),['bugs','stats']);
});

test('messages : retrait d’un message, y compris des navigateurs ouverts',async()=>{
  const first=await j('/v1/live?after=-1&lock=0&v=1.18.0&cc=FR');
  const pend=j(`/v1/live?after=${first.body.cursor}&lock=0&v=1.18.0&cc=FR`);
  assert.ok(await waitFor(()=>srv._waiters().size===1));
  const sent=await j('/v1/admin/messages',{method:'POST',headers:AUTH,body:JSON.stringify({text:'À retirer',level:'info'})});
  const got=await pend;assert.equal(got.body.messages[0].id,sent.body.id);
  const listen=j(`/v1/live?after=${got.body.cursor}&lock=0&v=1.18.0&cc=FR`);
  assert.ok(await waitFor(()=>srv._waiters().size===1));
  const t0=Date.now();
  const del=await j('/v1/admin/messages/'+sent.body.id,{method:'DELETE',headers:AUTH});
  assert.equal(del.status,200);assert.equal(del.body.deleted,1);assert.ok(!del.body.recent.some(m=>m.id===sent.body.id));
  const r=await listen;assert.ok(Date.now()-t0<1500);assert.deepEqual(r.body.retracted,[sent.body.id]);
  // pas de réveil en boucle : la même suppression n'est plus renvoyée après le nouveau curseur
  const again=j(`/v1/live?after=${r.body.cursor}&lock=0&v=1.18.0&cc=FR`);
  assert.ok(await waitFor(()=>srv._waiters().size===1),'le navigateur se remet en écoute (pas de réponse immédiate)');
  await j('/v1/admin/messages',{method:'POST',headers:AUTH,body:JSON.stringify({text:'Deux'})});
  await j('/v1/admin/messages',{method:'POST',headers:AUTH,body:JSON.stringify({text:'Trois'})});
  assert.deepEqual((await again).body.retracted,[]);
  const all=await j('/v1/admin/messages',{method:'DELETE',headers:AUTH});assert.equal(all.body.deleted,2);assert.deepEqual(all.body.recent,[]);
  assert.equal((await j('/v1/admin/messages/1',{method:'DELETE'})).status,401);
});

test('tchat de support : prise en charge, échanges, clé vérifiée, fin',async()=>{
  const key=crypto.randomBytes(32).toString('hex');
  const bug=await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'La vidéo se fige en plein écran',v:'1.18.0',chatKey:key})});
  const id=bug.body.id;
  const old=await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'Rapport d’une ancienne version',v:'1.17.0'})});
  const list=(await j('/v1/admin/bugs',{headers:AUTH})).body.bugs;
  const mine=list.find(b=>b.id===id);assert.equal(mine.canChat,true);assert.equal(list.find(b=>b.id===old.body.id).canChat,false);
  assert.ok(list.every(b=>!('chatKeyHash' in b)&&!('chat' in b)),'aucune empreinte de clé dans la liste admin');
  assert.ok(!fs.readFileSync(path.join(process.env.DATA_DIR,'bugs.json'),'utf8').includes(key),'la clé elle-même n’est jamais stockée');
  // rapport sans clé : discussion impossible
  assert.equal((await j(`/v1/admin/support/${old.body.id}/open`,{method:'POST',headers:AUTH,body:'{}'})).status,409);
  // le navigateur écoute avec sa clé
  const l0=await j(`/v1/live?after=-1&lock=0&v=1.18.0&chat=${key}:0`);assert.deepEqual(l0.body.support,[],'rien tant que non pris en charge');
  const pend=j(`/v1/live?after=${l0.body.cursor}&lock=0&v=1.18.0&chat=${key}:0`);
  assert.ok(await waitFor(()=>srv._waiters().size===1));
  const t0=Date.now();
  const open=await j(`/v1/admin/support/${id}/open`,{method:'POST',headers:AUTH,body:JSON.stringify({welcome:'Bonjour !'})});
  assert.equal(open.status,200);assert.equal(open.body.open,true);
  const got=await pend;assert.ok(Date.now()-t0<1500,'ouverture instantanée côté navigateur');
  const v=got.body.support[0];assert.equal(v.bugId,id);assert.equal(v.open,true);
  assert.deepEqual(v.messages.map(m=>m.from+':'+m.text),['system:open','admin:Bonjour !']);
  // l'utilisateur répond avec sa clé ; une mauvaise clé est refusée
  assert.equal((await j(`/v1/support/${id}/messages`,{method:'POST',body:JSON.stringify({key:'0'.repeat(64),text:'intrus'})})).status,403);
  assert.equal((await j(`/v1/support/${old.body.id}/messages`,{method:'POST',body:JSON.stringify({key,text:'x'})})).status,403);
  const u=await j(`/v1/support/${id}/messages`,{method:'POST',body:JSON.stringify({key,text:'Merci, sur YouTube surtout'})});
  assert.equal(u.status,200);assert.equal(u.body.messages.at(-1).from,'user');
  assert.equal((await j('/v1/admin/bugs',{headers:AUTH})).body.bugs.find(b=>b.id===id).unread,1);
  assert.equal((await j(`/v1/admin/support/${id}/read`,{method:'POST',headers:AUTH,body:'{}'})).status,204);
  // seq connu : pas de réponse en double
  const seen=await j(`/v1/live?after=-1&lock=0&v=1.18.0&chat=${key}:${u.body.seq}`);assert.deepEqual(seen.body.support,[]);
  assert.equal((await j(`/v1/support/${id}/messages`,{method:'POST',body:JSON.stringify({key,text:'   '})})).status,409,'message vide refusé');
  const long=await j(`/v1/admin/support/${id}/messages`,{method:'POST',headers:AUTH,body:JSON.stringify({text:'x'.repeat(5000)})});
  assert.equal(long.body.messages.at(-1).text.length,1000,'texte limité à 1000 caractères');
  // fin de la discussion
  const closed=await j(`/v1/admin/support/${id}/close`,{method:'POST',headers:AUTH,body:'{}'});
  assert.equal(closed.body.open,false);
  assert.equal((await j(`/v1/support/${id}/messages`,{method:'POST',body:JSON.stringify({key,text:'encore ?'})})).status,409,'discussion fermée');
  assert.equal((await j('/v1/admin/bugs',{headers:AUTH})).body.bugs.find(b=>b.id===id).status,'fixed');
  // limite de débit côté utilisateur
  const key2=crypto.randomBytes(32).toString('hex');const b2=(await j('/v1/bug',{method:'POST',body:JSON.stringify({text:'Deuxième rapport à discuter',chatKey:key2})})).body.id;
  await j(`/v1/admin/support/${b2}/open`,{method:'POST',headers:AUTH,body:'{}'});
  let last=0;for(let i=0;i<22;i++)last=(await j(`/v1/support/${b2}/messages`,{method:'POST',body:JSON.stringify({key:key2,text:'msg '+i})})).status;
  assert.equal(last,429);
});

test('rapports : suppression des corrigés ou de tous',async()=>{
  const ids=[];for(const t of ['Premier rapport à trier','Deuxième rapport à trier'])ids.push((await j('/v1/bug',{method:'POST',body:JSON.stringify({text:t})})).body.id);
  await j('/v1/admin/bugs/'+ids[0],{method:'PATCH',headers:AUTH,body:JSON.stringify({status:'fixed'})});
  const before=(await j('/v1/admin/bugs',{headers:AUTH})).body.bugs;
  const fixedCount=before.filter(b=>b.status==='fixed').length;
  const r=await j('/v1/admin/bugs?status=fixed',{method:'DELETE',headers:AUTH});assert.equal(r.body.deleted,fixedCount);
  const after=(await j('/v1/admin/bugs',{headers:AUTH})).body.bugs;assert.ok(after.every(b=>b.status!=='fixed'));assert.ok(after.some(b=>b.id===ids[1]));
  assert.equal((await j('/v1/admin/bugs',{method:'DELETE'})).status,401);
  const all=await j('/v1/admin/bugs',{method:'DELETE',headers:AUTH});assert.equal(all.body.deleted,after.length);
  assert.deepEqual((await j('/v1/admin/bugs',{headers:AUTH})).body.bugs,[]);
});

test('client : vues de support nettoyées, clé envoyée par l’écoute',()=>{
  const v=R.cleanSupport([{bugId:'a'.repeat(16),seq:3,open:true,subject:'s'.repeat(500),messages:[{from:'admin',text:'<b>x</b>',at:'t'},{from:'hacker',text:'?'}]},{bugId:'bad',seq:1}]);
  assert.equal(v.length,1);assert.equal(v[0].subject.length,140);assert.deepEqual(v[0].messages.map(m=>m.from),['admin']);assert.equal(v[0].messages[0].text,'<b>x</b>','texte brut, affiché avec textContent');
  const rc=new R.RemoteConfig({telemetry:{available:true},version:'1.18.0',country:()=>'FR',getChats:()=>[{bugId:'b'.repeat(16),key:'c'.repeat(64)},{bugId:'x',key:'y'}]});
  rc.chatSeq.set('b'.repeat(16),7);
  assert.equal(rc.chatQuery(),'&chat='+'c'.repeat(64)+':7');
  assert.equal(new R.RemoteConfig({telemetry:{},version:'1',country:()=>''}).chatQuery(),'');
});

test('navigateur : clé de support privée, fenêtres isolées, IPC liée à la fenêtre',()=>{
  const main=read('main.js');
  assert.match(main,/randomBytes\(32\)\.toString\('hex'\)/);
  assert.match(main,/'dismissedMessages','supportChats'\]\.includes\(key\)\) throw new Error\('Réglage protégé\.'\)/,'clé non modifiable depuis l’interface');
  assert.match(main,/const supportOf=event=>supportOwner\.get\(event\.sender\.id\)/,'discussion déduite de la fenêtre appelante');
  assert.match(main,/ui', 'support', 'preload\.js'\), nodeIntegration: false, contextIsolation: true, sandbox: true/);
  const pre=read('ui/support/preload.js');
  for(const ch of ['dgb-support:get','dgb-support:send','dgb-support:end','dgb-support:update'])assert.ok(pre.includes(ch),ch);
  assert.ok(!/require\('(fs|child_process|path)'\)/.test(pre));
  const html=read('ui/support/index.html');assert.match(html,/default-src 'self'; script-src 'self'/);
  const js=read('ui/support/support.js');assert.ok(!/innerHTML/.test(js),'messages affichés en texte brut');
  // panneau admin : temps réel sans relire GitHub à chaque événement
  const r=read('ui/renderer.js');
  assert.match(r,/api\.onAdminEvent\(/);assert.match(r,/Date\.now\(\)-adminLive\.githubAt>10\*60_000/);
  assert.match(main,/'admin:server-stats':async s=>\{\r?\n\s+if\(!s\.adminOpen\)/);
});

test('interface 1.18 : accueil, bouton des succès, plus de prompt()',()=>{
  const html=read('ui/index.html'),r=read('ui/renderer.js'),css=read('ui/home.css');
  assert.ok(!/[^.\w]prompt\(['"`]/.test(r),'Electron ne gère pas prompt()');
  assert.match(html,/<div class="status-cluster">\s*<button id="trophy-btn"[^>]*><svg class="trophy-ico"/,'icône neutre collée à l’heure');
  assert.ok(!html.includes('🏆</span>'));
  for(const id of ['start-search','start-address','open-babel','home-sites','home-sites-section','card-history','card-bookmarks','card-security','card-network','hp-greet'])assert.ok(html.includes(`id="${id}"`),id);
  assert.match(html,/href="home\.css"/);assert.match(html,/<button id="open-babel" class="bv-banner" type="button"[^>]*><img src="\.\.\/assets\/babelvisio-banniere\.webp" alt="[^"]+"/);
  assert.ok(fs.statSync(path.join(root,'assets','babelvisio-banniere.webp')).size<250_000,'image légère');
  assert.match(css,/\.bv-banner:after\{/);assert.ok(!html.includes('actifs sur 30 jours</span>'),'légende de la carte retirée');
  // les anciennes classes de l'accueil ne sont plus dans les feuilles de style
  for(const f of ['ui/style.css','ui/themes.css'])for(const c of ['.intro-panel','.promo-babel','.quick-item','.hero-hologram'])assert.ok(!read(f).includes(c),f+' '+c);
  const en=JSON.parse(read('i18n/en.json'));for(const k of ['Bonsoir','Raccourcis','Découvrir BabelVisio','Terminer la discussion','Discussion terminée'])assert.ok(en[k],k);
});

test('serveur : X-Forwarded-For ignoré sans proxy déclaré',()=>{
  const s=read('server/stats/server.js');
  assert.match(s,/const TRUST_PROXY = process\.env\.TRUST_PROXY === '1';/);
  assert.match(s,/\(TRUST_PROXY && req\.headers\['x-forwarded-for'\]\)/);
});

test('serveur pas à jour : signalé clairement dans le panneau admin',async()=>{
  assert.equal((await j('/health')).body.api,18);assert.equal((await j('/v1/admin/config',{headers:AUTH})).body.api,18);
  const r=read('ui/renderer.js'),main=read('main.js'),sh=read('server/stats/install.sh');
  assert.match(r,/\$\('admin-outdated'\)\.classList\.toggle\('hidden',Number\(c\.api\)>=18\)/);
  assert.match(main,/async function outdatedServer\(e, token\)/);
  assert.match(sh,/api\.github\.com\/repos\/hempreur\/DevGitBrowser\/contents\/server\/stats\/server\.js/,'installation sans cache');
  assert.match(sh,/if ! node --check "\$APP_DIR\/server\.new\.js"; then/,'extension .js obligatoire pour node --check');
});

test('paquet : sources du logo exclues de l’installateur, version 1.18',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('!assets/brand-source.png'));assert.ok(pkg.build.files.includes('!assets/generate-icon.py'));
  assert.equal(pkg.version,'1.18.4');assert.match(read('CHANGELOG.md'),/^## 1\.18\.4/);
});

test('1.18.2 : bouton Mode IE toujours disponible dans la barre (Windows)',()=>{
  const html=read('ui/index.html'),r=read('ui/renderer.js'),main=read('main.js');
  assert.match(html,/<div class="nav-tools">\s*<button id="legacy-button" class="nav-tool icon legacy-button hidden"/);
  assert.match(r,/const showIE=state\.platform==='win32' && hasPage;/);
  assert.match(r,/\$\('legacy-button'\)\.disabled=Boolean\(legacy\.modernOnly\)&&legacy\.engine==='chromium';/);
  assert.match(main,/modernOnly:Boolean\(t\?\.url&&requiresModernVideo\(t\.url\)\)/);
});
