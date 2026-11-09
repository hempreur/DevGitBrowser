/* MatchPulse — Panneau local en lecture seule sur les sites reconnus. */
(function(){
  'use strict';
  const core=globalThis.MatchPulseCore;
  const domReader=globalThis.MatchPulseDOM;
  const bookmaker=core?.detectBookmaker(location.hostname);
  if(!bookmaker || !domReader || !document.documentElement || document.getElementById('mp-root')) return;
  const selections=[];
  let ticketExpected=null;
  let ticketCombinedOdds=null;
  let ticketScoreBaseline=new Map(), ticketMarkerBaseline=new Set(), ticketScanBusy=false;
  // Les données restent en mémoire dans cet onglet. Pas de collecte de cookies ni d'API privées.
  const ticketWatchInterval=15000;
  let apiConfigured=false, lastState=null, seenAlert=null, autoDetect=true, lastAutoTicket='', autoTimer=null;
  const root=document.createElement('div');root.id='mp-root';
  root.innerHTML=`
  <div class="mp-panel mp-hidden" id="mp-panel" role="region" aria-label="MatchPulse, suivi sportif">
    <header class="mp-head"><div><b>⚡ MatchPulse</b><small id="mp-bookmaker">Bookmaker reconnu</small></div><button type="button" class="mp-x" id="mp-close" aria-label="Fermer le panneau">✕</button></header>
    <div class="mp-body">
      <section class="mp-section">
        <h3>🎟️ Mon ticket visible</h3>
        <p>Lit le DOM vivant du ticket (structure HTML et cotes à jour). Aucune capture d'écran, aucun identifiant, cookie ou montant de mise n'est collecté.</p>
        <div class="mp-group"><button type="button" class="mp-btn" id="mp-scan">Lire les sélections affichées</button><button type="button" class="mp-btn" id="mp-clear">Effacer</button></div>
        <div class="mp-items" id="mp-selections"></div>
        <div id="mp-ticket-status" class="mp-note" role="status">Aucun ticket lu.</div>
        <label class="mp-label">Cote totale du ticket validé, si elle apparaît sur Betclic (facultatif)</label>
        <div class="mp-group"><input id="mp-ticket-total-odds" placeholder="Ex. 8,75" aria-label="Cote totale du ticket"><button type="button" class="mp-btn" id="mp-ticket-total-update">Utiliser cette cote</button></div>
        <label class="mp-label">Ajouter/corriger manuellement une sélection</label>
        <div class="mp-group"><input id="mp-selection-label" placeholder="Ex. Équipe A gagne" aria-label="Libellé de la sélection"><input id="mp-selection-odds" placeholder="Cote 2,10" style="flex:0 1 100px!important" aria-label="Cote décimale"><button type="button" class="mp-btn" id="mp-add">Ajouter</button></div>
        <div id="mp-probability" class="mp-note">Ajoute des cotes pour calculer la probabilité implicite.</div>
        <p>⚠️ Probabilité déduite des cotes visibles sur le site, jamais une prédiction fiable. Une cote actuelle affichée peut différer de celle acceptée au moment du pari. La lecture ne confirme pas le statut du ticket.</p>
      </section>
      <section class="mp-section">
        <h3>🔴 Matchs et alertes en direct</h3>
        <p>Source gratuite <b>SofaScore</b> (sans clé, toutes compétitions, mise à jour ~30 s : buts, pénaltys, cartons, VAR, fautes, corners), avec bascule automatique sur <b>ESPN</b>. Le suivi continue même si tu changes de page ; une notification Windows est affichée à chaque alerte.</p>
        <div class="mp-group"><button type="button" class="mp-btn mp-primary" id="mp-follow-ticket">Suivre les matchs de mon ticket</button></div>
        <label class="mp-label">Source des résultats</label>
        <select id="mp-source"><option value="auto">Automatique · SofaScore puis ESPN (gratuit)</option><option value="sofascore">SofaScore uniquement</option><option value="public">ESPN uniquement</option><option value="api-football">API-Football · clé personnelle</option></select>
        <div id="mp-api-key-group" class="mp-hidden"><label class="mp-label">Clé personnelle API-Football (non enregistrée)</label>
        <div class="mp-group"><input type="password" id="mp-api-key" spellcheck="false" autocomplete="off" placeholder="Clé API-Football"><button class="mp-btn mp-primary" type="button" id="mp-key-connect">Connecter</button><button type="button" class="mp-btn" id="mp-key-clear">Retirer</button></div>
        <div id="mp-api-status" class="mp-note"></div></div>
        <label class="mp-label">Ajouter un autre match</label>
        <div class="mp-group"><input type="date" id="mp-date" aria-label="Date du match" style="flex:0 1 148px!important"><input id="mp-team" placeholder="Équipe, ex. Lyon" aria-label="Nom d'équipe"><button class="mp-btn" type="button" id="mp-find-fixtures">Chercher</button></div>
        <div class="mp-items" id="mp-results"></div>
        <h3 style="margin-top:14px!important">Matchs suivis</h3>
        <div class="mp-items" id="mp-tracked"></div>
        <div class="mp-group"><button type="button" class="mp-btn mp-primary" id="mp-start">Démarrer les alertes</button><button type="button" class="mp-btn" id="mp-stop">Arrêter</button></div>
        <div class="mp-note" id="mp-poll-status">Suivi arrêté.</div>
        <details class="mp-details"><summary>Types d’alertes</summary>
          <div class="mp-checks">
            <label><input type="checkbox" data-kind="goals" checked> Buts</label><label><input type="checkbox" data-kind="cards" checked> Cartons</label>
            <label><input type="checkbox" data-kind="penalties" checked> Pénaltys</label><label><input type="checkbox" data-kind="var" checked> VAR</label>
            <label><input type="checkbox" data-kind="fouls" checked> Fautes</label><label><input type="checkbox" data-kind="corners" checked> Corners</label>
            <label><input type="checkbox" id="mp-notify" checked> Notifications Windows</label><label><input type="checkbox" id="mp-autodetect" checked> Détection automatique des tickets</label><label><input type="checkbox" id="mp-analyze" checked> Probabilité avant validation</label>
          </div>
        </details>
        <div id="mp-alerts"></div>
      </section>
      <div class="mp-foot">By CodexHempreur · Extension incluse 0.5 · Jeu responsable : 09 74 75 13 13</div>
    </div>
  </div>
  <div id="mp-slip" class="mp-slip mp-hidden" role="status" aria-live="polite"></div>
  <button type="button" class="mp-launch" id="mp-launch"><span class="mp-pulse"></span> MatchPulse</button>
  <div id="mp-toast" class="mp-alert mp-hidden" role="status" style="clear:both!important;max-width:340px!important;pointer-events:auto!important"></div>`;
  document.documentElement.appendChild(root);
  const $=id=>root.querySelector('#'+id);
  $('mp-bookmaker').textContent=`${bookmaker.name} · ${bookmaker.region} · lecture seule`;
  function setText(id,text){$(id).textContent=String(text);}
  function note(msg,error=false){const el=$('mp-poll-status');el.textContent=msg;el.classList.toggle('mp-bad',error);}
  function toast(msg){
    const value=core.niceLabel(msg,220);
    const alert=$('mp-toast');alert.textContent=value;alert.classList.remove('mp-hidden');
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>alert.classList.add('mp-hidden'),9000);
  }
  function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
  function button(text,fn,cls='mp-btn'){const e=el('button',cls,text);e.type='button';e.addEventListener('click',fn);return e;}
  function openPanel(force){$('mp-panel').classList.toggle('mp-hidden',!force);if(force){extractVisibleSlip(true);refresh();}}
  $('mp-launch').addEventListener('click',()=>openPanel($('mp-panel').classList.contains('mp-hidden')));
  $('mp-close').addEventListener('click',()=>openPanel(false));
  function renderSelections(){
    const area=$('mp-selections');area.replaceChildren();
    if(!selections.length)area.append(el('p','mp-muted','Aucune sélection.'));
    selections.forEach((s,i)=>{
      const row=el('div','mp-item mp-selection-row');
      const detail=el('div','mp-selection-info');
      detail.append(el('b','',s.label));
      if(s.market)detail.append(el('small','',s.market));
      if(s.fixture)detail.append(el('small','mp-muted',s.fixture));
      if(s.oddsSource==='dom')detail.append(el('small','mp-muted','Cote lue dans le HTML du site'));
      const odd=el('input','mp-odd-input');odd.type='text';odd.inputMode='decimal';odd.placeholder='Cote ?';
      odd.title='Cote individuelle (facultative)';odd.setAttribute('aria-label','Cote de '+s.label);
      odd.value=s.odds?String(s.odds).replace('.',','):'';
      odd.addEventListener('change',()=>{
        const value=odd.value.trim();
        if(!value){s.odds=null;s.oddsSource='manual';renderSelections();return;}
        const n=core.parseOdds(value);
        if(!n){setText('mp-ticket-status','Cote non reconnue : utilise une cote décimale, ex. 1,85.');odd.focus();return;}
        s.odds=n;s.oddsSource='manual';renderSelections();
      });
      row.append(detail,odd,button('✕',()=>{selections.splice(i,1);renderSelections();}));area.append(row);
    });
    const result=core.combinedImplied(selections);
    if(ticketCombinedOdds){
      $('mp-probability').replaceChildren(el('b','mp-strong',(100/ticketCombinedOdds).toFixed(1)+' %'),
        el('span','mp-note',` · D'après la cote totale saisie ${ticketCombinedOdds.toFixed(2)} (marge non retirée)`));
    }else if(result){
      $('mp-probability').replaceChildren(el('b','mp-strong',(result.probability*100).toFixed(1)+' %'),
        el('span','mp-note',` · Cote combinée ${result.decimalOdds.toFixed(2)} · hypothèse d’indépendance`));
    }else setText('mp-probability','Probabilité inconnue : les cotes de ce ticket validé ne sont pas toutes affichées.');
  }
  function addSelection(label,odds){
    const clean=core.niceLabel(label,100),parsed=core.parseOdds(odds);
    if(!clean || !parsed)throw new Error('Indique un libellé et une cote décimale valide (ex. 2,10).');
    if(selections.length>=20)throw new Error('Maximum de 20 sélections.');
    if(selections.some(s=>s.label===clean&&s.odds===parsed))return;
    selections.push({label:clean,market:'Ajout manuel',fixture:'',odds:parsed});renderSelections();
  }
  $('mp-add').addEventListener('click',()=>{
    try{addSelection($('mp-selection-label').value,$('mp-selection-odds').value);$('mp-selection-label').value='';$('mp-selection-odds').value='';}catch(e){setText('mp-ticket-status',e.message);}
  });
  $('mp-clear').addEventListener('click',()=>{
    selections.splice(0);ticketExpected=null;ticketCombinedOdds=null;
    $('mp-ticket-total-odds').value='';renderSelections();setText('mp-ticket-status','Sélections locales effacées.');
  });
  $('mp-ticket-total-update').addEventListener('click',()=>{
    const text=$('mp-ticket-total-odds').value.trim();
    const odd=text?core.parseOdds(text):null;
    if(text && !odd){setText('mp-ticket-status','Cote totale non reconnue. Exemple : 8,75');return;}
    ticketCombinedOdds=odd;renderSelections();
  });
  // Le DOM d'un ticket VALIDÉ contient souvent les cotes dans des noeuds voisins,
  // non dans le même texte que le marché. Lire le DOM vivant, jamais les pixels.
  // Chercher d'abord les blocs « Combiné (N) », puis leurs lignes de sélections.
  function findTicketContainers(){
    const selectors=[
      '[data-testid*="betslip" i]','[data-testid*="bet-slip" i]','[data-test-id*="bet" i]',
      '[class*="betslip" i]','[data-testid*="coupon" i]','[class*="bet-slip" i]',
      '[class*="ticket" i]','[class*="bet-card" i]','[class*="my-bets" i]',
      '[class*="bet-history" i]','[class*="placed-bet" i]',
      '[role="article"]','article'
    ];
    const nodes=new Set();
    for(const el of document.querySelectorAll(selectors.join(','))){
      if(el.closest('#mp-root'))continue;
      nodes.add(el);if(nodes.size>=100)break;
    }
    // Une appli SPA peut ne pas avoir de classes connues : retrouver le titre du combiné.
    const leaves=document.querySelectorAll('button,span,strong,h1,h2,h3,h4,p,div');
    for(const leaf of leaves){
      if(nodes.size>180)break;
      if(leaf.closest('#mp-root') || leaf.children.length>5)continue;
      const text=(leaf.textContent||'').trim();
      if(text.length>80 || !/\bcombin[eé]\s*\(?\d{1,2}\)?/i.test(text))continue;
      let el=leaf;
      for(let depth=0;el&&depth<7;el=el.parentElement,depth++){
        if(el===document.body || el===document.documentElement)break;
        const len=(el.innerText||'').length;
        if(len>60 && len<14000)nodes.add(el);
      }
    }
    return [...nodes];
  }
  function readTicketFromPage(){
    let best={items:[],expected:null,complete:false,container:null};
    const candidates=findTicketContainers();
    for(const container of candidates){
      const rect=container.getBoundingClientRect(),style=getComputedStyle(container);
      if(rect.width<25||style.display==='none'||style.visibility==='hidden')continue;
      const text=(container.innerText||'').slice(0,14000);
      if(!text)continue;
      const parsed=core.parsePlacedTicketText(text);
      if(parsed.items.length>best.items.length || (parsed.items.length===best.items.length&&parsed.complete&&!best.complete))
        best={...parsed,container};
    }
    // Ancien lecteur des coupons AVANT validation.
    if(!best.items.length){
      const found=[];
      for(const container of candidates.slice(0,45)){
        const rows=[...container.querySelectorAll('li,[data-testid*="selection" i],[class*="selection" i],p')].slice(0,90);
        for(const row of rows){
          const text=(row.innerText||'').trim();
          if(text.length>220)continue;
          const item=core.extractOddsAndLabel(text);
          if(item&&!found.some(x=>x.label===item.label&&x.odds===item.odds))found.push({...item,market:'',fixture:''});
          if(found.length>=20)break;
        }
        if(found.length)break;
      }
      best={items:found,expected:null,complete:false,container:null};
    }
    if(best.container&&best.items.length)best.items=domReader.enrichTicketOdds(best.container,best.items,core);
    return best;
  }
  function snapshotTicket(best){
    const scores=new Map();
    for(const item of best.items){
      const parsed=core.scoreFromFixture(item.fixture);
      if(parsed)scores.set(item.label+'|'+item.market,parsed);
    }
    return {scores,markers:best.container?domReader.explicitMatchMarkers(best.container,best.items):new Map()};
  }
  function baselineTicket(best){
    const snap=snapshotTicket(best);
    ticketScoreBaseline=snap.scores;
    ticketMarkerBaseline=new Set([...snap.markers.values()].flat().map(x=>x.id));
  }
  function extractVisibleSlip(quiet=false){
    const best=readTicketFromPage();
    if(best.items.length){
      ticketExpected=best.expected;
      // Préserver les corrections manuelles si le DOM ne fournit pas une cote.
      const previous=new Map(selections.map(s=>[s.label+'|'+(s.market||''),s]));
      selections.splice(0,selections.length,...best.items.map(s=>{
        const prior=previous.get(s.label+'|'+(s.market||''));
        return prior?.oddsSource==='manual'?{...s,odds:prior.odds,oddsSource:'manual'}:
          {...s,odds:s.odds??prior?.odds??null,oddsSource:s.oddsSource||prior?.oddsSource||null};
      }));
      baselineTicket(best);
      renderSelections();
      const oddsFound=selections.filter(s=>s.odds!==null).length;
      setText('mp-ticket-status',best.expected?
        `${selections.length} sélection(s) sur ${best.expected} annoncée(s). ${oddsFound} cote(s) extraite(s) du HTML (anciennes cotes barrées ignorées). ${best.complete?'Liste complète détectée.':'Liste partielle : fais défiler le ticket puis relance la lecture.'} Source : page du bookmaker, données à vérifier.`:
        `${selections.length} sélection(s) détectée(s), dont ${oddsFound} cote(s) extraite(s) du HTML. Vérifie les informations.`);
    }else if(!quiet){
      setText('mp-ticket-status','Aucune sélection identifiable. Ouvre « Mes paris / En cours », déplie ton ticket et réessaie.');
    }
    return best;
  }
  // Les scores ne sont pas envoyés vers un fournisseur extérieur. Des modifications
  // réellement présentes dans le DOM Betclic deviennent des alertes locales.
  function watchBookmakerEvents(){
    if(ticketScanBusy||!selections.length)return;
    ticketScanBusy=true;
    try{
      const sample=readTicketFromPage();
      if(!sample.items.length)return;
      const now=snapshotTicket(sample);
      for(const [key,score] of now.scores){
        const old=ticketScoreBaseline.get(key);
        const change=core.scoreChange(old,score);
        if(change)toast(bookmaker.name+' : '+change);
      }
      for(const events of now.markers.values())for(const event of events){
        if(!ticketMarkerBaseline.has(event.id))toast(bookmaker.name+' : événement indiqué sur le site — '+event.text);
      }
      ticketScoreBaseline=now.scores;
      ticketMarkerBaseline=new Set([...now.markers.values()].flat().map(x=>x.id));
      // Les cotes restent locales et peuvent être rafraîchies si le bookmaker
      // modifie leur affichage. Ne jamais écraser une correction manuelle.
      const found=new Map(sample.items.map(s=>[s.label+'|'+s.market,s]));
      let changed=false;
      for(const s of selections){
        const latest=found.get(s.label+'|'+s.market);
        if(latest?.oddsSource==='dom'&&s.oddsSource==='dom'&&latest.odds!==s.odds){
          s.odds=latest.odds;changed=true;
        }
      }
      if(changed)renderSelections();
    }catch(e){console.debug('MatchPulse : suivi du DOM temporairement indisponible',e?.message);}
    finally{ticketScanBusy=false;}
  }
  setInterval(watchBookmakerEvents,ticketWatchInterval);
  $('mp-scan').addEventListener('click',()=>extractVisibleSlip(false));
  function msg(action,details={}){
    return new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Le module de données n’a pas répondu.'));}},25000);
      try{chrome.runtime.sendMessage({action,...details},response=>{
        if(done)return;done=true;clearTimeout(timer);
        const error=chrome.runtime.lastError;
        if(error)reject(new Error(error.message));
        else if(!response?.ok)reject(new Error(response?.error||'Erreur du fournisseur de données.'));
        else resolve(response.data);
      });}catch(e){clearTimeout(timer);reject(e);}
    });
  }
  function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  $('mp-date').value=localDate();
  const source=()=>$('mp-source').value;
  function updateSource(){
    const api=source()==='api-football';
    $('mp-api-key-group').classList.toggle('mp-hidden',!api);
    setText('mp-api-status',apiConfigured?'✓ Clé API-Football disponible pour cette session.':'Clé API-Football nécessaire pour ce mode (gratuit : 100 requêtes/jour).');
  }
  $('mp-source').addEventListener('change',updateSource);
  $('mp-key-connect').addEventListener('click',async()=>{
    const key=$('mp-api-key').value;$('mp-api-key').value='';
    try{await msg('set-key',{value:key});apiConfigured=true;updateSource();}
    catch(e){setText('mp-api-status','Erreur : '+e.message);}
  });
  $('mp-key-clear').addEventListener('click',async()=>{try{await msg('clear-key');}catch{}apiConfigured=false;updateSource();refresh();});
  // ---------------------------------------------------------------- État du suivi (module d'arrière-plan)
  function render(state){
    lastState=state;apiConfigured=Boolean(state.configured);
    const area=$('mp-tracked');area.replaceChildren();
    if(!state.tracked.length)area.append(el('p','mp-muted','Aucun match suivi. Utilise « Suivre les matchs de mon ticket » ou cherche une équipe.'));
    for(const t of state.tracked){
      const row=el('div','mp-item mp-match');
      const info=el('div','mp-selection-info');
      info.append(el('b','',`${t.label}`),el('small','',`${t.score} · ${t.status||'—'} · ${t.source==='sofascore'?'SofaScore':t.source==='public'?'ESPN':'API-Football'}`));
      if(t.stats){const parts=[];for(const [k,v] of Object.entries(t.stats))if(core.STAT_LABELS[k]&&['fouls','corners','yellow'].includes(k))parts.push(`${core.STAT_LABELS[k]} ${v.home}–${v.away}`);if(parts.length)info.append(el('small','mp-muted',parts.join(' · ')));}
      for(const e of t.events.slice(-2))info.append(el('small','mp-muted',e));
      row.append(info,button('✕',async()=>{try{render(await msg('untrack',{id:t.id}));}catch(e){note(e.message,true);}}));
      area.append(row);
    }
    const when=state.lastPoll?new Date(state.lastPoll).toLocaleTimeString('fr-FR'):'';
    note(state.running?`Alertes actives · ${state.tracked.length} match(s) · actualisé ${when||'…'}${state.lastError?' · '+state.lastError:''}`:'Suivi arrêté.',Boolean(state.lastError)&&state.running);
    const alertsArea=$('mp-alerts');alertsArea.replaceChildren();
    if(state.alerts.length){
      const head=el('div','mp-group');head.append(el('h3','','Alertes reçues'),button('Effacer',async()=>render(await msg('clear-alerts'))));
      alertsArea.append(head);
      for(const a of state.alerts.slice(0,15))alertsArea.append(el('div','mp-alert',`${new Date(a.at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})} · ${a.text}`));
    }
    // Afficher dans la page les alertes arrivées depuis le dernier passage.
    const newest=state.alerts[0]?.id||0;
    if(seenAlert!==null){const fresh=state.alerts.filter(a=>a.id>seenAlert);if(fresh.length)toast(fresh[0].text+(fresh.length>1?` (+${fresh.length-1})`:''));}
    seenAlert=Math.max(seenAlert??0,newest);
    $('mp-notify').checked=state.prefs.notifications;
    for(const box of root.querySelectorAll('[data-kind]'))box.checked=Boolean(state.prefs.kinds[box.dataset.kind]);
    $('mp-launch').classList.toggle('mp-live',state.running&&state.tracked.length>0);
  }
  async function refresh(){try{render(await msg('state'));}catch(e){note('Module de données indisponible : '+e.message,true);}}
  setInterval(()=>{if(document.visibilityState==='visible')refresh();},5000);
  async function findFixtures(){
    const area=$('mp-results');area.replaceChildren();
    const search=$('mp-team').value.trim();
    if(search.length<2){note('Saisis au moins deux lettres du nom d’une équipe.',true);return;}
    if(source()==='api-football'&&!apiConfigured){note('Configure ta clé API-Football ou choisis une source gratuite.',true);return;}
    try{
      note('Recherche…');
      const result=await msg('search',{date:$('mp-date').value,search,source:source()});
      if(!result.items.length)area.append(el('p','mp-muted','Aucun match correspondant sur cette date.'));
      for(const f of result.items){
        const row=el('div','mp-item');
        row.append(el('span','',`${f.home} – ${f.away} · ${f.score||''} ${f.status?'('+f.status+')':''}`),button('Suivre',async()=>{
          try{render(await msg('track',{match:{...f,date:$('mp-date').value}}));row.remove();}catch(e){note(e.message,true);}
        }));
        area.append(row);
      }
      note(`${result.items.length} match(s) · source ${result.source==='sofascore'?'SofaScore':result.source==='public'?'ESPN (secours)':'API-Football'}${result.fallback?' · SofaScore indisponible : '+result.fallback:''}`);
    }catch(e){note(e.message,true);}
  }
  $('mp-find-fixtures').addEventListener('click',findFixtures);
  $('mp-team').addEventListener('keydown',e=>{if(e.key==='Enter')findFixtures();});
  async function followTicket(items){
    const list=(items||selections).filter(s=>s.fixture||/\s(?:-|–|vs)\s/i.test(s.label||''));
    if(!list.length){setText('mp-ticket-status','Aucun match identifiable dans le ticket : lis d’abord tes sélections (bouton ci-dessus).');return;}
    note('Recherche des matchs du ticket…');
    try{
      const result=await msg('track-ticket',{items:list.map(s=>({label:s.label,fixture:s.fixture,market:s.market})),date:localDate()});
      render(result.snapshot);
      toast(`MatchPulse : ${result.matched.length} match(s) suivi(s)${result.missing.length?` · introuvable(s) : ${result.missing.slice(0,3).join(', ')}`:''}`);
    }catch(e){note(e.message,true);}
  }
  $('mp-follow-ticket').addEventListener('click',()=>{if(!selections.length)extractVisibleSlip(false);followTicket();});
  $('mp-start').addEventListener('click',async()=>{try{render(await msg('start'));}catch(e){note(e.message,true);}});
  $('mp-stop').addEventListener('click',async()=>{try{render(await msg('stop'));}catch(e){note(e.message,true);}});
  async function savePrefs(){
    const kinds={};for(const box of root.querySelectorAll('[data-kind]'))kinds[box.dataset.kind]=box.checked;
    try{render(await msg('prefs',{notifications:$('mp-notify').checked,kinds}));}catch(e){note(e.message,true);}
  }
  for(const box of root.querySelectorAll('[data-kind],#mp-notify'))box.addEventListener('change',savePrefs);
  $('mp-autodetect').addEventListener('change',()=>{autoDetect=$('mp-autodetect').checked;});
  // ---------------------------------------------------------------- Détection automatique d'un ticket validé
  // Observe uniquement le texte affiché ; aucune requête du site n'est interceptée.
  function checkForNewTicket(){
    autoTimer=null;
    if(!autoDetect)return;
    const text=(document.body?.innerText||'').slice(0,60000);
    const confirmed=core.isBetConfirmation(text);
    if(!confirmed)return;
    const best=readTicketFromPage();
    if(!best.items.length)return;
    const signature=best.items.map(s=>s.label+'|'+s.fixture).join('#');
    if(signature===lastAutoTicket)return;
    lastAutoTicket=signature;
    extractVisibleSlip(true);
    const banner=$('mp-toast');
    banner.replaceChildren(el('div','',`🎟️ Ticket détecté : ${best.items.length} sélection(s). Suivre les matchs en direct ?`));
    const actions=el('div','mp-group');
    actions.append(button('Suivre',()=>{banner.classList.add('mp-hidden');followTicket(best.items);},'mp-btn mp-primary'),button('Ignorer',()=>banner.classList.add('mp-hidden')));
    banner.append(actions);banner.classList.remove('mp-hidden');
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>banner.classList.add('mp-hidden'),30000);
  }
  try{
    new MutationObserver(()=>{if(!autoTimer)autoTimer=setTimeout(checkForNewTicket,1500);})
      .observe(document.body||document.documentElement,{subtree:true,childList:true,characterData:true});
  }catch{}
  // ---------------------------------------------------------------- Ticket en préparation
  // Lit le panier (sélections non validées) et affiche une probabilité estimée.
  let analyzeEnabled=true, lastSlipSignature='', slipTimer=null, slipBusy=false;
  $('mp-analyze').addEventListener('change',()=>{analyzeEnabled=$('mp-analyze').checked;if(!analyzeEnabled)$('mp-slip').classList.add('mp-hidden');});
  function readBetslip(){
    const containers=[...document.querySelectorAll('[class*="betslip" i],[class*="bet-slip" i],[data-testid*="betslip" i],[data-qa*="betslip" i],[class*="coupon" i],[class*="panier" i],[class*="basket" i],bcdk-bet-slip,[class*="BetSlip"]')]
      .filter(el=>!el.closest('#mp-root')).slice(0,40);
    let best={items:[],totalOdds:null};
    for(const el of containers){
      const r=el.getBoundingClientRect();if(r.width<40||r.height<40)continue;
      const parsed=core.parseBetslipText((el.innerText||'').slice(0,14000));
      if(parsed.items.length>best.items.length)best=parsed;
    }
    return best;
  }
  function renderSlip(data){
    const box=$('mp-slip');box.replaceChildren();
    const head=el('div','mp-slip-head');
    head.append(el('b','',`🎯 Ticket en préparation · ${data.results.length} sélection(s)`),button('✕',()=>box.classList.add('mp-hidden')));
    box.append(head);
    for(const r of data.results){
      const row=el('div','mp-slip-row');
      const pct=el('span','mp-pct '+(r.probability>=0.6?'mp-good':r.probability>=0.4?'mp-mid':'mp-low'),core.percent(r.probability));
      const info=el('div','mp-selection-info');
      info.append(el('b','',`${r.label}${r.odds?' @ '+r.odds.toFixed(2):''}`),el('small','',`${r.match||r.fixture} · ${r.market}`),
        el('small','mp-muted',`${r.source}${r.form?` · forme ${r.form.home} / ${r.form.away}`:''}${r.value!==null&&r.value!==undefined?` · valeur ${r.value>=0?'+':''}${Math.round(r.value*100)} %`:''}`));
      row.append(pct,info);box.append(row);
    }
    const total=el('div','mp-slip-total');
    total.append(el('span','','Réussite estimée du ticket'),el('b','',data.combined!==null?core.percent(data.combined):'—'));
    box.append(total);
    if(data.totalOdds)box.append(el('small','mp-muted',`Cote totale ${data.totalOdds.toFixed(2)} · probabilité implicite du bookmaker ${core.percent(1/data.totalOdds)}`));
    if(data.sameMatch)box.append(el('small','mp-muted','⚠ Plusieurs sélections sur le même match : elles ne sont pas indépendantes, l’estimation combinée est approximative.'));
    box.append(el('small','mp-muted','Estimation statistique (cotes du marché SofaScore, forme récente), jamais une garantie. Joue avec modération.'));
    box.classList.remove('mp-hidden');
  }
  async function checkBetslip(){
    slipTimer=null;
    if(!analyzeEnabled||slipBusy)return;
    const slip=readBetslip();
    if(!slip.items.length){if(lastSlipSignature){lastSlipSignature='';$('mp-slip').classList.add('mp-hidden');}return;}
    const signature=slip.items.map(i=>[i.label,i.market,i.fixture,i.odds].join('|')).join('#');
    if(signature===lastSlipSignature)return;
    lastSlipSignature=signature;slipBusy=true;
    try{renderSlip(await msg('analyze-slip',{items:slip.items,date:localDate()}));}
    catch(e){note('Analyse du ticket : '+e.message,true);}
    finally{slipBusy=false;}
  }
  try{new MutationObserver(()=>{if(!slipTimer)slipTimer=setTimeout(checkBetslip,1800);}).observe(document.body||document.documentElement,{subtree:true,childList:true,characterData:true});}catch{}
  setTimeout(checkBetslip,2500);
  // Ne demande aucun accès au compte bookmaker ni au paiement.
  renderSelections();updateSource();refresh();
})();
