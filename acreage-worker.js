importScripts('proj4.js');
const ALBERS='+proj=aea +lat_1=29.5 +lat_2=45.5 +lat_0=23 +lon_0=-96 +x_0=0 +y_0=0 +datum=NAD83 +units=m +no_defs';
let ready;
async function load(){
 const metadata=await (await fetch('acreage-summary.json')).json();
 const response=await fetch(metadata.grid.path);
 if(!response.ok)throw new Error('Acreage grid unavailable');
 const stream=response.body.pipeThrough(new DecompressionStream('gzip'));
 const raster=new Uint8Array(await new Response(stream).arrayBuffer());
 if(raster.length!==Math.ceil(metadata.grid.width*metadata.grid.height/2))throw new Error('Incomplete acreage grid');
 return {raster,...metadata.grid};
}
ready=load();
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
self.onmessage=async event=>{const {id,bounds}=event.data;try{const grid=await ready;self.postMessage({id,counts:countCells(grid,projectedRing(bounds))});}catch(e){self.postMessage({id,error:e.message});}};

