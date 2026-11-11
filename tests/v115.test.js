const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const A=require('../lib/achievements');const EN=JSON.parse(read('i18n/en.json'));const I=require('../ui/i18n.js');

test('succès : définitions complètes, icônes uniques, paliers, traductions',()=>{
  assert.ok(A.ACHIEVEMENTS.length>=45);
  const ids=new Set(),icons=new Set();
  for(const a of A.ACHIEVEMENTS){
    assert.ok(!ids.has(a.id),'id en double '+a.id);ids.add(a.id);
    assert.ok(!icons.has(a.icon),'icône en double '+a.icon+' ('+a.id+')');icons.add(a.icon);
    assert.ok(A.TIERS[a.tier]&&a.target>0&&a.name&&a.desc&&a.nameEn&&a.descEn,a.id);
    assert.ok(A.CATEGORIES.some(c=>c.id===a.category),a.id);
  }
  const pairs=A.i18nPairs();for(const a of A.ACHIEVEMENTS){assert.equal(pairs[a.name],a.nameEn);assert.equal(pairs[a.desc],a.descEn);}
  for(const k of ['🏆 Mes succès','Argent','🏆 Succès débloqué : {0}'])assert.ok(EN[k],k);
  const tr=I.createTranslator({...pairs,...EN});
  assert.equal(tr.t('🏆 Succès débloqué : 🐉 Gardien légendaire'),'🏆 Achievement unlocked: 🐉 Legendary guardian','annonce traduite avec le nom');
});

test('succès : temps, jours, séries, nuit, déblocage et persistance',()=>{
  let now=new Date(2026,10,10,2,0);let saved=null;const unlocked=[];
  const a=new A.Achievements({read:()=>null,write:d=>{saved=JSON.parse(JSON.stringify(d));},now:()=>now,onUnlock:l=>unlocked.push(...l.map(x=>x.id))});
  for(let i=0;i<10;i++)a.tickMinute({});
  assert.ok(unlocked.includes('first_steps'));assert.equal(a.stats.nightMinutes,10);
  // 7 jours d'affilée
  for(let d=1;d<7;d++){now=new Date(2026,10,10+d,14,0);a.tickMinute({vpn:true});}
  assert.equal(a.stats.days,7);assert.equal(a.stats.bestStreak,7);assert.ok(unlocked.includes('regular')&&unlocked.includes('streak7'));
  // trou d'un jour : la série repart à 1, la meilleure série reste 7
  now=new Date(2026,10,19,14,0);a.tickMinute({});assert.equal(a.streak,1);assert.equal(a.stats.bestStreak,7);
  assert.equal(a.stats.vpnMinutes,6);
  // événements
  a.bump('ads',150);assert.ok(unlocked.includes('ads_100'));
  a.atLeast('referrals',1);a.atLeast('referrals',0);assert.equal(a.stats.referrals,1);assert.ok(unlocked.includes('first_referral'));
  a.addDistinct('themes','neon');a.addDistinct('themes','neon');a.addDistinct('themes','ocean');a.addDistinct('themes','sable');assert.ok(unlocked.includes('chameleon'));
  assert.deepEqual(a.bump('inconnu',5),[]);assert.deepEqual(a.bump('ads',-3),[]);
  const before=unlocked.length;a.bump('ads',1);assert.equal(unlocked.length,before,'pas de double déblocage');
  a.flush();assert.ok(saved.unlocked.first_steps);
  const b=new A.Achievements({read:()=>saved,now:()=>now});assert.equal(b.stats.ads,151);assert.equal(b.stats.themes,3);assert.ok(b.unlocked.chameleon);assert.equal(b.streak,1);
});

test('succès secrets DGBx : invisibles hors du mode, points et rang',()=>{
  const a=new A.Achievements({now:()=>new Date(2026,10,10,15,0)});
  for(let i=0;i<10;i++)a.tickMinute({dgbx:true});
  assert.ok(a.unlocked.dgbx_first);
  const pub=a.summary();assert.ok(!pub.list.some(x=>x.secret));assert.ok(!pub.categories.some(c=>c.id==='secret'));
  assert.ok(!pub.list.some(x=>x.unseen&&x.id==='dgbx_first'));
  const priv=a.summary({includeSecret:true});assert.ok(priv.list.some(x=>x.id==='dgbx_first'&&x.unlockedAt));
  assert.equal(pub.rank.points,10);assert.equal(priv.rank.points,20,'points secrets comptés seulement dans le mode');
  a.markSeen(false);assert.ok(a.unseen.has('dgbx_first'),'le nouveau succès secret reste à découvrir dans le mode');
  a.markSeen(true);assert.equal(a.unseen.size,0);
  a.bump('ads',100000);a.bump('pages',10000);assert.ok(a.rank().points>=150);assert.equal(a.rank().fr,'Explorateur');
});

test('succès et invitations câblés dans le navigateur',()=>{
  const main=read('main.js'),html=read('ui/index.html'),js=read('ui/renderer.js');
  assert.match(html,/id="trophy-btn"[^>]*>.*🏆/);assert.ok(html.indexOf('id="trophy-btn"')<html.indexOf('id="clock-weather"'),'à côté de la météo et de l’heure');
  for(const c of ['link','message','whatsapp','discord','telegram','x','facebook','reddit','email'])assert.match(html,new RegExp(`data-share="${c}"`),c);
  for(const k of ['pages','bookmarks','pip','privateTabs','previews','extensions','breachChecks','trackerReports','invites','bugs','imports'])assert.match(main,new RegExp(`ach\\('bump', ?'${k}'`),k);
  assert.match(main,/if \(a\.secret && !inDgbx\(\)\) continue;/);assert.match(main,/'ach:summary':s=>achievements\?achievements\.summary\(\{includeSecret:Boolean\(s\.xmode\)\}\)/);
  assert.match(main,/'ach:event':\(_s,name\)=>\{if\(\['generated'\]\.includes\(name\)\)/,'seuls les événements prévus viennent de l’interface');
  assert.match(js,/renderTrophy\(state\)/);assert.match(main,/i18nPairs\(\)/);
});
