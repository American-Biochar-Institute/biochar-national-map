importScripts('proj4.js','sectioned-grid.js?v=20261010-policy2','policy.js?v=20261011-liming','index-grid.js?v=20261011-rounding');
const ALBERS='+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
const DATA_HOST='https://biochar-national-data.abi-verified-api.workers.dev/',V='?v=20261011-rounding';
// The NRCS rating (the default choices) uses the published class layer; any other choice uses the
// map-unit index grid scored here with policy.js.
let dataBase=null,nrcsReady,indexReady,tableReady,nationalReady;
const asset=url=>dataBase&&url.startsWith(DATA_HOST)?dataBase+url.slice(DATA_HOST.length):url;
async function decompress(url){
 const r=await fetch(url);if(!r.ok)throw new Error('Map data unavailable');
 return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
function nrcsGrid(){
 if(!nrcsReady)nrcsReady=fetch('acreage-summary.json'+V).then(r=>{if(!r.ok)throw new Error('Summary data unavailable');return r.json();}).then(m=>{
  const counties=new Map(m.counties.map((c,i)=>[c.fips,i+1]));return {...m.grid,assetBase:asset(m.grid.assetBase),counties};});
 return nrcsReady;
}
function indexMeta(){
 if(!indexReady)indexReady=fetch('index-grid.json'+V).then(r=>{if(!r.ok)throw new Error('Adjusted-score data unavailable');return r.json();}).then(m=>({...m,assetBase:asset(m.assetBase)}));
 return indexReady;
}
function table(){
 if(!tableReady)tableReady=indexMeta().then(m=>decompress(m.assetBase+m.mapunits.path)).then(IndexGrid.decodeMapunits);
 tableReady.catch(()=>{tableReady=null;});return tableReady;
}
function national(){
 if(!nationalReady)nationalReady=indexMeta().then(m=>decompress(m.assetBase+m.acres.national)).then(b=>new Uint32Array(b.buffer,b.byteOffset,b.byteLength/4));
 nationalReady.catch(()=>{nationalReady=null;});return nationalReady;
}
// Class lookups by the set of factors counted (the same set always gives the same scores).
const luts=new Map();
async function lookup(answers){
 const on=ABIPolicy.active(answers),key=ABIPolicy.ORDER.map(k=>on[k]?1:0).join('');
 if(!luts.has(key)){const p=table().then(t=>{const t0=performance.now(),lut=IndexGrid.classLookup(ABIPolicy,t,answers);lut.ms=performance.now()-t0;return lut;});luts.set(key,p);p.catch(()=>luts.delete(key));while(luts.size>16)luts.delete(luts.keys().next().value);}
 const lut=await luts.get(key);luts.delete(key);luts.set(key,Promise.resolve(lut));return lut;
}
// Index sections: decoded and kept up to about 160 MB, least recently used first out.
const sections=new Map(),waiting=new Map();let held=0,active=0;const queue=[];
async function scheduled(fn){if(active>=6)await new Promise(resolve=>queue.push(resolve));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
async function section(level,tx,ty){
 const meta=await indexMeta(),key=level+'/'+ty+'-'+tx;
 if(sections.has(key)){const s=sections.get(key);sections.delete(key);sections.set(key,s);return s;}
 if(waiting.has(key))return waiting.get(key);
 const p=scheduled(async()=>{const s=IndexGrid.decodeSection(await decompress(meta.assetBase+key+'.bin.gz'));sections.set(key,s);held+=s.codes.byteLength;
  while(held>160e6&&sections.size>1){const [k,v]=sections.entries().next().value;sections.delete(k);held-=v.codes.byteLength;}return s;});
 waiting.set(key,p);try{return await p;}finally{waiting.delete(key);}
}
const stateTables=new Map();
function statePairs(fips){
 if(!stateTables.has(fips)){const p=indexMeta().then(m=>{if(!m.acres.states.includes(fips))throw new Error('No acreage table for this state');return decompress(m.assetBase+'acres/'+fips+'.bin.gz');}).then(IndexGrid.decodePairs);stateTables.set(fips,p);p.catch(()=>stateTables.delete(fips));}
 return stateTables.get(fips);
}
async function areaCounts(answers,state,county){
 const lut=await lookup(answers);
 if(!state)return IndexGrid.nationalCounts(await national(),lut);
 const r=IndexGrid.stateCounts(await statePairs(state),lut);if(!county)return r.state;
 const position=(await nrcsGrid()).counties.get(county);return r.counties.get(position)||[0,0,0,0,0,0,0];
}
function projectedRing(bounds){
 const [west,south,east,north]=bounds;const out=[];
 const edges=[[[west,south],[east,south]],[[east,south],[east,north]],[[east,north],[west,north]],[[west,north],[west,south]]];
 for(const [a,b] of edges){const n=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/.5));
  for(let i=0;i<n;i++){let f=i/n;out.push(proj4('EPSG:4326',ALBERS,[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]));}}
 return out;
}
// GRS80 Albers forward projection, separable by latitude and longitude.
// This uses the same EPSG:5070 projection as the acreage grid.
const rad=Math.PI/180,a=6378137,e=Math.sqrt(2/298.257222101-1/298.257222101**2),e2=e*e;
function q(phi){const s=Math.sin(phi);return (1-e2)*(s/(1-e2*s*s)-Math.log((1-e*s)/(1+e*s))/(2*e));}
function m(phi){const s=Math.sin(phi);return Math.cos(phi)/Math.sqrt(1-e2*s*s);}
const n=(m(29.5*rad)**2-m(45.5*rad)**2)/(q(45.5*rad)-q(29.5*rad));
const C=m(29.5*rad)**2+n*q(29.5*rad),rho0=a*Math.sqrt(C-n*q(23*rad))/n;
const palette=[[0,0,0,0],[247,252,245,255],[199,233,192,255],[116,196,118,255],[35,139,69,255],[0,68,27,255],[222,222,216,255]];
// By class index: 0 Negligible ... 4 Excellent, 5 unrated, 6 no adjusted score (a darker gray, never a response class).
const classPalette=palette.slice(1).concat([[150,150,143,255]]);
function tilePixels(grid,coords){
 const pixels=new Uint8ClampedArray(256*256*4),scale=256*2**coords.z;
 const sins=[],coss=[],rhos=[];
 for(let i=0;i<256;i++){
  const lon=(coords.x*256+i+.5)/scale*360-180,theta=n*(lon+96)*rad;
  sins[i]=Math.sin(theta);coss[i]=Math.cos(theta);
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y*256+i+.5)/scale)));
  rhos[i]=a*Math.sqrt(C-n*q(lat))/n;
 }
 const {origin,resolution,width,height,raster}=grid;
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){
  const col=Math.floor((rhos[y]*sins[x]-origin[0])/resolution[0]);
  const row=Math.floor((rho0-rhos[y]*coss[x]-origin[1])/resolution[1]);
  if(col<0||row<0||col>=width||row>=height)continue;
  const index=row*width+col,cls=(raster[index>>1]>>((index&1)*4))&15;
  if(!cls||!palette[cls])continue;
  pixels.set(palette[cls],(y*256+x)*4);
 }
 return pixels;
}
function projectedPixels(coords){
 const points=new Float64Array(256*256*2),scale=256*2**coords.z;
 const sins=[],coss=[],rhos=[];
 for(let i=0;i<256;i++){
  const lon=(coords.x*256+i+.5)/scale*360-180,theta=n*(lon+96)*rad;sins[i]=Math.sin(theta);coss[i]=Math.cos(theta);
  const lat=Math.atan(Math.sinh(Math.PI*(1-2*(coords.y*256+i+.5)/scale)));rhos[i]=a*Math.sqrt(C-n*q(lat))/n;
 }
 for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*2;points[i]=rhos[y]*sins[x];points[i+1]=rho0-rhos[y]*coss[x];}
 return points;
}
async function prefetch(level){
 await Promise.all([table(),national()]);
 if(level==='overview'){const meta=await indexMeta();await Promise.all(meta.overview.tiles.map(([y,x])=>section('overview',x,y)));}
}
self.onmessage=async event=>{const msg=event.data,{id,answers}=msg;try{
 if(msg.type==='config'){dataBase=msg.dataBase||null;return;}
 if(msg.type==='prefetch'){await prefetch(msg.level);self.postMessage({id,done:true});return;}
 const nrcs=ABIPolicy.isNRCS(answers);
 if(msg.type==='lookup'){const lut=await lookup(answers);self.postMessage({id,ms:lut.ms});return;}
 if(msg.type==='tile'){
  const pixels=nrcs?await Grid50.tile(await nrcsGrid(),msg.coords,palette,projectedPixels,tilePixels):
   await IndexGrid.tile(await indexMeta(),msg.coords.z,projectedPixels(msg.coords),section,await lookup(answers),classPalette);
  self.postMessage({id,pixels},[pixels.buffer]);return;
 }
 if(msg.type==='view'){
  const ring=projectedRing(msg.bounds);
  if(nrcs){self.postMessage({id,counts:await Grid50.count(await nrcsGrid(),ring),exact:true});return;}
  const meta=await indexMeta(),info=IndexGrid.levelInfo(meta,IndexGrid.level(meta,msg.zoom));
  self.postMessage({id,counts:await IndexGrid.countView(meta,info,ring,section,await lookup(answers)),exact:info.stride===1});return;
 }
 if(msg.type==='area'){self.postMessage({id,counts:await areaCounts(answers,msg.state,msg.county)});return;}
 throw new Error('Unknown request');
}catch(e){self.postMessage({id,error:e.message});}};
