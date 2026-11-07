'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../extensions/matchpulse/core');
const reader=require('../extensions/matchpulse/dom-reader');

// Petit arbre HTML simulant un ticket déjà validé. On teste le DOM, pas les pixels.
class E {
  constructor(tag='div',text='',attrs={}){
    this.tagName=tag.toUpperCase();this.ownText=text;this.children=[];this.parentElement=null;
    this.className=attrs.className||'';this.style=attrs.style||{};this.attrs=attrs;
    this.ownerDocument={defaultView:{getComputedStyle(node){return {textDecorationLine:node.style.textDecorationLine||'',textDecoration:node.style.textDecoration||''};}}};
  }
  add(...nodes){for(const child of nodes){child.parentElement=this;child.ownerDocument=this.ownerDocument;this.children.push(child);}return this;}
  get textContent(){return [this.ownText,...this.children.map(c=>c.textContent)].filter(Boolean).join(' ');}
  contains(el){for(let n=el;n;n=n.parentElement)if(n===this)return true;return false;}
  closest(selector){if(selector==='#mp-root')return null;return null;}
  querySelectorAll(selector){
    const result=[];
    const visit=n=>{for(const c of n.children){if(!selector.startsWith('[')||Object.keys(c.attrs).some(k=>['title','aria-label','data-testid'].includes(k)))result.push(c);visit(c);}};
    visit(this);return result;
  }
  getAttribute(key){return this.attrs[key]||null;}
}
const e=(tag,text,attrs)=>new E(tag,text,attrs);
const ticket=()=>e('main').add(
  e('article').add(
    e('section').add(e('strong','Tigre'),e('p','L’équipe possède 2 buts d’avance ou gagne (t. rég)'),
      e('div').add(e('del').add(e('span','1,49')),e('span','1,50')),
      e('p','Tigre 0 - 0 Sarmiento')),
    e('section').add(e('strong','Necaxa'),e('p','L’équipe possède 2 buts d’avance ou gagne (t. rég)'),
      e('b','1,56'),e('p','Necaxa 1 - 0 Club Tijuana')),
    e('section').add(e('strong','Club des Pins'),e('p','Résultat du match (t. rég)'),
      e('del').add(e('span','1,25')),
      e('p','Union Nord 0 - 2 Club des Pins'))
  )
);
test('Les cotes de Betclic sont récupérées depuis leurs noeuds HTML, pas à partir des scores',()=>{
  const root=ticket();
  const items=[
    {label:'Tigre',market:'L’équipe possède 2 buts d’avance ou gagne (t. rég)',odds:null},
    {label:'Necaxa',market:'L’équipe possède 2 buts d’avance ou gagne (t. rég)',odds:null},
    {label:'Club des Pins',market:'Résultat du match (t. rég)',odds:null}
  ];
  const result=reader.enrichTicketOdds(root,items,core);
  assert.deepEqual(result.map(x=>x.odds),[1.5,1.56,null]);
  assert.deepEqual(result.map(x=>x.oddsSource),['dom','dom',null]);
  assert.equal(core.combinedImplied(result),null);
});
test('Aucune cote ne traverse la frontière HTML de la sélection voisine',()=>{
  const root=ticket();
  const items=[{label:'Tigre',market:'L’équipe possède 2 buts d’avance ou gagne (t. rég)',odds:null},
    {label:'Club des Pins',market:'Résultat du match (t. rég)',odds:null}];
  const enriched=reader.enrichTicketOdds(root,items,core);
  assert.deepEqual(enriched.map(x=>x.odds),[1.5,null]);
});
test('Le lecteur textuel accepte les cotes dans les lignes du ticket, sans confondre scores et minutes',()=>{
  const source=`Combiné (2)\nTigre\nL’équipe possède 2 buts d’avance ou gagne (t. rég)\n1,49\n1,50\n41′ · MT 1\nTigre 0 - 0 Sarmiento\nNecaxa\nRésultat du match (t. rég)\n1,56\n41′ · MT 1\nNecaxa 1 - 0 Club Tijuana`;
  const r=core.parsePlacedTicketText(source);
  assert.equal(r.complete,true);
  assert.deepEqual(r.items.map(x=>x.odds),[1.5,1.56]);
  assert.equal(core.scoreFromFixture(r.items[0].fixture).homeGoals,0);
});
test('Alertes issues d’un changement de score réel, sans générer de faux but',()=>{
  const old=core.scoreFromFixture('Tigre 0 - 0 Sarmiento');
  const next=core.scoreFromFixture('Tigre 1 - 0 Sarmiento');
  assert.match(core.scoreChange(old,next),/But signalé/);
  assert.equal(core.scoreChange(old,old),null);
  assert.match(core.scoreChange(next,old),/Score rectifié/);
  assert.equal(core.scoreChange(old,core.scoreFromFixture('Autres 1 - 0 Equipes')),null);
});

test('Ne jamais récupérer une ancienne cote barrée depuis le texte plat',()=>{
  const root=ticket();
  const items=[{label:'Club des Pins',market:'Résultat du match (t. rég)',odds:1.25}];
  const out=reader.enrichTicketOdds(root,items,core);
  assert.equal(out[0].odds,null);
  assert.equal(out[0].oddsSource,null);
});
test('Ticket avec cotes et anciennes cotes dans le même libellé HTML',()=>{
  const source=`Combiné (2)\nTigre 1,49 1,50\nL’équipe possède 2 buts d’avance ou gagne (t. rég)\nTigre 0 - 0 Sarmiento\nNecaxa 1,56\nRésultat du match (t. rég)\nNecaxa 1 - 0 Club Tijuana`;
  const r=core.parsePlacedTicketText(source);
  assert.equal(r.complete,true);
  assert.deepEqual(r.items.map(x=>x.label),['Tigre','Necaxa']);
});
