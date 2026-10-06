(function(){
 const aoiLink=document.getElementById('aoi-explorer-link'),nationalTab=document.getElementById('national-tab'),aoiTab=document.getElementById('aoi-tab');
 const aoiFrame=document.getElementById('aoi-frame'),nationalPanel=document.getElementById('national-panel'),aoiPanel=document.getElementById('aoi-panel');
 const embedded=new URLSearchParams(location.search).get('embedded')==='1';
 const aoiOrigin=location.origin==='http://127.0.0.1:8766'?'http://127.0.0.1:8788':'https://biochar-aoi-public.abi-verified-api.workers.dev';
 let areaFit=Promise.resolve(),modeRequest=0;
 async function switchMode(mode){
  if(embedded){const parentOrigin=new URL(document.referrer||location.href).origin;if([aoiOrigin,'http://127.0.0.1:8788'].includes(parentOrigin))parent.postMessage({type:'abi-map-mode',mode},parentOrigin);return;}
  const request=++modeRequest;
  if(mode==='aoi'&&!aoiFrame.getAttribute('src'))await areaFit;
  if(request!==modeRequest)return;
  const aoi=mode==='aoi';nationalPanel.hidden=aoi;aoiPanel.hidden=!aoi;
  nationalTab.setAttribute('aria-selected',String(!aoi));aoiTab.setAttribute('aria-selected',String(aoi));nationalTab.tabIndex=aoi?-1:0;aoiTab.tabIndex=aoi?0:-1;
  document.getElementById('mode-description').textContent=aoi?'Aerial imagery and live mapped soil detail':'USDA-NRCS published rating, read as native soil condition';
  if(aoi&&!aoiFrame.getAttribute('src')){const center=map.getCenter();document.getElementById('aoi-loading').hidden=false;aoiFrame.src=aoiOrigin+'/?embedded=1#map='+center.lat.toFixed(6)+','+center.lng.toFixed(6)+','+map.getZoom();}
  else if(aoi)aoiFrame.contentWindow.postMessage({type:'abi-map-resume'},aoiOrigin);
  else {updateRatingLabels();requestAnimationFrame(()=>map.invalidateSize({pan:false}));}
 }
 aoiFrame.addEventListener('load',()=>{document.getElementById('aoi-loading').hidden=true;broadcastScenario();});
 if(aoiLink)aoiLink.addEventListener('click',()=>{switchMode('aoi');if(!embedded)aoiTab.focus();});
 nationalTab.addEventListener('click',()=>switchMode('national'));aoiTab.addEventListener('click',()=>switchMode('aoi'));
 for(const tab of [nationalTab,aoiTab])tab.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const next=e.key==='Home'?nationalTab:e.key==='End'?aoiTab:tab===nationalTab?aoiTab:nationalTab;switchMode(next===aoiTab?'aoi':'national');next.focus();});
 addEventListener('message',e=>{
  const trusted=embedded?e.source===parent&&[aoiOrigin,'http://127.0.0.1:8788'].includes(e.origin):e.source===aoiFrame.contentWindow&&e.origin===aoiOrigin;
  if(!trusted)return;
  if(e.data?.type==='abi-map-scenario')receiveScenario(e.data);
  if(embedded&&e.data?.type==='abi-map-resume')requestAnimationFrame(()=>map.invalidateSize({pan:false}));
  if(!embedded&&e.data?.type==='abi-map-mode'&&e.data.mode==='national')switchMode('national');
 });
 const panel=document.getElementById('acreage'), stateSelect=document.getElementById('acreage-state'), countySelect=document.getElementById('acreage-county');
 const areaTitle=document.getElementById('acreage-area-title'), status=document.getElementById('acreage-status'),body=document.getElementById('acreage-rows');
 let data,viewCounts=null,viewId=0,timer,selectedCounts,selectedName='Contiguous U.S.',selectionId=0,scenario='nrcs',scenarioRequest=0,pendingScenario=null;
 const ratingSelect=document.getElementById('rating-mode'),drainageSelect=document.getElementById('national-drainage'),phSelect=document.getElementById('national-ph');
 const scenarioStatus=document.getElementById('scenario-status'),summaryCache=new Map();
 function broadcastScenario(){
  const payload={type:'abi-map-scenario',mode:ratingSelect.value,drained:drainageSelect.value,ph:phSelect.value};
  if(embedded){const origin=new URL(document.referrer||location.href).origin;if([aoiOrigin,'http://127.0.0.1:8788'].includes(origin))parent.postMessage(payload,origin);}
  else if(aoiFrame.getAttribute('src'))aoiFrame.contentWindow.postMessage(payload,aoiOrigin);
 }
 function receiveScenario(payload){
  if(!['nrcs','abi'].includes(payload.mode)||!['','yes','no'].includes(payload.drained)||!['','yes','no'].includes(payload.ph))return;
  if(!data){pendingScenario=payload;return;}
  ratingSelect.value=payload.mode;drainageSelect.value=payload.drained;phSelect.value=payload.ph;updateScenario(false);
 }
 const colors=['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b','#deded8'];
 const order=[4,3,2,1,0,5];const format=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
 const worker=new Worker('acreage-worker.js?v=20261006-adjusted-ids');
 let tileId=0;const pendingTiles=new Map();
 const ScenarioLayer=L.GridLayer.extend({createTile(coords,done){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const id='tile:'+ ++tileId;pendingTiles.set(id,{canvas,done});worker.postMessage({id,scenario,coords:{x:coords.x,y:coords.y,z:coords.z}});return canvas;
 }});
 const exploratoryLayer=new ScenarioLayer({opacity:.82,maxZoom:15,maxNativeZoom:11,attribution:'ABI adjusted response score; USDA-NRCS FY2026 gSSURGO; 300 m overview'});
 function updateRatingLabels(){
  const abi=scenario!=='nrcs';
  window.abiExploratoryActive=abi;
  document.getElementById('about-rating').textContent=abi?'Colors show the ABI adjusted response score using your drainage and pH choices. Darker green means greater modeled response potential. These scores are estimates, not measured soil improvements. Switch to Area of interest for live soil-polygon detail.':'Colors show the USDA-NRCS interpretation SOH - Dynamic Soil Properties Response to Biochar. Darker green means greater modeled response potential. Zoom in for county lines; switch to Area of interest for aerial imagery and soil-polygon detail.';
  document.getElementById('rating-title').textContent=abi?'ABI adjusted response score acres by response class':'NRCS acres by response class';
  document.getElementById('rating-note').textContent=abi?'ABI scenario estimates use the largest soil component in each map unit. Some missing factors are inferred or calibrated to the published rating. This is an exploratory model, not a measured benefit or an NRCS rating.':'NRCS ratings describe soils as mapped in their native condition. They do not predict crop yield or establish funding eligibility.';
  document.getElementById('resolution-note').textContent=abi?'Adjusted-score colors and acreage use a 300 m grid with current soil IDs refreshed where saved IDs were retired. Use Area of interest for live soil-polygon detail. Unrated or unavailable model results stay separate.':'Estimates use the 300 m class raster and cell centers. Rounded acres include all mapped land uses. Current view may cross state or county boundaries. Unrated area stays separate. Outside county boundaries is excluded.';
  document.getElementById('resnote').textContent=abi?'The ABI adjusted response overview uses 300 m cells. Zooming enlarges those cells; use Area of interest for soil-polygon detail.':'This national overview is built at about 50 m resolution (roughly zoom 11). Beyond that the coloring is upscaled and is not intended for site-specific decisions; use the Institute\'s area tool for field-level detail.';
  document.getElementById('resnote').style.display=map.getZoom()>=(abi?9:12)?'block':'none';
  if(!nationalPanel.hidden)document.getElementById('mode-description').textContent=abi?'ABI adjusted response score — 300 m national overview':'USDA-NRCS published rating, read as native soil condition';
 }
 async function updateScenario(broadcast=true){
  if(broadcast!==false)broadcastScenario();
  const request=++scenarioRequest,abi=ratingSelect.value==='abi';
  document.getElementById('national-assumptions').hidden=!abi;
  const complete=drainageSelect.value&&phSelect.value;
  const next=abi&&complete?drainageSelect.value+'-'+phSelect.value:'nrcs';
  scenarioStatus.textContent=abi&&!complete?'Answer both questions to display the ABI scenario. The NRCS layer remains displayed.':abi?'Loading adjusted response scenario…':'USDA-NRCS published rating.';
  viewId++;viewCounts=null;
  try{
   const path=next==='nrcs'?'acreage-summary.json':'exploratory/'+next+'-summary.json';
   if(!summaryCache.has(next))summaryCache.set(next,fetch(path+(next==='nrcs'?'':'?v=20261006-adjusted-ids')).then(r=>{if(!r.ok)throw new Error('Scenario data unavailable');return r.json();}));
   const nextData=await summaryCache.get(next);if(request!==scenarioRequest)return;
   data=nextData;scenario=next;
   if(scenario==='nrcs'){map.removeLayer(exploratoryLayer);if(!map.hasLayer(nrcsLayer))nrcsLayer.addTo(map);}
   else {map.removeLayer(nrcsLayer);if(!map.hasLayer(exploratoryLayer))exploratoryLayer.addTo(map);else exploratoryLayer.redraw();}
   const c=data.counties.find(c=>c.fips===countySelect.value),s=data.states.find(s=>s.fips===stateSelect.value);
   selectedCounts=c?c.cells:s?s.cells:data.nationalCells;updateRatingLabels();render();requestView();
   if(abi&&complete)scenarioStatus.textContent='ABI scenario: artificially drained '+drainageSelect.value+'; raise soil pH '+phSelect.value+'.';
   else if(!abi)scenarioStatus.textContent='USDA-NRCS published rating.';
  }catch(e){if(request===scenarioRequest){scenarioStatus.textContent=e.message+'. Previous layer remains displayed.';summaryCache.delete(next);}}
 }
 for(const control of [ratingSelect,drainageSelect,phSelect])control.addEventListener('change',updateScenario);
 for(const button of document.querySelectorAll('.national-info'))button.addEventListener('click',()=>{const help=document.getElementById(button.getAttribute('aria-controls')),open=help.hidden;help.hidden=!open;button.setAttribute('aria-expanded',String(open));});
 map.createPane('selectedCountyPane');
 map.getPane('selectedCountyPane').style.zIndex=450;
 map.getPane('selectedCountyPane').style.pointerEvents='none';
 const selectedCountyLayer=L.layerGroup().addTo(map);
 function render(){
  if(!data)return;areaTitle.textContent=selectedName;
  body.replaceChildren();
  for(const index of order){const row=document.createElement('tr');const label=document.createElement('th');label.scope='row';
   const sw=document.createElement('span');sw.className='acreage-swatch';sw.style.background=colors[index];label.append(sw,document.createTextNode(data.classes[index]));row.append(label);
   for(const counts of [selectedCounts,viewCounts]){const cell=document.createElement('td');cell.textContent=counts?format(counts[index]*data.cellAcres):'…';row.append(cell);}body.append(row);}
  const total=document.createElement('tr');total.className='acreage-total';const th=document.createElement('th');th.scope='row';th.textContent='Rated total';total.append(th);
  for(const counts of [selectedCounts,viewCounts]){const td=document.createElement('td');td.textContent=counts?format(counts.slice(0,5).reduce((a,b)=>a+b,0)*data.cellAcres):'…';total.append(td);}body.append(total);
 }
 function requestView(){if(!data)return;viewId++;viewCounts=null;render();status.textContent='Updating current map view…';const b=map.getBounds();
  worker.postMessage({id:viewId,scenario,bounds:[Math.max(-180,b.getWest()),Math.max(-85,b.getSouth()),Math.min(180,b.getEast()),Math.min(85,b.getNorth())]});}
 worker.onmessage=e=>{
  if(pendingTiles.has(e.data.id)){const {canvas,done}=pendingTiles.get(e.data.id);pendingTiles.delete(e.data.id);if(e.data.error){done(new Error(e.data.error),canvas);scenarioStatus.textContent='Adjusted-score colors unavailable: '+e.data.error;}else{canvas.getContext('2d').putImageData(new ImageData(e.data.pixels,256,256),0,0);done(null,canvas);}return;}
  if(e.data.id!==viewId)return;if(e.data.error){status.textContent='Visible-area totals unavailable: '+e.data.error;return;}viewCounts=e.data.counts;render();status.textContent='Current view updates as you zoom or pan.';};
 worker.onerror=()=>{status.textContent='Visible-area calculation unavailable. State and county totals remain available.';};
 map.on('moveend',()=>{clearTimeout(timer);timer=setTimeout(requestView,180);});
 function populateCounties(){countySelect.replaceChildren(new Option('Whole state',''));const rows=data.counties.filter(c=>c.state===stateSelect.value).sort((a,b)=>a.name.localeCompare(b.name));
  for(const c of rows)countySelect.add(new Option(c.name+(c.type==='County'?' County':c.type?' '+c.type:''),c.fips));countySelect.disabled=!stateSelect.value;}
 async function fitSelected(){
  const selection=++selectionId;
  selectedCountyLayer.clearLayers();
  if(!stateSelect.value){map.setView([39.5,-98.35],4,{animate:false});return;}
  const county=countySelect.value,state=stateSelect.value;
  const gj=await fetch(county?'counties.geojson':'states.geojson').then(r=>r.json());
  const f=gj.features.find(f=>county?f.id===county:f.id.padStart(2,'0')===state);
  if(!f || selection!==selectionId)return;
  if(county){
   const options={pane:'selectedCountyPane',interactive:false};
   L.geoJSON(f,{...options,style:{color:'#ffffff',weight:7,opacity:1,fill:false,className:'selected-county-halo'}}).addTo(selectedCountyLayer);
   L.geoJSON(f,{...options,style:{color:'#45173d',weight:4,opacity:1,fill:false,className:'selected-county-outline'}}).addTo(selectedCountyLayer);
  }
  map.fitBounds(L.geoJSON(f).getBounds(),{animate:false,paddingTopLeft:[30,100],paddingBottomRight:[30,35],maxZoom:11});
 }
 function selectArea(){
  const c=data.counties.find(c=>c.fips===countySelect.value),s=data.states.find(s=>s.fips===stateSelect.value);
  selectedCounts=c?c.cells:s?s.cells:data.nationalCells;selectedName=c?c.name+(c.type==='County'?' County':c.type?' '+c.type:'')+', '+c.stateName:s?s.name:'Contiguous U.S.';render();areaFit=fitSelected().catch(()=>{});
 }
 stateSelect.addEventListener('change',()=>{populateCounties();selectArea();});countySelect.addEventListener('change',selectArea);
 document.getElementById('acreage-export').addEventListener('click',()=>{
  if(!data)return;const lines=['Class,"'+selectedName.replaceAll('"','""')+' acres",Current map view acres'];
  for(const i of order)lines.push([data.classes[i],Math.round(selectedCounts[i]*data.cellAcres),viewCounts?Math.round(viewCounts[i]*data.cellAcres):''].join(','));
  lines.push('','"'+data.method.replaceAll('"','""')+'"','Rating,'+(scenario==='nrcs'?'USDA-NRCS published':'ABI adjusted response score'),'Artificially drained,'+(scenario==='nrcs'?'Not applicable':drainageSelect.value),'Raise soil pH,'+(scenario==='nrcs'?'Not applicable':phSelect.value));
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='biochar-acreage-'+scenario+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });
 fetch('acreage-summary.json').then(r=>{if(!r.ok)throw new Error('Summary data unavailable');return r.json();}).then(j=>{
  data=j;for(const s of data.states.slice().sort((a,b)=>a.name.localeCompare(b.name)))stateSelect.add(new Option(s.name,s.fips));
  summaryCache.set('nrcs',Promise.resolve(j));ratingSelect.disabled=false;stateSelect.disabled=false;selectedCounts=data.nationalCells;updateRatingLabels();render();requestView();if(pendingScenario){receiveScenario(pendingScenario);pendingScenario=null;}
 }).catch(e=>{status.textContent=e.message;});
 L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);
})();
