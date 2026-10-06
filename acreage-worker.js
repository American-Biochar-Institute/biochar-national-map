importScripts('proj4.js');
const ALBERS='+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
let loadedName,ready;
async function load(name='nrcs'){
 const path=name==='nrcs'?'acreage-summary.json':'exploratory/'+name+'-summary.json';
 const metadata=await (await fetch(path)).json();
 const response=await fetch(metadata.grid.path);
 if(!response.ok)throw new Error('Acreage grid unavailable');
 const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
 const raster=new Uint8Array(await new Response(stream).arrayBuffer());
 if(raster.length!==Math.ceil(metadata.grid.width*metadata.grid.height/2))throw new Error('Incomplete acreage grid');
 return {raster,...metadata.grid};
}
function getGrid(name='nrcs'){
 if(!['nrcs','no-yes','no-no','yes-yes','yes-no'].includes(name))throw new Error('Unknown scenario');
 if(name!==loadedName){loadedName=name;ready=load(name);}
 return ready;
}
function projectedRing(bounds){
 const [west,south,east,north]=bounds;const out=[];
 const edges=[[[west,south],[east,south]],[[east,south],[east,north]],[[east,north],[west,north]],[[west,north],[west,south]]];
 for(const [a,b] of edges){const n=Math.max(1,Math.ceil(Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]))/.5));
  for(let i=0;i<n;i++){let f=i/n;out.push(proj4('EPSG:4326',ALBERS,[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]));}}
 return out;
}
function countCells(grid,polygon){
 const {raster,width,height,origin,resolution}=grid;const counts=[0,0,0,0,0,0];
 const dx=resolution[0],dy=resolution[1];let ymin=Infinity,ymax=-Infinity;
 for(const p of polygon){ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);}
 let r0=Math.max(0,Math.ceil((ymax-origin[1])/dy-.5)),r1=Math.min(height-1,Math.floor((ymin-origin[1])/dy-.5));
 for(let row=r0;row<=r1;row++){
  const y=origin[1]+(row+.5)*dy, intersections=[];
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
   const a=polygon[j],b=polygon[i];if((a[1]>y)!==(b[1]>y))intersections.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
  intersections.sort((a,b)=>a-b);
  for(let k=0;k+1<intersections.length;k+=2){
   const left=Math.max(0,Math.ceil((intersections[k]-origin[0])/dx-.5)),right=Math.min(width-1,Math.ceil((intersections[k+1]-origin[0])/dx-.5)-1);
   const end=row*width+right;
   for(let idx=row*width+left;idx<=end;idx++){const cls=(raster[idx>>1]>>((idx&1)*4))&15;if(cls>=1&&cls<=6)counts[cls-1]++;}
  }
 }
 return counts;
}
// GRS80 Albers forward projection, separable by latitude and longitude.
// This uses the same EPSG:5070 projection as the acreage grid.
const rad=Math.PI/180,a=6378137,e=Math.sqrt(2/298.257222101-1/298.257222101**2),e2=e*e;
function q(phi){const s=Math.sin(phi);return (1-e2)*(s/(1-e2*s*s)-Math.log((1-e*s)/(1+e*s))/(2*e));}
function m(phi){const s=Math.sin(phi);return Math.cos(phi)/Math.sqrt(1-e2*s*s);}
const n=(m(29.5*rad)**2-m(45.5*rad)**2)/(q(45.5*rad)-q(29.5*rad));
const C=m(29.5*rad)**2+n*q(29.5*rad),rho0=a*Math.sqrt(C-n*q(23*rad))/n;
function albers(lon,lat){const rho=a*Math.sqrt(C-n*q(lat*rad))/n,theta=n*(lon+96)*rad;return [rho*Math.sin(theta),rho0-rho*Math.cos(theta)];}
const palette=[[0,0,0,0],[247,252,245,255],[199,233,192,255],[116,196,118,255],[35,139,69,255],[0,68,27,255],[222,222,216,255]];
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
self.onmessage=async event=>{const {id,bounds,scenario,coords}=event.data;try{
 const grid=await getGrid(scenario);
 if(coords){const pixels=tilePixels(grid,coords);self.postMessage({id,pixels},[pixels.buffer]);}
 else self.postMessage({id,counts:countCells(grid,projectedRing(bounds))});
}catch(e){self.postMessage({id,error:e.message});}};

