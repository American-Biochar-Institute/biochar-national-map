/* ABI adjusted response score policy, version 2 (October 10, 2026).
 * Shared by the national map, the field (AOI) tool and the national build.
 * Matches the Biochar Response Rating Explorer:
 *  - With the default answers every factor counts, and the score IS the NRCS published rating.
 *  - Drained = yes leaves out the water table and ponding checks.
 *  - Raise pH = no leaves out soil pH. Since October 11, 2026 the public question is whether the
 *    biochar has a meaningful liming value (answers.raisePH keeps its name: 'no' = little liming value).
 *  - Group 1 (slope, flooding, cobbles and stones, shrink-swell) can be left out all at once
 *    or one factor at a time.
 *  - A left-out site check counts as no limit (1.0). A left-out soil property is removed and
 *    the soil properties still counted share the points (0.15 x 7 / number counted), so a
 *    left-out property can lower a score as well as raise it.
 *  - Rounding (October 11, 2026, Brandon Smith): the engine "reproduces" a published rating when
 *    its all-factors result is within MATCH_TOLERANCE (0.005, the same hundredth). For such soils,
 *    choices that do not change the computed score keep the published rating, so a soil NRCS rates
 *    0.751 is not shown as 0.750 when its own factors are untouched.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ABIPolicy=factory();})(typeof self!=='undefined'?self:this,function(){
 'use strict';
 const SITE=['wt','slope','pond','flood','cobble','karst'];
 const DYN=['awc','bd','ksat','lep','meq','oc','ph'];
 const ORDER=SITE.concat(DYN); // column order for national per-map-unit tables
 const GROUP1=['slope','flood','cobble','lep'];
 const DEFAULTS=Object.freeze({drained:'no',raisePH:'yes',group1All:false,keep:Object.freeze({slope:true,flood:true,cobble:true,lep:true})});
 const MATCH_TOLERANCE=0.005;
 const LABELS={wt:'Water table',slope:'Slope',pond:'Ponding',flood:'Flooding',cobble:'Cobbles and stones',karst:'Karst',awc:'Water-holding capacity',bd:'Compaction',ksat:'Drainage rate',lep:'Shrink-swell',meq:'Nutrient-holding capacity',oc:'Soil organic carbon',ph:'Soil pH'};
 function normalize(a){
  a=a||{};const keep=Object.assign({},DEFAULTS.keep,a.keep||{});
  return {drained:a.drained==='yes'?'yes':'no',raisePH:a.raisePH==='no'?'no':'yes',group1All:!!a.group1All,keep:keep};
 }
 function active(answers){
  const a=normalize(answers),on={};ORDER.forEach(k=>on[k]=true);
  if(a.drained==='yes'){on.wt=false;on.pond=false;}
  if(a.raisePH==='no')on.ph=false;
  GROUP1.forEach(k=>{if(a.group1All||a.keep[k]===false)on[k]=false;});
  return on;
 }
 function isNRCS(answers){const on=active(answers);return ORDER.every(k=>on[k]);}
 function round3(v){return Math.round(v*1000)/1000;}
 // values: {key: grade 0..1}; on: output of active(). Returns 0..1 or null.
 function scoreValues(values,on){
  let site=1;for(const k of SITE){if(!on[k])continue;const v=values[k];if(v===null||v===undefined||!Number.isFinite(+v))return null;site=Math.min(site,+v);}
  const kept=DYN.filter(k=>on[k]);if(!kept.length)return null;
  let sum=0;for(const k of kept){const v=values[k];if(v===null||v===undefined||!Number.isFinite(+v))return null;sum+=+v;}
  return round3(Math.min(site,Math.min(1,0.15*DYN.length/kept.length*sum)));
 }
 // engine model from BiocharEngine.buildComponent. Defaults return the NRCS published rating.
 function score(engine,model,answers){
  if(!model||!model.top||model.top.rep===null||model.top.rep===undefined)return null;
  if(isNRCS(answers))return round3(+model.top.rep);
  return keepPublished(scoreValues(model.base,active(answers)),model.base,+model.top.rep);
 }
 // A choice that leaves the computed score unchanged keeps the published rating, when the engine
 // matches that rating to the hundredth.
 function keepPublished(s,values,published){
  if(s===null)return null;
  const all=scoreValues(values,active(DEFAULTS));
  return all!==null&&Math.abs(all-published)<=MATCH_TOLERANCE+1e-9&&Math.abs(s-all)<1e-9?round3(published):s;
 }
 // National table row: base = array of 13 grades in ORDER (or null), published = NRCS rating.
 function scoreRow(base,published,answers){
  if(published===null||published===undefined||!Number.isFinite(+published))return null;
  if(isNRCS(answers))return round3(+published);
  if(!base)return null;
  const values={};ORDER.forEach((k,i)=>values[k]=base[i]);
  return keepPublished(scoreValues(values,active(answers)),values,+published);
 }
 function classIndex(r){if(r===null||r===undefined||!Number.isFinite(+r))return 5;return r<=0?0:r<=.25?1:r<=.5?2:r<=.75?3:4;}
 // Plain-language summary of the current choices for status lines and CSV exports.
 function describe(answers){
  const a=normalize(answers),out=[];
  if(isNRCS(a))return 'Same as the NRCS rating: every factor counts.';
  if(a.drained==='yes')out.push('drained land (water table and ponding left out)');
  if(a.raisePH==='no')out.push('biochar with little liming value (soil pH left out)');
  const g=GROUP1.filter(k=>a.group1All||a.keep[k]===false).map(k=>LABELS[k].toLowerCase());
  if(g.length)out.push((g.length>2?g.slice(0,-1).join(', ')+', and '+g[g.length-1]:g.join(' and '))+' treated as application notes');
  return 'Adjusted score: '+out.join('; ')+'.';
 }
 return {version:2,revision:'2026-10-11 rounding, liming question',MATCH_TOLERANCE,keepPublished,SITE,DYN,ORDER,GROUP1,DEFAULTS,LABELS,normalize,active,isNRCS,scoreValues,score,scoreRow,classIndex,describe};
});
