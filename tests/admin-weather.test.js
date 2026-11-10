const test=require('node:test');const assert=require('node:assert');
const admin=require('../lib/admin');const weather=require('../lib/weather');
test('clé admin : génération, format et vérification',()=>{
  const k=admin.generateKey();assert.match(k,/^DGB-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const h=admin.hashSecret(k);assert.ok(admin.isHash(h));
  assert.ok(admin.verifySecret(admin.normalizeKey(k.toLowerCase().replace(/-/g,' ')),h));
  assert.ok(!admin.verifySecret(admin.generateKey(),h));
  assert.ok(!admin.verifySecret('x','pas-un-hash'));
});
test('mots de sécurité : ordre exigé, casse et espaces ignorés',()=>{
  assert.ok(admin.verifySecret(admin.recoveryPhrase([' Portugal','BENFICA','1904 ']),admin.RECOVERY_HASH));
  assert.ok(!admin.verifySecret(admin.recoveryPhrase(['Benfica','Portugal','1904']),admin.RECOVERY_HASH));
  assert.ok(!admin.verifySecret(admin.recoveryPhrase(['Portugal','Benfica']),admin.RECOVERY_HASH));
});
test('aucune clé en clair dans le code',()=>{
  const src=require('fs').readFileSync(require.resolve('../lib/admin'),'utf8');
  assert.doesNotMatch(src,/DGB-[A-Z2-9]{4}-[A-Z2-9]{4}/);assert.doesNotMatch(src,/benfica/i);
});
test('verrou anti-essais après 5 erreurs',()=>{
  const l=admin.createLimiter();for(let i=0;i<5;i++){l.check();l.fail();}
  assert.throws(()=>l.check(),/Trop d’essais/);
});
test('statistiques résumées depuis les releases GitHub',()=>{
  const now=new Date(Date.now()-2*86400000).toISOString();
  const st=admin.summarize({stargazers_count:5,forks_count:1,subscribers_count:2,open_issues_count:3},[
    {tag_name:'v1.7.0',published_at:now,assets:[{name:'DevGitBrowser-Setup-1.7.0.exe',download_count:10},{name:'DevGitBrowser-Setup-1.7.0.exe.blockmap',download_count:40},{name:'latest.yml',download_count:400}]},
    {tag_name:'v1.6.0',published_at:now,assets:[{name:'DevGitBrowser-Setup-1.6.0.exe',download_count:20}]},{tag_name:'brouillon',draft:true,assets:[]}]);
  assert.equal(st.totals.installs,30);assert.equal(st.totals.updates,40);assert.equal(st.totals.releases,2);
  assert.equal(st.activity.version,'v1.7.0');assert.ok(st.activity.checksPerDay>=190&&st.activity.checksPerDay<=210);assert.equal(st.repo.stars,5);
});
test('météo : ville et température via Open-Meteo',async()=>{
  const fake=async url=>({ok:true,status:200,json:async()=>url.includes('geocoding')?{results:[{name:'Lisbonne',country_code:'PT',latitude:38.7,longitude:-9.1}]}:{current:{temperature_2m:17.6,weather_code:2,is_day:1}}});
  const city=await weather.findCity(fake,'lisbonne');assert.equal(city.name,'Lisbonne');assert.ok(weather.validCity(city));
  const now=await weather.current(fake,city);assert.equal(now.temp,18);assert.equal(now.label,'Éclaircies');assert.equal(now.icon,'partly');
  await assert.rejects(weather.findCity(async()=>({ok:true,json:async()=>({})}),'zzzz'),/introuvable/);
});
