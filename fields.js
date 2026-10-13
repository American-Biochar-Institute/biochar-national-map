/* Field tool for the public map (policy v2, October 2026).
 * "Select fields on the map" fades the soil colors to 0%, shows aerial imagery and a toolbar to draw
 * fields or upload boundaries. Each field's soils come from USDA Soil Data Access through the
 * Institute's AOI service (biochar-aoi-public /api/aoi) and are scored with policy.js, the same
 * rules as the national layer: dominant component, NRCS rating by default, and "No adjusted score"
 * where the engine cannot reproduce the NRCS rating.
 */
(function(){
 'use strict';
 const P=window.ABIPolicy,E=window.BiocharEngine,Insights=window.BiocharInsights,Up=window.BoundaryUploads,M=window.abiMap,$=id=>document.getElementById(id);
 const local=['127.0.0.1','localhost'].includes(location.hostname),params=new URLSearchParams(location.search);
 const AOI_URL=local&&params.get('aoi')?params.get('aoi'):'https://biochar-aoi-public.abi-verified-api.workers.dev/api/aoi';
 const MAX_UPLOAD=25,MAX_VERTICES=256,ENVELOPE_M2=45e6,MAX_PIECES=40,PER_MINUTE=25;
 const NAMES=['Negligible','Low','Fair','Good','Excellent','Unrated',M.NO_SCORE],ORDER=[4,3,2,1,0,6,5],colors=M.colors;
 const acresOf=m2=>m2/4046.8564224,fmt=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:1,minimumFractionDigits:1}).format(n);
 const answers=()=>M.answers;

 // ---- map layers ----
 map.createPane('fieldSoilPane');map.getPane('fieldSoilPane').style.zIndex=440;
 map.createPane('fieldPane');map.getPane('fieldPane').style.zIndex=460;map.getPane('fieldPane').style.pointerEvents='none';
 const fields=[];let counter=0,selected=null,drawer=null;

 // ---- toolbar ----
 const toolbar=$('field-toolbar'),fileInput=$('field-file');
 L.DomEvent.disableClickPropagation(toolbar);L.DomEvent.disableScrollPropagation(toolbar);
 function setHint(text){$('field-toolbar-hint').textContent=text;}
 function stopDrawing(){if(drawer)drawer.disable();drawer=null;for(const id of ['draw-field','draw-rect'])$(id).setAttribute('aria-pressed','false');}
 function draw(kind){
  stopDrawing();
  const shape={pane:'fieldPane',color:'#45173d',weight:3,fill:false};
  drawer=kind==='polygon'?new L.Draw.Polygon(map,{shapeOptions:shape,allowIntersection:false,showArea:false}):new L.Draw.Rectangle(map,{shapeOptions:shape,showArea:false});
  drawer.enable();$(kind==='polygon'?'draw-field':'draw-rect').setAttribute('aria-pressed','true');
  setHint(kind==='polygon'?'Click each corner of the field, then click the first corner to finish. Escape cancels.':'Drag from one corner of the field to the opposite corner. Escape cancels.');
 }
 // Field mode: while the field tool is open or fields exist, the state, county and current-view acreage
 // collapse so the panel shows only field totals; a link reopens it (October 12, 2026).
 // "Your fields" in the panel appears only in field mode; the button that opens the tool is at the top of the map.
 const acreageSection=$('acreage-section'),showAcreage=$('show-acreage'),launcher=$('field-launcher');
 function setFieldMode(on){
  acreageSection.hidden=on;showAcreage.hidden=!on;$('fields-section').hidden=!on;
  showAcreage.setAttribute('aria-expanded','false');showAcreage.textContent='Show state and county acreage';
 }
 function leaveFieldModeIfEmpty(){if(!fields.length&&toolbar.hidden)setFieldMode(false);}
 showAcreage.addEventListener('click',()=>{const open=acreageSection.hidden;acreageSection.hidden=!open;showAcreage.setAttribute('aria-expanded',String(open));showAcreage.textContent=open?'Hide state and county acreage':'Show state and county acreage';});
 $('select-fields').disabled=false;
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!launcher.hidden)launcher.classList.add('tip-off');});
 launcher.addEventListener('mouseleave',()=>launcher.classList.remove('tip-off'));
 $('select-fields').addEventListener('blur',()=>launcher.classList.remove('tip-off'));
 $('select-fields').addEventListener('click',()=>{M.setOpacity(0);launcher.hidden=true;toolbar.hidden=false;setFieldMode(true);$('fields-title').scrollIntoView({block:'start'});setHint('Find a place by address, then draw a field or upload field boundaries. Add as many fields as you need.');if(window.abiAddressSearch)window.abiAddressSearch.focus();else $('draw-field').focus();});
 $('draw-field').addEventListener('click',()=>draw('polygon'));
 $('draw-rect').addEventListener('click',()=>draw('rectangle'));
 $('upload-fields').addEventListener('click',()=>fileInput.click());
 $('fields-done').addEventListener('click',()=>{stopDrawing();if(window.abiAddressSearch)window.abiAddressSearch.reset();toolbar.hidden=true;launcher.hidden=false;leaveFieldModeIfEmpty();$('select-fields').focus();});
 map.on('draw:drawstop',()=>{for(const id of ['draw-field','draw-rect'])$(id).setAttribute('aria-pressed','false');drawer=null;});
 map.on('draw:created',e=>{stopDrawing();const f=addField(e.layer.toGeoJSON().geometry,null);setHint(f.name+' added. Draw another field, upload boundaries, or press Done.');});

 fileInput.addEventListener('change',async()=>{
  const files=[...fileInput.files];fileInput.value='';if(!files.length)return;
  progress('Reading '+files.map(f=>f.name).join(', ')+'…');
  const added=[];const notes=[];
  for(const file of files){
   try{
    const r=await Up.read(file);notes.push(...r.notes);
    if(r.skipped)notes.push(file.name+': '+r.skipped+' feature'+(r.skipped===1?' was':'s were')+' not a polygon and '+(r.skipped===1?'was':'were')+' skipped.');
    let list=r.fields;if(added.length+list.length>MAX_UPLOAD){notes.push('Only the first '+MAX_UPLOAD+' fields of an upload are added. Upload the rest separately.');list=list.slice(0,Math.max(0,MAX_UPLOAD-added.length));}
    if(!r.fields.length)notes.push(file.name+' has no field polygons.');
    for(const f of list)added.push(addField(f.geometry,f.name,true));
   }catch(e){notes.push(file.name+': '+e.message);}
  }
  if(added.length){const b=L.featureGroup(added.map(f=>f.outline)).getBounds();map.fitBounds(b,{padding:[40,40],maxZoom:16});}
  setHint(added.length?added.length+' field'+(added.length===1?'':'s')+' added from the upload.':'No fields were added.');
  $('field-notes').textContent=notes.join(' ');$('field-notes').hidden=!notes.length;
  pump();
 });

 // ---- fields ----
 function textLabel(text){const s=document.createElement('span');s.textContent=text;return s;}
 function addField(geometry,name,quiet){
  const f={id:++counter,name:name||'Field '+counter,geometry,acres:acresOf(turf.area(geometry)),status:'queued',error:null,units:[],soilLayer:null,exploratoryError:null};
  const halo=L.geoJSON(geometry,{pane:'fieldPane',interactive:false,style:{color:'#fff',weight:6,fill:false}}),line=L.geoJSON(geometry,{pane:'fieldPane',interactive:false,style:{color:'#45173d',weight:3,fill:false}});
  // Field names come from users and uploaded files: pass them to Leaflet as text, never as HTML (audit finding A1).
  f.outline=L.featureGroup([halo,line]).addTo(map);f.outline.bindTooltip(textLabel(f.name),{permanent:true,direction:'center',className:'field-label'});
  fields.push(f);queue.push(f);batch.total++;renderList();if(!quiet)pump();return f;
 }
 function removeField(f){
  f.removed=true;map.removeLayer(f.outline);if(f.soilLayer)map.removeLayer(f.soilLayer);
  fields.splice(fields.indexOf(f),1);if(selected&&selected.field===f)selected=null;renderList();renderTotals();renderSoil();leaveFieldModeIfEmpty();
 }

 // ---- lookups: queued, paced under the service's rate limit, each part sent on its own ----
 const queue=[],sent=[],batch={total:0,done:0};let running=0;
 function progress(text){$('fields-progress').textContent=text;}
 function wait(ms){return new Promise(r=>setTimeout(r,ms));}
 async function slot(){for(;;){const now=Date.now();while(sent.length&&now-sent[0]>60000)sent.shift();if(sent.length<PER_MINUTE){sent.push(now);return;}const ms=60000-(now-sent[0])+250;progress('Pausing about '+Math.ceil(ms/1000)+' seconds to stay within the lookup limit, then continuing…');await wait(ms);}}
 async function post(ring,f){
  for(let attempt=0;;attempt++){
   await slot();if(f?.progress)progress(f.progress);
   let r,data;
   try{r=await fetch(AOI_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({geometry:{type:'Polygon',coordinates:[ring]}})});data=await r.json().catch(()=>({}));}
   catch{if(attempt<3){await wait(5000);continue;}throw new Error('The soil lookup service could not be reached. Check your connection and try again.');}
   if(r.status===429&&attempt<4){progress('The lookup service is busy. Waiting a moment, then continuing…');await wait(20000);continue;}
   if(!r.ok)throw Object.assign(new Error(data.error||'The soil lookup could not complete.'),{status:r.status});
   return data;
  }
 }
 function pump(){
  while(running<2&&queue.length){
   const f=queue.shift();if(f.removed){batch.total--;continue;}
   running++;f.status='looking';renderList();
   const n=++batch.done;f.progress='Looking up soils for field '+n+' of '+batch.total+'…';progress(f.progress);
   lookupField(f).then(()=>{f.status='done';},e=>{f.status='error';f.error=e.message;}).finally(()=>{
    running--;if(!f.removed){draw_(f);renderList();renderTotals();}
    if(!queue.length&&!running){const failed=fields.filter(x=>x.status==='error').length;const found=fields.filter(x=>x.status==='done').length;progress(failed?failed+' field'+(failed===1?'':'s')+' could not be looked up. See the message under each field.':'Soils found for '+found+' field'+(found===1?'':'s')+'. Hover over a soil for its rating.');batch.total=batch.done=0;}
    pump();
   });
  }
 }

 // Split a field into lookup pieces: each polygon part, cut into cells when its envelope is too large.
 function envelopeM2(b){return (b[2]-b[0])*111320*Math.cos((b[1]+b[3])/2*Math.PI/180)*(b[3]-b[1])*111320;}
 function polysOf(g){return !g?[]:g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:g.type==='Feature'?polysOf(g.geometry):[];}
 function pieces(geometry){
  const out=[];
  for(const poly of polysOf(geometry)){
   const feature=turf.polygon(poly),b=turf.bbox(feature);
   if(envelopeM2(b)<=ENVELOPE_M2&&b[2]-b[0]<.9&&b[3]-b[1]<.9){out.push(poly);continue;}
   const scale=Math.sqrt(envelopeM2(b)/ENVELOPE_M2)*1.15,nx=Math.max(1,Math.ceil(Math.max(scale,(b[2]-b[0])/.85))),ny=Math.max(1,Math.ceil(Math.max(scale,(b[3]-b[1])/.85)));
   if(nx*ny>MAX_PIECES)throw new Error('This field is too large to look up. Split it into fields under about 100,000 acres.');
   for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
    const cell=[b[0]+(b[2]-b[0])*i/nx,b[1]+(b[3]-b[1])*j/ny,b[0]+(b[2]-b[0])*(i+1)/nx,b[1]+(b[3]-b[1])*(j+1)/ny];
    const part=turf.intersect(turf.featureCollection([feature,turf.bboxPolygon(cell)]));if(part)out.push(...polysOf(part));
   }
  }
  if(out.length>MAX_PIECES)throw new Error('This field has too many separate parts to look up. Split it into smaller fields.');
  return out;
 }
 function round(ring){const out=[];for(const p of ring){const q=[+p[0].toFixed(7),+p[1].toFixed(7)];const l=out[out.length-1];if(!l||l[0]!==q[0]||l[1]!==q[1])out.push(q);}if(out.length&&(out[0][0]!==out.at(-1)[0]||out[0][1]!==out.at(-1)[1]))out.push(out[0].slice());return out;}
 function valid(ring){return ring.length>=4&&ring.length<=MAX_VERTICES+1&&turf.kinks(turf.polygon([ring])).features.length===0;}
 // The ring sent for lookup: the outer boundary itself when it is simple enough, otherwise a slightly
 // enlarged, simplified outline that still covers the whole part. Holes are dropped here; results are
 // clipped back to the true shape afterward.
 function queryRing(poly){
  const outer=round(poly[0]);if(valid(outer))return outer;
  const grown=turf.buffer(turf.polygon([poly[0]]),.03,{units:'kilometers'});
  for(const source of [grown,turf.convex(grown)]){
   if(!source)continue;
   for(const tol of [.00002,.00005,.0001,.00015,.0002]){const s=turf.simplify(source,{tolerance:tol,highQuality:true}),r=round(polysOf(s.geometry)[0][0]);if(valid(r))return r;}
  }
  const b=turf.bbox(grown);return [[b[0],b[1]],[b[2],b[1]],[b[2],b[3]],[b[0],b[3]],[b[0],b[1]]].map(p=>[+p[0].toFixed(7),+p[1].toFixed(7)]);
 }
 // WKT from SDA (STIntersection), as polygon coordinate arrays.
 function depthSplit(s){let d=0,st=0;const out=[];for(let i=0;i<s.length;i++){if(s[i]==='(')d++;else if(s[i]===')')d--;else if(s[i]===','&&d===0){out.push(s.slice(st,i).trim());st=i+1;}}out.push(s.slice(st).trim());return out;}
 function ringCoords(s){return s.trim().replace(/^\(|\)$/g,'').split(',').map(p=>p.trim().split(/\s+/).slice(0,2).map(Number));}
 function wktPolys(w){if(!w||/EMPTY/i.test(w))return [];const inner=w.slice(w.indexOf('(')+1,w.lastIndexOf(')'));if(/^GEOMETRYCOLLECTION/i.test(w))return depthSplit(inner).flatMap(wktPolys);if(/^MULTIPOLYGON/i.test(w))return depthSplit(inner).map(p=>depthSplit(p.trim().replace(/^\(|\)$/g,'')).map(ringCoords));if(/^POLYGON/i.test(w))return [depthSplit(inner).map(ringCoords)];return [];}
 async function lookupPiece(poly,depth,acc){
  const clip=turf.polygon(poly);let data;
  try{data=await post(queryRing(poly),acc.field);}
  catch(e){
   // Too many map units or polygons for one lookup: split the part into quarters and try again.
   if(depth<2&&/too many|too complex|smaller area/i.test(e.message)&&e.status!==429){
    const b=turf.bbox(clip),mx=(b[0]+b[2])/2,my=(b[1]+b[3])/2;
    for(const cell of [[b[0],b[1],mx,my],[mx,b[1],b[2],my],[b[0],my,mx,b[3]],[mx,my,b[2],b[3]]]){const part=turf.intersect(turf.featureCollection([clip,turf.bboxPolygon(cell)]));if(part)for(const p of polysOf(part))await lookupPiece(p,depth+1,acc);}
    return;
   }
   throw e;
  }
  for(const r of data.ratings||[])acc.ratings.set(String(r.mukey),r);
  for(const c of data.components||[])acc.components.set(String(c.cokey),c);
  if(data.exploratoryError)acc.exploratoryError=data.exploratoryError;
  acc.retrieved=data.retrieved;
  for(const row of data.polygons||[]){
   for(const p of wktPolys(row.wkt)){
    let piece;try{piece=turf.intersect(turf.featureCollection([turf.polygon(p),clip]));}catch{continue;}
    if(!piece)continue;const area=turf.area(piece);if(area<.01)continue;
    const key=String(row.mukey);if(!acc.units.has(key))acc.units.set(key,{key,parts:[],area:0});
    const u=acc.units.get(key);u.parts.push(...polysOf(piece));u.area+=area;
   }
  }
 }
 async function lookupField(f){
  const acc={field:f,units:new Map(),ratings:new Map(),components:new Map(),exploratoryError:null,retrieved:null};
  for(const poly of pieces(f.geometry))await lookupPiece(poly,0,acc);
  f.exploratoryError=acc.exploratoryError;f.retrieved=acc.retrieved;
  f.units=[...acc.units.values()].map(u=>{
   const info=acc.ratings.get(u.key)||{},comp=info.cokey!==undefined&&info.cokey!==null?acc.components.get(String(info.cokey)):null;
   let model=null;try{model=comp?E.buildComponent(comp):null;}catch{model=null;}
   return {...u,info,comp,model,field:f};
  }).sort((a,b)=>b.area-a.area);
 }

 // ---- scoring: same rules as the national layer ----
 function published(u){const v=u.info.rating;return v===null||v===undefined||v===''||!Number.isFinite(+v)?null:Math.round(+v*1000)/1000;}
 // Adjusted scores need the engine to reproduce the NRCS rating from the soil data (as in the national build).
 function available(u){
  const m=u.model,c=u.comp;if(!m||!m.top||!Number.isFinite(+m.top.rep))return false;
  if(c&&(c.unknownReasons||[]).length)return false;
  if(Math.abs(m.reproError||0)>P.MATCH_TOLERANCE+1e-9)return false; // same hundredth as the published rating
  const stored=Object.values(m.stored||{}).map(s=>s.rep).filter(Number.isFinite),needs=m.nStored>=5&&stored.length&&Math.max(...stored)<1;
  if(needs&&(!c||!c.horizons||!c.horizons.length||!c.site||!Object.keys(c.site).length))return false;
  return true;
 }
 // A field's soil test pH replaces the mapped pH (through the NRCS pH curve) while soil pH counts.
 const usesTest=(f,a)=>Number.isFinite(f.phTest)&&P.active(a).ph;
 const adjustedFor=(fs,a)=>!P.isNRCS(a)||fs.some(f=>usesTest(f,a));
 function withTest(u,a){return usesTest(u.field,a)?{...u.model,props:{...u.model.props,ph:u.field.phTest}}:u.model;}
 function score(u,a){
  const p=published(u);if(p===null)return {nrcs:null,nrcsCls:5,value:null,cls:5};
  const nrcsCls=P.classIndex(p),test=usesTest(u.field,a);if(P.isNRCS(a)&&!test)return {nrcs:p,nrcsCls,value:p,cls:nrcsCls};
  if(u.exploratoryError||!available(u))return {nrcs:p,nrcsCls,value:null,cls:6};
  const base=test?{...u.model.base,ph:E.BY_KEY.ph.curve(u.field.phTest)}:u.model.base;
  const s=P.keepPublished(P.scoreValues(base,P.active(a)),u.model.base,+u.model.top.rep);
  return {nrcs:p,nrcsCls,value:s,cls:s===null?6:P.classIndex(s)};
 }
 function scoreLine(u,a){
  const s=score(u,a),n=s.nrcs===null?'NRCS rating: unrated':'NRCS rating: '+s.nrcs.toFixed(3)+' ('+NAMES[s.nrcsCls]+')';
  if(!adjustedFor([u.field],a))return n;
  return n+'. Your choices'+(usesTest(u.field,a)?' with soil test pH '+u.field.phTest.toFixed(1):'')+': '+(s.nrcs===null?'unrated':s.cls===6?M.NO_SCORE.toLowerCase():s.value.toFixed(3)+' ('+NAMES[s.cls]+')');
 }
 function counts(units,a){const n=Array(7).fill(0),y=Array(7).fill(0);for(const u of units){const s=score(u,a),ac=acresOf(u.area);n[s.nrcsCls]+=ac;y[s.cls]+=ac;}return {n,y};}

 // ---- drawing soils ----
 function esc(t){const d=document.createElement('span');d.textContent=String(t??'');return d.innerHTML;}
 function tooltip(u){
  const a=answers();return '<strong>'+esc(u.info.muname||'Map unit '+u.key)+'</strong><br>'+esc(u.field.name)+' · '+fmt(acresOf(u.area))+' acres<br>Main soil: '+esc(u.info.compname||'Unavailable')+'<br>'+esc(scoreLine(u,a));
 }
 function draw_(f){
  if(f.soilLayer)map.removeLayer(f.soilLayer);f.soilLayer=null;if(!f.units.length)return;
  const features=f.units.map(u=>({type:'Feature',properties:{key:u.key},geometry:{type:'MultiPolygon',coordinates:u.parts}}));
  const byKey=new Map(f.units.map(u=>[u.key,u]));
  f.soilLayer=L.geoJSON({type:'FeatureCollection',features},{pane:'fieldSoilPane',style:feature=>style(byKey.get(feature.properties.key)),
   onEachFeature:(feature,layer)=>{const u=byKey.get(feature.properties.key);layer.bindTooltip(()=>tooltip(u),{sticky:true});layer.on('click',()=>selectSoil(u,false));}}).addTo(map);
 }
 function style(u){const c=score(u,answers()).cls;return {color:'#474540',weight:1,fillColor:colors[c],fillOpacity:.65};}
 function restyle(){for(const f of fields)if(f.soilLayer)f.soilLayer.eachLayer(l=>l.setStyle(style(f.units.find(u=>u.key===l.feature.properties.key))));}

 // ---- panel ----
 function table(n,y,adjusted){
  const nrcs=!adjusted,t=document.createElement('table');
  t.innerHTML='<thead><tr><th scope="col">Response</th><th scope="col">NRCS acres</th>'+(nrcs?'':'<th scope="col">Your choices acres</th>')+'</tr></thead>';
  const body=document.createElement('tbody');
  for(const i of ORDER){
   if(i===6&&nrcs)continue;if(n[i]<.05&&y[i]<.05&&i>=5)continue;
   const tr=document.createElement('tr');tr.innerHTML='<th scope="row"><span class="acreage-swatch" style="background:'+colors[i]+'"></span>'+esc(NAMES[i])+'</th><td>'+(i===6?'–':fmt(n[i]))+'</td>'+(nrcs?'':'<td>'+fmt(y[i])+'</td>');
   if(i===6)tr.querySelector('th').title=M.NO_SCORE_HELP;body.append(tr);
  }
  const sum=c=>c.reduce((s,v)=>s+v,0),tr=document.createElement('tr');tr.className='acreage-total';tr.innerHTML='<th scope="row">Mapped soils</th><td>'+fmt(sum(n))+'</td>'+(nrcs?'':'<td>'+fmt(sum(y))+'</td>');body.append(tr);
  t.append(body);return t;
 }
 function renderList(){
  const list=$('field-list'),a=answers();list.replaceChildren();
  for(const f of fields){
   const li=document.createElement('li');li.className='field-item';
   const head=document.createElement('div');head.className='field-head';
   const name=document.createElement('input');name.type='text';name.value=f.name;name.className='field-name';name.setAttribute('aria-label','Field name');name.maxLength=60;
   name.addEventListener('change',()=>{f.name=name.value.trim()||'Field '+f.id;name.value=f.name;f.outline.setTooltipContent(textLabel(f.name));renderTotals();});
   const ac=document.createElement('span');ac.className='field-acres';ac.textContent=fmt(f.acres)+' ac';head.append(name,ac);
   const actions=document.createElement('div');actions.className='field-actions';
   const zoom=document.createElement('button');zoom.type='button';zoom.className='text-button';zoom.textContent='Zoom to';zoom.addEventListener('click',()=>map.fitBounds(f.outline.getBounds(),{padding:[40,40],maxZoom:17}));
   const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+f.name);remove.addEventListener('click',()=>removeField(f));
   actions.append(zoom,remove);li.append(head,actions);
   const st=document.createElement('p');st.className='field-status';
   if(f.status==='queued')st.textContent='Waiting to look up soils…';
   else if(f.status==='looking')st.textContent='Looking up soils…';
   else if(f.status==='error'){st.textContent=f.error;st.classList.add('error');}
   else if(!f.units.length)st.textContent='No mapped soils were found inside this field.';
   if(st.textContent)li.append(st);
   if(f.status==='done'&&f.units.length){
    const box=document.createElement('div');box.className='field-ph';
    const lab=document.createElement('label'),inp=document.createElement('input');lab.textContent='Soil test pH (optional) ';
    inp.type='number';inp.step='0.1';inp.min='3';inp.max='10';inp.inputMode='decimal';inp.value=Number.isFinite(f.phTest)?f.phTest.toFixed(1):'';inp.setAttribute('aria-describedby','ph-note-'+f.id);
    inp.addEventListener('change',()=>{const v=parseFloat(inp.value);f.phTest=Number.isFinite(v)&&v>=3&&v<=10?Math.round(v*10)/10:null;restyle();renderList();renderTotals();renderSoil();});
    lab.append(inp);const note=document.createElement('p');note.className='hint';note.id='ph-note-'+f.id;
    note.textContent=!Number.isFinite(f.phTest)?'Replaces the mapped pH for every soil in this field.':usesTest(f,a)?'Your soil test pH replaces the mapped pH for every soil in this field.':'Soil pH is left out under your liming answer, so this soil test pH is not used.';
    box.append(lab,note);li.append(box);
    const mapped=f.units.reduce((s,u)=>s+acresOf(u.area),0),{n,y}=counts(f.units,a);
    const det=document.createElement('details');det.open=fields.length<=3;const sum=document.createElement('summary');sum.textContent='Soils and acres ('+f.units.length+' soil'+(f.units.length===1?'':'s')+', '+fmt(mapped)+' mapped acres)';det.append(sum,table(n,y,adjustedFor([f],a)));
    if(f.exploratoryError){const p=document.createElement('p');p.className='hint';p.textContent=f.exploratoryError;det.append(p);}
    const soils=document.createElement('ul');soils.className='soil-list';
    for(const u of f.units){const s=score(u,a),li2=document.createElement('li'),b=document.createElement('button');b.type='button';b.className='soil-button'+(selected===u?' selected':'');
     b.innerHTML='<span class="acreage-swatch" style="background:'+colors[s.cls]+'"></span><span><strong>'+esc(u.info.muname||'Map unit '+u.key)+'</strong><br><small>'+fmt(acresOf(u.area))+' ac · '+esc(scoreLine(u,a))+'</small></span>';
     b.addEventListener('click',()=>selectSoil(u,true));li2.append(b);soils.append(li2);}
    det.append(soils);li.append(det);
   }
   list.append(li);
  }
  $('fields-none').hidden=fields.length>0;
 }
 function renderTotals(){
  const done=fields.filter(f=>f.status==='done'),box=$('fields-total');box.hidden=!done.length;if(!done.length)return;
  const a=answers(),{n,y}=counts(done.flatMap(f=>f.units),a);
  $('fields-total-title').textContent=done.length===1?'Field total':'All '+done.length+' fields';
  $('fields-total-table').replaceChildren(table(n,y,adjustedFor(done,a)));
 }
 function selectSoil(u,zoom){
  selected=u;renderList();renderSoil();
  if(zoom){const b=L.geoJSON({type:'MultiPolygon',coordinates:u.parts}).getBounds();map.fitBounds(b,{padding:[40,40],maxZoom:17});}
  $('soil-detail').scrollIntoView({block:'nearest'});
 }
 function renderSoil(){
  const box=$('soil-detail');box.hidden=!selected;if(!selected)return;const u=selected,a=answers();
  $('soil-detail-name').textContent=(u.info.muname||'Map unit '+u.key)+' ('+u.field.name+')';
  $('soil-detail-score').textContent=scoreLine(u,a)+'.';
  const opp=$('soil-opportunities'),con=$('soil-constraints');opp.replaceChildren();con.replaceChildren();
  if(!u.model){const p=document.createElement('p');p.textContent='Detailed soil properties are unavailable for this soil.';opp.append(p);$('soil-constraints-box').hidden=true;return;}
  const rows=Insights.publicRows(E,withTest(u,a),{active:P.active(a)});
  $('soil-detail-main').textContent='Main soil: '+u.model.compname+'.';
  const card=r=>{const d=document.createElement('div');d.className='insight-card';const h=document.createElement('h5');h.textContent=r.label;const p=document.createElement('p');p.textContent=r.text;const v=document.createElement('p');v.className='hint';v.textContent=Insights.plainValue(r);d.append(h,p,v);return d;};
  for(const r of rows.opportunities)opp.append(card(r));
  if(!rows.opportunities.length){const p=document.createElement('p');p.textContent='The available soil data do not identify a clear improvement for this soil.';opp.append(p);}
  for(const r of rows.constraints)con.append(card(r));$('soil-constraints-box').hidden=!rows.constraints.length;
 }
 window.addEventListener('abi:choices',()=>{restyle();renderList();renderTotals();renderSoil();});

 // ---- exports ----
 const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 function download(text,type,name){const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 $('export-field-acres').addEventListener('click',()=>{
  const a=answers(),done=fields.filter(f=>f.status==='done');if(!done.length)return;const nrcs=!adjustedFor(done,a);
  const lines=[['Field','Field acres','Soil test pH used','Response','NRCS acres',...(nrcs?[]:['Your choices acres'])].map(csv).join(',')];
  const add=(label,ac,ph,units)=>{const {n,y}=counts(units,a);for(const i of ORDER){if(i===6&&nrcs)continue;lines.push([label,ac.toFixed(2),ph,NAMES[i],i===6?'':n[i].toFixed(2),...(nrcs?[]:[y[i].toFixed(2)])].map(csv).join(','));}};
  for(const f of done)add(f.name,f.acres,usesTest(f,a)?f.phTest.toFixed(1):'',f.units);
  if(done.length>1)add('All fields',done.reduce((s,f)=>s+f.acres,0),'',done.flatMap(f=>f.units));
  lines.push('',csv('Choices: '+P.describe(a)),csv('Dominant soil component of each map unit, from USDA-NRCS Soil Data Access. Retrieved '+(done[0].retrieved?new Date(done[0].retrieved).toLocaleString():'')+'.'),csv('Adjusted scores are the Institute\'s estimates from published NRCS soil data, not NRCS ratings. They do not predict crop yield or establish program eligibility.'));
  download(lines.join('\n'),'text/csv','biochar-field-acres'+(nrcs?'-nrcs':'-adjusted')+'.csv');
 });
 $('export-field-bounds').addEventListener('click',()=>{
  if(!fields.length)return;
  download(JSON.stringify({type:'FeatureCollection',features:fields.map(f=>({type:'Feature',properties:{name:f.name,acres:+f.acres.toFixed(2)},geometry:f.geometry}))},null,1),'application/geo+json','biochar-fields.geojson');
 });
 $('export-field-soils').addEventListener('click',()=>{
  const a=answers(),done=fields.filter(f=>f.status==='done');if(!done.length)return;
  const lines=[['Field','Map unit','mukey','Main soil','Acres in field','NRCS rating','Your choices score','Type','Property','Soil-survey estimate (soil test pH where entered)','What this means for biochar'].map(csv).join(',')];
  for(const f of done)for(const u of f.units){
   const s=score(u,a),base=[f.name,u.info.muname,u.key,u.model?.compname||u.info.compname,acresOf(u.area).toFixed(2),s.nrcs===null?'Unrated':s.nrcs.toFixed(3),s.nrcs===null?'Unrated':s.cls===6?M.NO_SCORE:s.value.toFixed(3)];
   const rows=u.model?Insights.publicRows(E,withTest(u,a),{active:P.active(a)}):{opportunities:[],constraints:[]};
   const items=[...rows.opportunities.map(r=>['Possible improvement',r]),...rows.constraints.map(r=>['Application consideration',r])];
   if(!items.length)lines.push([...base,'','','',''].map(csv).join(','));
   for(const [type,r] of items)lines.push([...base,type,r.label,r.value,r.text].map(csv).join(','));
  }
  lines.push('',csv('Choices: '+P.describe(a)));
  download(lines.join('\n'),'text/csv','biochar-field-soils.csv');
 });

 window.abiFields={fields,addField,removeField,get busy(){return running>0||queue.length>0;},score,available,pieces,queryRing};
 renderList();
})();
