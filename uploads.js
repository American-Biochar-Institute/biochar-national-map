/* Field boundary uploads for the public map (October 2026).
 * Reads a zipped shapefile (.zip with .shp, .shx, .dbf, .prj), GeoJSON (.geojson, .json), KML or KMZ
 * in the browser and returns fields as WGS84 GeoJSON Polygon or MultiPolygon geometries.
 * No third-party parsers: zip entries are inflated with the browser's DecompressionStream, and
 * shapefiles are reprojected from their .prj with the bundled proj4.js.
 * API: BoundaryUploads.read(file) -> Promise<{fields:[{name, geometry}], skipped, notes:[]}>
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BoundaryUploads=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const NAME_KEYS=['name','field','field_name','fieldname','fld_name','label','title','id'];

 // ---- zip ----
 async function inflate(bytes){
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
 }
 async function unzip(buffer){
  const bytes=new Uint8Array(buffer),v=new DataView(buffer);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('This .zip file could not be read.');
  const count=v.getUint16(end+10,true);let p=v.getUint32(end+16,true);const files=new Map();
  for(let n=0;n<count;n++){
   if(v.getUint32(p,true)!==0x02014b50)throw new Error('This .zip file could not be read.');
   const method=v.getUint16(p+10,true),size=v.getUint32(p+20,true),nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true);
   const name=new TextDecoder().decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment;
   if(name.endsWith('/')||/(^|\/)__MACOSX\//.test(name))continue;
   const start=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true),data=bytes.subarray(start,start+size);
   if(method!==0&&method!==8)throw new Error('This .zip uses a compression method the map cannot read. Re-save it as a standard .zip.');
   files.set(name,{method,data});
  }
  return {names:[...files.keys()],read:async name=>{const f=files.get(name);return f.method===0?f.data:inflate(f.data);}};
 }

 // ---- shapefile ----
 function ringArea(r){let a=0;for(let i=0,j=r.length-1;i<r.length;j=i++)a+=(r[i][0]-r[j][0])*(r[i][1]+r[j][1]);return a/2;} // > 0 clockwise
 function inside(pt,r){let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;}
 // Shapefile rings: clockwise outer rings, counterclockwise holes. Each hole joins the smallest outer ring
 // that contains it, so a pond on an island inside a lake belongs to the island (audit finding A2).
 function polygonFromRings(rings){
  const outers=[],holes=[];
  for(const r of rings){if(r.length<4)continue;(ringArea(r)>=0?outers:holes).push(r);}
  if(!outers.length&&holes.length)outers.push(...holes.splice(0).map(r=>r.slice().reverse()));
  const polys=outers.map(o=>[o.slice().reverse()]); // GeoJSON outer rings run counterclockwise
  for(const h of holes){
   let owner=null,best=Infinity;
   for(const p of polys)if(h.every(pt=>inside(pt,p[0])||p[0].some(q=>q[0]===pt[0]&&q[1]===pt[1]))){const a=Math.abs(ringArea(p[0]));if(a<best){best=a;owner=p;}}
   if(owner)owner.push(h.slice().reverse());
  }
  if(!polys.length)return null;
  return polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys};
 }
 function readShp(buffer){
  const v=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),out=[];
  if(v.getInt32(0,false)!==9994)throw new Error('The .shp file is not a shapefile.');
  const type=v.getInt32(32,true);
  if(![5,15,25].includes(type))throw new Error('The shapefile holds '+({1:'points',3:'lines',8:'multipoints',11:'points',13:'lines',21:'points',23:'lines'}[type]||'shapes')+', not field polygons.');
  let p=100;const end=Math.min(buffer.byteLength,v.getInt32(24,false)*2);
  while(p+8<=end){
   const len=v.getInt32(p+4,false)*2,s=p+8;p=s+len;
   if(v.getInt32(s,true)===0){out.push(null);continue;}
   const nParts=v.getInt32(s+36,true),nPoints=v.getInt32(s+40,true),parts=[];
   for(let i=0;i<nParts;i++)parts.push(v.getInt32(s+44+i*4,true));
   const pts=s+44+nParts*4,rings=[];
   for(let i=0;i<nParts;i++){const a=parts[i],b=i+1<nParts?parts[i+1]:nPoints,ring=[];for(let k=a;k<b;k++)ring.push([v.getFloat64(pts+k*16,true),v.getFloat64(pts+k*16+8,true)]);rings.push(ring);}
   out.push(polygonFromRings(rings));
  }
  return out;
 }
 function readDbf(buffer,encoding){
  const v=new DataView(buffer.buffer,buffer.byteOffset,buffer.byteLength),n=v.getUint32(4,true),headLen=v.getUint16(8,true),recLen=v.getUint16(10,true),fields=[];
  let decoder;try{decoder=new TextDecoder(encoding||'utf-8',{fatal:!encoding});}catch{decoder=new TextDecoder('utf-8');}
  const latin=new TextDecoder('windows-1252'),text=b=>{try{return decoder.decode(b);}catch{return latin.decode(b);}};
  for(let p=32;p<headLen-1&&buffer[p]!==0x0d;p+=32){let name='';for(let i=0;i<11&&buffer[p+i];i++)name+=String.fromCharCode(buffer[p+i]);fields.push({name,len:buffer[p+16]});}
  const rows=[];
  for(let r=0;r<n;r++){let p=headLen+r*recLen+1;const row={};for(const f of fields){row[f.name]=text(buffer.subarray(p,p+f.len)).trim();p+=f.len;}rows.push(row);}
  return rows;
 }
 function nameFrom(props,fallback){
  if(props){const keys=Object.keys(props);for(const want of NAME_KEYS){const k=keys.find(k=>k.toLowerCase()===want);if(k&&props[k]!==null&&props[k]!==undefined&&String(props[k]).trim())return String(props[k]).trim().slice(0,60);}}
  return fallback;
 }
 function reproject(geom,prj){
  if(!prj||!prj.trim())return geom;
  if(/GEOGCS\[[^\]]*WGS[ _]?84|GCS_WGS_1984|GEOGCS\["GCS_North_American_1983"/i.test(prj)&&!/PROJCS/i.test(prj))return geom;
  if(typeof proj4!=='function')throw new Error('Map projection support is unavailable.');
  let t;try{t=proj4(prj,'EPSG:4326');}catch{throw new Error('The .prj projection could not be read. Save the boundaries in WGS 84 (EPSG:4326) and try again.');}
  const ring=r=>r.map(p=>t.forward([p[0],p[1]]));
  return geom.type==='Polygon'?{type:'Polygon',coordinates:geom.coordinates.map(ring)}:{type:'MultiPolygon',coordinates:geom.coordinates.map(p=>p.map(ring))};
 }
 async function readZip(buffer,fileName){
  const zip=await unzip(buffer),lower=new Map(zip.names.map(n=>[n.toLowerCase(),n]));
  const kml=zip.names.find(n=>/\.kml$/i.test(n));
  const shps=zip.names.filter(n=>/\.shp$/i.test(n));
  if(!shps.length){
   if(kml)return readKml(new TextDecoder().decode(await zip.read(kml)),fileName);
   const gj=zip.names.find(n=>/\.(geo)?json$/i.test(n));if(gj)return readGeoJSON(new TextDecoder().decode(await zip.read(gj)),fileName);
   throw new Error('No shapefile (.shp) was found in this .zip.');
  }
  const fields=[],notes=[];let skipped=0;
  for(const shp of shps){
   const base=shp.slice(0,-4).toLowerCase(),get=ext=>lower.get(base+ext);
   if(!get('.dbf'))notes.push(shp+' has no .dbf file, so field names were not read.');
   if(!get('.prj'))notes.push(shp+' has no .prj file. Coordinates are read as longitude and latitude (WGS 84).');
   const geoms=readShp(await zip.read(shp));
   const cpg=get('.cpg')?new TextDecoder().decode(await zip.read(get('.cpg'))).trim():'';
   const enc=/utf-?8/i.test(cpg)?'utf-8':/1252|latin/i.test(cpg)?'windows-1252':'';
   const rows=get('.dbf')?readDbf(await zip.read(get('.dbf')),enc):[];
   const prj=get('.prj')?new TextDecoder().decode(await zip.read(get('.prj'))):'';
   const label=shp.split('/').pop().slice(0,-4);
   geoms.forEach((g,i)=>{if(!g){skipped++;return;}fields.push({name:nameFrom(rows[i],shps.length>1?label+' '+(i+1):null),geometry:reproject(g,prj)});});
  }
  return {fields,skipped,notes};
 }

 // ---- GeoJSON ----
 function collect(geom,props,out,state){
  if(!geom){state.skipped++;return;}
  if(geom.type==='Polygon'||geom.type==='MultiPolygon')out.push({name:nameFrom(props,null),geometry:{type:geom.type,coordinates:geom.coordinates}});
  else if(geom.type==='GeometryCollection'){const polys=[];for(const g of geom.geometries||[])if(g.type==='Polygon')polys.push(g.coordinates);else if(g.type==='MultiPolygon')polys.push(...g.coordinates);else state.skipped++;if(polys.length)out.push({name:nameFrom(props,null),geometry:polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys}});}
  else state.skipped++;
 }
 function readGeoJSON(text){
  let j;try{j=JSON.parse(text);}catch{throw new Error('This GeoJSON file could not be read.');}
  const out=[],state={skipped:0},notes=[];
  const name=j.crs?.properties?.name||'';
  if(name&&!/4326|CRS84/i.test(name))notes.push('The file lists the coordinate system '+name+'. GeoJSON should use longitude and latitude (WGS 84); check the fields on the map.');
  if(j.type==='FeatureCollection')for(const f of j.features||[])collect(f.geometry,f.properties,out,state);
  else if(j.type==='Feature')collect(j.geometry,j.properties,out,state);
  else collect(j,null,out,state);
  return {fields:out,skipped:state.skipped,notes};
 }

 // ---- KML ----
 // Elements are matched by local name in any namespace, so <Placemark> and <k:Placemark> both work (audit finding A7).
 const tags=(el,name)=>el.getElementsByTagNameNS('*',name);
 function kmlRing(el){
  const c=el&&tags(el,'coordinates')[0];if(!c)return null;
  const pts=c.textContent.trim().split(/\s+/).map(t=>t.split(',').slice(0,2).map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));
  return pts.length>=3?pts:null;
 }
 function readKml(text){
  const doc=new DOMParser().parseFromString(text,'application/xml');
  if(doc.getElementsByTagName('parsererror').length||tags(doc,'parsererror').length)throw new Error('This KML file could not be read.');
  const out=[];let skipped=0;
  for(const pm of tags(doc,'Placemark')){
   const polys=[];
   for(const pg of tags(pm,'Polygon')){
    const outer=kmlRing(tags(pg,'outerBoundaryIs')[0]);if(!outer)continue;
    const rings=[outer];for(const ib of tags(pg,'innerBoundaryIs')){const r=kmlRing(ib);if(r)rings.push(r);}
    polys.push(rings);
   }
   if(!polys.length){skipped++;continue;}
   const nm=[...tags(pm,'name')].find(n=>n.parentNode===pm)?.textContent.trim()||null;
   out.push({name:nm?nm.slice(0,60):null,geometry:polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys}});
  }
  return {fields:out,skipped,notes:[]};
 }

 // ---- clean-up shared by every format ----
 function closeRing(r){
  const out=[];for(const p of r){if(!Array.isArray(p)||!Number.isFinite(+p[0])||!Number.isFinite(+p[1]))return [];const q=[+(+p[0]).toFixed(7),+(+p[1]).toFixed(7)];const last=out[out.length-1];if(!last||last[0]!==q[0]||last[1]!==q[1])out.push(q);}
  if(out.length&&(out[0][0]!==out[out.length-1][0]||out[0][1]!==out[out.length-1][1]))out.push(out[0].slice());
  return out;
 }
 // Returns {geometry, dropped}: parts whose outer boundary has fewer than three distinct corners or
 // non-numeric coordinates are dropped and counted (audit finding A3). Unusable holes are dropped.
 function tidy(geom){
  let dropped=0;
  const polys=(geom.type==='Polygon'?[geom.coordinates]:geom.coordinates).map(p=>{
   const outer=Array.isArray(p)&&Array.isArray(p[0])?closeRing(p[0]):[];
   if(outer.length<4){dropped++;return null;}
   return [outer,...p.slice(1).map(closeRing).filter(r=>r.length>=4)];
  }).filter(Boolean);
  if(!polys.length)return {geometry:null,dropped};
  for(const p of polys)for(const r of p)for(const q of r)if(q[0]<-180||q[0]>180||q[1]<-85||q[1]>85)throw new Error('Some coordinates are not longitude and latitude. Include the .prj file, or save the boundaries in WGS 84.');
  return {geometry:polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys},dropped};
 }
 async function read(file){
  const name=file.name||'',lower=name.toLowerCase();let r;
  if(/\.(zip|kmz)$/.test(lower))r=await readZip(await file.arrayBuffer(),name);
  else if(/\.(geo)?json$/.test(lower))r=readGeoJSON(await file.text());
  else if(/\.kml$/.test(lower))r=readKml(await file.text());
  else if(/\.(shp|dbf|shx|prj)$/.test(lower))throw new Error('Put the shapefile parts (.shp, .shx, .dbf, .prj) together in one .zip file and upload the .zip.');
  else throw new Error('Upload a .zip shapefile, a GeoJSON (.geojson or .json) or a KML file.');
  const fields=[],notes=r.notes||[];let skipped=r.skipped||0,dropped=0;
  for(const f of r.fields){const t=tidy(f.geometry);dropped+=t.dropped;if(t.geometry)fields.push({name:f.name,geometry:t.geometry});else skipped++;}
  if(dropped)notes.push(name+': '+dropped+' polygon'+(dropped===1?' was':'s were')+' left out because '+(dropped===1?'its':'their')+' outside boundary has fewer than three corners or unreadable coordinates.');
  return {fields,skipped,notes};
 }
 return {read,readShp,readDbf,readGeoJSON,readKml,unzip,polygonFromRings,tidy};
});
