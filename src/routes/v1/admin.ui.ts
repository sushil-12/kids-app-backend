// Self-contained admin panel served as static HTML from GET /v1/admin. Tabs:
// Dashboard, Stories, Poems, ABC, Coloring (iframe to /v1/coloring/review),
// Crawl, RAG, Jobs. Calls only x-admin-key JSON endpoints (existing ones for
// coloring/crawl/RAG + the new /v1/admin/* ones for stories/poems/abc/jobs).
// Admin key is stored in localStorage (bm_admin_key) — same pattern as the
// coloring review page.
export const adminPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Admin · BrightMind Kids</title>
<style>
  :root { --coral:#FF7361; --teal:#2EBDB5; --yellow:#FFCC40; --purple:#8C73F2;
          --cream:#FFF7EB; --dark:#332E40; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--cream); color:var(--dark); }
  header { position:sticky; top:0; z-index:10; background:#fff; border-bottom:2px solid #efeaf7;
           padding:12px 20px; display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .spacer { flex:1; }
  header input[type=text] { padding:6px 10px; border:1px solid #d8d2e6; border-radius:8px; font-size:13px; width:200px; }
  nav { display:flex; gap:4px; flex-wrap:wrap; padding:10px 20px; background:#fff7ef; border-bottom:1px solid #efeaf7; }
  nav button { background:transparent; border:none; border-radius:8px; padding:8px 14px; font:inherit; font-weight:600; cursor:pointer; color:#7a7488; }
  nav button.active { background:var(--purple); color:#fff; }
  main { padding:20px; }
  .tab { display:none; }
  .tab.active { display:block; }
  button { font:inherit; border:none; border-radius:10px; padding:8px 14px; cursor:pointer; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .btn { background:var(--purple); color:#fff; }
  .btn-danger { background:#fff; color:var(--coral); border:2px solid var(--coral); padding:6px 12px; font-size:13px; }
  .btn-go { background:var(--teal); color:#fff; padding:6px 12px; font-size:13px; }
  table { width:100%; border-collapse:collapse; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 2px 10px rgba(51,46,64,.06); }
  th, td { text-align:left; padding:10px 12px; border-bottom:1px solid #f1edf8; font-size:13px; vertical-align:top; }
  th { background:#f7f4fd; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:#7a7488; }
  td .muted { color:#7a7488; font-size:12px; }
  td .tag { background:#f3f0fa; border-radius:6px; padding:1px 7px; font-size:11px; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .toolbar select, .toolbar input { padding:6px 10px; border:1px solid #d8d2e6; border-radius:8px; font-size:13px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; }
  .stat { background:#fff; border-radius:14px; padding:16px; box-shadow:0 2px 10px rgba(51,46,64,.06); }
  .stat .label { font-size:12px; color:#7a7488; text-transform:uppercase; letter-spacing:.04em; }
  .stat .value { font-size:26px; font-weight:700; margin-top:4px; }
  .msg { text-align:center; color:#7a7488; padding:40px 20px; }
  .err { color:var(--coral); }
  iframe { width:100%; height:75vh; border:1px solid #efeaf7; border-radius:12px; background:#fff; }
  pre { background:#fff; border:1px solid #efeaf7; border-radius:10px; padding:12px; white-space:pre-wrap; font-size:12px; max-height:300px; overflow:auto; }
  .row-actions { display:flex; gap:6px; }
  .cropped { max-width:380px; max-height:6em; overflow:hidden; text-overflow:ellipsis; }
  .btn-edit { background:#fff; color:var(--purple); border:2px solid var(--purple); padding:6px 12px; font-size:13px; }
  .overlay { position:fixed; inset:0; background:rgba(51,46,64,.45); display:none; align-items:flex-start; justify-content:center; padding:40px 20px; z-index:50; overflow:auto; }
  .overlay.show { display:flex; }
  .modal { background:#fff; border-radius:16px; padding:20px; width:100%; max-width:620px; box-shadow:0 10px 40px rgba(51,46,64,.25); }
  .modal h2 { margin:0 0 12px; font-size:18px; }
  .modal .field { margin-bottom:12px; }
  .modal label { display:block; font-size:12px; color:#7a7488; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px; }
  .modal input[type=text], .modal textarea, .modal select { width:100%; padding:8px 10px; border:1px solid #d8d2e6; border-radius:8px; font:inherit; font-size:14px; }
  .modal textarea { min-height:120px; resize:vertical; font-family:inherit; }
  .modal .actions { display:flex; gap:10px; justify-content:flex-end; margin-top:16px; }
  .modal .err { color:var(--coral); font-size:13px; margin-top:8px; min-height:1em; }
</style>
</head>
<body>
<header>
  <h1>BrightMind Kids · Admin</h1>
  <div class="spacer"></div>
  <!-- Stories, poems and ABC are authored in the content portal (admin/), which
       edits scenes, pictures and recorded narration. The tabs below stay for
       the legacy flat content, coloring, crawl, RAG and jobs. -->
  <a href="/admin/" style="font-weight:700;color:var(--purple);text-decoration:none;margin-right:14px;">Content portal ↗</a>
  <input type="text" id="adminKey" placeholder="admin key (x-admin-key)" />
</header>
<nav id="nav"></nav>
<main>
  <div id="tab-dashboard" class="tab"></div>
  <div id="tab-stories" class="tab"></div>
  <div id="tab-cinematic" class="tab"></div>
  <div id="tab-poems" class="tab"></div>
  <div id="tab-abc" class="tab"></div>
  <div id="tab-coloring" class="tab"><iframe src="/v1/coloring/review"></iframe></div>
  <div id="tab-crawl" class="tab"></div>
  <div id="tab-rag" class="tab"></div>
  <div id="tab-jobs" class="tab"></div>
</main>
<div id="overlay" class="overlay"><div class="modal" id="modal"></div></div>
<script>
(function(){
  var KEY_STORE='bm_admin_key';
  var keyInput=document.getElementById('adminKey');
  keyInput.value=localStorage.getItem(KEY_STORE)||'';
  keyInput.addEventListener('change',function(){ localStorage.setItem(KEY_STORE,keyInput.value.trim()); });

  function key(){ return keyInput.value.trim(); }
  function headers(){ return { 'x-admin-key': key(), 'Content-Type':'application/json' }; }
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function fmtDate(s){ if(!s) return ''; try{ return new Date(s).toISOString().slice(0,19).replace('T',' '); }catch(e){ return String(s); } }

  function api(path, opts){
    opts = opts || {};
    opts.headers = Object.assign({}, headers(), opts.headers||{});
    return fetch(path, opts).then(function(r){
      if(r.status===204) return { _status:204 };
      return r.json().then(function(d){ return Object.assign({ _status:r.status }, d); })
        .catch(function(){ return { _status:r.status, error:'Non-JSON response' }; });
    });
  }

  // ---------- Modal editor ----------
  // fields: [{ key, label, type:'text'|'textarea'|'select', value, options?:[{value,label}] }]
  // onSave(values) -> Promise; called when Save is clicked. Closes on success.
  var overlay=document.getElementById('overlay');
  var modalEl=document.getElementById('modal');
  function closeEditor(){ overlay.classList.remove('show'); modalEl.innerHTML=''; }
  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeEditor(); });
  function openEditor(title, fields, onSave){
    var html='<h2>'+esc(title)+'</h2>';
    fields.forEach(function(f){
      html+='<div class="field"><label>'+esc(f.label)+'</label>';
      var v=f.value==null?'':String(f.value);
      if(f.type==='textarea'){
        html+='<textarea data-key="'+esc(f.key)+'">'+esc(v)+'</textarea>';
      } else if(f.type==='select'){
        html+='<select data-key="'+esc(f.key)+'">';
        (f.options||[]).forEach(function(o){
          html+='<option value="'+esc(o.value)+'"'+(String(o.value)===String(f.value)?' selected':'')+'>'+esc(o.label)+'</option>';
        });
        html+='</select>';
      } else {
        html+='<input type="text" data-key="'+esc(f.key)+'" value="'+esc(v).replace(/"/g,'&quot;')+'" />';
      }
      html+='</div>';
    });
    html+='<div class="err" id="modal-err"></div>';
    html+='<div class="actions"><button class="btn-danger" id="modal-cancel">Cancel</button><button class="btn" id="modal-save">Save</button></div>';
    modalEl.innerHTML=html;
    overlay.classList.add('show');
    var errBox=document.getElementById('modal-err');
    document.getElementById('modal-cancel').addEventListener('click', closeEditor);
    document.getElementById('modal-save').addEventListener('click', function(){
      var values={};
      modalEl.querySelectorAll('[data-key]').forEach(function(inp){
        values[inp.dataset.key]=inp.value;
      });
      var saveBtn=document.getElementById('modal-save');
      saveBtn.disabled=true; saveBtn.textContent='Saving…';
      Promise.resolve(onSave(values))
        .then(function(ok){ if(ok!==false) closeEditor(); })
        .catch(function(e){ errBox.textContent=e.message||String(e); })
        .then(function(){ saveBtn.disabled=false; saveBtn.textContent='Save'; });
    });
  }

  var TABS=[
    {id:'dashboard', label:'Dashboard'},
    {id:'stories', label:'Stories'},
    {id:'cinematic', label:'Cinematic'},
    {id:'poems', label:'Poems'},
    {id:'abc', label:'ABC'},
    {id:'coloring', label:'Coloring'},
    {id:'crawl', label:'Crawl'},
    {id:'rag', label:'RAG'},
    {id:'jobs', label:'Jobs / Crons'}
  ];
  var nav=document.getElementById('nav');
  TABS.forEach(function(t){
    var b=document.createElement('button');
    b.textContent=t.label; b.dataset.tab=t.id;
    b.addEventListener('click',function(){ showTab(t.id); });
    nav.appendChild(b);
  });

  function showTab(id){
    document.querySelectorAll('.tab').forEach(function(el){ el.classList.remove('active'); });
    document.querySelectorAll('nav button').forEach(function(el){ el.classList.remove('active'); });
    document.getElementById('tab-'+id).classList.add('active');
    document.querySelector('nav button[data-tab="'+id+'"]').classList.add('active');
    var loader=LOADERS[id]; if(loader) loader();
  }

  function setHTML(id, html){ var el=document.getElementById(id); el.innerHTML=html; return el; }
  function loading(id, msg){ setHTML(id, '<div class="msg">'+esc(msg||'Loading…')+'</div>'); }
  function fail(id, msg){ setHTML(id, '<div class="msg err">'+esc(msg)+'</div>'); }

  // ---------- Dashboard ----------
  // The dashboard writes directly into its tab container (id "tab-dashboard"),
  // so use that id — not "dashboard" — for setHTML/loading/fail.
  function loadDashboard(){
    loading('tab-dashboard');
    Promise.all([api('/v1/stats'), api('/v1/rag/stats')])
      .then(function(res){
        var s=res[0], r=res[1];
        if(s._status===401||r._status===401){ fail('tab-dashboard','Unauthorized — set the admin key above.'); return; }
        var byKind=r.byKind||{};
        var html='<div class="cards">'+
          stat('Stories', s.stories)+
          stat('Poems', s.poems)+
          stat('ABC lessons', s.abcLessons)+
          stat('OpenAI calls today', s.openAiCallsToday)+
          stat('Crawled this week', s.crawledThisWeek)+
          stat('RAG chunks', r.total)+
          stat('Embed calls today', r.embedCallsToday)+
          '</div>';
        var kinds=Object.keys(byKind);
        if(kinds.length){
          html+='<h3>Chunks by kind</h3><div class="cards">';
          kinds.forEach(function(k){ html+=stat(k, byKind[k]); });
          html+='</div>';
        }
        setHTML('tab-dashboard', html);
      })
      .catch(function(e){ fail('tab-dashboard', e.message); });
  }
  function stat(label, value){
    return '<div class="stat"><div class="label">'+esc(label)+'</div><div class="value">'+esc(value)+'</div></div>';
  }

  // ---------- Stories ----------
  function loadStories(){
    var el=document.getElementById('tab-stories');
    el.innerHTML=
      '<div class="toolbar">'+
        '<select id="st-ageBand"><option value="">all ageBands</option><option>junior</option><option>senior</option></select>'+
        '<select id="st-source"><option value="">all sources</option><option>manual</option><option>crawled</option><option>openai-grounded</option></select>'+
        '<button class="btn-go" id="st-refresh">Refresh</button>'+
        '<div class="spacer" style="flex:1"></div>'+
        '<select id="st-genBand"><option value="junior">junior</option><option value="senior">senior</option></select>'+
        '<input type="date" id="st-genDate" />'+
        '<button class="btn" id="st-generate">Generate story</button>'+
      '</div>'+
      '<div id="st-list" class="msg">Loading…</div>';
    document.getElementById('st-genDate').value=new Date().toISOString().slice(0,10);
    document.getElementById('st-refresh').addEventListener('click', fetchStories);
    document.getElementById('st-generate').addEventListener('click', genStory);
    fetchStories();
  }
  function fetchStories(){
    loading('st-list');
    var ab=document.getElementById('st-ageBand').value;
    var src=document.getElementById('st-source').value;
    var q='?limit=100'+(ab?'&ageBand='+encodeURIComponent(ab):'')+(src?'&source='+encodeURIComponent(src):'');
    api('/v1/admin/stories'+q).then(function(res){
      if(res._status===401){ fail('st-list','Unauthorized — set the admin key.'); return; }
      var rows=res.items||[];
      if(!rows.length){ setHTML('st-list','<div class="msg">No stories.</div>'); return; }
      var html='<table><thead><tr><th>Title</th><th>Age</th><th>Source</th><th>Date</th><th>Used</th><th>Created</th><th></th></tr></thead><tbody>';
      rows.forEach(function(s){
        html+='<tr data-id="'+esc(s.id)+'">'+
          '<td><b>'+esc(s.title)+'</b><div class="muted cropped">'+esc(s.body)+'</div></td>'+
          '<td>'+esc(s.ageBand)+'</td>'+
          '<td><span class="tag">'+esc(s.source)+'</span></td>'+
          '<td>'+esc(s.date||'evergreen')+'</td>'+
          '<td>'+esc(s.usedCount)+'</td>'+
          '<td class="muted">'+fmtDate(s.createdAt)+'</td>'+
          '<td><div class="row-actions"><button class="btn-edit">Edit</button><button class="btn-danger">Delete</button></div></td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('st-list', html);
      var trs=document.querySelectorAll('#st-list tbody tr');
      rows.forEach(function(s, i){
        var tr=trs[i]; if(!tr) return;
        tr.__row=s;
        tr.querySelector('.btn-danger').addEventListener('click', function(){ delStory(tr); });
        tr.querySelector('.btn-edit').addEventListener('click', function(){ editStory(tr); });
      });
    }).catch(function(e){ fail('st-list', e.message); });
  }
  function delStory(tr){
    var id=tr.dataset.id;
    if(!confirm('Delete story '+id+'?')) return;
    api('/v1/admin/stories/'+encodeURIComponent(id), { method:'DELETE' }).then(function(res){
      if(res._status!==200&&res._status!==204){ alert('Delete failed: '+(res.error||res._status)); return; }
      tr.remove();
    });
  }
  function editStory(tr){
    var s=tr.__row; if(!s) return;
    openEditor('Edit story · '+s.title, [
      { key:'title', label:'Title', type:'text', value:s.title },
      { key:'ageBand', label:'Age band', type:'select', value:s.ageBand, options:[{value:'junior',label:'junior'},{value:'senior',label:'senior'}] },
      { key:'emoji', label:'Emoji', type:'text', value:s.emoji },
      { key:'moral', label:'Moral', type:'text', value:s.moral },
      { key:'date', label:'Date (YYYY-MM-DD, blank = evergreen)', type:'text', value:s.date||'' },
      { key:'source', label:'Source', type:'text', value:s.source },
      { key:'body', label:'Body', type:'textarea', value:s.body },
    ], function(values){
      if(!values.date) values.date=null;
      return api('/v1/admin/stories/'+encodeURIComponent(s.id), { method:'PATCH', body:JSON.stringify(values) })
        .then(function(res){
          if(res._status!==200){ throw new Error((res.error&&(res.error.message||res.error))||'HTTP '+res._status); }
          fetchStories();
        });
    });
  }
  function genStory(){
    var btn=document.getElementById('st-generate');
    var ageBand=document.getElementById('st-genBand').value;
    var date=document.getElementById('st-genDate').value;
    if(!date){ alert('Pick a date'); return; }
    btn.disabled=true; btn.textContent='Queuing…';
    api('/v1/admin/stories/generate', { method:'POST', body:JSON.stringify({ ageBand:ageBand, date:date }) })
      .then(function(res){
        if(res._status===202){ alert('Queued (jobId '+res.jobId+'). Check Jobs tab.'); }
        else { alert('Failed: '+(res.error||res._status)); }
      })
      .catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; btn.textContent='Generate story'; });
  }

  // ---------- Cinematic stories ----------
  // Review queue for scene-script stories: unpublished AI output is previewed
  // scene by scene (narration, staging, interactions) then published/rejected.
  function loadCinematic(){
    var el=document.getElementById('tab-cinematic');
    el.innerHTML=
      '<div class="toolbar">'+
        '<select id="ci-published"><option value="">all</option><option value="false">pending review</option><option value="true">published</option></select>'+
        '<select id="ci-ageBand"><option value="">all ageBands</option><option>junior</option><option>senior</option></select>'+
        '<select id="ci-lang"><option value="">all langs</option><option>en</option><option>hi</option></select>'+
        '<button class="btn-go" id="ci-refresh">Refresh</button>'+
        '<div class="spacer" style="flex:1"></div>'+
        '<select id="ci-genBand"><option value="junior">junior</option><option value="senior">senior</option></select>'+
        '<select id="ci-genLang"><option value="en">en</option><option value="hi">hi</option></select>'+
        '<input type="date" id="ci-genDate" />'+
        '<button class="btn" id="ci-generate">Generate story</button>'+
      '</div>'+
      '<div id="ci-list" class="msg">Loading…</div>';
    document.getElementById('ci-genDate').value=new Date().toISOString().slice(0,10);
    document.getElementById('ci-refresh').addEventListener('click', fetchCinematic);
    document.getElementById('ci-generate').addEventListener('click', genCinematic);
    fetchCinematic();
  }
  function fetchCinematic(){
    loading('ci-list');
    var pub=document.getElementById('ci-published').value;
    var ab=document.getElementById('ci-ageBand').value;
    var lg=document.getElementById('ci-lang').value;
    var q='?limit=100'+(pub?'&published='+pub:'')+(ab?'&ageBand='+encodeURIComponent(ab):'')+(lg?'&lang='+encodeURIComponent(lg):'');
    api('/v1/admin/cinematic'+q).then(function(res){
      if(res._status===401){ fail('ci-list','Unauthorized — set the admin key.'); return; }
      var rows=res.items||[];
      if(!rows.length){ setHTML('ci-list','<div class="msg">No cinematic stories.</div>'); return; }
      var html='<table><thead><tr><th>Title</th><th>Lang</th><th>Age</th><th>Scenes</th><th>Status</th><th>Date</th><th>Used</th><th>Created</th><th></th></tr></thead><tbody>';
      rows.forEach(function(s){
        html+='<tr data-id="'+esc(s.id)+'">'+
          '<td><b>'+esc(s.coverEmoji)+' '+esc(s.title)+'</b><div class="muted cropped">'+esc(s.moral)+'</div></td>'+
          '<td>'+esc(s.lang)+'</td>'+
          '<td>'+esc(s.ageBand)+'</td>'+
          '<td>'+esc(s.sceneCount)+'</td>'+
          '<td><span class="tag">'+(s.published?'published':'pending')+'</span></td>'+
          '<td>'+esc(s.date||'evergreen')+'</td>'+
          '<td>'+esc(s.usedCount)+'</td>'+
          '<td class="muted">'+fmtDate(s.createdAt)+'</td>'+
          '<td><div class="row-actions">'+
            '<button class="btn-edit">Preview</button>'+
            '<button class="btn-go">'+(s.published?'Unpublish':'Publish')+'</button>'+
            '<button class="btn-danger">Delete</button>'+
          '</div></td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('ci-list', html);
      var trs=document.querySelectorAll('#ci-list tbody tr');
      rows.forEach(function(s, i){
        var tr=trs[i]; if(!tr) return;
        tr.__row=s;
        tr.querySelector('.btn-edit').addEventListener('click', function(){ previewCinematic(s.id); });
        tr.querySelector('.btn-go').addEventListener('click', function(){ publishCinematic(s.id, !s.published); });
        tr.querySelector('.btn-danger').addEventListener('click', function(){ delCinematic(tr); });
      });
    }).catch(function(e){ fail('ci-list', e.message); });
  }
  function previewCinematic(id){
    api('/v1/admin/cinematic/'+encodeURIComponent(id)).then(function(res){
      if(res._status!==200){ alert('Load failed: '+(res.error||res._status)); return; }
      var html='<h2>'+esc(res.coverEmoji)+' '+esc(res.title)+' <span class="tag">'+esc(res.lang)+' · '+esc(res.ageBand)+' · '+esc(res.music)+'</span></h2>';
      var rw=res.reward||{};
      html+='<div class="field"><label>Moral</label><div>'+esc(res.moral)+'</div></div>';
      html+='<div class="field"><label>Reward</label><div>⭐ '+esc(rw.stars)+' · 🪙 '+esc(rw.coins)+' · badge: '+esc(rw.badgeStickerId)+'</div></div>';
      (res.scenes||[]).forEach(function(sc){
        html+='<div class="field" style="border-top:1px solid #efeaf7;padding-top:10px">'+
          '<label>Scene '+esc(sc.id)+' · '+esc(sc.title)+' · bg: '+esc(sc.background)+' · cam: '+esc(sc.camera&&sc.camera.effect)+'</label>'+
          '<div>'+esc(sc.narration)+'</div>'+
          '<div class="muted" style="font-size:12px;margin-top:4px">'+
            'chars: '+esc((sc.characters||[]).map(function(c){return c.kind+'('+c.animation+')';}).join(', ')||'—')+
            ' · props: '+esc((sc.props||[]).map(function(p){return p.kind;}).join(', ')||'—')+
            ' · particles: '+esc((sc.particles||[]).join(', ')||'—')+
            (sc.interaction?' · ▶ '+esc(sc.interaction.type)+' '+esc(sc.interaction.target)+(sc.interaction.dropZone?'→'+esc(sc.interaction.dropZone):'')+' — "'+esc(sc.interaction.hint)+'"':'')+
          '</div>'+
        '</div>';
      });
      html+='<div class="actions"><button class="btn-danger" id="modal-cancel">Close</button></div>';
      modalEl.innerHTML=html;
      overlay.classList.add('show');
      document.getElementById('modal-cancel').addEventListener('click', closeEditor);
    }).catch(function(e){ alert('Load failed: '+e.message); });
  }
  function publishCinematic(id, published){
    api('/v1/admin/cinematic/'+encodeURIComponent(id)+'/publish', { method:'PATCH', body:JSON.stringify({ published:published }) })
      .then(function(res){
        if(res._status!==200){ alert('Failed: '+(res.error||res._status)); return; }
        fetchCinematic();
      }).catch(function(e){ alert('Failed: '+e.message); });
  }
  function delCinematic(tr){
    var id=tr.dataset.id;
    if(!confirm('Delete cinematic story '+id+'?')) return;
    api('/v1/admin/cinematic/'+encodeURIComponent(id), { method:'DELETE' }).then(function(res){
      if(res._status!==200&&res._status!==204){ alert('Delete failed: '+(res.error||res._status)); return; }
      tr.remove();
    });
  }
  function genCinematic(){
    var btn=document.getElementById('ci-generate');
    var ageBand=document.getElementById('ci-genBand').value;
    var lang=document.getElementById('ci-genLang').value;
    var date=document.getElementById('ci-genDate').value;
    if(!date){ alert('Pick a date'); return; }
    btn.disabled=true; btn.textContent='Queuing…';
    api('/v1/admin/cinematic/generate', { method:'POST', body:JSON.stringify({ ageBand:ageBand, lang:lang, date:date }) })
      .then(function(res){
        if(res._status===202){ alert('Queued (jobId '+res.jobId+'). It lands in "pending review" when done.'); }
        else { alert('Failed: '+(res.error||res._status)); }
      })
      .catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; btn.textContent='Generate story'; });
  }

  // ---------- Poems ----------
  function loadPoems(){
    var el=document.getElementById('tab-poems');
    el.innerHTML=
      '<div class="toolbar">'+
        '<select id="po-topic"><option value="">all topics</option><option>Animals</option><option>Seasons</option><option>Numbers</option><option>Colors</option><option>Nature</option></select>'+
        '<button class="btn-go" id="po-refresh">Refresh</button>'+
        '<div class="spacer" style="flex:1"></div>'+
        '<select id="po-genTopic"><option>Animals</option><option>Seasons</option><option>Numbers</option><option>Colors</option><option>Nature</option></select>'+
        '<button class="btn" id="po-generate">Generate poem</button>'+
      '</div>'+
      '<div id="po-list" class="msg">Loading…</div>';
    document.getElementById('po-refresh').addEventListener('click', fetchPoems);
    document.getElementById('po-generate').addEventListener('click', genPoem);
    fetchPoems();
  }
  function fetchPoems(){
    loading('po-list');
    var topic=document.getElementById('po-topic').value;
    var q='?limit=100'+(topic?'&topic='+encodeURIComponent(topic):'');
    api('/v1/admin/poems'+q).then(function(res){
      if(res._status===401){ fail('po-list','Unauthorized — set the admin key.'); return; }
      var rows=res.items||[];
      if(!rows.length){ setHTML('po-list','<div class="msg">No poems.</div>'); return; }
      var html='<table><thead><tr><th>Title</th><th>Topic</th><th>Source</th><th>Used</th><th>Created</th><th></th></tr></thead><tbody>';
      rows.forEach(function(p){
        html+='<tr data-id="'+esc(p.id)+'">'+
          '<td><b>'+esc(p.title)+'</b><div class="muted cropped">'+esc(p.lines)+'</div></td>'+
          '<td>'+esc(p.topic)+'</td>'+
          '<td><span class="tag">'+esc(p.source)+'</span></td>'+
          '<td>'+esc(p.usedCount)+'</td>'+
          '<td class="muted">'+fmtDate(p.createdAt)+'</td>'+
          '<td><div class="row-actions"><button class="btn-edit">Edit</button><button class="btn-danger">Delete</button></div></td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('po-list', html);
      var trs=document.querySelectorAll('#po-list tbody tr');
      rows.forEach(function(p, i){
        var tr=trs[i]; if(!tr) return;
        tr.__row=p;
        tr.querySelector('.btn-danger').addEventListener('click', function(){ delPoem(tr); });
        tr.querySelector('.btn-edit').addEventListener('click', function(){ editPoem(tr); });
      });
    }).catch(function(e){ fail('po-list', e.message); });
  }
  function delPoem(tr){
    var id=tr.dataset.id;
    if(!confirm('Delete poem '+id+'?')) return;
    api('/v1/admin/poems/'+encodeURIComponent(id), { method:'DELETE' }).then(function(res){
      if(res._status!==200&&res._status!==204){ alert('Delete failed: '+(res.error||res._status)); return; }
      tr.remove();
    });
  }
  function editPoem(tr){
    var p=tr.__row; if(!p) return;
    var topicOpts=['Animals','Seasons','Numbers','Colors','Nature'].map(function(t){ return {value:t,label:t}; });
    openEditor('Edit poem · '+p.title, [
      { key:'title', label:'Title', type:'text', value:p.title },
      { key:'topic', label:'Topic', type:'select', value:p.topic, options:topicOpts },
      { key:'emoji', label:'Emoji', type:'text', value:p.emoji },
      { key:'source', label:'Source', type:'text', value:p.source },
      { key:'lines', label:'Lines', type:'textarea', value:p.lines },
    ], function(values){
      return api('/v1/admin/poems/'+encodeURIComponent(p.id), { method:'PATCH', body:JSON.stringify(values) })
        .then(function(res){
          if(res._status!==200){ throw new Error((res.error&&(res.error.message||res.error))||'HTTP '+res._status); }
          fetchPoems();
        });
    });
  }
  function genPoem(){
    var btn=document.getElementById('po-generate');
    var topic=document.getElementById('po-genTopic').value;
    btn.disabled=true; btn.textContent='Generating…';
    api('/v1/admin/poems/generate', { method:'POST', body:JSON.stringify({ topic:topic }) })
      .then(function(res){
        if(res._status===201){ alert('Created: '+(res.poem&&res.poem.title||'ok')); fetchPoems(); }
        else { alert('Failed: '+(res.error||res._status)); }
      })
      .catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; btn.textContent='Generate poem'; });
  }

  // ---------- ABC ----------
  function loadAbc(){
    var el=document.getElementById('tab-abc');
    el.innerHTML=
      '<div class="toolbar">'+
        '<button class="btn-go" id="ab-refresh">Refresh</button>'+
        '<div class="spacer" style="flex:1"></div>'+
        '<select id="ab-genLetter">'+Array.from({length:26},function(_,i){ var L=String.fromCharCode(65+i); return '<option>'+L+'</option>'; }).join('')+'</select>'+
        '<button class="btn" id="ab-generate">Generate letter</button>'+
      '</div>'+
      '<div id="ab-list" class="msg">Loading…</div>';
    document.getElementById('ab-refresh').addEventListener('click', fetchAbc);
    document.getElementById('ab-generate').addEventListener('click', genAbc);
    fetchAbc();
  }
  function fetchAbc(){
    loading('ab-list');
    api('/v1/admin/abc').then(function(res){
      if(res._status===401){ fail('ab-list','Unauthorized — set the admin key.'); return; }
      var rows=res.items||[];
      if(!rows.length){ setHTML('ab-list','<div class="msg">No ABC lessons.</div>'); return; }
      var html='<table><thead><tr><th>Letter</th><th>Word</th><th>Emoji</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>';
      rows.forEach(function(l){
        html+='<tr data-letter="'+esc(l.letter)+'">'+
          '<td><b>'+esc(l.letter)+'</b></td>'+
          '<td>'+esc(l.word)+'</td>'+
          '<td>'+esc(l.emoji)+'</td>'+
          '<td><span class="tag">'+esc(l.source)+'</span></td>'+
          '<td class="muted">'+fmtDate(l.updatedAt)+'</td>'+
          '<td><div class="row-actions"><button class="btn-edit">Edit</button><button class="btn-danger">Delete</button></div></td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('ab-list', html);
      var trs=document.querySelectorAll('#ab-list tbody tr');
      rows.forEach(function(l, i){
        var tr=trs[i]; if(!tr) return;
        tr.__row=l;
        tr.querySelector('.btn-danger').addEventListener('click', function(){ delAbc(tr); });
        tr.querySelector('.btn-edit').addEventListener('click', function(){ editAbc(tr); });
      });
    }).catch(function(e){ fail('ab-list', e.message); });
  }
  function delAbc(tr){
    var letter=tr.dataset.letter;
    if(!confirm('Delete ABC lesson for '+letter+'?')) return;
    api('/v1/admin/abc/'+encodeURIComponent(letter), { method:'DELETE' }).then(function(res){
      if(res._status!==200&&res._status!==204){ alert('Delete failed: '+(res.error||res._status)); return; }
      tr.remove();
    });
  }
  function editAbc(tr){
    var l=tr.__row; if(!l) return;
    openEditor('Edit ABC · '+l.letter, [
      { key:'word', label:'Word', type:'text', value:l.word },
      { key:'emoji', label:'Emoji', type:'text', value:l.emoji },
      { key:'phonics', label:'Phonics', type:'text', value:l.phonics },
      { key:'source', label:'Source', type:'text', value:l.source },
      { key:'miniStory', label:'Mini story', type:'textarea', value:l.miniStory },
    ], function(values){
      return api('/v1/admin/abc/'+encodeURIComponent(l.letter), { method:'PATCH', body:JSON.stringify(values) })
        .then(function(res){
          if(res._status!==200){ throw new Error((res.error&&(res.error.message||res.error))||'HTTP '+res._status); }
          fetchAbc();
        });
    });
  }
  function genAbc(){
    var btn=document.getElementById('ab-generate');
    var letter=document.getElementById('ab-genLetter').value;
    btn.disabled=true; btn.textContent='Generating…';
    api('/v1/admin/abc/generate', { method:'POST', body:JSON.stringify({ letter:letter }) })
      .then(function(res){
        if(res._status===201){ alert('Created lesson for '+(res.lesson&&res.lesson.letter||letter)); fetchAbc(); }
        else { alert('Failed: '+(res.error||res._status)); }
      })
      .catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; btn.textContent='Generate letter'; });
  }

  // ---------- Crawl ----------
  function loadCrawl(){
    var el=document.getElementById('tab-crawl');
    el.innerHTML=
      '<div class="toolbar">'+
        '<input type="text" id="cr-url" placeholder="https://…" style="width:300px" />'+
        '<select id="cr-contentType"><option>story</option><option>poem</option><option>abc</option></select>'+
        '<select id="cr-mode"><option value="index">index</option><option value="page">page</option></select>'+
        '<button class="btn" id="cr-trigger">Trigger crawl</button>'+
        '<button class="btn-go" id="cr-refresh">Refresh</button>'+
      '</div>'+
      '<div id="cr-list" class="msg">Loading…</div>';
    document.getElementById('cr-trigger').addEventListener('click', triggerCrawl);
    document.getElementById('cr-refresh').addEventListener('click', fetchCrawl);
    fetchCrawl();
  }
  function fetchCrawl(){
    loading('cr-list');
    api('/v1/crawl/sources').then(function(res){
      if(res._status===401){ fail('cr-list','Unauthorized — set the admin key.'); return; }
      var rows=res||[];
      if(!Array.isArray(rows)||!rows.length){ setHTML('cr-list','<div class="msg">No crawl sources.</div>'); return; }
      var html='<table><thead><tr><th>URL</th><th>Type</th><th>Mode</th><th>Status</th><th>Last crawled</th><th>Discovered from</th></tr></thead><tbody>';
      rows.forEach(function(s){
        html+='<tr>'+
          '<td class="muted">'+esc(s.url)+'</td>'+
          '<td>'+esc(s.contentType)+'</td>'+
          '<td>'+esc(s.mode)+'</td>'+
          '<td><span class="tag">'+esc(s.status)+'</span></td>'+
          '<td class="muted">'+fmtDate(s.lastCrawled)+'</td>'+
          '<td class="muted">'+esc(s.discoveredFrom||'')+'</td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('cr-list', html);
    }).catch(function(e){ fail('cr-list', e.message); });
  }
  function triggerCrawl(){
    var btn=document.getElementById('cr-trigger');
    var url=document.getElementById('cr-url').value.trim();
    var contentType=document.getElementById('cr-contentType').value;
    var mode=document.getElementById('cr-mode').value;
    if(!url){ alert('Enter a URL'); return; }
    btn.disabled=true;
    api('/v1/crawl/trigger', { method:'POST', body:JSON.stringify({ url:url, contentType:contentType, mode:mode }) })
      .then(function(res){
        if(res._status===202){ alert('Queued (jobId '+res.jobId+')'); fetchCrawl(); }
        else { alert('Failed: '+(res.error||res._status)); }
      })
      .catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; });
  }

  // ---------- RAG ----------
  function loadRag(){
    var el=document.getElementById('tab-rag');
    el.innerHTML=
      '<div class="toolbar">'+
        '<button class="btn" id="rag-backfill">Backfill corpus</button>'+
        '<button class="btn-go" id="rag-stats">Refresh stats</button>'+
      '</div>'+
      '<div id="rag-stats-box" class="msg">Loading…</div>'+
      '<h3>Debug retrieval</h3>'+
      '<div class="toolbar">'+
        '<input type="text" id="rag-q" placeholder="query…" style="width:300px" />'+
        '<input type="number" id="rag-k" value="6" min="1" max="20" style="width:70px" />'+
        '<button class="btn-go" id="rag-search">Search</button>'+
      '</div>'+
      '<div id="rag-results"></div>';
    document.getElementById('rag-backfill').addEventListener('click', backfill);
    document.getElementById('rag-stats').addEventListener('click', fetchRagStats);
    document.getElementById('rag-search').addEventListener('click', ragSearch);
    fetchRagStats();
  }
  function fetchRagStats(){
    loading('rag-stats-box');
    api('/v1/rag/stats').then(function(res){
      if(res._status===401){ fail('rag-stats-box','Unauthorized — set the admin key.'); return; }
      var byKind=res.byKind||{};
      var html='<div class="cards">'+
        stat('Total chunks', res.total)+
        stat('Embed calls today', res.embedCallsToday);
      Object.keys(byKind).forEach(function(k){ html+=stat(k+' chunks', byKind[k]); });
      html+='</div>';
      setHTML('rag-stats-box', html);
    }).catch(function(e){ fail('rag-stats-box', e.message); });
  }
  function backfill(){
    var btn=document.getElementById('rag-backfill');
    if(!confirm('Run corpus backfill now? (idempotent)')) return;
    btn.disabled=true;
    api('/v1/rag/backfill', { method:'POST' }).then(function(res){
      if(res._status===202){ alert('Backfill queued (jobId '+res.jobId+'). Check Jobs tab.'); }
      else { alert('Failed: '+(res.error||res._status)); }
    }).catch(function(e){ alert('Failed: '+e.message); })
      .then(function(){ btn.disabled=false; });
  }
  function ragSearch(){
    var q=document.getElementById('rag-q').value.trim();
    if(!q){ alert('Enter a query'); return; }
    var k=document.getElementById('rag-k').value||6;
    loading('rag-results');
    api('/v1/rag/search?q='+encodeURIComponent(q)+'&k='+encodeURIComponent(k)).then(function(res){
      if(res._status===401){ fail('rag-results','Unauthorized — set the admin key.'); return; }
      var chunks=res.chunks||[];
      if(!chunks.length){ setHTML('rag-results','<div class="msg">No matches.</div>'); return; }
      var html='<table><thead><tr><th>Score</th><th>Source</th><th>Text</th></tr></thead><tbody>';
      chunks.forEach(function(c){
        html+='<tr>'+
          '<td>'+esc((c.score||0).toFixed(3))+'</td>'+
          '<td class="muted">'+esc(c.sourceTitle||c.sourceUrl||'')+'</td>'+
          '<td class="cropped">'+esc(c.text)+'</td>'+
        '</tr>';
      });
      html+='</tbody></table>';
      setHTML('rag-results', html);
    }).catch(function(e){ fail('rag-results', e.message); });
  }

  // ---------- Jobs ----------
  var JOB_TYPES=['pre-generate-stories','pre-generate-cinematic','pre-generate-poems','pre-generate-coloring','crawl-sweep','backfill-corpus'];
  function loadJobs(){
    var el=document.getElementById('tab-jobs');
    el.innerHTML=
      '<div class="toolbar"><button class="btn-go" id="jb-refresh">Refresh</button></div>'+
      '<div id="jb-list" class="msg">Loading…</div>';
    document.getElementById('jb-refresh').addEventListener('click', fetchJobs);
    fetchJobs();
  }
  function fetchJobs(){
    loading('jb-list');
    api('/v1/admin/jobs').then(function(res){
      if(res._status===401){ fail('jb-list','Unauthorized — set the admin key.'); return; }
      var gen=res.generate||[], cr=res.crawl||[];
      var counts=res.counts||{};
      var gc=counts.generate||{}, cc=counts.crawl||{};
      var html='<h3>Repeatable jobs (crons)</h3>';
      html+='<table><thead><tr><th>Name</th><th>Queue</th><th>Cron</th><th>Next run</th><th></th></tr></thead><tbody>';
      function addRows(list, qName){
        list.forEach(function(j){
          var name=j.name||j.id||'';
          var pattern=(j.repeat&&j.repeat.pattern)||j.cron||'';
          var next=j.next? fmtDate(new Date(j.next).toISOString()):'';
          var t=(j.data&&j.data.type)||name;
          html+='<tr data-type="'+esc(t)+'">'+
            '<td><b>'+esc(name)+'</b></td>'+
            '<td>'+esc(qName)+'</td>'+
            '<td><span class="tag">'+esc(pattern)+'</span></td>'+
            '<td class="muted">'+esc(next)+'</td>'+
            '<td><div class="row-actions"><button class="btn-go">Run now</button></div></td>'+
          '</tr>';
        });
      }
      addRows(gen,'generate');
      addRows(cr,'crawl');
      html+='</tbody></table>';
      html+='<h3>Manual one-shot triggers</h3>';
      html+='<div class="toolbar">';
      JOB_TYPES.forEach(function(t){
        html+='<button class="btn-go" data-onetype="'+t+'">Run '+t+'</button>';
      });
      html+='</div>';
      html+='<h3>Queue depths</h3><div class="cards">'+
        stat('generate waiting', gc.waiting||0)+
        stat('generate active', gc.active||0)+
        stat('crawl waiting', cc.waiting||0)+
        stat('crawl active', cc.active||0)+
        '</div>';
      setHTML('jb-list', html);
      document.querySelectorAll('#jb-list tr[data-type]').forEach(function(tr){
        tr.querySelector('.btn-go').addEventListener('click', function(){ runJobType(tr.dataset.type); });
      });
      document.querySelectorAll('#jb-list button[data-onetype]').forEach(function(b){
        b.addEventListener('click', function(){ runJobType(b.dataset.onetype); });
      });
    }).catch(function(e){ fail('jb-list', e.message); });
  }
  function runJobType(type){
    if(!confirm('Run "'+type+'" now?')) return;
    api('/v1/admin/jobs/trigger', { method:'POST', body:JSON.stringify({ type:type }) }).then(function(res){
      if(res._status===202){ alert('Queued (jobId '+res.jobId+')'); }
      else { alert('Failed: '+(res.error||res._status)); }
    }).catch(function(e){ alert('Failed: '+e.message); });
  }

  var LOADERS={
    dashboard:loadDashboard, stories:loadStories, cinematic:loadCinematic,
    poems:loadPoems, abc:loadAbc, crawl:loadCrawl, rag:loadRag, jobs:loadJobs
  };

  showTab('dashboard');
})();
</script>
</body>
</html>`;
