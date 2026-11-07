/* MatchPulse — Panneau local en lecture seule sur les sites reconnus. */
(function(){
  'use strict';
  const core=globalThis.MatchPulseCore;
  const bookmaker=core?.detectBookmaker(location.hostname);
  if(!bookmaker || !document.documentElement || document.getElementById('mp-root')) return;
  const selections=[];
  let ticketExpected=null;
  let ticketCombinedOdds=null;
  const tracked=[];
  const latestAlerts=[];
  let active=false, apiConfigured=false, pollTimer=null, pollBusy=false, pollNumber=0;
  const root=document.createElement('div');root.id='mp-root';
  root.innerHTML=`
  <div class="mp-panel mp-hidden" id="mp-panel" role="region" aria-label="MatchPulse, suivi sportif">
    <header class="mp-head"><div><b>⚡ MatchPulse</b><small id="mp-bookmaker">Bookmaker reconnu</small></div><button type="button" class="mp-x" id="mp-close" aria-label="Fermer le panneau">✕</button></header>
    <div class="mp-body">
      <section class="mp-section">
        <h3>🎟️ Mon ticket visible</h3>
        <p>Ouvre ton ticket sur le bookmaker, puis lance sa lecture. Aucun identifiant, cookie ou montant de mise n'est collecté.</p>
        <div class="mp-group"><button type="button" class="mp-btn" id="mp-scan">Lire les sélections affichées</button><button type="button" class="mp-btn" id="mp-clear">Effacer</button></div>
        <div class="mp-items" id="mp-selections"></div>
        <div id="mp-ticket-status" class="mp-note" role="status">Aucun ticket lu.</div>
        <label class="mp-label">Cote totale du ticket validé, si elle apparaît sur Betclic (facultatif)</label>
        <div class="mp-group"><input id="mp-ticket-total-odds" placeholder="Ex. 8,75" aria-label="Cote totale du ticket"><button type="button" class="mp-btn" id="mp-ticket-total-update">Utiliser cette cote</button></div>
        <label class="mp-label">Ajouter/corriger manuellement une sélection</label>
        <div class="mp-group"><input id="mp-selection-label" placeholder="Ex. Équipe A gagne" aria-label="Libellé de la sélection"><input id="mp-selection-odds" placeholder="Cote 2,10" style="flex:0 1 100px!important" aria-label="Cote décimale"><button type="button" class="mp-btn" id="mp-add">Ajouter</button></div>
        <div id="mp-probability" class="mp-note">Ajoute des cotes pour calculer la probabilité implicite.</div>
        <p>⚠️ Probabilité déduite des cotes, jamais une prédiction fiable. Une cote manque dans les tickets déjà validés ? Laisse-la vide. La lecture ne confirme pas le statut du pari.</p>
      </section>
      <section class="mp-section">
        <h3>🔴 Matchs et alertes en direct</h3>
        <p>Alertes buts, cartons et pénaltys selon les événements disponibles. ESPN public fonctionne sans clé (non officiel, couverture variable). Fautes d’équipe : seulement via API-Football si statistiques disponibles.</p>
        <label class="mp-label">Source des résultats</label>
        <select id="mp-source"><option value="public">ESPN public · sans clé (expérimental)</option><option value="api-football">API-Football · clé personnelle</option></select>
        <div id="mp-api-key-group" class="mp-hidden"><label class="mp-label">Clé personnelle API-Football (non enregistrée)</label>
        <div class="mp-group"><input type="password" id="mp-api-key" spellcheck="false" autocomplete="off" placeholder="Clé API-Football"><button class="mp-btn mp-primary" type="button" id="mp-key-connect">Connecter</button><button type="button" class="mp-btn" id="mp-key-clear">Retirer</button></div>
        <div id="mp-api-status" class="mp-note">Source ESPN expérimentale, sans compte ni clé.</div></div>
        <label class="mp-label">Chercher un match du jour (ou choisir une date)</label>
        <div class="mp-group"><input type="date" id="mp-date" aria-label="Date du match" style="flex:0 1 148px!important"><input id="mp-team" placeholder="Équipe, ex. Lyon" aria-label="Nom d'équipe"><button class="mp-btn" type="button" id="mp-find-fixtures">Chercher</button></div>
        <div class="mp-items" id="mp-results"></div>
        <h3 style="margin-top:14px!important">Mes matchs suivis (3 maximum)</h3>
        <div class="mp-items" id="mp-tracked"></div>
        <div class="mp-group"><button type="button" class="mp-btn mp-primary" id="mp-start">Démarrer les alertes</button><button type="button" class="mp-btn" id="mp-stop">Arrêter</button></div>
        <div class="mp-note" id="mp-poll-status">Suivi arrêté.</div>
        <div id="mp-alerts"></div>
      </section>
      <div class="mp-foot">By CodexHempreur · Extension incluse 0.2</div>
    </div>
  </div>
  <button type="button" class="mp-launch" id="mp-launch"><span class="mp-pulse"></span> MatchPulse</button>
  <div id="mp-toast" class="mp-alert mp-hidden" role="status" style="clear:both!important;max-width:340px!important;pointer-events:auto!important"></div>`;
  document.documentElement.appendChild(root);
  const $=id=>root.querySelector('#'+id);
  $('mp-bookmaker').textContent=`${bookmaker.name} · ${bookmaker.region} · lecture seule`;
  function setText(id,text){$(id).textContent=String(text);}
  function note(msg,error=false){const el=$('mp-poll-status');el.textContent=msg;el.classList.toggle('mp-bad',error);}
  function toast(msg){
    const value=core.niceLabel(msg,200);
    latestAlerts.unshift(value);latestAlerts.length=Math.min(latestAlerts.length,12);
    const alert=$('mp-toast');alert.textContent=value;alert.classList.remove('mp-hidden');
    // Ne pas perdre de ressources sur les onglets fermés.
    clearTimeout(toast.timer);toast.timer=setTimeout(()=>alert.classList.add('mp-hidden'),9000);
    renderAlerts();
  }
  function el(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
  function button(text,fn,cls='mp-btn'){const e=el('button',cls,text);e.type='button';e.addEventListener('click',fn);return e;}
  function openPanel(force){$('mp-panel').classList.toggle('mp-hidden',!force);if(force&&!selections.length&&bookmaker.name==='Betclic')extractVisibleSlip();}
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
      const odd=el('input','mp-odd-input');odd.type='text';odd.inputMode='decimal';odd.placeholder='Cote ?';
      odd.title='Cote individuelle (facultative)';odd.setAttribute('aria-label','Cote de '+s.label);
      odd.value=s.odds?String(s.odds).replace('.',','):'';
      odd.addEventListener('change',()=>{
        const value=odd.value.trim();
        if(!value){s.odds=null;renderSelections();return;}
        const n=core.parseOdds(value);
        if(!n){setText('mp-ticket-status','Cote non reconnue : utilise une cote décimale, ex. 1,85.');odd.focus();return;}
        s.odds=n;renderSelections();
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
  // Sur les tickets VALIDÉS, Betclic n’affiche souvent aucune cote individuelle.
  // Chercher d'abord les blocs « Combiné (N) », puis les listes de sélections.
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
  function extractVisibleSlip(){
    let best={items:[],expected:null,complete:false};
    const candidates=findTicketContainers();
    for(const container of candidates){
      const rect=container.getBoundingClientRect(),style=getComputedStyle(container);
      if(rect.width<25||style.display==='none'||style.visibility==='hidden')continue;
      const text=(container.innerText||'').slice(0,14000);
      if(!text)continue;
      const parsed=core.parsePlacedTicketText(text);
      if(parsed.items.length>best.items.length || (parsed.items.length===best.items.length&&parsed.complete&&!best.complete))best=parsed;
    }
    // Ancien lecteur des coupons AVANT validation, quand les cotes sont présentes.
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
      best={items:found,expected:null,complete:false};
    }
    if(best.items.length){
      ticketExpected=best.expected;
      // Une nouvelle lecture du ticket remplace les anciennes suggestions, mais pas les cotes
      // corrigées par l'utilisateur pour la même sélection.
      const previous=new Map(selections.map(s=>[s.label+'|'+(s.market||''),s]));
      selections.splice(0,selections.length,...best.items.map(s=>{
        const prior=previous.get(s.label+'|'+(s.market||''));
        return {...s,odds:s.odds||prior?.odds||null};
      }));
      renderSelections();
      setText('mp-ticket-status',best.expected?
        `${selections.length} sélection(s) candidate(s) sur ${best.expected} annoncée(s) par le combiné.${best.complete?' Liste complète détectée.':' Liste partielle : fais défiler le ticket et relance la lecture.'} Vérifie les libellés.`:
        `${selections.length} sélection(s) candidate(s) détectée(s). Vérifie les libellés.`);
    }else{
      setText('mp-ticket-status','Aucune sélection identifiable. Ouvre « En cours » puis déplie ton combiné Betclic et réessaie. Les tickets n’ont pas toujours des cotes visibles.');
    }
  }
  $('mp-scan').addEventListener('click',extractVisibleSlip);
  function msg(action,details={}){
    return new Promise((resolve,reject)=>{
      let done=false;
      const timer=setTimeout(()=>{if(!done){done=true;reject(new Error('Le module de données n’a pas répondu.'));}},16000);
      try{chrome.runtime.sendMessage({action,...details},response=>{
        if(done)return;done=true;clearTimeout(timer);
        const error=chrome.runtime.lastError;
        if(error)reject(new Error(error.message));
        else if(!response?.ok)reject(new Error(response?.error||'Erreur du fournisseur de données.'));
        else resolve(response.data);
      });}catch(e){clearTimeout(timer);reject(e);}
    });
  }
  const isPublic=()=>$('mp-source').value==='public';
  function updateSource(){
    $('mp-api-key-group').classList.toggle('mp-hidden',isPublic());
    setText('mp-api-status',isPublic()? 'ESPN : données publiques sans clé, non officielles. Les fautes ne sont pas couvertes.':
      apiConfigured?'✓ Clé API-Football disponible pour cette session.':'Clé API-Football nécessaire pour ce mode.');
    stop();
  }
  $('mp-source').addEventListener('change',updateSource);
  $('mp-key-connect').addEventListener('click',async()=>{
    const key=$('mp-api-key').value;$('mp-api-key').value='';
    try{await msg('set-key',{value:key});apiConfigured=true;setText('mp-api-status','✓ Clé disponible pendant la session uniquement.');}
    catch(e){setText('mp-api-status','Erreur : '+e.message);}
  });
  $('mp-key-clear').addEventListener('click',async()=>{
    stop();try{await msg('clear-key');}catch{}apiConfigured=false;setText('mp-api-status','Clé retirée de la mémoire.');
  });
  function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  $('mp-date').value=localDate();
  async function findFixtures(){
    const area=$('mp-results');area.replaceChildren();
    const search=$('mp-team').value.trim();
    if(search.length<2){note('Saisis au moins deux lettres du nom d’une équipe.',true);return;}
    if(!isPublic()&&!apiConfigured){note('Configure ta clé API-Football ou choisis le mode ESPN public.',true);return;}
    try{
      note(isPublic()?'Recherche dans les championnats ESPN (données publiques)…':'Recherche via API-Football…');
      const result=isPublic()?await msg('public-fixtures',{date:$('mp-date').value,search}):
        await msg('fixtures',{date:$('mp-date').value,search});
      if(!result.items.length)area.append(el('p','mp-muted','Aucun match correspondant sur cette date.'));
      for(const f of result.items){
        const row=el('div','mp-item');
        row.append(el('span','',`${f.home} – ${f.away} (${f.status})`),button('Suivre',()=>follow(f)));
        area.append(row);
      }
      note(`${result.items.length} match(s) trouvé(s) · ${isPublic()?'ESPN non officiel, couverture partielle':'API-Football'}.${result.partial?' Certaines ligues étaient indisponibles.':''}`);
    }catch(e){note(e.message,true);}
  }
  $('mp-find-fixtures').addEventListener('click',findFixtures);
  function follow(f){
    if(tracked.some(t=>t.id===f.id))return;
    if(tracked.length>=3){note('Trois matchs maximum. Retire un match avant d’en ajouter un autre.',true);return;}
    tracked.push({id:f.id,league:f.league||null,source:f.source||'api-football',date:$('mp-date').value,
      label:`${f.home} – ${f.away}`,seen:null,fouls:null,events:[],score:f.score,requestCount:0});
    renderTracked();
    note('Match ajouté. Clique « Démarrer les alertes ».');
  }
  function renderTracked(){
    const area=$('mp-tracked');area.replaceChildren();
    if(!tracked.length)area.append(el('p','mp-muted','Aucun match suivi.'));
    for(const t of tracked){
      const row=el('div','mp-item');row.append(el('span','',t.label+' · '+t.score),button('✕',()=>{
        const i=tracked.indexOf(t);if(i!==-1)tracked.splice(i,1);renderTracked();
        if(!tracked.length)stop();
      }));area.append(row);
      for(const event of t.events.slice(-3))area.append(el('p','mp-muted',t.source==='public'?core.publicEventText(event)||'Événement sportif':core.eventText(event)||'Événement sportif'));
    }
  }
  function renderAlerts(){const area=$('mp-alerts');area.replaceChildren();
    if(latestAlerts.length){area.append(el('h3','','Alertes reçues'));for(const text of latestAlerts)area.append(el('div','mp-alert',text));}
  }
  async function poll(){
    if(!active||pollBusy||!tracked.length)return;
    pollBusy=true;pollNumber++;
    try{
      for(const t of tracked){
        if(t.source==='public'){
          const response=await msg('public-events',{fixture:t.id,league:t.league,date:t.date});
          const items=response.items||[];
          const nextSeen=new Set(items.map(x=>x.id));
          let sawGoal=false;
          if(t.seen!==null)for(const event of items){
            if(!t.seen.has(event.id)){
              const message=core.publicEventText(event);
              if(message){toast(`${t.label} : ${message}`);if(['goal','penalty'].includes(event.kind))sawGoal=true;}
            }
          }
          if(t.seen!==null && !sawGoal && response.score!==t.score){
            toast(`${t.label} : score mis à jour ${response.score} (source ESPN)`);
          }
          t.seen=nextSeen;t.events=items.slice(-6);t.score=response.score;
          continue;
        }
        const events=await msg('events',{fixture:t.id});
        const items=(events.items||[]).filter(x=>core.eventKind(x));
        const nextSeen=new Set(items.map(core.eventId));
        if(t.seen!==null)for(const event of items){
          if(!t.seen.has(core.eventId(event))){
            const message=core.eventText(event);if(message)toast(`${t.label}: ${message}`);
          }
        }
        t.seen=nextSeen;t.events=items.slice(-6);
        if(pollNumber%2===1){
          const fouls=await msg('fouls',{fixture:t.id});
          if(fouls.total!==null){
            if(t.fouls!==null&&fouls.total>t.fouls)toast(`${t.label} : fautes totales ${t.fouls} → ${fouls.total} (statistique, sans détail joueur)`);
            t.fouls=fouls.total;
          }
        }
      }
      renderTracked();note(`Source ${isPublic()?'ESPN':'API-Football'} · actualisée à ${new Date().toLocaleTimeString('fr-FR')}, délai indicatif ≥ 2 min`);
    }catch(e){note('Données live indisponibles : '+e.message,true);}
    finally{pollBusy=false;}
  }
  function start(){
    if(tracked.some(x=>x.source==='api-football')&&!apiConfigured){note('Ajoute une clé API-Football pour les matchs suivis avec cette source.',true);return;}
    if(!tracked.length){note('Sélectionne au moins un match.',true);return;}
    stop();active=true;pollNumber=0;
    for(const t of tracked){t.seen=null;t.fouls=null;}
    poll();pollTimer=setInterval(poll,120_000);
  }
  function stop(){active=false;if(pollTimer)clearInterval(pollTimer);pollTimer=null;note('Suivi arrêté.');}
  $('mp-start').addEventListener('click',start);
  $('mp-stop').addEventListener('click',stop);
  // Ne demande aucun accès au compte bookmaker ni au paiement.
  renderSelections();renderTracked();
  msg('status').then(s=>{apiConfigured=s.configured;updateSource();}).catch(()=>{
    setText('mp-api-status','La source de résultats ne répond pas.');
  });
})();
