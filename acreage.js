(function(){
 // Panel choices, soil layer and acreage (policy v2). The map starts with the NRCS rating; the
 // drainage, pH and Group 1 choices change it. Scoring runs in acreage-worker.js.
 const P=window.ABIPolicy,$=id=>document.getElementById(id);
 const local=['127.0.0.1','localhost'].includes(location.hostname),params=new URLSearchParams(location.search);
 const dataBase=local&&params.get('data')?params.get('data').replace(/\/?$/,'/'):null;
 const worker=new Worker('acreage-worker.js?v=20261011-rounding');
 if(dataBase)worker.postMessage({type:'config',dataBase});
 let requestId=0;const pending=new Map();
 function ask(msg){const id=++requestId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker.postMessage({...msg,id});});}
 worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);if(e.data.error)p.reject(new Error(e.data.error));else p.resolve(e.data);};
 worker.onerror=()=>{status.textContent='Map calculations are unavailable in this browser. State and county NRCS totals remain available.';};

 // ---- choices ----
 const drained=$('choice-drained'),raisePH=$('choice-ph'),group1=$('choice-group1'),reset=$('reset-nrcs');
 const factorBoxes=[...document.querySelectorAll('#choices input[data-factor]')];
 const keep={slope:true,flood:true,cobble:true,lep:true};
 let answers=P.normalize(P.DEFAULTS),version=0;
 function readChoices(){return P.normalize({drained:drained.value,raisePH:raisePH.value,group1All:group1.checked,keep:{...keep}});}
 function showChoices(){
  drained.value=answers.drained;raisePH.value=answers.raisePH;group1.checked=answers.group1All;
  for(const box of factorBoxes){const k=box.dataset.factor;box.checked=answers.group1All||!keep[k];box.disabled=answers.group1All;}
  const nrcs=P.isNRCS(answers);
  $('status-line').textContent=nrcs?'Showing: NRCS rating':'Showing: adjusted score (your choices)';
  $('status-detail').textContent=P.describe(answers);
  reset.hidden=nrcs;
  for(const el of document.querySelectorAll('.col-yours'))el.hidden=nrcs;
  // The legend: what the colors show, and the no-adjusted-score row only beside an adjusted score.
  $('about-rating').innerHTML=nrcs?'Scores run from 0 to 1. Colors show the USDA-NRCS rating <i>Dynamic Soil Properties Response to Biochar</i>. Zoom in to see county lines.':
   'Scores run from 0 to 1. Colors show the Institute\'s adjusted score for your choices. It is an estimate, not a measured soil improvement.';
  $('legend-noscore').hidden=nrcs;
 }
 // Only a factor box changes the one-at-a-time choices; the master switch shows all four as left out
 // while it is on, and turning it off brings back the one-at-a-time choices (none, by default).
 function choicesChanged(e){
  if(e&&e.target.dataset.factor)keep[e.target.dataset.factor]=!e.target.checked;
  answers=readChoices();showChoices();update();
 }
 for(const control of [drained,raisePH,group1,...factorBoxes])control.addEventListener('change',choicesChanged);
 function resetChoices(){for(const k in keep)keep[k]=true;answers=P.normalize(P.DEFAULTS);showChoices();return update();}
 reset.addEventListener('click',()=>{resetChoices();drained.focus();});

 // ---- information buttons: open on hover, keyboard focus and tap; Escape closes ----
 const infos=[...document.querySelectorAll('#acreage .info')];
 function setInfo(button,open,pinned){
  const pop=$(button.getAttribute('aria-controls'));pop.hidden=!open;button.setAttribute('aria-expanded',String(open));button.dataset.pinned=open&&pinned?'1':'';
  if(open)for(const other of infos)if(other!==button&&other.getAttribute('aria-expanded')==='true')setInfo(other,false);
 }
 for(const button of infos){
  const pop=$(button.getAttribute('aria-controls')),row=button.parentElement;let timer;
  const open=()=>{clearTimeout(timer);if(button.getAttribute('aria-expanded')!=='true')setInfo(button,true,false);};
  const later=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!button.dataset.pinned&&!row.contains(document.activeElement))setInfo(button,false);},250);};
  button.addEventListener('mouseenter',open);pop.addEventListener('mouseenter',open);
  button.addEventListener('mouseleave',later);pop.addEventListener('mouseleave',later);
  // Focus returned by Escape must not reopen the text (audit finding A5).
  button.addEventListener('focus',()=>{if(button.dataset.restoring){delete button.dataset.restoring;return;}open();});
  row.addEventListener('focusout',e=>{if(!row.contains(e.relatedTarget)&&!button.dataset.pinned)setInfo(button,false);});
  button.addEventListener('click',()=>{const pinned=button.dataset.pinned==='1';setInfo(button,!pinned,!pinned);});
 }
 document.addEventListener('keydown',e=>{if(e.key!=='Escape')return;for(const b of infos)if(b.getAttribute('aria-expanded')==='true'){const inside=b.parentElement.contains(document.activeElement);setInfo(b,false);if(inside&&document.activeElement!==b){b.dataset.restoring='1';b.focus();}}});
 document.addEventListener('pointerdown',e=>{for(const b of infos)if(b.getAttribute('aria-expanded')==='true'&&!b.parentElement.contains(e.target))setInfo(b,false);});

 // ---- soil layer: NRCS class layer by default, recolored in place when choices change ----
 map.createPane('nationalSoilPane');map.getPane('nationalSoilPane').style.zIndex=250;map.getPane('nationalSoilPane').style.pointerEvents='none';
 map.createPane('nationalImageryPane');map.getPane('nationalImageryPane').style.zIndex=210;map.getPane('nationalImageryPane').style.pointerEvents='none';
 const imagery=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{pane:'nationalImageryPane',maxZoom:19,attribution:'Imagery &copy; Esri and its data providers'});
 let failure=null;
 async function paint(canvas,coords){
  const v=version,r=await ask({type:'tile',coords:{x:coords.x,y:coords.y,z:coords.z},answers});
  if((canvas.abiVersion??-1)>v)return;
  canvas.getContext('2d').putImageData(new ImageData(r.pixels,256,256),0,0);canvas.abiVersion=v;
 }
 const SoilLayer=L.GridLayer.extend({createTile(coords,done){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  paint(canvas,coords).then(()=>done(null,canvas),e=>{failure=e.message;status.textContent='Soil colors unavailable: '+e.message;done(e,canvas);});return canvas;
 }});
 const soil=new SoilLayer({pane:'nationalSoilPane',opacity:1,maxZoom:18,maxNativeZoom:14,attribution:'Biochar response; USDA-NRCS soil data; native 30 m grid'});
 function recolor(){
  const jobs=[];
  for(const key in soil._tiles){const t=soil._tiles[key];if(t.el&&t.coords)jobs.push(paint(t.el,t.coords).catch(e=>{failure=e.message;}));}
  return Promise.all(jobs);
 }
 const opacity=$('national-soil-opacity'),opacityValue=$('national-opacity-value');
 function setOpacity(amount){
  opacity.value=amount;opacityValue.textContent=amount+'%';opacity.setAttribute('aria-valuetext',amount+'% soil colors');soil.setOpacity(amount/100);
  if(amount<100){if(!map.hasLayer(imagery))imagery.addTo(map);}else map.removeLayer(imagery);
 }
 opacity.addEventListener('input',()=>setOpacity(Number(opacity.value)));

 // ---- acreage ----
 const status=$('acreage-status'),stateSelect=$('acreage-state'),countySelect=$('acreage-county');
 // Class 6: rated by NRCS, but no adjusted score (the engine cannot reproduce the rating). Never drawn or counted as a response class.
 const colors=['#f7fcf5','#c7e9c0','#74c476','#238b45','#00441b','#deded8','#96968f'],order=[4,3,2,1,0,6,5];
 const NO_SCORE='No adjusted score',NO_SCORE_HELP='Rated by NRCS, but the Institute cannot reproduce that rating from the soil data, so no adjusted score is shown. The NRCS rating appears in field results.';
 // Class 5 holds soils without an NRCS rating; soils with no adjusted score have their own row.
 const className=i=>i===6?NO_SCORE:i===5?'Unrated':data.classes[i],sum=(c,ks)=>ks.reduce((a,k)=>a+(c[k]||0),0);
 const format=n=>new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
 const updating=$('map-updating');
 let data,selectedName='Contiguous U.S.',nrcsCounts=null,yourCounts=null,areaId=0;
 function rows(body,columns){
  body.replaceChildren();
  for(const index of order){
   // The no-adjusted-score row appears only beside an adjusted column.
   if(index===6&&!columns.some(c=>c.adjusted))continue;
   const row=document.createElement('tr'),label=document.createElement('th');label.scope='row';
   const sw=document.createElement('span');sw.className='acreage-swatch';sw.style.background=colors[index];label.append(sw,document.createTextNode(className(index)));row.append(label);
   if(index===6){row.className='no-score';label.title=NO_SCORE_HELP;}
   for(const c of columns){const cell=document.createElement('td');if(c.yours)cell.className='col-yours',cell.hidden=P.isNRCS(answers);cell.textContent=index===6&&!c.adjusted?'–':c.counts?format((c.counts[index]||0)*data.cellAcres):'…';row.append(cell);}
   body.append(row);
  }
  const total=document.createElement('tr'),th=document.createElement('th');total.className='acreage-total';th.scope='row';th.textContent='Rated total';total.append(th);
  for(const c of columns){const td=document.createElement('td');if(c.yours)td.className='col-yours',td.hidden=P.isNRCS(answers);td.textContent=c.counts?format(sum(c.counts,[0,1,2,3,4,6])*data.cellAcres):'…';total.append(td);}
  body.append(total);
 }
 function render(){
  if(!data)return;$('acreage-area-title').textContent=selectedName;
  const adjusted=!P.isNRCS(answers);
  rows($('acreage-rows'),[{counts:nrcsCounts},{counts:yourCounts,yours:true,adjusted}]);
 }
 function selectedNRCS(){const c=data.counties.find(c=>c.fips===countySelect.value),s=data.states.find(s=>s.fips===stateSelect.value);return c?c.cells:s?s.cells:data.nationalCells;}
 async function updateArea(){
  const id=++areaId;nrcsCounts=selectedNRCS();
  if(P.isNRCS(answers)){yourCounts=nrcsCounts;render();return;}
  yourCounts=null;render();
  const r=await ask({type:'area',answers,state:stateSelect.value,county:countySelect.value});
  if(id===areaId){yourCounts=r.counts;render();}
 }
 // A change recolors the visible map and updates every acreage table; the time is kept for testing.
 async function update(){
  const v=++version,t0=performance.now();failure=null;
  window.dispatchEvent(new CustomEvent('abi:choices',{detail:{answers}})); // field results rescore right away
  status.textContent=P.isNRCS(answers)?'':'Scoring every map unit for your choices…';
  const busy=setTimeout(()=>{if(v===version)updating.hidden=false;},150);
  const results=await Promise.allSettled([recolor(),updateArea()]);
  clearTimeout(busy);
  if(v!==version)return;
  updating.hidden=true;
  const failed=results.find(r=>r.status==='rejected');
  status.textContent=failed||failure?'Some adjusted results are unavailable: '+(failed?failed.reason.message:failure):'';
  window.abiMap.lastUpdateMs=Math.round(performance.now()-t0);
 }
 map.createPane('selectedCountyPane');map.getPane('selectedCountyPane').style.zIndex=450;map.getPane('selectedCountyPane').style.pointerEvents='none';
 const selectedCountyLayer=L.layerGroup().addTo(map);let selectionId=0;
 function populateCounties(){
  countySelect.replaceChildren(new Option('Whole state',''));
  for(const c of data.counties.filter(c=>c.state===stateSelect.value).sort((a,b)=>a.name.localeCompare(b.name)))countySelect.add(new Option(c.name+(c.type==='County'?' County':c.type?' '+c.type:''),c.fips));
  countySelect.disabled=!stateSelect.value;
 }
 async function fitSelected(){
  const selection=++selectionId;selectedCountyLayer.clearLayers();
  if(!stateSelect.value){map.setView([39.5,-98.35],4,{animate:false});return;}
  const county=countySelect.value,state=stateSelect.value;
  const gj=await fetch(county?'counties.geojson':'states.geojson').then(r=>r.json());
  const f=gj.features.find(f=>county?f.id===county:f.id.padStart(2,'0')===state);
  if(!f||selection!==selectionId)return;
  if(county){
   const options={pane:'selectedCountyPane',interactive:false};
   L.geoJSON(f,{...options,style:{color:'#ffffff',weight:7,opacity:1,fill:false,className:'selected-county-halo'}}).addTo(selectedCountyLayer);
   L.geoJSON(f,{...options,style:{color:'#45173d',weight:4,opacity:1,fill:false,className:'selected-county-outline'}}).addTo(selectedCountyLayer);
  }
  map.fitBounds(L.geoJSON(f).getBounds(),{animate:false,paddingTopLeft:[30,100],paddingBottomRight:[30,35],maxZoom:11});
 }
 function selectArea(){
  const c=data.counties.find(c=>c.fips===countySelect.value),s=data.states.find(s=>s.fips===stateSelect.value);
  selectedName=c?c.name+(c.type==='County'?' County':c.type?' '+c.type:'')+', '+c.stateName:s?s.name:'Contiguous U.S.';
  updateArea().catch(e=>{status.textContent='Adjusted acres unavailable: '+e.message;});fitSelected().catch(()=>{});
 }
 stateSelect.addEventListener('change',()=>{populateCounties();selectArea();});countySelect.addEventListener('change',selectArea);
 function resetArea(){if(!data)return;stateSelect.value='';countySelect.replaceChildren(new Option('Select a state first',''));countySelect.disabled=true;selectArea();}
 $('acreage-export').addEventListener('click',()=>{
  if(!data)return;const q=s=>'"'+String(s).replaceAll('"','""')+'"',nrcs=P.isNRCS(answers);
  const lines=[['Response',q(selectedName+' NRCS acres'),...(nrcs?[]:[q(selectedName+' your choices acres')])].join(',')];
  for(const i of order){if(i===6&&nrcs)continue;lines.push([className(i),i===6?'':Math.round(nrcsCounts[i]*data.cellAcres),...(nrcs?[]:[yourCounts?Math.round((yourCounts[i]||0)*data.cellAcres):''])].join(','));}
  lines.push('',q('Choices: '+P.describe(answers)),q(data.method),q('Adjusted scores are the Institute\'s estimates from published NRCS soil data, not NRCS ratings. They do not predict crop yield or establish program eligibility.'));
  const url=URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'})),a=document.createElement('a');a.href=url;a.download='biochar-acreage'+(nrcs?'-nrcs':'-adjusted')+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 });

 // ---- legend: hide or show its body ----
 const legend=$('legend'),legendToggle=$('legend-toggle');
 legendToggle.addEventListener('click',()=>{const closed=legend.classList.toggle('collapsed');legendToggle.setAttribute('aria-expanded',String(!closed));legendToggle.textContent=closed?'Show':'Hide';});
 L.DomEvent.disableClickPropagation(legend);L.DomEvent.disableScrollPropagation(legend);
 // On a phone the legend starts closed so it does not cover the map.
 if(window.matchMedia('(max-width:640px)').matches){legend.classList.add('collapsed');legendToggle.setAttribute('aria-expanded','false');legendToggle.textContent='Show';}

 // ---- start ----
 window.abiMap={get answers(){return answers;},lastUpdateMs:null,ask,setOpacity,resetChoices,resetArea,imagery,colors,NO_SCORE,NO_SCORE_HELP};
 showChoices();
 fetch('acreage-summary.json?v=20261010-policy2').then(r=>{if(!r.ok)throw new Error('Summary data unavailable');return r.json();}).then(j=>{
  data=j;for(const s of data.states.slice().sort((a,b)=>a.name.localeCompare(b.name)))stateSelect.add(new Option(s.name,s.fips));
  stateSelect.disabled=false;nrcsCounts=yourCounts=data.nationalCells;soil.addTo(map);render();status.textContent='';
  // Load the map-unit scores ahead of a first change, unless the browser asks to save data.
  if(!navigator.connection?.saveData)setTimeout(()=>ask({type:'prefetch'}).catch(()=>{}),2500);
 }).catch(e=>{status.textContent=e.message;});
 let overviewWanted=false;
 $('choices').addEventListener('pointerenter',()=>{if(!overviewWanted&&map.getZoom()<=7){overviewWanted=true;ask({type:'prefetch',level:'overview'}).catch(()=>{});}});
 $('choices').addEventListener('focusin',()=>{if(!overviewWanted&&map.getZoom()<=7){overviewWanted=true;ask({type:'prefetch',level:'overview'}).catch(()=>{});}});
 L.DomEvent.disableClickPropagation($('acreage'));L.DomEvent.disableScrollPropagation($('acreage'));
})();
