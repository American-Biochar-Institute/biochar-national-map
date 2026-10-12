/* Map-unit index grid for adjusted scores (policy v2, October 10, 2026).
 * Decodes mapunits.bin.gz, the index sections and the acreage tables written by build_index30_assets.py
 * and build_mapunit_table.cjs, and scores every map unit with ABIPolicy in the browser.
 * Class index: 0 Negligible, 1 Low, 2 Fair, 3 Good, 4 Excellent, 5 unrated (no NRCS rating),
 * 6 no adjusted score (rated by NRCS, but the engine cannot reproduce the rating; non-default choices only).
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.IndexGrid=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const NONE=65535,EXACT=65534;
 // mapunits.bin: 'ABIMU2\0\0', uint32 N, uint32 E, float64 exact[E], uint32 mukey[N], uint16 published[N], uint16 grade[N*13].
 function decodeMapunits(bytes){
  const b=bytes.buffer,o=bytes.byteOffset,v=new DataView(b,o,bytes.byteLength);
  if(String.fromCharCode(...bytes.subarray(0,6))!=='ABIMU2')throw new Error('Map-unit table format not recognized');
  const N=v.getUint32(8,true),E=v.getUint32(12,true);let p=16;
  const exact=new Float64Array(b.slice(o+p,o+p+E*8));p+=E*8;
  const mukeys=new Uint32Array(b.slice(o+p,o+p+N*4));p+=N*4;for(let i=1;i<N;i++)mukeys[i]+=mukeys[i-1];
  const pub=new Uint16Array(b.slice(o+p,o+p+N*2));p+=N*2;
  const grade=new Uint16Array(b.slice(o+p,o+p+N*26));p+=N*26;
  if(p!==bytes.byteLength)throw new Error('Incomplete map-unit table');
  const published=new Array(N),bases=new Array(N);let e=0;
  for(let i=0;i<N;i++){
   published[i]=pub[i]===NONE?null:pub[i]/1000;
   if(grade[i*13]===NONE){bases[i]=null;continue;}
   const g=new Array(13);for(let j=0;j<13;j++){const c=grade[i*13+j];g[j]=c===EXACT?exact[e++]:c/1000;}bases[i]=g;
  }
  if(e!==E)throw new Error('Map-unit table exceptions do not match');
  return {count:N,mukeys,published,bases};
 }
 // Same branches as ABIPolicy.scoreRow, with isNRCS and active worked out once per set of choices.
 function classLookup(P,table,answers){
  const N=table.count,lut=new Uint8Array(N+1),nrcs=P.isNRCS(answers),on=P.active(answers),values={},ORDER=P.ORDER,tol=(P.MATCH_TOLERANCE||0)+1e-9;
  // All-factors score per map unit, worked out once: a choice that leaves it unchanged keeps the
  // published rating when the two match to the hundredth (policy.js keepPublished).
  if(!table.allOn&&tol>1e-9){const allOn=new Float64Array(N).fill(NaN),every=P.active(P.DEFAULTS);for(let i=0;i<N;i++){const b=table.bases[i];if(!b)continue;for(let j=0;j<13;j++)values[ORDER[j]]=b[j];const v=P.scoreValues(values,every);if(v!==null)allOn[i]=v;}table.allOn=allOn;}
  lut[0]=5;
  for(let i=0;i<N;i++){
   const p=table.published[i];let s;
   if(p===null||p===undefined||!Number.isFinite(+p))s=null;
   else if(nrcs)s=Math.round(+p*1000)/1000;
   else if(!table.bases[i]){lut[i+1]=6;continue;}
   else{const b=table.bases[i];for(let j=0;j<13;j++)values[ORDER[j]]=b[j];s=P.scoreValues(values,on);if(s===null){lut[i+1]=6;continue;}
    if(table.allOn&&Math.abs(table.allOn[i]-p)<=tol&&Math.abs(s-table.allOn[i])<1e-9)s=Math.round(+p*1000)/1000;}
   lut[i+1]=P.classIndex(s);
  }
  return lut;
 }
 // Section: 'MUI1', uint32 K, uint32 code bytes, uint32 side, uint32 palette[K], codes[side*side].
 function decodeSection(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,16);
  if(v.getUint32(0,true)!==0x3149554d)throw new Error('Map section format not recognized');
  const K=v.getUint32(4,true),cb=v.getUint32(8,true),side=v.getUint32(12,true),start=bytes.byteOffset+16+K*4;
  if(bytes.byteLength!==16+K*4+side*side*cb||bytes.byteOffset%4)throw new Error('Incomplete map section');
  const palette=new Uint32Array(bytes.buffer,bytes.byteOffset+16,K);
  const codes=cb===1?new Uint8Array(bytes.buffer,start,side*side):cb===2?new Uint16Array(bytes.buffer,start,side*side):new Uint32Array(bytes.buffer,start,side*side);
  return {K,side,palette,codes,classes:null,lut:null};
 }
 // Per-section class by local code (255 = outside the mapped counties), cached for the current lookup.
 function sectionClasses(section,lut){
  if(section.lut!==lut){const c=new Uint8Array(section.K+1);c[0]=255;for(let i=0;i<section.K;i++)c[i+1]=lut[section.palette[i]];section.classes=c;section.lut=lut;}
  return section.classes;
 }
 // acres/<state>.bin: 'ACR1', uint32 M, uint32 county[M], dense[M], cells[M].
 function decodePairs(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,8);if(v.getUint32(0,true)!==0x31524341)throw new Error('Acreage table format not recognized');
  const M=v.getUint32(4,true);if(bytes.byteLength!==8+M*12)throw new Error('Incomplete acreage table');
  const b=bytes.buffer.slice(bytes.byteOffset+8,bytes.byteOffset+8+M*12);
  return {county:new Uint32Array(b,0,M),dense:new Uint32Array(b,M*4,M),cells:new Uint32Array(b,M*8,M)};
 }
 function nationalCounts(cells,lut){const out=[0,0,0,0,0,0,0];for(let i=0;i<cells.length;i++)out[lut[i]]+=cells[i];return out;}
 // counts by 1-based county position, and the state total.
 function stateCounts(pairs,lut){
  const counties=new Map(),state=[0,0,0,0,0,0,0];
  for(let i=0;i<pairs.county.length;i++){
   const c=pairs.county[i],k=lut[pairs.dense[i]],n=pairs.cells[i];
   let a=counties.get(c);if(!a){a=[0,0,0,0,0,0,0];counties.set(c,a);}a[k]+=n;state[k]+=n;
  }
  return {state,counties};
 }
 function intervals(polygon,y){
  const xs=[];
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j],b=polygon[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
  xs.sort((a,b)=>a-b);const out=[];for(let i=0;i+1<xs.length;i+=2)out.push([xs[i],xs[i+1]]);return out;
 }
 function level(meta,z){return z<=7?'overview':z<=9?'medium':'fine';}
 function levelInfo(meta,name){
  if(name==='fine')return {name,stride:1,side:meta.fine.side,width:meta.width,height:meta.height};
  const l=meta[name];return {name,stride:l.stride,side:l.side,width:l.width,height:l.height};
 }
 function has(meta,info,tx,ty){
  if(info.name==='fine'){
   if(!meta._fine)meta._fine=typeof atob==='function'?Uint8Array.from(atob(meta.fine.availableChunks),c=>c.charCodeAt(0)):Uint8Array.from(Buffer.from(meta.fine.availableChunks,'base64'));
   return tx>=0&&ty>=0&&tx<meta.fine.chunkWidth&&ty<meta.fine.chunkHeight&&meta._fine[ty*meta.fine.chunkWidth+tx]===1;
  }
  const key='_'+info.name;if(!meta[key])meta[key]=new Set(meta[info.name].tiles.map(t=>t[0]+'-'+t[1]));
  return meta[key].has(ty+'-'+tx);
 }
 // Class counts of the cells whose centers fall inside an Albers polygon, at one level.
 // Each cell counts stride^2 native cells, so only the fine level is exact at 30 m.
 async function countView(meta,info,polygon,load,lut){
  const counts=[0,0,0,0,0,0,0],dx=meta.resolution[0]*info.stride,dy=meta.resolution[1]*info.stride,ox=meta.origin[0],oy=meta.origin[1],side=info.side;
  let ymin=Infinity,ymax=-Infinity;for(const p of polygon){ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);}
  const r0=Math.max(0,Math.ceil((ymax-oy)/dy-.5)),r1=Math.min(info.height-1,Math.floor((ymin-oy)/dy-.5));
  const rows=new Map();
  for(let row=r0;row<=r1;row++){
   for(const [a,b] of intervals(polygon,oy+(row+.5)*dy)){
    const left=Math.max(0,Math.ceil((a-ox)/dx-.5)),right=Math.min(info.width-1,Math.ceil((b-ox)/dx-.5)-1);
    for(let tx=Math.floor(left/side);tx<=Math.floor(right/side);tx++){
     const ty=Math.floor(row/side);if(!has(meta,info,tx,ty))continue;
     const key=ty+'-'+tx;if(!rows.has(key))rows.set(key,{tx,ty,spans:[]});
     rows.get(key).spans.push([row,Math.max(left,tx*side),Math.min(right,tx*side+side-1)]);
    }
   }
  }
  const weight=info.stride*info.stride;
  await Promise.all([...rows.values()].map(async g=>{
   const s=await load(info.name,g.tx,g.ty),cls=sectionClasses(s,lut),codes=s.codes;
   for(const [row,l,r] of g.spans){const base=(row-g.ty*side)*side-g.tx*side;for(let col=l;col<=r;col++){const k=cls[codes[base+col]];if(k!==255)counts[k]+=weight;}}
  }));
  return counts;
 }
 // RGBA pixels for a 256 px tile from projected pixel centers (Albers x,y pairs).
 async function tile(meta,z,points,load,lut,palette){
  const info=levelInfo(meta,level(meta,z)),pixels=new Uint8ClampedArray(256*256*4),groups=new Map(),side=info.side;
  const dx=meta.resolution[0]*info.stride,dy=meta.resolution[1]*info.stride;
  for(let i=0;i<points.length/2;i++){
   const col=Math.floor((points[i*2]-meta.origin[0])/dx),row=Math.floor((points[i*2+1]-meta.origin[1])/dy);
   if(col<0||row<0||col>=info.width||row>=info.height)continue;
   const tx=Math.floor(col/side),ty=Math.floor(row/side);if(!has(meta,info,tx,ty))continue;
   const key=ty+'-'+tx;if(!groups.has(key))groups.set(key,{tx,ty,pixels:[]});groups.get(key).pixels.push(i,(row%side)*side+col%side);
  }
  await Promise.all([...groups.values()].map(async g=>{
   const s=await load(info.name,g.tx,g.ty),cls=sectionClasses(s,lut);
   for(let k=0;k<g.pixels.length;k+=2){const c=cls[s.codes[g.pixels[k+1]]];if(c!==255)pixels.set(palette[c],g.pixels[k]*4);}
  }));
  return pixels;
 }
 return {decodeMapunits,classLookup,decodeSection,sectionClasses,decodePairs,nationalCounts,stateCounts,countView,tile,level,levelInfo,has,intervals};
});
