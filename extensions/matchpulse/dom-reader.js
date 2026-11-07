/* Extraction locale des sélections depuis le DOM vivant de la page du bookmaker.
 * N'intercepte aucune requête réseau, cookie, clé de session ni donnée de paiement.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MatchPulseDOM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ODDS = /^\s*(\d{1,3}[,.]\d{1,3})\s*$/;
  const OLD = /(?:^|[\s_-])(old|ancien|previous|strikethrough|strik|outdated|was|obsolete)(?:$|[\s_-])/i;
  const MARKET = /(?:l['’]équipe possède|r[eé]sultat du match|double chance|les deux [eé]quipes|nombre de buts|total de buts|plus de \d|moins de \d|handicap|but(eur|s)?|cartons?|corners?|r[eé]sultat mi-temps|1x2|remporte (?:le match|la rencontre)|tirs cadr[eé]s|[eé]quipe (?:gagne|marque)|victoire (?:de|du))/i;
  const SCAN_TAGS = 'span,div,p,strong,b,small,label,li,button,em,i,s,del,ins';
  function normal(value) { return String(value || '').replace(/\s+/g, ' ').replace(/[\u00a0\u202f]/g, ' ').trim().toLocaleLowerCase('fr-FR'); }
  function getText(node) { return String(node?.textContent || '').replace(/\s+/g, ' ').trim(); }
  function leafElements(container,limit=6500) {
    const found=[];
    for(const node of container.querySelectorAll(SCAN_TAGS)) {
      if (found.length>=limit) break;
      if(node.closest?.('#mp-root')) continue;
      const text=getText(node);
      if(!text||text.length>170)continue;
      // Ne retenir que le noeud textuel le plus spécifique pour ne pas compter les cotes deux fois.
      const childWithText=[...(node.children||[])].some(child=>Boolean(getText(child)));
      if(!childWithText)found.push(node);
    }
    return found;
  }
  function isCrossed(node,stop){
    for(let current=node;current&&current!==stop;current=current.parentElement){
      const tag=String(current.tagName||'').toLowerCase();
      if(['s','del','strike'].includes(tag))return true;
      if(OLD.test(String(current.className||'')))return true;
      if(/line-through/i.test(current.style?.textDecoration||current.style?.textDecorationLine||''))return true;
      try{
        const style=current.ownerDocument?.defaultView?.getComputedStyle?.(current);
        if(/line-through/i.test(style?.textDecorationLine||style?.textDecoration||''))return true;
      }catch{}
    }
    return false;
  }
  function oddsInScope(scope,leaves,core){
    const values=[];
    for(const node of leaves){
      if(!scope.contains(node))continue;
      const match=getText(node).match(ODDS);
      if(!match)continue;
      const odds=core.parseOdds(match[1]);
      if(odds===null)continue;
      values.push({odds,crossed:isCrossed(node,scope),node});
    }
    return values;
  }
  function countMarkets(scope,leaves){
    let n=0;
    for(const node of leaves){if(scope.contains(node)&&MARKET.test(getText(node)))n++;}
    return n;
  }
  function matchSelectionOdds(container,item,leaves,core){
    const label=normal(item.label),market=normal(item.market);
    if(!market||!label)return null;
    const anchors=leaves.filter(node=>normal(getText(node))===label).slice(0,10);
    let best=null;
    let seenOnlyCrossed=false;
    for(const anchor of anchors){
      let scope=anchor;
      for(let depth=0;scope&&depth<9;depth++,scope=scope.parentElement){
        if(scope===container.parentElement)break;
        const text=normal(getText(scope));
        if(text.length>2200)break;
        if(!text.includes(market)||!text.includes(label))continue;
        const markets=countMarkets(scope,leaves);
        if(markets!==1)continue; // Un seul pari par bloc : évite d'attribuer la cote voisine.
        const options=oddsInScope(scope,leaves,core);
        if(options.length>4)continue;
        const current=options.filter(option=>!option.crossed);
        if(!current.length){if(options.length)seenOnlyCrossed=true;continue;}
        // Si plusieurs cotes non barrées sont dans un bloc, leur association est ambiguë.
        // Le cas habituel Betclic contient ancienne cote barrée + cote actuelle non barrée.
        if(current.length>1&&new Set(current.map(x=>x.odds)).size>1)continue;
        const chosen=current[current.length-1];
        if(!best||depth<best.depth)best={odds:chosen.odds,depth};
        break;
      }
    }
    return best?{odds:best.odds,fromDom:true}:{odds:null,fromDom:seenOnlyCrossed};
  }
  function enrichTicketOdds(container,items,core){
    if(!container?.querySelectorAll||!Array.isArray(items)||!core)return items||[];
    const leaves=leafElements(container);
    return items.map(item=>{
      const fromDom=matchSelectionOdds(container,item,leaves,core);
      // Si seules d'anciennes cotes barrées sont visibles, ne pas les récupérer
      // aveuglément du texte plat, même si celui-ci contient un nombre valide.
      const odds=fromDom.fromDom?fromDom.odds:(item.odds??null);
      return {...item,odds,oddsSource:fromDom.fromDom&&odds!==null?'dom':odds!==null?'text':null};
    });
  }
  function explicitMatchMarkers(container,items){
    if(!container?.querySelectorAll)return new Map();
    const leaves=leafElements(container),result=new Map();
    const matchRE=/(carton\s+jaune|yellow\s+card|carton\s+rouge|red\s+card|p[eé]nalty|penalty|faute\s+(?:commise|signal[eé]e)|foul\s+committed)/i;
    for(const item of items){
      const key=normal(item.label)+'|'+normal(item.market);
      const anchor=leaves.find(node=>normal(getText(node))===normal(item.label));
      if(!anchor)continue;
      let scope=anchor;
      for(let i=0;scope&&i<8;i++,scope=scope.parentElement){
        const text=normal(getText(scope));
        if(text.length>2200)break;
        if(text.includes(normal(item.market))&&countMarkets(scope,leaves)===1)break;
      }
      if(!scope||!scope.querySelectorAll)continue;
      const events=[];
      for(const n of scope.querySelectorAll('[title],[aria-label],[data-testid]')){
        if(n.closest?.('#mp-root'))continue;
        const desc=[n.getAttribute?.('aria-label'),n.getAttribute?.('title')].filter(Boolean).join(' ');
        if(desc.length>160||!matchRE.test(desc))continue;
        const when=getText(n).match(/\b(\d{1,3})[’′']/)?.[1]||'';
        const message=desc.replace(/\s+/g,' ').trim();
        const id=key+'|'+normal(message)+'|'+when;
        if(!events.some(e=>e.id===id))events.push({id,text:message});
        if(events.length>=20)break;
      }
      result.set(key,events);
    }
    return result;
  }
  return {enrichTicketOdds,explicitMatchMarkers,leafElements,matchSelectionOdds};
});
