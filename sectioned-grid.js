(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.Grid50=factory();})(typeof self!=='undefined'?self:this,function(){
 function intervals(polygon,y){
  const xs=[];
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
   const a=polygon[j],b=polygon[i];if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
  }
  xs.sort((a,b)=>a-b);const out=[];for(let i=0;i+1<xs.length;i+=2)out.push([xs[i],xs[i+1]]);return out;
 }
 function intersection(a,b){const out=[];for(const x of a)for(const y of b){const l=Math.max(x[0],y[0]),r=Math.min(x[1],y[1]);if(l<r)out.push([l,r]);}return out;}
 function plan(grid,polygon,hist){
  const {origin,resolution,width,height,blockSize:block,blockWidth:bw}=grid,dx=resolution[0],dy=resolution[1];
  const ys=polygon.map(p=>p[1]),r0=Math.max(0,Math.ceil((Math.max(...ys)-origin[1])/dy-.5)),r1=Math.min(height-1,Math.floor((Math.min(...ys)-origin[1])/dy-.5));
  const counts=[0,0,0,0,0,0],partial=[];
  for(let by=Math.floor(r0/block);by<=Math.floor(r1/block);by++){
   const top=origin[1]+(by*block+.5)*dy,bottom=origin[1]+(Math.min(height,(by+1)*block)-.5)*dy;
   const samples=[top,bottom,(top+bottom)/2];
   for(const [,y] of polygon)if(y>bottom&&y<top){samples.push(y);samples.push(Math.max(bottom,y-1e-7),Math.min(top,y+1e-7));}
   let inside=null,left=Infinity,right=-Infinity;
   for(const y of samples){const spans=intervals(polygon,y);inside=inside===null?spans:intersection(inside,spans);for(const [a,b]of spans){left=Math.min(left,a);right=Math.max(right,b);}}
   if(!Number.isFinite(left))continue;
   const b0=Math.max(0,Math.floor(((left-origin[0])/dx-.5)/block)),b1=Math.min(bw-1,Math.floor(((right-origin[0])/dx-.5)/block));
   for(let bx=b0;bx<=b1;bx++){
    const offset=(by*bw+bx)*6;let total=0;for(let c=0;c<6;c++)total+=hist[offset+c];if(!total)continue;
    const x0=origin[0]+(bx*block+.5)*dx,x1=origin[0]+(Math.min(width,(bx+1)*block)-.5)*dx;
    if(inside.some(([a,b])=>x0>=a&&x1<b))for(let c=0;c<6;c++)counts[c]+=hist[offset+c];
    else partial.push([bx,by]);
   }
  }
  return {counts,partial};
 }
 function blockCounts(grid,polygon,raster,bx,by){
  const {origin,resolution,width,height,blockSize:block,chunkSize:size}=grid;
  const counts=[0,0,0,0,0,0],x0=bx*block,x1=Math.min(width,x0+block),y0=by*block,y1=Math.min(height,y0+block);
  const chunkX=Math.floor(x0/size)*size,chunkY=Math.floor(y0/size)*size;
  for(let row=y0;row<y1;row++)for(const [a,b]of intervals(polygon,origin[1]+(row+.5)*resolution[1])){
   const left=Math.max(x0,Math.ceil((a-origin[0])/resolution[0]-.5)),right=Math.min(x1-1,Math.ceil((b-origin[0])/resolution[0]-.5)-1);
   for(let col=left;col<=right;col++){const index=(row-chunkY)*size+col-chunkX,cls=(raster[index>>1]>>((index&1)*4))&15;if(cls>=1&&cls<=6)counts[cls-1]++;}
  }
  return counts;
 }
 async function decompress(url){
  const r=await fetch(url);if(!r.ok)throw new Error('50 m map section unavailable');
  return new Uint8Array(await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
 }
 const cache=new Map(),waiting=new Map();let active=0;const queue=[];
 async function scheduled(fn){if(active>=6)await new Promise(resolve=>queue.push(resolve));active++;try{return await fn();}finally{active--;queue.shift()?.();}}
 async function chunk(grid,level,x,y){
  const key=grid.assetBase+level+'/'+y+'-'+x+'.bin.gz';
  if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}
  if(waiting.has(key))return waiting.get(key);
  const promise=scheduled(async()=>{const v=await decompress(key);if(v.length!==grid.chunkSize*grid.chunkSize/2)throw new Error('Incomplete 50 m map section');cache.set(key,v);while(cache.size>24)cache.delete(cache.keys().next().value);return v;});
  waiting.set(key,promise);try{return await promise;}finally{waiting.delete(key);}
 }
 async function histograms(grid){
  if(!grid.histograms)grid.histograms=decompress(grid.assetBase+'block-counts.bin.gz').then(v=>{
   if(v.length!==grid.blockWidth*grid.blockHeight*12)throw new Error('Incomplete 50 m acreage index');return new Uint16Array(v.buffer,v.byteOffset,v.byteLength/2);
  });
  return grid.histograms;
 }
 async function count(grid,polygon){
  const {counts,partial}=plan(grid,polygon,await histograms(grid)),groups=new Map();
  for(const [bx,by]of partial){const x=Math.floor(bx*grid.blockSize/grid.chunkSize),y=Math.floor(by*grid.blockSize/grid.chunkSize),key=y+'-'+x;if(!groups.has(key))groups.set(key,{x,y,blocks:[]});groups.get(key).blocks.push([bx,by]);}
  await Promise.all([...groups.values()].map(async g=>{const raster=await chunk(grid,'fine',g.x,g.y);for(const [bx,by]of g.blocks){const v=blockCounts(grid,polygon,raster,bx,by);for(let c=0;c<6;c++)counts[c]+=v[c];}}));
  return counts;
 }
 function available(grid,tx,ty,stride=1){
  if(!grid.available)grid.available=Uint8Array.from(atob(grid.availableChunks),c=>c.charCodeAt(0));
  for(let y=ty*stride;y<Math.min((ty+1)*stride,grid.chunkHeight);y++)for(let x=tx*stride;x<Math.min((tx+1)*stride,grid.chunkWidth);x++)if(grid.available[y*grid.chunkWidth+x])return true;
  return false;
 }
 async function tile(grid,coords,palette,projectedPixels,overviewTile){
  const stride=coords.z<=7?16:coords.z<=9?4:1;
  if(stride===16){
   if(!grid.overviewRaster)grid.overviewRaster=decompress(grid.assetBase+'overview.bin.gz').then(v=>{if(v.length!==Math.ceil(grid.overview.width*grid.overview.height/2))throw new Error('Incomplete overview');return v;});
   return overviewTile({...grid,width:grid.overview.width,height:grid.overview.height,resolution:[800,-800],raster:await grid.overviewRaster},coords);
  }
  const pixels=new Uint8ClampedArray(256*256*4),points=projectedPixels(coords),groups=new Map(),size=grid.chunkSize;
  const width=stride===1?grid.width:grid.medium.width,height=stride===1?grid.height:grid.medium.height;
  for(let i=0;i<points.length/2;i++){
   const px=points[i*2],py=points[i*2+1],col=Math.floor((px-grid.origin[0])/(50*stride)),row=Math.floor((py-grid.origin[1])/(-50*stride));
   if(col<0||row<0||col>=width||row>=height)continue;
   const tx=Math.floor(col/size),ty=Math.floor(row/size);if(!available(grid,tx,ty,stride))continue;
   const key=ty+'-'+tx;if(!groups.has(key))groups.set(key,{x:tx,y:ty,pixels:[]});groups.get(key).pixels.push([i,(row%size)*size+col%size]);
  }
  await Promise.all([...groups.values()].map(async g=>{const raster=await chunk(grid,stride===1?'fine':'medium',g.x,g.y);for(const [i,j]of g.pixels){const cls=(raster[j>>1]>>((j&1)*4))&15;if(cls&&palette[cls])pixels.set(palette[cls],i*4);}}));
  return pixels;
 }
 return {intervals,plan,blockCounts,count,tile};
});
