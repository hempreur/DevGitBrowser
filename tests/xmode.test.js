const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const main=fs.readFileSync(path.join(root,'main.js'),'utf8');
const renderer=fs.readFileSync(path.join(root,'ui/renderer.js'),'utf8');
test('la commande %SxOnSite% est interceptée et jamais envoyée à la recherche',()=>{
  assert.match(renderer,/XMODE_COMMAND=\/\^\\s\*%SxOnSite%\\s\*\$\/i/);
  assert.match(main,/function navigate\(s,text\) \{ if \(XMODE_COMMAND\.test/);
});
test('les onglets DGBx sont exclus de l\'historique et de la session',()=>{
  assert.match(main,/!t\.xTab\)/);
  assert.match(main,/xTab:Boolean\(s\.xmode\)/);
});
test('le code d\'accès est haché (scrypt) et la majorité est obligatoire',()=>{
  assert.match(main,/'scrypt\$'/);assert.match(main,/timingSafeEqual/);assert.match(main,/confirmAge/);
});
test('le catalogue DGBx est valide',()=>{
  const ctx={};new Function('window',fs.readFileSync(path.join(root,'ui/x-catalog.js'),'utf8'))(ctx);
  const cats=ctx.DGBX_CATALOG.categories||ctx.DGBX_CATALOG;const sites=(Array.isArray(cats)?cats:Object.values(cats)).flatMap(c=>c.sites||[]);
  assert.ok(sites.length>=20);for(const s of sites){assert.match(s.url,/^https:\/\//);assert.ok(['Gratuit','Freemium','Payant'].includes(s.price));}
});
test('logos DGB et DGBx présents',()=>{for(const f of ['icon.ico','icon.png','logo-mark.png','logo-dgbx.png','logo-dgbx-mark.png'])assert.ok(fs.statSync(path.join(root,'assets',f)).size>1000,f);});
