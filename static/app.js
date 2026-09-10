import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { VV_CONFIG } from './config.js';

const app = document.getElementById('app');
let sb = null;
let settingsData = null;
let settingsTab = 'questions';
let candidateCtx = null;
let currentHrEmail = '';
let currentSettingsVersion = '';
let pendingResultId = null;

const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = x => x ? new Date(x).toLocaleString('it-IT',{dateStyle:'short',timeStyle:'short'}) : '—';

function configReady(){
  return VV_CONFIG.SUPABASE_URL && !VV_CONFIG.SUPABASE_URL.includes('YOUR-PROJECT') &&
    VV_CONFIG.SUPABASE_PUBLISHABLE_KEY && !VV_CONFIG.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_SUPABASE');
}
function getClient(){
  if(!sb) sb=createClient(VV_CONFIG.SUPABASE_URL,VV_CONFIG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  return sb;
}
function friendlyError(err){
  const m=String(err?.message||err||'Errore');
  const map={
    HR_AUTH_REQUIRED:'Utente non autorizzato all’area HR.',
    LINK_NOT_FOUND:'Link candidato non valido.',
    LINK_EXPIRED:'Il link candidato è scaduto.',
    TEST_COMPLETED:'Il test è già stato completato.',
    INVALID_ANSWER:'Una delle risposte non è valida.',
    MISSING_ANSWER:'Completa tutte le domande prima di inviare il test.',
    INVALID_TEST_CONFIG:'Configurazione del test non valida.',
    INVITATION_NOT_FOUND:'Invito non trovato.',
    RESULT_NOT_AVAILABLE:'Risultato non ancora disponibile.'
  };
  for(const [k,v] of Object.entries(map)) if(m.includes(k)) return v;
  return m;
}
async function rpc(name,args={}){
  const {data,error}=await getClient().rpc(name,args);
  if(error) throw new Error(friendlyError(error));
  return data;
}
function candidateToken(){return new URLSearchParams(location.search).get('candidate')||''}
function hrSectionName(){const h=(location.hash||'').replace(/^#/, ''); if(!h.startsWith('hr'))return null; return h.split('/')[1]||'candidates'}
function appBaseUrl(){
  const configured=(VV_CONFIG.APP_URL||'').trim();
  if(configured) return configured.endsWith('/')?configured:configured+'/';
  return location.origin+location.pathname.replace(/[^/]*$/,'');
}
function candidateUrl(token){return appBaseUrl()+'?candidate='+encodeURIComponent(token)}
function nav(section){location.hash='#hr/'+section}
window.addEventListener('hashchange',()=>render().catch(showFatal));
window.addEventListener('popstate',()=>render().catch(showFatal));

function setupRequired(){
  app.innerHTML=`<div class="candidate"><section class="candidate-card"><div class="logo"><span class="mark">V</span>VoipVoice</div><h1>Configurazione richiesta</h1><p class="sub">Il frontend non è ancora collegato a Supabase.</p><div class="callout" style="margin-top:20px">Apri <strong>static/config.js</strong> e inserisci SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY del progetto.</div></section></div>`;
}
function neutralHome(){
  app.innerHTML=`<div class="candidate"><section class="candidate-card"><div class="logo"><span class="mark">V</span>VoipVoice</div><h1>Valutazione attitudinale</h1><p class="sub">Per accedere al questionario utilizza esclusivamente il link personale ricevuto dal team HR.</p><div class="foot">Questa pagina non espone risultati, scoring o funzioni amministrative.</div></section></div>`;
}
function showFatal(e){app.innerHTML=`<div class="candidate"><section class="candidate-card"><h1>Errore</h1><p class="sub">${E(friendlyError(e))}</p></section></div>`}

async function render(){
  if(!configReady()) return setupRequired();
  const token=candidateToken();
  if(token) return candidateHome(token);
  const section=hrSectionName();
  if(!section) return neutralHome();
  const {data:{session}}=await getClient().auth.getSession();
  if(!session) return login();
  try{
    const b=await rpc('hr_bootstrap');
    currentHrEmail=b.email||session.user.email||'';
  }catch(e){await getClient().auth.signOut(); return login(friendlyError(e));}
  return hrSection(section);
}

function login(msg=''){
  app.innerHTML=`<div class="login"><section class="login-card"><div class="logo"><span class="mark">V</span>VoipVoice HR</div><h1>Area riservata</h1><p class="sub">Gestisci candidature, risultati e configurazione del test.</p><div style="display:grid;gap:12px;margin-top:22px"><label>Email HR<input id="email" type="email" autocomplete="username"></label><label>Password<input id="pwd" type="password" autocomplete="current-password"></label></div><button class="btn primary" style="width:100%;margin-top:13px" onclick="doLogin()">Accedi</button><div id="msg">${msg?`<div class="error">${E(msg)}</div>`:''}</div><div class="foot">L’accesso è gestito da Supabase Auth. Solo gli utenti inseriti nella whitelist HR possono utilizzare le funzioni amministrative.</div></section></div>`;
}
async function doLogin(){
  const email=document.getElementById('email').value.trim(),password=document.getElementById('pwd').value;
  try{
    const {error}=await getClient().auth.signInWithPassword({email,password}); if(error)throw error;
    await rpc('hr_bootstrap'); location.hash='#hr/candidates'; await render();
  }catch(e){await getClient().auth.signOut();document.getElementById('msg').innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
}
async function logout(){await getClient().auth.signOut();location.hash='#hr';render()}

function shell(section,content){
  app.innerHTML=`<div class="hr"><aside class="side"><div class="brand">VoipVoice HR<small>Talent assessment</small></div><nav><a class="${section==='candidates'?'active':''}" href="javascript:nav('candidates')">Candidature</a><a class="${section==='results'?'active':''}" href="javascript:nav('results')">Risultati</a><a class="${section==='settings'?'active':''}" href="javascript:nav('settings')">Impostazioni</a><a class="${section==='audit'?'active':''}" href="javascript:nav('audit')">Registro e versioni</a><div class="logout"><a href="javascript:logout()">Esci</a></div></nav></aside><main class="main">${content}</main></div>`;
}
async function hrSection(s){if(s==='results')return results();if(s==='settings')return settings();if(s==='audit')return audit();return candidates()}

async function candidates(){
  const [b,d]=await Promise.all([rpc('hr_bootstrap'),rpc('hr_list_candidates')]);
  const items=d.items||[],done=items.filter(x=>x.status==='completed').length;
  const rows=items.map(c=>`<tr><td><strong>${E(c.name)}</strong><br><span class="muted">${E(c.position||'')}</span></td><td>v${E(c.version)}</td><td>${fmt(c.createdAt)}</td><td><span class="badge ${c.status==='completed'?'green':c.status==='expired'?'yellow':'blue'}">${c.status==='completed'?'Completato':c.status==='started'?'In corso':c.status==='expired'?'Scaduto':'Inviato'}</span></td><td>${c.status==='completed'?`<button class="btn secondary small" onclick="openResult(${c.id})">Risultato</button>`:`<button class="btn secondary small" onclick="rotateLink(${c.id})">Rigenera link</button>`}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">Nessun candidato.</td></tr>';
  shell('candidates',`<div class="top"><div><h1>Candidature</h1><p class="sub">Genera link personali e controlla l’avanzamento da qualsiasi dispositivo.</p></div><span class="version">Test v${E(b.currentVersion)}</span></div><div class="kpis"><div class="kpi"><span>Inviti</span><strong>${items.length}</strong></div><div class="kpi"><span>Da completare</span><strong>${items.length-done}</strong></div><div class="kpi"><span>Completati</span><strong>${done}</strong></div><div class="kpi"><span>Versione attiva</span><strong>${E(b.currentVersion)}</strong></div></div><section class="card"><h2>Nuovo invito</h2><div class="grid3" style="margin-top:14px"><label>Nome candidato<input id="cname"></label><label>Posizione<input id="cposition"></label><label>Scadenza<select id="cexp"><option value="7">7 giorni</option><option value="14">14 giorni</option><option value="30">30 giorni</option></select></label></div><button class="btn primary" style="margin-top:14px" onclick="newInvite()">Genera link candidato</button><div id="inviteMsg"></div></section><section class="card"><h2>Candidati</h2><div style="overflow:auto"><table><thead><tr><th>Candidato</th><th>Versione</th><th>Invito</th><th>Stato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
}
async function newInvite(){
  try{
    const d=await rpc('hr_create_invitation',{p_name:document.getElementById('cname').value,p_position:document.getElementById('cposition').value,p_expiry_days:Number(document.getElementById('cexp').value)});
    const url=candidateUrl(d.token);
    document.getElementById('inviteMsg').innerHTML=`<div class="success">Link v${E(d.version)} generato:<div class="linkbox"><input id="newLink" readonly value="${E(url)}"><button class="btn secondary" onclick="copyText('newLink')">Copia</button><button class="btn secondary" onclick="window.open(document.getElementById('newLink').value,'_blank')">Apri</button></div><div class="foot">Per sicurezza il token non viene conservato in chiaro: se perdi il link usa “Rigenera link”.</div></div>`;
  }catch(e){document.getElementById('inviteMsg').innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
}
async function rotateLink(id){
  if(!confirm('Rigenerare il link? Quello precedente smetterà di funzionare.'))return;
  try{const d=await rpc('hr_rotate_invitation_token',{p_invitation_id:id});const url=candidateUrl(d.token);await navigator.clipboard.writeText(url);alert('Nuovo link copiato negli appunti:\n'+url);candidates()}catch(e){alert(friendlyError(e))}
}
async function copyText(id){await navigator.clipboard.writeText(document.getElementById(id).value);alert('Link copiato.')}

async function candidateHome(token){
  try{
    const d=await rpc('candidate_get_test',{p_token:token});
    candidateCtx={token,data:d,answers:d.answers||{},index:0};
    if(d.status==='completed')return candidateDone(d.name);
    const first=(d.questions||[]).findIndex(q=>candidateCtx.answers[String(q.id)]==null);candidateCtx.index=first<0?0:first;
    app.innerHTML=`<div class="candidate"><section class="candidate-card"><div class="logo"><span class="mark">V</span>VoipVoice</div><span class="badge blue">Valutazione attitudinale</span><h1>Benvenuto, ${E(d.name)}.</h1><p class="sub">Da questo link puoi esclusivamente svolgere il questionario assegnato. I risultati sono riservati all’area HR.</p><div class="meta"><div><strong>Durata</strong><span>15–20 minuti</span></div><div><strong>Domande</strong><span>${d.questions.length}</span></div><div><strong>Versione</strong><span>${E(d.version)}</span></div></div><button class="btn primary" style="width:100%" onclick="startCandidate()">${d.status==='started'?'Continua il test':'Inizia il test'}</button><div class="foot">Questa interfaccia non espone punteggi, risultati, competenze associate o funzioni HR.</div></section></div>`;
  }catch(e){app.innerHTML=`<div class="candidate"><section class="candidate-card"><div class="logo"><span class="mark">V</span>VoipVoice</div><h1>Link non disponibile</h1><p class="sub">${E(friendlyError(e))}</p></section></div>`}
}
async function startCandidate(){try{await rpc('candidate_start',{p_token:candidateCtx.token});showQuestion()}catch(e){showFatal(e)}}
function showQuestion(){
  const {data,index,answers}=candidateCtx,q=data.questions[index],sel=answers[String(q.id)];
  const choices=q.answers.map(a=>`<label class="choice"><input type="radio" name="ans" value="${E(a.key)}" ${String(sel)===String(a.key)?'checked':''}><span>${q.type==='scenario'?`<strong>${E(a.key)}. </strong>`:''}${E(a.text)}</span></label>`).join('');
  app.innerHTML=`<div class="test"><main class="testmain"><div class="logo"><span class="mark">V</span>Valutazione attitudinale</div><div class="muted">${E(data.name)} · domanda ${index+1} di ${data.questions.length}</div><div class="progress"><span style="width:${(index+1)/data.questions.length*100}%"></span></div><section class="qcard"><div class="qtype">${q.type==='scenario'?'Scenario situazionale':'Scala di accordo'}</div><div class="qtext">${E(q.text)}</div><div class="choices">${choices}</div><div class="testnav"><button class="btn secondary" ${index===0?'disabled':''} onclick="candidateMove(-1)">Indietro</button><button class="btn primary" onclick="candidateMove(1)">${index===data.questions.length-1?'Concludi test':'Avanti'}</button></div><div id="qmsg"></div></section></main></div>`;
}
async function candidateMove(delta){
  const q=candidateCtx.data.questions[candidateCtx.index];
  if(delta>0){
    const r=document.querySelector('input[name=ans]:checked');if(!r)return document.getElementById('qmsg').innerHTML='<div class="error">Seleziona una risposta.</div>';
    candidateCtx.answers[String(q.id)]=r.value;
    try{await rpc('candidate_save',{p_token:candidateCtx.token,p_answers:candidateCtx.answers})}catch(e){return document.getElementById('qmsg').innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
  }
  const n=candidateCtx.index+delta;if(n<0)return;
  if(n>=candidateCtx.data.questions.length){
    try{await rpc('candidate_submit',{p_token:candidateCtx.token,p_answers:candidateCtx.answers});return candidateDone(candidateCtx.data.name)}catch(e){return document.getElementById('qmsg').innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
  }
  candidateCtx.index=n;showQuestion();
}
function candidateDone(name){app.innerHTML=`<div class="candidate"><section class="candidate-card complete"><div class="check">✓</div><h1>Test completato</h1><p class="sub">Grazie, ${E(name)}. Le risposte sono state registrate. I risultati sono consultabili esclusivamente dal team HR.</p><div class="success">Puoi chiudere questa pagina.</div></section></div>`}

async function results(){
  const d=await rpc('hr_list_candidates'); const items=(d.items||[]).filter(x=>x.status==='completed');
  const rows=items.map(c=>`<tr><td><strong>${E(c.name)}</strong><br><span class="muted">${E(c.position||'')}</span></td><td>v${E(c.version)}</td><td>${fmt(c.completedAt)}</td><td><button class="btn secondary small" onclick="openResult(${c.id})">Apri report</button></td></tr>`).join('')||'<tr><td colspan="4" class="muted">Nessun test completato.</td></tr>';
  shell('results',`<div class="top"><div><h1>Risultati</h1><p class="sub">Report accessibili soltanto agli utenti HR autorizzati.</p></div></div><section class="card"><div style="overflow:auto"><table><thead><tr><th>Candidato</th><th>Versione</th><th>Completato</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section><div id="result"></div>`);
  if(pendingResultId!==null){const id=pendingResultId;pendingResultId=null;resultDetail(id);}
}
function openResult(id){if(hrSectionName()!=='results'){pendingResultId=id;nav('results')}else resultDetail(id)}
function findRange(ranges,s){return ranges.find(r=>s>=Number(r.min)&&s<=Number(r.max))||ranges[ranges.length-1]}
async function resultDetail(id){
  try{
    const d=await rpc('hr_get_result',{p_invitation_id:id}),r=d.result,c=d.config;
    const cards=c.competencies.map(x=>{const s=Number(r.scores[x.name]||0),k=findRange(c.ranges,s);return `<div class="score"><div class="scorehead"><strong>${E(x.name)}</strong><strong>${s.toFixed(0)}</strong></div><div class="bar"><span style="width:${Math.max(0,Math.min(100,s))}%"></span></div><span class="badge ${s>=65?'green':s>=45?'blue':'yellow'}">${E(k.label)}</span><p><strong>Uso in colloquio:</strong> ${E(k.interview)}</p><p><strong>Approfondimento:</strong> ${E(x.suggestion)}</p></div>`}).join('');
    document.getElementById('result').innerHTML=`<section class="card"><div class="toolbar"><div><h2>${E(d.candidate.name)}</h2><div class="muted">${E(d.candidate.position||'')} · v${E(d.candidate.version)} · ${fmt(d.candidate.completedAt)}</div></div><button class="btn secondary" onclick="document.getElementById('result').innerHTML=''">Chiudi</button></div><div class="scenario">Punteggio scenari: <strong>${Number(r.scenarioScore||0).toFixed(0)}/100</strong><div class="muted">Media normalizzata delle 10 situazioni lavorative.</div></div><div class="scoregrid">${cards}</div><div class="foot">Strumento interno di supporto al colloquio; non è un test psicometrico validato e non va usato come unico criterio di esclusione.</div></section>`;
  }catch(e){document.getElementById('result').innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
}

async function settings(){
  const d=await rpc('hr_get_settings');settingsData=d.data;window.settingsData=settingsData;currentSettingsVersion=d.currentVersion;renderSettingsPage();
}
function renderSettingsPage(){
  shell('settings',`<div class="top"><div><h1>Impostazioni</h1><p class="sub">Modifica in bozza e pubblica una nuova versione.</p></div><span class="version">Pubblicata v${E(currentSettingsVersion)}</span></div><div class="callout"><strong>Versionamento attivo.</strong> Gli inviti già creati e i risultati storici restano legati alla loro versione. Le modifiche diventano operative solo dopo “Pubblica nuova versione”.</div><div class="tabs"><button class="btn secondary ${settingsTab==='questions'?'active':''}" onclick="setTab('questions')">Domande</button><button class="btn secondary ${settingsTab==='answers'?'active':''}" onclick="setTab('answers')">Risposte</button><button class="btn secondary ${settingsTab==='scoring'?'active':''}" onclick="setTab('scoring')">Punteggi</button><button class="btn secondary ${settingsTab==='security'?'active':''}" onclick="setTab('security')">Sicurezza</button></div><div id="settingsBody"></div><div class="savebar ${settingsTab==='security'?'hidden':''}"><div><strong>Configurazione in modifica</strong><div class="muted" style="font-size:12px">Salva bozza senza renderla attiva.</div></div><div class="toolbar-actions"><button class="btn secondary" onclick="saveDraft()">Salva bozza</button><button class="btn danger" onclick="discardDraft()">Annulla bozza</button><button class="btn primary" onclick="publishSettings()">Pubblica nuova versione</button></div></div>`);settingsBody();
}
function setTab(t){settingsTab=t;renderSettingsPage()}
function compOptions(value,none=false){return (none?'<option value="">Nessuna</option>':'')+settingsData.competencies.map(c=>`<option value="${E(c.name)}" ${c.name===value?'selected':''}>${E(c.name)}</option>`).join('')}
function settingsBody(){
  const el=document.getElementById('settingsBody');
  if(settingsTab==='questions'){
    el.innerHTML=`<section class="card"><h2>Domande (${settingsData.questions.length})</h2><p class="muted">Modifica testo e competenze associate.</p>${settingsData.questions.map((q,i)=>`<div class="editor"><div class="ehead"><span class="num">${q.id}</span><div><strong>${E(q.text)}</strong><div><span class="pill">${E(q.scoring.primary)}</span>${q.scoring.secondary?`<span class="pill">+ ${E(q.scoring.secondary)}</span>`:''}</div></div></div><div class="editgrid"><label>Testo<textarea onchange="settingsData.questions[${i}].text=this.value">${E(q.text)}</textarea></label><label>Competenza primaria<select onchange="settingsData.questions[${i}].scoring.primary=this.value">${compOptions(q.scoring.primary)}</select></label><label>Competenza secondaria<select onchange="settingsData.questions[${i}].scoring.secondary=this.value||null">${compOptions(q.scoring.secondary,true)}</select></label></div></div>`).join('')}</section>`;
  }else if(settingsTab==='answers'){
    el.innerHTML=`<section class="card"><h2>Risposte e punti</h2><p class="muted">Puoi modificare sia il testo sia il valore attribuito a ciascuna risposta.</p>${settingsData.questions.map((q,i)=>`<div class="editor"><div class="ehead"><span class="num">${q.id}</span><div><strong>${E(q.text)}</strong><div class="muted">${q.type==='scenario'?'Scenario':'Scala'} ${q.scoring.inverse?'· inversa':''}</div></div></div>${q.answers.map((a,j)=>`<div class="answerrow"><span class="akey">${E(a.key)}</span><input value="${E(a.text)}" onchange="settingsData.questions[${i}].answers[${j}].text=this.value"><input type="number" step=".1" value="${Number(a.points)}" onchange="settingsData.questions[${i}].answers[${j}].points=Number(this.value)"></div>`).join('')}</div>`).join('')}</section>`;
  }else if(settingsTab==='scoring'){
    el.innerHTML=`<section class="card"><h2>Fasce di valutazione</h2>${settingsData.ranges.map((r,i)=>`<div class="rangerow"><input type="number" step=".01" value="${r.min}" onchange="settingsData.ranges[${i}].min=Number(this.value)"><input type="number" step=".01" value="${r.max}" onchange="settingsData.ranges[${i}].max=Number(this.value)"><input value="${E(r.label)}" onchange="settingsData.ranges[${i}].label=this.value"><input value="${E(r.interview)}" onchange="settingsData.ranges[${i}].interview=this.value"></div>`).join('')}</section><section class="card"><h2>Pesi e item inversi</h2><div class="grid2"><label>Peso competenza primaria<input type="number" step=".1" min="0" value="${settingsData.weights?.primary??1}" onchange="settingsData.weights.primary=Number(this.value)"></label><label>Peso competenza secondaria<input type="number" step=".1" min="0" value="${settingsData.weights?.secondary??1}" onchange="settingsData.weights.secondary=Number(this.value)"></label></div><div style="overflow:auto;margin-top:16px"><table><thead><tr><th>N.</th><th>Domanda scala</th><th>Inversa</th></tr></thead><tbody>${settingsData.questions.filter(q=>q.type==='scale').map(q=>{const i=settingsData.questions.indexOf(q);return `<tr><td>${q.id}</td><td>${E(q.text)}</td><td><select onchange="settingsData.questions[${i}].scoring.inverse=this.value==='1'"><option value="0" ${!q.scoring.inverse?'selected':''}>No</option><option value="1" ${q.scoring.inverse?'selected':''}>Sì</option></select></td></tr>`}).join('')}</tbody></table></div></section>`;
  }else{
    el.innerHTML=`<div class="grid2"><section class="card"><h2>Cambia password HR</h2><div class="muted">Utente: ${E(currentHrEmail)}</div><div style="display:grid;gap:12px;margin-top:15px"><label>Password attuale<input id="oldp" type="password" autocomplete="current-password"></label><label>Nuova password<input id="newp" type="password" autocomplete="new-password"></label><label>Conferma<input id="newp2" type="password" autocomplete="new-password"></label></div><button class="btn primary" style="margin-top:14px" onclick="passwordChange()">Aggiorna password</button><div id="passMsg"></div></section><section class="card"><h2>Sicurezza</h2><p class="muted">L’autenticazione HR è gestita da Supabase Auth. Le tabelle applicative non sono accessibili direttamente dal browser: candidate e HR usano esclusivamente funzioni SQL autorizzate.</p><p class="muted">I token candidato sono salvati nel database solo come hash SHA-256.</p></section></div>`;
  }
}
async function saveDraft(){try{await rpc('hr_save_draft',{p_data:settingsData});alert('Bozza salvata su Supabase.')}catch(e){alert(friendlyError(e))}}
async function discardDraft(){if(!confirm('Eliminare la bozza e ripartire dalla versione pubblicata?'))return;try{await rpc('hr_discard_draft');settings()}catch(e){alert(friendlyError(e))}}
async function publishSettings(){if(!confirm('Pubblicare una nuova versione? I vecchi inviti resteranno sulla loro versione.'))return;try{const d=await rpc('hr_publish_settings',{p_data:settingsData});alert('Pubblicata versione '+d.version);settings()}catch(e){alert(friendlyError(e))}}
async function passwordChange(){
  const oldp=document.getElementById('oldp').value,newp=document.getElementById('newp').value,newp2=document.getElementById('newp2').value,msg=document.getElementById('passMsg');
  if(newp.length<12)return msg.innerHTML='<div class="error">La nuova password deve contenere almeno 12 caratteri.</div>';
  if(newp!==newp2)return msg.innerHTML='<div class="error">Le nuove password non coincidono.</div>';
  try{
    const {error:reauthErr}=await getClient().auth.signInWithPassword({email:currentHrEmail,password:oldp});if(reauthErr)throw new Error('Password attuale non corretta.');
    const {error}=await getClient().auth.updateUser({password:newp});if(error)throw error;
    msg.innerHTML='<div class="success">Password aggiornata. Verrai disconnesso.</div>';
    setTimeout(async()=>{await getClient().auth.signOut({scope:'global'});location.hash='#hr';render()},900);
  }catch(e){msg.innerHTML=`<div class="error">${E(friendlyError(e))}</div>`}
}

async function audit(){
  const d=await rpc('hr_audit');
  const vers=(d.versions||[]).map(v=>`<tr><td>v${E(v.label)}</td><td>${fmt(v.createdAt)}</td><td>${v.isCurrent?'<span class="badge green">Attiva</span>':'<span class="badge blue">Storica</span>'}</td><td>${v.invitations}</td></tr>`).join('');
  shell('audit',`<div class="top"><div><h1>Registro e versioni</h1><p class="sub">Inviti, modifiche e risultati restano collegati alla versione corretta.</p></div></div><div class="grid2"><section class="card"><h2>Versioni</h2><table><thead><tr><th>Versione</th><th>Data</th><th>Stato</th><th>Inviti</th></tr></thead><tbody>${vers}</tbody></table></section><section class="card"><h2>Attività</h2>${(d.audit||[]).map(x=>`<div class="auditrow"><strong>${E(x.event)}</strong><span>${fmt(x.createdAt)}</span></div>`).join('')}</section></div>`);
}

Object.assign(window,{nav,doLogin,logout,newInvite,rotateLink,copyText,startCandidate,candidateMove,openResult,setTab,saveDraft,discardDraft,publishSettings,passwordChange});
render().catch(showFatal);
