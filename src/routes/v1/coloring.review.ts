// Self-contained admin review page for the coloring queue. Served as static
// HTML from GET /v1/coloring/review. It calls the JSON admin endpoints
// (/v1/coloring/pending, /:slug/publish, DELETE /:slug) from the browser,
// sending the admin key as the `x-admin-key` header. The SVG preview mirrors
// the Flutter painter: white region fills, dark line-art outlines (width 1.8),
// solid-dark details — so what you approve is what kids see uncolored.
export const reviewPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Coloring review · BrightMind Kids</title>
<style>
  :root { --coral:#FF7361; --teal:#2EBDB5; --yellow:#FFCC40; --purple:#8C73F2;
          --cream:#FFF7EB; --dark:#332E40; }
  * { box-sizing: border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--cream); color:var(--dark); }
  header { position:sticky; top:0; z-index:10; background:#fff; border-bottom:2px solid #efeaf7;
           padding:14px 20px; display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
  header h1 { font-size:18px; margin:0; }
  header .count { background:var(--purple); color:#fff; border-radius:999px;
                  padding:2px 10px; font-size:13px; font-weight:600; }
  header .spacer { flex:1; }
  header label { font-size:13px; display:flex; align-items:center; gap:6px; cursor:pointer; }
  header input[type=text] { padding:6px 10px; border:1px solid #d8d2e6; border-radius:8px; font-size:13px; width:180px; }
  button { font:inherit; border:none; border-radius:10px; padding:8px 14px; cursor:pointer; font-weight:600; }
  button:disabled { opacity:.5; cursor:default; }
  .btn-approve { background:var(--teal); color:#fff; }
  .btn-reject  { background:#fff; color:var(--coral); border:2px solid var(--coral); }
  .btn-refresh { background:var(--purple); color:#fff; }
  main { padding:20px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:18px; }
  .card { background:#fff; border-radius:16px; padding:14px; box-shadow:0 2px 10px rgba(51,46,64,.08);
          display:flex; flex-direction:column; gap:10px; transition:opacity .25s; }
  .card.removing { opacity:0; }
  .art { background:#fff; border:1px solid #efeaf7; border-radius:12px; aspect-ratio:1; overflow:hidden; }
  .art svg { width:100%; height:100%; display:block; }
  .card h2 { font-size:15px; margin:0; }
  .meta { font-size:12px; color:#7a7488; display:flex; gap:6px; flex-wrap:wrap; }
  .tag { background:#f3f0fa; border-radius:6px; padding:1px 7px; }
  .tag.premium { background:#fff3d6; color:#9a7400; }
  .actions { display:flex; gap:8px; margin-top:auto; }
  .actions button { flex:1; }
  .empty, .msg { text-align:center; color:#7a7488; padding:60px 20px; font-size:15px; }
  .err { color:var(--coral); }
</style>
</head>
<body>
<header>
  <h1>Coloring review</h1>
  <span class="count" id="count">–</span>
  <label><input type="checkbox" id="showRegions" /> show region colors</label>
  <div class="spacer"></div>
  <input type="text" id="adminKey" placeholder="admin key (x-admin-key)" />
  <button class="btn-approve" id="generate">✨ Generate</button>
  <button class="btn-refresh" id="upload">⬆ Upload SVG/PNG</button>
  <button class="btn-refresh" id="refresh">Refresh</button>
  <input type="file" id="fileInput" accept="image/svg+xml,.svg,image/png,image/jpeg" style="display:none" />
</header>
<main><div id="content" class="msg">Loading…</div></main>
<script>
(function(){
  var KEY_STORE='bm_admin_key';
  var PALETTE=['#FFCDD2','#F8BBD0','#E1BEE7','#D1C4E9','#C5CAE9','#BBDEFB','#B3E5FC',
               '#B2EBF2','#B2DFDB','#C8E6C9','#DCEDC8','#FFF9C4','#FFE0B2','#FFCCBC'];
  var keyInput=document.getElementById('adminKey');
  var showRegions=document.getElementById('showRegions');
  var content=document.getElementById('content');
  var countEl=document.getElementById('count');
  var pages=[];

  keyInput.value=localStorage.getItem(KEY_STORE)||'';
  keyInput.addEventListener('change',function(){ localStorage.setItem(KEY_STORE,keyInput.value.trim()); });

  function headers(){ return { 'x-admin-key': keyInput.value.trim(), 'Content-Type':'application/json' }; }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function svgFor(page){
    var vb=page.viewBox||100;
    var regions=page.regions||[], outlines=page.outlines||[], details=page.details||[];
    var s='<svg viewBox="0 0 '+vb+' '+vb+'" xmlns="http://www.w3.org/2000/svg">';
    s+='<rect x="0" y="0" width="'+vb+'" height="'+vb+'" fill="#ffffff"/>';
    for(var i=0;i<regions.length;i++){
      var f=showRegions.checked?PALETTE[i%PALETTE.length]:'#ffffff';
      s+='<path d="'+esc(regions[i].d)+'" fill="'+f+'" stroke="#eceaf3" stroke-width="0.3"/>';
    }
    for(var j=0;j<outlines.length;j++){
      s+='<path d="'+esc(outlines[j])+'" fill="none" stroke="#332E40" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    for(var k=0;k<details.length;k++){
      s+='<path d="'+esc(details[k])+'" fill="#332E40"/>';
    }
    return s+'</svg>';
  }

  function render(){
    countEl.textContent=pages.length;
    if(!pages.length){ content.className='empty'; content.textContent='Nothing waiting for review. 🎉'; return; }
    content.className='grid';
    content.innerHTML='';
    pages.forEach(function(page){
      var card=document.createElement('div');
      card.className='card';
      var meta='<span class="tag">'+esc(page.source||'?')+'</span>';
      if(page.date) meta+='<span class="tag">'+esc(page.date)+'</span>';
      meta+='<span class="tag">'+((page.regions||[]).length)+' regions</span>';
      if(page.isPremium) meta+='<span class="tag premium">premium</span>';
      card.innerHTML=
        '<div class="art">'+svgFor(page)+'</div>'+
        '<h2>'+esc(page.title||page.id)+'</h2>'+
        '<div class="meta"><span class="tag">'+esc(page.id)+'</span>'+meta+'</div>'+
        '<div class="actions">'+
          '<button class="btn-approve">Approve</button>'+
          '<button class="btn-reject">Reject</button>'+
        '</div>';
      card.querySelector('.btn-approve').addEventListener('click',function(){ approve(page,card); });
      card.querySelector('.btn-reject').addEventListener('click',function(){ reject(page,card); });
      content.appendChild(card);
    });
  }

  function removeCard(page,card){
    card.classList.add('removing');
    setTimeout(function(){
      pages=pages.filter(function(p){ return p.id!==page.id; });
      render();
    },250);
  }

  function approve(page,card){
    fetch('/v1/coloring/'+encodeURIComponent(page.id)+'/publish',{
      method:'PATCH', headers:headers(), body:JSON.stringify({published:true})
    }).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); removeCard(page,card); })
      .catch(function(e){ alert('Approve failed: '+e.message); });
  }

  function reject(page,card){
    if(!confirm('Delete "'+(page.title||page.id)+'" permanently?')) return;
    fetch('/v1/coloring/'+encodeURIComponent(page.id),{ method:'DELETE', headers:headers() })
      .then(function(r){ if(!r.ok && r.status!==204) throw new Error('HTTP '+r.status); removeCard(page,card); })
      .catch(function(e){ alert('Reject failed: '+e.message); });
  }

  function load(){
    content.className='msg'; content.textContent='Loading…';
    fetch('/v1/coloring/pending',{ headers:headers() })
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(data){ pages=(data&&data.pages)||[]; render(); })
      .catch(function(e){ content.className='msg err'; content.textContent='Could not load queue: '+e.message; });
  }

  function generate(){
    var btn=document.getElementById('generate');
    var n=prompt('How many pages to generate with AI? (1-5)','1');
    if(n===null) return;
    var count=Math.min(Math.max(parseInt(n,10)||1,1),5);
    btn.disabled=true; btn.textContent='Generating…';
    fetch('/v1/coloring/generate',{
      method:'POST', headers:headers(), body:JSON.stringify({count:count})
    }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        var made=(res.d&&res.d.created)||[];
        var errs=(res.d&&res.d.errors)||[];
        if(errs.length) alert('Done: '+made.length+' created.\\nIssues:\\n'+errs.join('\\n'));
        load();
      })
      .catch(function(e){ alert('Generate failed: '+e.message); })
      .then(function(){ btn.disabled=false; btn.textContent='✨ Generate'; });
  }

  function upload(){
    var fileInput=document.getElementById('fileInput');
    fileInput.value='';
    fileInput.click();
  }

  function onFilePicked(ev){
    var file=ev.target.files&&ev.target.files[0];
    if(!file) return;
    var title=prompt('Title for this page?', file.name.replace(/\\.[^.]+$/,''));
    if(title===null||!title.trim()) return;
    var btn=document.getElementById('upload');
    var reader=new FileReader();
    reader.onload=function(){
      btn.disabled=true; btn.textContent='Uploading…';
      fetch('/v1/coloring/import',{
        method:'POST', headers:headers(),
        body:JSON.stringify({ imageBase64:String(reader.result), title:title.trim() })
      }).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
        .then(function(res){
          if(!res.ok) throw new Error((res.d&&res.d.error&&(res.d.error.message||res.d.error))||'HTTP error');
          load();
        })
        .catch(function(e){ alert('Upload failed: '+(e.message||e)); })
        .then(function(){ btn.disabled=false; btn.textContent='⬆ Upload SVG/PNG'; });
    };
    reader.readAsDataURL(file); // -> data:image/png;base64,... (server strips prefix)
  }

  document.getElementById('generate').addEventListener('click',generate);
  document.getElementById('upload').addEventListener('click',upload);
  document.getElementById('fileInput').addEventListener('change',onFilePicked);
  document.getElementById('refresh').addEventListener('click',load);
  showRegions.addEventListener('change',render);
  load();
})();
</script>
</body>
</html>`;
