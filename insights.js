(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BiocharInsights=factory();})(typeof self!=='undefined'?self:this,function(){
 const descriptions={
  awc:{label:'Water available to plants',text:'This estimates how much water the soil can store for plants. Soils that store less water may have more room to benefit from biochar.'},
  bd:{label:'Compaction and soil structure',text:'This index describes how dense the soil is for its texture. Higher values suggest more compaction. It does not tell us how much biochar would reduce compaction.'},
  ksat:{label:'Water movement through soil',text:'This describes how quickly water moves through saturated soil. It does not predict how biochar would change that rate.'},
  lep:{label:'Soil shrinking and swelling',text:'This describes how much soil changes size as it wets and dries. It does not show whether biochar would reduce shrinking and swelling.'},
  meq:{label:'Nutrient-holding capacity',text:'This estimates the soil\'s ability to hold nutrients. A low value suggests more room to improve nutrient retention.'},
  oc:{label:'Carbon stored in soil',text:'This estimates the organic carbon already in the upper 30 cm of soil. Soils with less carbon may have more room to gain carbon from a biochar amendment.'},
  ph:{label:'Soil acidity (pH)',text:'A suitable biochar may help raise an acidic soil\'s pH. The effect depends on the biochar product and application rate.'},
  wt:{label:'Depth to groundwater',text:'This estimates how close groundwater gets to the surface during the growing season. A shallower water table lowers the site\'s score in this tool.'},
  pond:{label:'Standing water on the soil surface',text:'Ponding means water standing on the soil surface. More frequent ponding lowers the site\'s score in this tool.'},
  karst:{label:'Sinkholes and karst',text:'Karst is land with features such as sinkholes. When the soil data indicate karst, this tool lowers the site\'s score.'}
 };
 // Plain-language paraphrases of the saved NRCS biochar description and NASIS criteria report.
 const definitions={
  awc:{term:'Available water capacity (AWC)',meaning:'The water held in soil that plants can use. The NRCS rule uses the average in the upper 30 cm of mineral soil, or above a shallower root restriction.',why:'The NRCS interpretation assumes soils that store less water have more room to benefit from improved water storage.',units:'cm/cm means centimeters of plant-available water per centimeter of soil. Higher values mean more water storage.'},
  bd:{term:'Bulk density and compaction index',meaning:'Bulk density describes how tightly soil is packed. NRCS compares the reported density with a reference density for that soil\'s mix of sand, silt, and clay. The tool shows the resulting compaction index for the densest layer in the upper 30 cm.',why:'Dense soil can restrict roots and the movement of air and water. NRCS assumes more compacted soils have more room to benefit from biochar.',units:'This index has no units. Higher values suggest more compaction. A value of 0.662 does not mean 66.2% compaction.'},
  ksat:{term:'Saturated hydraulic conductivity (Ksat)',meaning:'How quickly water moves through soil when its pores are filled with water. The rule uses the fastest rate in the upper 30 cm of mineral soil, or above a shallower restriction.',why:'Water moving quickly through soil can carry nutrients out of the root zone. NRCS considers whether biochar could slow water movement in these soils. The effect depends on the soil and biochar.',units:'µm/s means micrometers per second. Higher values mean faster water movement.'},
  lep:{term:'Linear extensibility percent (LEP)',meaning:'How much soil shrinks as it dries and swells as it gets wet. This depends on the amount and type of clay. The rule uses the highest value in the upper 30 cm of mineral soil, or above a shallower restriction.',why:'Large cracks can allow biochar to move below the root zone. NRCS therefore favors soils with less shrinking and swelling. This rating does not predict that biochar will reduce shrinking and swelling.',units:'The percentage describes a change in soil length. Higher values mean more shrinking and swelling.'},
  meq:{term:'Cation exchange capacity (CEC) and milliequivalents of exchange (MEQ)',meaning:'The soil\'s ability to hold positively charged nutrients. NRCS calculates a total for a column of soil with a surface area of 1 cm², down to 30 cm or a shallower restriction. This accounts for soil density and rock fragments.',why:'Clay and organic matter provide places where nutrients can be held. NRCS assumes soils with less nutrient-holding capacity have more room to benefit from suitable biochar.',units:'meq/cm² expresses the nutrient-holding capacity per unit of ground area over that depth. Higher values mean more capacity; this is not a fertilizer application rate.'},
  oc:{term:'Soil organic carbon',meaning:'The carbon in the soil\'s organic materials. The rule estimates the amount in the upper 30 cm of soil.',why:'Organic matter supports nutrient supply, water storage, and soil structure. NRCS assumes soils with less initial carbon have more room to gain carbon from biochar.',units:'kg C/m² means kilograms of carbon per square meter of ground, down to 30 cm. It is not the soil\'s organic-matter percentage.'},
  ph:{term:'Soil pH',meaning:'A measure of soil acidity or alkalinity. Lower numbers mean more acidic soil; higher numbers mean more alkaline soil. The rule uses an average weighted by soil-layer thickness in the upper 30 cm, or above a shallower restriction.',why:'The NRCS interpretation considers the potential for biochar to raise the pH of acidic soil. Excessively high pH can make some nutrients less available. The biochar product and rate determine its liming effect.',units:'pH has no units. The soil-survey value uses a soil-and-water test.'},
  wt:{term:'Growing-season water-table depth',meaning:'The depth from the soil surface to groundwater during the growing season. A smaller depth means groundwater is closer to the surface.',why:'A shallow water table can make spreading equipment cause ruts and soil compaction. The NASIS rule text notes that its effect on how biochar works is not yet known.',units:'The depth is shown in centimeters below the soil surface.'},
  pond:{term:'Ponding frequency',meaning:'How often water stands on the soil surface instead of flowing away.',why:'Ponded water can make biochar float and collect in one part of the field. NRCS treats ponding as a condition that can limit application and use.',units:'The soil survey reports frequency classes such as none, rare, occasional, or frequent.'},
  karst:{term:'Karst landforms',meaning:'Land with features such as sinkholes and underground openings that can carry water into an aquifer. The rule checks for “karst” in the mapped soil name, together with the soil record’s sinkhole data.',why:'Water may reach groundwater quickly with little filtering. NRCS treats this as a site limitation, rather than a soil property that biochar can improve.',units:'The tool reports whether the soil data indicate karst. A mapped indication is not a field inspection.'}
 };
 const sourceURL='https://nasis.sc.egov.usda.gov/NasisReportsWebSite/limsreport.aspx?report_name=INTERP-Rule_Description_Biochar_Application';
 function valueText(rule,props){
  const value=rule.prop(props),num=(v,d=2)=>Number.isFinite(v)?v.toFixed(d):'Not reported';
  if(rule.key==='slope')return num(props.slope,1)+'% slope; '+num(props.othk,1)+' cm O horizon';
  if(rule.key==='cobble')return num(props.frag75,1)+'% fragments ≥75 mm; '+num(props.stone250,1)+'% surface stones ≥250 mm';
  if(value===null||value===undefined||Number.isNaN(value))return 'Not reported';
  if(typeof value==='boolean')return value?'Karst indicated':'No karst indicated';
  if(typeof value==='string')return value;
  const units={awc:'cm/cm',bd:'ratio',ksat:'µm/s',lep:'%',meq:'meq/cm² to 30 cm',oc:'kg C/m² to 30 cm',ph:'pH (1:1 water)',wt:'cm'};
  const digits=rule.key==='awc'||rule.key==='bd'?3:rule.key==='ph'?2:1;
  return num(value,digits)+' '+(units[rule.key]||rule.propUnit||'');
 }
 function rows(engine,model,config){
  if(!model)return {opportunities:[],constraints:[]};
  const rated=Number.isFinite(model.top?.rep);
  const active=config?.active||{slope:false,flood:false,cobble:false};
  const items=engine.SUBRULES.map(rule=>({key:rule.key,label:rule.label,group:rule.group,value:valueText(rule,model.props),factor:rated&&Number.isFinite(model.base[rule.key])?model.base[rule.key]:null,basis:rated?(model.source[rule.key]||'Unavailable'):'No published rating for this component',included:active[rule.key]===false?false:config?true:null,criteria:rule.criteria,...(descriptions[rule.key]||{})})).filter(item=>item.included!==false);
  return {opportunities:items.filter(i=>i.group==='dynamic').sort((a,b)=>(b.factor??-1)-(a.factor??-1)),constraints:items.filter(i=>i.group==='site').sort((a,b)=>(a.factor??2)-(b.factor??2))};
 }
 function basisText(row){
  if(row.basis==='Non-limiting (not stored)')return 'No separate NRCS score is available for this property. The tool assumes a score of 1. That does not tell us whether biochar will improve it.';
  if(row.basis==='NRCS stored')return 'NRCS provides a separate score for this property. It helps calculate the overall response estimate; it does not predict how much the soil would improve.';
  if(row.basis==='Calculated from SSURGO')return 'NRCS does not provide a separate score for this property. The tool estimates one from the soil-survey values. It does not predict how much the soil would improve.';
  if(row.basis==='Calibrated to NRCS rating')return 'The tool estimates this property\'s score so the starting calculation matches NRCS\'s published overall score. NRCS did not report this individual score.';
  if(row.basis==='No published rating for this component')return 'NRCS has not rated this soil\'s response to biochar. The tool cannot calculate a response score for it.';
  return 'The tool cannot identify where this property\'s score came from.';
 }
 function scoreMeaning(row){
  if(row.factor===null)return 'No score is available for the calculation.';
  return row.group==='site'?'Scores range from 0 to 1. Lower numbers reduce the overall ABI score. A score of 1 does not reduce it.':'Scores range from 0 to 1. Higher numbers add more to the overall response estimate. A score of 1 does not mean 100% improvement.';
 }
 function basisLabel(row){
  return {'Non-limiting (not stored)':'Assumed by the tool','NRCS stored':'Provided by NRCS','Calculated from SSURGO':'Estimated from soil-survey values','Calibrated to NRCS rating':'Estimated to match the overall NRCS score','No published rating for this component':'Unavailable; NRCS has not rated this soil'}[row.basis]||'Unavailable';
 }
 function plainValue(row){
  const labels={bd:'Compaction index',awc:'Plant-available water',ksat:'Water-movement rate',lep:'Shrink–swell estimate',meq:'Nutrient-holding estimate',oc:'Organic carbon in soil',ph:'Soil pH',wt:'Seasonal water-table depth',pond:'Ponding frequency',karst:'Soil-survey indication'};
  const value=row.key==='bd'?row.value.replace(' ratio',' (an index, not a percentage)'):row.key==='awc'?row.value.replace('cm/cm','cm of water per cm of soil'):row.value;
  return (labels[row.key]||'Soil-survey value')+': '+value;
 }
 function publicRows(engine,model,config){
  const all=rows(engine,model,config),p=model?.props||{};
  const benefit={
   awc:Number.isFinite(p.awc)&&p.awc<.2?(p.awc<.02?'This soil stores very little water for plants. Biochar may help it hold more.':'Biochar may help this soil hold more water for plants.'):null,
   bd:Number.isFinite(p.bdratio)&&p.bdratio>0?'The soil data suggest compaction. Biochar may help make the soil less dense.':null,
   ksat:Number.isFinite(p.ksat)&&p.ksat>14?'Biochar may slow water loss through this soil and help keep nutrients in the root zone.':null,
   meq:Number.isFinite(p.meq)&&p.meq<12?'Biochar may improve this soil\'s ability to hold nutrients.':null,
   oc:Number.isFinite(p.oc)&&p.oc<10?'Biochar can add lasting carbon to this soil.':null,
   ph:Number.isFinite(p.ph)&&p.ph<7?'This soil is acidic. A suitable biochar may help raise its pH.':null
  };
  const opportunities=all.opportunities.filter(r=>benefit[r.key]).map(r=>({...r,text:benefit[r.key]}));
  const concern={
   wt:Number.isFinite(p.wtdepth)&&p.wtdepth<75?'Groundwater is close to the surface. Wet soil can make spreading biochar difficult and increase rutting and compaction.':null,
   pond:p.pondclass&&p.pondclass!=='None'?'Standing water can make biochar float and collect in one part of the field.':null,
   karst:p.karst===true?'Sinkholes or karst may let water reach groundwater with little filtering. This needs attention when planning an application.':null,
   lep:Number.isFinite(p.lep)&&p.lep>=4?'Cracks that form as this soil dries may let biochar move below the root zone.':null
  };
  const constraints=[...all.constraints,...all.opportunities.filter(r=>r.key==='lep')].filter(r=>concern[r.key]).map(r=>({...r,text:concern[r.key]})).sort((a,b)=>(a.factor??2)-(b.factor??2));
  return {opportunities,constraints};
 }
 return {rows,publicRows,valueText,basisText,basisLabel,scoreMeaning,plainValue,definitions,sourceURL};
});
