/*
 * biochar_engine.js  (v1.2, November 2026)
 * American Biochar Institute (the Institute) - biochar.org
 *
 * Reference implementation of the NRCS soil interpretation
 *   "SOH - Dynamic Soil Properties Response to Biochar"
 * reconstructed from the NASIS rule schematic, the NASIS criteria report, and
 * validation against published SSURGO ratings (34,821 Michigan components,
 * SSURGO 2.3.3 export, August 2023).
 *
 * What is established (validated against published ratings):
 *   rating = MIN( site factors..., MIN(1, 0.15 x SUM(7 dynamic subrules)) )
 *   - Site factors (most-limiting gates): water table, slope + O-horizon
 *     thickness, ponding, flooding, cobble and stone content, karst.
 *   - Dynamic subrules (added, 0.15 each): AWC, bulk density ratio, Ksat, LEP,
 *     MEQ (CEC to 30 cm), organic carbon, pH.
 *   - NASIS "sigmoid" evaluations are Zadeh S-curves (piecewise quadratic)
 *     between the published breakpoints.
 *
 * Property calculations follow the NASIS property scripts sent by NRCS (Bob
 * Dobos, October 15 and 23 and November 2, 2026). Where a script could be read
 * more than one way, the reading that reproduces the stored NRCS subrule
 * values nationwide was chosen (engine-update-2026-11/). Match rates are in
 * CALC_NOTES.
 *   - Calculated values only matter where NRCS did not store the subrule value (NRCS keeps
 *     the 5 most limiting per component). The engine calibrates unstored
 *     dynamic values to the published rating, so "all subrules on, no user
 *     data" reproduces the NRCS rating.
 *
 * The engine never changes the NRCS published rating. Everything a user edits
 * produces a separately labeled "ABI custom" score.
 *
 * Works in the browser (window.BiocharEngine) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BiocharEngine = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var RULE = "SOH - Dynamic Soil Properties Response to Biochar";
  var DYN_WEIGHT = 0.15;
  var EPS = 0.0015;

  // ---------------------------------------------------------------------------
  // Evaluation curves
  // ---------------------------------------------------------------------------
  function isNum(x) { return x !== null && x !== undefined && x !== "" && !isNaN(+x); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  // NASIS sigmoid: Zadeh S-curve, 0 at a, 1 at b
  function sRise(x, a, b) {
    if (!isNum(x)) return null;
    var u = clamp01((+x - a) / (b - a));
    return u <= 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
  }
  function sFall(x, a, b) { var v = sRise(x, a, b); return v === null ? null : 1 - v; }
  function linFall(x, a, b) { if (!isNum(x)) return null; return clamp01((b - +x) / (b - a)); }
  // NASIS property 62702 "BULK DENSITY RATIO MAXIMUM 0-30 CM" (public NASIS
  // export, ncss-tech/interpretation-engine, July 2024): how far 1/3-bar bulk
  // density sits above a texture-based ideal, as a share of the allowable
  // increase before roots are limited.
  function bdRatio(db, sand, silt, clay) {
    if (![db, sand, silt, clay].every(isNum)) return null;
    var ideal = (1.65 * sand + 1.30 * silt + 1.25 * clay) / 100;
    var delta = 0.002081 * sand + 0.003912 * silt + 0.0024351 * clay;
    return delta > 0 ? (db - ideal) / delta : null;
  }
  function round3(v) { return v === null || v === undefined ? null : Math.round(v * 1000) / 1000; }

  // Slope x O-horizon thickness response surface (Biochar Slope and Organic
  // Layer Thickness). Membership 1 at the lower slope, 0 at the upper slope.
  // The last class ends at 40.1% (NASIS evaluation sent November 2, 2026).
  var SLOPE_O_TABLE = [
    { oMax: 2, a: 6, b: 15.1 }, { oMax: 4, a: 8, b: 20.1 }, { oMax: 6, a: 10, b: 25.1 },
    { oMax: 8, a: 12, b: 30.1 }, { oMax: 10, a: 15, b: 35.1 }, { oMax: Infinity, a: 20, b: 40.1 }
  ];
  function slopeO(slope, othk) {
    if (!isNum(slope)) return null;
    var o = isNum(othk) ? +othk : 0;
    for (var i = 0; i < SLOPE_O_TABLE.length; i++) {
      var r = SLOPE_O_TABLE[i];
      if (o < r.oMax) return linFall(slope, r.a, r.b);
    }
    return null;
  }
  var FLOOD_CLASSES = ["None", "Very rare", "Rare", "Occasional", "Frequent", "Very frequent"];
  var FLOOD_VALUE = { "None": 1, "Very rare": 1, "Rare": 0.6, "Occasional": 0.2, "Common": 0.2, "Frequent": 0, "Very frequent": 0 };
  var FLOOD_RATER = { 0: "None", 1: "Very rare", 2: "Rare", 3: "Occasional", 4: "Frequent", 5: "Very frequent" };
  // Flooding named in the map unit name (NASIS "FLOODING BY MAP UNIT NAME"): very rarely 1, rarely 2,
  // occasionally 3, commonly 4, frequently 5, none named 0. Scored linearly from 1 (1.0) to 4 (0).
  function floodNameClass(muname) {
    var m = String(muname || "");
    if (/, very rarely flooded/i.test(m)) return 1;
    if (/, rarely flooded/i.test(m)) return 2;
    if (/, occasionally flooded/i.test(m)) return 3;
    if (/commonly flooded/i.test(m)) return 4;
    if (/, frequently flooded/i.test(m)) return 5;
    return 0;
  }
  function floodNameValue(c) { return isNum(c) && +c > 0 ? linFall(+c, 1, 4) : 1; }
  var POND_CLASSES = ["None", "Rare", "Occasional", "Frequent"];
  var POND_VALUE = { "None": 1, "Rare": 1 - 1 / 1.2, "Occasional": 0, "Common": 0, "Frequent": 0 };
  var POND_RATER = { 0: "None", 1: "Rare", 2: "Occasional", 3: "Frequent" };

  // ---------------------------------------------------------------------------
  // Subrule definitions. `name` is the exact cointerp rulename stored in SDA.
  // `inputs` drive the "your data" form. `fromInputs` converts what a user
  // measured into the property the rule evaluates, then into membership.
  // ---------------------------------------------------------------------------
  var SUBRULES = [
    { key: "wt", group: "site", name: "Water Table Rule (Biochar Response)", label: "Depth to water table",
      criteria: "Shallowest 'wet' depth in the growing-season months for the soil temperature regime: >75 cm well suited, 15-75 somewhat, <15 poorly. Null = well suited.",
      inputs: [{ id: "depth", label: "Shallowest growing-season water table (cm). Leave blank if none within 200 cm.", unit: "cm" }],
      prop: function (p) { return p.wtdepth; }, propUnit: "cm",
      curve: function (x) { return x === null || x === undefined ? 1 : sRise(x, 15, 75); },
      fromInputs: function (v) { return isNum(v.depth) ? { prop: +v.depth } : { prop: null }; } },
    { key: "slope", group: "site", name: "Biochar Slope and Organic Layer Thickness", label: "Slope and O-horizon thickness",
      criteria: "Slope <6% well suited, >15% poorly; thicker O horizons shift the curve to steeper slopes.",
      inputs: [{ id: "slope", label: "Slope (%)", unit: "%" }, { id: "othk", label: "Surface O-horizon thickness (cm)", unit: "cm", def: 0 }],
      prop: function (p) { return p.slope; }, propUnit: "% slope",
      curve: function (x, p) { return slopeO(x, p ? p.othk : 0); },
      fromInputs: function (v) { return { prop: isNum(v.slope) ? +v.slope : null, extra: { othk: isNum(v.othk) ? +v.othk : 0 } }; } },
    { key: "pond", group: "site", name: "SOH - Ponding Rating (Suitability)", label: "Ponding frequency",
      criteria: "None well suited; rare to occasional somewhat; common to frequent poorly. Null = well suited.",
      inputs: [{ id: "cls", label: "Ponding frequency class", type: "select", options: POND_CLASSES }],
      prop: function (p) { return p.pondclass; }, propUnit: "class",
      curve: function (x) { return x === null || x === undefined ? 1 : (x in POND_VALUE ? POND_VALUE[x] : null); },
      fromInputs: function (v) { return { prop: v.cls || null }; } },
    { key: "flood", group: "site", name: "SOH - Flooding Frequency Rating (Suitability)", label: "Flooding frequency",
      criteria: "None to very rare well suited; rare to occasional somewhat; frequent poorly. Null = well suited. A flooding class in the map unit name also counts (the lower of the two).",
      inputs: [{ id: "cls", label: "Flooding frequency class", type: "select", options: FLOOD_CLASSES }],
      prop: function (p) { return p.floodclass; }, propUnit: "class",
      curve: function (x, p) {
        var a = x === null || x === undefined ? 1 : (x in FLOOD_VALUE ? FLOOD_VALUE[x] : null);
        return a === null ? null : Math.min(a, floodNameValue(p ? p.floodname : 0));
      },
      // A class the user enters replaces both the mapped class and the map unit name.
      fromInputs: function (v) { return { prop: v.cls || null, extra: { floodname: 0 } }; } },
    { key: "cobble", group: "site", name: "SOH - Cobble and Stone Content 0-30cm", label: "Cobbles and stones",
      criteria: "Fragments >=75 mm (with cohesive, persistent artifacts) in layers starting within 30 cm below the O horizon: <2% well, >15% poorly. Surface stones >=250 mm: <0.1% well, >3% poorly. Lower of the two.",
      inputs: [{ id: "frag75", label: "Fragments >=75 mm, 0-30 cm (% volume)", unit: "%" }, { id: "stone250", label: "Surface stones >=250 mm (% cover)", unit: "%", def: 0 }],
      prop: function (p) { return p.frag75; }, propUnit: "% vol >=75 mm",
      curve: function (x, p) {
        var a = sFall(isNum(x) ? x : 0, 2, 15), b = sFall(p && isNum(p.stone250) ? p.stone250 : 0, 0.1, 3);
        return Math.min(a, b);
      },
      fromInputs: function (v) { return { prop: isNum(v.frag75) ? +v.frag75 : 0, extra: { stone250: isNum(v.stone250) ? +v.stone250 : 0 } }; } },
    { key: "karst", group: "site", name: "SOH - Karst landform", label: "Karst",
      criteria: "Map unit name contains 'karst' = poorly suited.",
      inputs: [{ id: "cls", label: "Karst present?", type: "select", options: ["No", "Yes"] }],
      prop: function (p) { return p.karst; }, propUnit: "",
      curve: function (x) { return x === null || x === undefined ? 1 : (x ? 0 : 1); },
      fromInputs: function (v) { return { prop: v.cls === "Yes" ? true : (v.cls === "No" ? false : null) }; } },

    { key: "awc", group: "dynamic", name: "SOH - AWC Average 0-30cm", label: "Available water capacity",
      criteria: "AWC 0-30 cm: <0.02 cm/cm well suited (most to gain), >0.2 poorly.",
      inputs: [{ id: "awc", label: "AWC, average 0-30 cm (cm/cm)", unit: "cm/cm" }],
      prop: function (p) { return p.awc; }, propUnit: "cm/cm",
      curve: function (x) { return sFall(x, 0.02, 0.2); },
      fromInputs: function (v) { return { prop: isNum(v.awc) ? +v.awc : null }; } },
    { key: "bd", group: "dynamic", name: "SOH - Bulk Density Ratio Max 0-30cm", label: "Bulk density ratio (compaction)",
      criteria: "Bulk density ratio max 0-30 cm: >0.4 well suited (compacted), <0 poorly.",
      inputs: [{ id: "db", label: "Bulk density at 1/3 bar (g/cm3), densest layer 0-30 cm", unit: "g/cm3" },
               { id: "sand", label: "Sand (%)", unit: "%" }, { id: "silt", label: "Silt (%)", unit: "%" }, { id: "clay", label: "Clay (%)", unit: "%" },
               { id: "ratio", label: "Or enter the NASIS bulk density ratio directly", unit: "ratio" }],
      prop: function (p) { return p.bdratio; }, propUnit: "ratio",
      curve: function (x) { return sRise(x, 0, 0.4); },
      fromInputs: function (v) {
        if (isNum(v.ratio)) return { prop: +v.ratio };
        if (!isNum(v.db) || !isNum(v.sand) || !isNum(v.silt) || !isNum(v.clay)) return { prop: null };
        return { prop: bdRatio(+v.db, +v.sand, +v.silt, +v.clay) };
      } },
    { key: "ksat", group: "dynamic", name: "SOH - Ksat Max 0-30cm", label: "Saturated hydraulic conductivity",
      criteria: "Ksat max 0-30 cm: >40 um/s well suited, <14 poorly.",
      inputs: [{ id: "ksat", label: "Ksat, maximum 0-30 cm", unit: "um/s" }, { id: "unit", label: "Units", type: "select", options: ["um/s", "in/hr", "cm/hr"] }],
      prop: function (p) { return p.ksat; }, propUnit: "um/s",
      curve: function (x) { return sRise(x, 14, 40); },
      fromInputs: function (v) {
        if (!isNum(v.ksat)) return { prop: null };
        var k = +v.ksat; if (v.unit === "in/hr") k = k * 7.0556; if (v.unit === "cm/hr") k = k * 2.7778;
        return { prop: k };
      } },
    { key: "lep", group: "dynamic", name: "SOH - LEP Max 0-30cm", label: "Linear extensibility (shrink-swell)",
      criteria: "LEP max 0-30 cm: <4% well suited, >12% poorly.",
      inputs: [{ id: "lep", label: "LEP, maximum 0-30 cm (%)", unit: "%" }],
      prop: function (p) { return p.lep; }, propUnit: "%",
      curve: function (x) { return sFall(x, 4, 12); },
      fromInputs: function (v) { return { prop: isNum(v.lep) ? +v.lep : null }; } },
    { key: "meq", group: "dynamic", name: "SOH - MEQ 0-30cm", label: "Cation exchange capacity (MEQ to 30 cm)",
      criteria: "Exchange capacity in a 1 cm2 column to 30 cm: <4 meq well suited, >12 poorly.",
      inputs: [{ id: "cec", label: "CEC (meq/100 g, NH4OAc pH 7)", unit: "meq/100g" }, { id: "bd", label: "Bulk density (g/cm3)", unit: "g/cm3" },
               { id: "frag", label: "Rock fragments (% volume)", unit: "%", def: 0 }, { id: "depth", label: "Depth represented (cm, max 30)", unit: "cm", def: 30 },
               { id: "direct", label: "Or enter MEQ directly (meq/cm2 to 30 cm)", unit: "meq" }],
      prop: function (p) { return p.meq; }, propUnit: "meq to 30 cm",
      curve: function (x) { return sFall(x, 4, 12); },
      fromInputs: function (v) {
        if (isNum(v.direct)) return { prop: +v.direct };
        if (!isNum(v.cec) || !isNum(v.bd)) return { prop: null };
        var d = isNum(v.depth) ? Math.min(30, +v.depth) : 30, f = isNum(v.frag) ? +v.frag / 100 : 0;
        return { prop: (+v.cec / 100) * (+v.bd) * d * (1 - f) };
      } },
    { key: "oc", group: "dynamic", name: "SOH - Organic Carbon, kg/m2 to 30cm", label: "Soil organic carbon (kg/m2 to 30 cm)",
      criteria: "Organic carbon to 30 cm: <2 kg/m2 well suited (most to gain), >10 poorly.",
      inputs: [{ id: "soc", label: "Soil organic carbon (%)", unit: "% C" }, { id: "om", label: "Or organic matter (%)", unit: "% OM" },
               { id: "bd", label: "Bulk density (g/cm3)", unit: "g/cm3" }, { id: "frag", label: "Rock fragments (% volume)", unit: "%", def: 0 },
               { id: "depth", label: "Depth represented (cm, max 30)", unit: "cm", def: 30 }, { id: "direct", label: "Or enter SOC stock directly (kg/m2 to 30 cm)", unit: "kg/m2" }],
      prop: function (p) { return p.oc; }, propUnit: "kg/m2 to 30 cm",
      curve: function (x) { return sFall(x, 2, 10); },
      fromInputs: function (v) {
        if (isNum(v.direct)) return { prop: +v.direct };
        var c = isNum(v.soc) ? +v.soc : (isNum(v.om) ? +v.om / 1.724 : null);
        if (c === null || !isNum(v.bd)) return { prop: null };
        var d = isNum(v.depth) ? Math.min(30, +v.depth) : 30, f = isNum(v.frag) ? +v.frag / 100 : 0;
        return { prop: (c / 100) * (+v.bd) * d * (1 - f) * 10 };
      } },
    { key: "ph", group: "dynamic", name: "SOH - pH WTD_AVG 0-30 Suitability", label: "Soil pH",
      criteria: "Weighted average pH 0-30 cm: <5.5 well suited (most to gain), >7.5 poorly.",
      inputs: [{ id: "ph", label: "pH (1:1 water), 0-30 cm", unit: "pH" }],
      prop: function (p) { return p.ph; }, propUnit: "pH",
      curve: function (x) { return sFall(x, 5.5, 7.5); },
      fromInputs: function (v) { return { prop: isNum(v.ph) ? +v.ph : null }; } }
  ];
  var BY_KEY = {}, BY_NAME = {};
  SUBRULES.forEach(function (s) { BY_KEY[s.key] = s; BY_NAME[s.name] = s; });
  // Older SDA vintages and the NASIS report use this name for the slope subrule.
  BY_NAME["SOH - Slope 6 to >15%"] = BY_KEY.slope;
  var SITE_KEYS = SUBRULES.filter(function (s) { return s.group === "site"; }).map(function (s) { return s.key; });
  var DYN_KEYS = SUBRULES.filter(function (s) { return s.group === "dynamic"; }).map(function (s) { return s.key; });

  // Match rates: share of stored NRCS subrule values (strictly between 0 and 1) reproduced within 0.0015,
  // soils nationwide with SSURGO data (engine-update-2026-11/variants.json, November 2, 2026).
  var CALC_NOTES = {
    ph: "Weighted average 1:1 water pH (0.01M CaCl2 pH when blank), 0-30 cm below the surface organic layer, above a cemented or bedrock restriction. Matches 99.8% of stored values.",
    oc: "Sum of 58 x OM x bulk density (1/3 bar, else 1/10 bar, else 1.45) x fine-earth volume x thickness, 0-30 cm from the surface above a restriction; layers without fragment data add nothing. Matches 99.7%.",
    ksat: "Maximum 0-30 cm from the surface, stops at a restriction. Matches 98.9%.",
    awc: "Weighted average 0-30 cm below the surface organic layer, above a cemented or bedrock restriction. Matches 100%.",
    meq: "Sum of CEC7 (ECEC / 0.8 when blank) / 100 x bulk density (1 when blank) x (1 - fragments and cohesive, persistent artifacts) x thickness, 0-30 cm or to the first restriction; the surface organic layer counts only in Histosols. Matches 99.3%.",
    lep: "Maximum LEP (blank = 0) over layers starting within 31 cm below the surface organic layer, above a cemented or bedrock restriction. Matches 99.9%.",
    bd: "NASIS property 62702: (Db 1/3 bar - ideal) / delta, ideal = (1.65 sand + 1.30 silt + 1.25 clay)/100, delta = 0.002081 sand + 0.003912 silt + 0.0024351 clay. Maximum over horizons starting within 31 cm below the surface organic layer; Histosols and histic soils = 0. Matches 99.99%.",
    wt: "Shallowest 'Wet' soil moisture depth in the growing-season months set by the soil temperature regime. Matches 100%.",
    slope: "Representative slope on the response surface for the surface organic layer thickness (organic and histic soils use 0). Matches 100%.",
    cobble: "Maximum volume of fragments >=75 mm plus cohesive, persistent artifacts >=75 mm in layers starting within 30 cm below the surface organic layer, and surface cover of stones >=250 mm; lower of the two. Matches 99.2%.",
    flood: "Most frequent monthly flooding class (rare = 0.6, occasional = 0.2, frequent = 0) and any flooding class in the map unit name; lower of the two. Matches 100%.",
    pond: "Most frequent monthly ponding class. Rare = 0.17, occasional or frequent = 0. Matches 100%.",
    karst: "'Karst' in the map unit name. NRCS stores this check as failed for every rated soil with 'karst' in its name and none without it."
  };

  // ---------------------------------------------------------------------------
  // Combination (the NASIS rule tree)
  // ---------------------------------------------------------------------------
  function combine(vals) {
    var site = 1, dynSum = 0, missing = [];
    SITE_KEYS.forEach(function (k) { var v = vals[k]; if (v === null || v === undefined) missing.push(k); else site = Math.min(site, v); });
    DYN_KEYS.forEach(function (k) { var v = vals[k]; if (v === null || v === undefined) missing.push(k); else dynSum += v; });
    var dyn = Math.min(1, DYN_WEIGHT * dynSum);
    var rating = Math.min(site, dyn);
    var governing = site < dyn ? "site" : "dynamic";
    return { rating: missing.length ? null : rating, site: site, dyn: dyn, dynSum: dynSum, governing: governing, missing: missing };
  }

  function classify(r) {
    if (r === null || r === undefined) return "Not rated";
    if (r <= 0) return "Negligible response";
    if (r <= 0.25) return "Low response";
    if (r <= 0.5) return "Fair response";
    if (r <= 0.75) return "Good response";
    return "Excellent response";
  }
  function classCode(r) {
    if (r === null || r === undefined) return 0;
    if (r <= 0) return 1; if (r <= 0.25) return 2; if (r <= 0.5) return 3; if (r <= 0.75) return 4; return 5;
  }

  // ---------------------------------------------------------------------------
  // SSURGO properties -> subrule inputs (NASIS property scripts)
  // comp.horizons: [{hzname, hzdept_r, hzdepb_r, ph1to1h2o_r, ph01mcacl2_r, om_r,
  //   dbthirdbar_r, dbtenthbar_r, awc_r, ksat_r, lep_r, cec7_r, ecec_r,
  //   sieveno10_r, frag3to10_r, fraggt10_r, sandtotal_r, silttotal_r, claytotal_r,
  //   fragvol_tot, fragvol_75, rvtex_n, rvtex_org, huart_cp, huart_cp75}]
  // comp.site: {resdept, cemdept, reskinddept, wtdepth or wet {jan: depth, ...},
  //   taxtempregime, taxtempcl, stones250, floodrater, pondrater, sinkholes, landforms}
  // comp.slope_r, comp.muname, comp.taxorder, comp.taxsuborder, comp.taxgrtgroup, comp.taxsubgrp
  // ---------------------------------------------------------------------------
  function isO(h) { return /^\^?\d*O/.test(h.hzname || ""); }
  function n(v) { return isNum(v) ? +v : null; }

  // Growing-season months by soil temperature regime (NASIS "WATER TABLE DEPTH, GROWING SEASON").
  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  function monthRange(a, b) { return MONTHS.slice(MONTHS.indexOf(a), MONTHS.indexOf(b) + 1); }
  var GROW_MONTHS = {
    thermic: monthRange("feb", "oct"), mesic: monthRange("mar", "oct"), cryic: monthRange("jun", "aug"),
    frigid: monthRange("may", "sep"), isofrigid: monthRange("apr", "oct"), hyperthermic: monthRange("feb", "dec"),
    isothermic: MONTHS, isohyperthermic: MONTHS, isomesic: MONTHS, gelic: ["jul", "aug"]
  };
  var GELIC_CLASSES = ["hypergelic", "pergelic", "subgelic"];
  function growingMonths(regime, cls) {
    var out = (GROW_MONTHS[String(regime || "").toLowerCase()] || []).slice();
    if (GELIC_CLASSES.indexOf(String(cls || "").toLowerCase()) >= 0) ["jul", "aug"].forEach(function (m) { if (out.indexOf(m) < 0) out.push(m); });
    return out;
  }
  // Shallowest 'Wet' depth in growing-season months; a month with no depth counts as 200 cm.
  // Uses monthly rows (site.wet) when present, else site.wtdepth (SQL.site computes the same value).
  function wtGrowing(site) {
    if (!site.wet) return n(site.wtdepth);
    var d = null;
    growingMonths(site.taxtempregime, site.taxtempcl).forEach(function (m) {
      if (m in site.wet) { var v = n(site.wet[m]); d = Math.min(d === null ? 200 : d, v === null ? 200 : v); }
    });
    return d;
  }

  // Organic and histic soils (Histosols, Histels, histic subgroups, Histoturbels).
  function organicSoil(comp) {
    var t = [comp.taxorder, comp.taxsuborder, comp.taxsubgrp, comp.taxgrtgroup].map(function (x) { return String(x || "").toLowerCase(); });
    return { histic: !!comp.taxorder && (/histosols/.test(t[0]) || /histels/.test(t[1]) || /^histic/.test(t[2]) || /histoturbels/.test(t[3])),
      histosol: /histosols/.test(t[0]) };
  }
  // Surface organic layer thickness (NASIS "THICKNESS OF SURFACE ORGANIC HORIZON"): the top of the first
  // layer whose representative texture is not organic (muck, peat, mucky peat, plant materials,
  // coprogenous earth). Falls back to O horizon names when texture data are absent.
  function organicThickness(hz) {
    var hasTex = hz.some(function (h) { return isNum(h.rvtex_n); });
    if (hasTex) {
      for (var i = 0; i < hz.length; i++) if (n(hz[i].rvtex_n) > 0 && n(hz[i].rvtex_org) < n(hz[i].rvtex_n)) return hz[i].top;
      return 0;
    }
    var o = 0;
    for (var j = 0; j < hz.length; j++) { if (isO(hz[j]) && hz[j].top <= o + 0.01) o = hz[j].bot; else break; }
    return o;
  }

  function computeProps(comp) {
    var hz = (comp.horizons || []).filter(function (h) { return isNum(h.hzdept_r) && isNum(h.hzdepb_r); })
      .map(function (h) { var o = {}; for (var k in h) o[k] = h[k]; o.top = +h.hzdept_r; o.bot = +h.hzdepb_r; return o; })
      .sort(function (a, b) { return a.top - b.top; });
    var site = comp.site || {};
    var res = n(site.resdept);
    // Cemented or bedrock restriction (permafrost, bedrock, cemented horizon, duripan, ortstein, petro- layers).
    var cem = ("reskinddept" in site) ? n(site.reskinddept) : n(site.cemdept);
    var org = organicSoil(comp), oRaw = organicThickness(hz);
    var othk = org.histic ? 0 : oRaw;            // THICKNESS OF SURFACE ORGANIC HORIZON
    var othkNH = org.histosol ? 0 : oRaw;        // SURFACE ORGANIC HORIZON THICKNESS, NOT HISTOSOL (MEQ)

    function overlap(h, z0, end) { return Math.max(0, Math.min(h.bot, end) - Math.max(h.top, z0)); }
    function wavgBelowO(f) {
      var end = Math.min(othk + 30, cem === null ? Infinity : cem), s = 0, w = 0;
      hz.forEach(function (h) {
        if (h.bot - othk <= 0) return;
        var t = overlap(h, othk, end), v = f(h);
        if (t > 0 && v !== null) { s += v * t; w += t; }
      });
      return w > 0 ? s / w : null;
    }
    // Layers whose top lies within 31 cm below the organic layer (or above a shallower cemented layer).
    function inRange31(h) {
      if (h.bot - othk <= 0) return false;
      var cb = cem === null ? null : cem - othk, minD = cb !== null && cb < 31 ? cb : 31, rel = h.top - othk;
      return rel === 0 || rel <= minD;
    }

    // pH: 1:1 water, else 0.01M CaCl2.
    var ph = wavgBelowO(function (h) { var w = n(h.ph1to1h2o_r); return w !== null ? w : n(h.ph01mcacl2_r); });
    var awc = wavgBelowO(function (h) { return n(h.awc_r); });
    var lep = null;
    hz.forEach(function (h) { if (inRange31(h)) { var v = n(h.lep_r); if (v === null) v = 0; if (lep === null || v > lep) lep = v; } });

    // Ksat: maximum 0-30 cm from the surface, stopping at any restriction (fits the stored values best).
    var ksat = null, kEnd = Math.min(30, res === null ? Infinity : res);
    hz.forEach(function (h) { var v = n(h.ksat_r); if (overlap(h, 0, kEnd) > 0 && v !== null && (ksat === null || v > ksat)) ksat = v; });

    // Organic carbon, kg/m2 to 30 cm (null when no layer lies in the window).
    var oc = 0, ocAny = false, ocEnd = Math.min(30, res === null ? Infinity : res);
    hz.forEach(function (h) {
      var t = overlap(h, 0, ocEnd);
      if (t <= 0) return;
      ocAny = true;
      var om = n(h.om_r) || 0, d3 = n(h.dbthirdbar_r), dbF = d3 !== null ? d3 : n(h.dbtenthbar_r), db = dbF !== null ? dbF : 1.45;
      var s10 = n(h.sieveno10_r), f3 = n(h.frag3to10_r), f10 = n(h.fraggt10_r);
      if (dbF === null || s10 === null || f3 === null || f10 === null) return;   // no fine-earth value: adds nothing
      var pct = (100 - s10) * (100 - (f3 + f10)) / 100, tot = pct + f3 + f10;
      var fine = 100 - ((tot / 2.65) / ((tot / 2.65) + ((100 - tot) / dbF))) * 100;
      oc += t * 58 * om * db * fine / 100;
    });
    oc = ocAny ? oc / 1000 : null;

    // MEQ, as the NASIS script is written (its window arithmetic included).
    var meq = null, mDepth = res === null ? null : res - othkNH, mMin = mDepth !== null && mDepth < 31 ? mDepth : 30;
    hz.forEach(function (h) {
      var c7 = n(h.cec7_r), ec = n(h.ecec_r), cec = c7 !== null ? c7 : (ec !== null ? ec / 0.8 : null);
      if (cec === null) return;
      var db = n(h.dbthirdbar_r); if (db === null) db = 1;
      var fr = (n(h.fragvol_tot) || 0) + (n(h.huart_cp) || 0);
      var top = h.top > mMin ? mMin : h.top - othkNH, bot = h.bot > mMin ? mMin : h.bot - othkNH;
      meq = (meq || 0) + cec / 100 * db * (1 - fr / 100) * (bot - top);
    });

    // Cobbles: layers starting within 30 cm below the organic layer.
    var frag75 = 0;
    hz.forEach(function (h) { if (h.top <= othk + 30) frag75 = Math.max(frag75, (n(h.fragvol_75) || 0) + (n(h.huart_cp75) || 0)); });

    var fr = n(site.floodrater), pr = n(site.pondrater);
    return {
      othk: othk,
      ph: ph, awc: awc, lep: lep, ksat: ksat,
      oc: oc, meq: meq,
      frag75: frag75,
      stone250: n(site.stones250) || 0,
      wtdepth: wtGrowing(site),
      floodclass: fr === null ? null : FLOOD_RATER[fr],
      floodname: floodNameClass(comp.muname),
      pondclass: pr === null ? null : POND_RATER[pr],
      slope: n(comp.slope_r),
      // The NASIS sinkhole branch applies only where a sinkhole record exists; no rated soil named 'karst' has one,
      // and stored values fail every soil named 'karst' (engine-update-2026-11), so the name decides.
      karst: /karst/i.test(comp.muname || ""),
      bdratio: bdRatioProfile(hz, othk, n(site.cemdept), comp)
    };
  }

  // Profile logic of property 62702: horizons whose top lies within 31 cm of
  // the bottom of the surface O horizon (or above a strongly cemented layer),
  // excluding the O horizon itself; maximum ratio; organic soils rate 0.
  function bdRatioProfile(hz, othk, cemdep, comp) {
    var tax = [comp.taxorder, comp.taxsubgrp, comp.taxgrtgroup, comp.taxsuborder].map(function (t) { return String(t || "").toLowerCase(); });
    var organic = comp.taxorder && (/histosols/.test(tax[0]) || /^histic/.test(tax[1]) || /histoturbels/.test(tax[2]) || /histels/.test(tax[3]));
    var minDepth = (cemdep !== null && cemdep < 31) ? cemdep : 31;
    var best = null;
    hz.forEach(function (h) {
      if (!(h.bot > h.top) || h.bot - othk <= 0) return;
      var rel = h.top - othk;
      if (!(rel === 0 || rel <= minDepth)) return;
      var r = organic ? 0 : bdRatio(n(h.dbthirdbar_r), n(h.sandtotal_r), n(h.silttotal_r), n(h.claytotal_r));
      if (r !== null && (best === null || r > best)) best = r;
    });
    return best;
  }

  function membershipFromProps(key, props) {
    var s = BY_KEY[key];
    var x = s.prop(props);
    if ((x === null || x === undefined) && s.group === "dynamic") return null;
    return s.curve(x, props);
  }

  // ---------------------------------------------------------------------------
  // Build a component model: NRCS stored values, values calculated from SSURGO,
  // and the calibrated baseline that reproduces the published rating.
  //
  // comp.top    : {ll, rep, hh, cls}   (ruledepth 0)
  // comp.stored : {key: {ll, rep, hh, cls}}  (ruledepth 1, up to 5 reasons)
  // ---------------------------------------------------------------------------
  function buildComponent(comp) {
    var props = computeProps(comp);
    var stored = comp.stored || {};
    var storedKeys = Object.keys(stored).filter(function (k) { return stored[k] && isNum(stored[k].rep); });
    var nStored = storedKeys.length;
    var maxStored = 0;
    storedKeys.forEach(function (k) { maxStored = Math.max(maxStored, +stored[k].rep); });
    // NRCS stores the lowest-valued subrules. With all 5 slots used, every
    // unstored subrule is at least the largest stored value. With fewer than 5,
    // unstored subrules are non-limiting (1.0).
    var lo = nStored >= 5 ? maxStored : 1;

    var calc = {}, base = {}, source = {};
    SUBRULES.forEach(function (s) {
      var k = s.key;
      calc[k] = membershipFromProps(k, props);
      if (stored[k] && isNum(stored[k].rep)) { base[k] = +stored[k].rep; source[k] = "NRCS stored"; }
      else {
        var c = calc[k];
        if (c === null || c === undefined) c = (lo + 1) / 2;
        base[k] = Math.max(lo, Math.min(1, c));
        source[k] = lo >= 1 ? "Non-limiting (not stored)" : "Calculated from SSURGO";
      }
    });

    // Calibrate unstored dynamic values so the all-on score equals the
    // published rating.
    var T = comp.top && isNum(comp.top.rep) ? +comp.top.rep : null;
    var calibrated = false;
    if (T !== null) {
      var siteMin = 1;
      SITE_KEYS.forEach(function (k) { siteMin = Math.min(siteMin, base[k]); });
      var unst = DYN_KEYS.filter(function (k) { return source[k] !== "NRCS stored"; });
      var storedSum = 0;
      DYN_KEYS.forEach(function (k) { if (source[k] === "NRCS stored") storedSum += base[k]; });
      var cur = 0; unst.forEach(function (k) { cur += base[k]; });
      var sumGoverned = T < siteMin - EPS;
      var target = null;
      if (sumGoverned) target = T / DYN_WEIGHT - storedSum;
      else if (DYN_WEIGHT * (storedSum + cur) < T - EPS) target = T / DYN_WEIGHT - storedSum;
      if (target !== null && unst.length) {
        var diff = target - cur;
        if (Math.abs(diff) > 1e-9) {
          var rooms = unst.map(function (k) { return diff > 0 ? 1 - base[k] : base[k] - lo; });
          var tot = rooms.reduce(function (a, b) { return a + b; }, 0);
          if (tot > 1e-12) {
            unst.forEach(function (k, i) {
              base[k] = Math.max(lo, Math.min(1, base[k] + diff * rooms[i] / tot));
              if (source[k] !== "NRCS stored") source[k] = "Calibrated to NRCS rating";
            });
            calibrated = true;
          }
        }
      }
    }
    var check = combine(base);
    return {
      cokey: comp.cokey, compname: comp.compname, comppct: n(comp.comppct_r) || 0, majcompflag: comp.majcompflag,
      mukey: comp.mukey, muname: comp.muname,
      top: comp.top || null, stored: stored, props: props, calc: calc, base: base, source: source,
      nStored: nStored, calibrated: calibrated,
      reproduced: check.rating, reproError: (T !== null && check.rating !== null) ? check.rating - T : null
    };
  }

  // ---------------------------------------------------------------------------
  // ABI custom score.
  // settings.active[key] = false  -> subrule treated as non-limiting (1.0)
  // settings.data[key] = {inputs} -> measured data replaces the subrule value
  // ---------------------------------------------------------------------------
  function customScore(model, settings) {
    settings = settings || {};
    var active = settings.active || {}, data = settings.data || {};
    var vals = {}, how = {};
    SUBRULES.forEach(function (s) {
      var k = s.key;
      if (active[k] === false) { vals[k] = 1; how[k] = "off"; return; }
      var d = data[k];
      if (d) {
        var r = s.fromInputs(d);
        if (r && r.prop !== null && r.prop !== undefined) {
          var p = {}; for (var q in model.props) p[q] = model.props[q];
          if (r.extra) for (var e in r.extra) p[e] = r.extra[e];
          var v = s.curve(r.prop, p);
          if (v !== null && v !== undefined) { vals[k] = v; how[k] = "your data"; return; }
        }
      }
      vals[k] = model.base[k]; how[k] = model.source[k];
    });
    var c = combine(vals);
    return { rating: c.rating === null ? null : round3(c.rating), raw: c, values: vals, how: how };
  }

  // ---------------------------------------------------------------------------
  // Map unit roll-up (Web Soil Survey style)
  // ---------------------------------------------------------------------------
  function rollup(items) {
    // items: [{comppct, rating}]
    var rated = items.filter(function (i) { return i.rating !== null && i.rating !== undefined; });
    var dom = items.slice().sort(function (a, b) { return b.comppct - a.comppct; })[0] || null;
    var byClass = {};
    items.forEach(function (i) { var c = classify(i.rating); byClass[c] = (byClass[c] || 0) + (i.comppct || 0); });
    var domCond = null, best = -1;
    Object.keys(byClass).forEach(function (c) { if (byClass[c] > best) { best = byClass[c]; domCond = c; } });
    var w = 0, s = 0;
    rated.forEach(function (i) { w += i.comppct || 0; s += (i.comppct || 0) * i.rating; });
    return {
      dominantCondition: domCond, dominantConditionPct: best,
      dominantComponent: dom ? { name: dom.name, pct: dom.comppct, rating: dom.rating, cls: classify(dom.rating) } : null,
      weightedMean: w > 0 ? round3(s / w) : null
    };
  }

  // ---------------------------------------------------------------------------
  // Soil Data Access queries (T-SQL). Send through a CORS proxy.
  // ---------------------------------------------------------------------------
  function keyList(keys) {
    return keys.map(function (k) { return "'" + String(k).replace(/[^0-9]/g, "") + "'"; }).join(",");
  }
  var ORGANIC_LIEUTEX = "('Muck','Peat','Mucky peat','Slightly decomposed plant material','Moderately decomposed plant material','Highly decomposed plant material','Coprogenous earth')";
  var CEMENTED_KINDS = "('Permafrost','Densic bedrock','Lithic bedrock','Paralithic bedrock','Cemented horizon','Duripan','Ortstein','Petrocalcic','Petroferric','Petrogypsic')";
  var MONTH_NAMES = { jan: "January", feb: "February", mar: "March", apr: "April", may: "May", jun: "June",
    jul: "July", aug: "August", sep: "September", oct: "October", nov: "November", dec: "December" };
  function monthList(ms) { return "(" + ms.map(function (m) { return "'" + MONTH_NAMES[m] + "'"; }).join(",") + ")"; }
  // The growing-season months of growingMonths() as a WHERE clause on comonth cm and component c.
  function growingSeasonSQL() {
    var parts = ["(c.taxtempcl IN ('" + GELIC_CLASSES.join("','") + "') AND cm.month IN " + monthList(["jul", "aug"]) + ")"];
    Object.keys(GROW_MONTHS).forEach(function (r) { parts.push("(c.taxtempregime = '" + r + "' AND cm.month IN " + monthList(GROW_MONTHS[r]) + ")"); });
    return parts.join(" OR ");
  }
  var SQL = {
    mukeyAtPoint: function (lon, lat) {
      return "SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(" + (+lon) + " " + (+lat) + ")')";
    },
    polygonsInAOI: function (wkt) {
      return "SELECT mukey, mupolygongeo.STAsText() AS wkt FROM mupolygon " +
        "WHERE mupolygongeo.STIntersects(geometry::STGeomFromText('" + wkt.replace(/'/g, "") + "', 4326)) = 1";
    },
    polygonsForMukeys: function (mukeys, wkt) {
      return "SELECT mukey, mupolygongeo.STAsText() AS wkt FROM mupolygon WHERE mukey IN (" + keyList(mukeys) + ")" +
        (wkt ? " AND mupolygongeo.STIntersects(geometry::STGeomFromText('" + wkt.replace(/'/g, "") + "', 4326)) = 1" : "");
    },
    mukeysByAreaSymbol: function (areasymbol, musym) {
      return "SELECT mu.mukey FROM legend l INNER JOIN mapunit mu ON mu.lkey = l.lkey WHERE l.areasymbol = '" +
        String(areasymbol).replace(/[^A-Za-z0-9]/g, "") + "'" + (musym ? " AND mu.musym = '" + String(musym).replace(/'/g, "") + "'" : "");
    },
    ratings: function (mukeys) {
      return "SELECT l.areasymbol, mu.mukey, mu.musym, mu.muname, c.cokey, c.compname, c.comppct_r, c.majcompflag, c.slope_r, c.taxorder, c.taxsuborder, c.taxgrtgroup, c.taxsubgrp, " +
        "ci.rulename, ci.ruledepth, ci.seqnum, ci.interpll, ci.interpllc, ci.interphr, ci.interphrc, ci.interphh, ci.interphhc " +
        "FROM legend l INNER JOIN mapunit mu ON mu.lkey = l.lkey INNER JOIN component c ON c.mukey = mu.mukey " +
        "LEFT OUTER JOIN cointerp ci ON ci.cokey = c.cokey AND ci.mrulename = '" + RULE + "' " +
        "WHERE mu.mukey IN (" + keyList(mukeys) + ") ORDER BY mu.mukey, c.comppct_r DESC, c.cokey, ci.ruledepth, ci.seqnum";
    },
    horizons: function (mukeys) {
      return "SELECT ch.cokey, ch.chkey, ch.hzname, ch.hzdept_r, ch.hzdepb_r, ch.ph1to1h2o_r, ch.om_r, ch.dbthirdbar_r, " +
        "ch.awc_r, ch.ksat_r, ch.lep_r, ch.cec7_r, ch.sieveno10_r, ch.frag3to10_r, ch.fraggt10_r, ch.sandtotal_r, ch.silttotal_r, ch.claytotal_r, " +
        "ch.ecec_r, ch.ph01mcacl2_r, ch.dbtenthbar_r, " +
        "(SELECT SUM(f.fragvol_r) FROM chfrags f WHERE f.chkey = ch.chkey) AS fragvol_tot, " +
        "(SELECT SUM(f.fragvol_r) FROM chfrags f WHERE f.chkey = ch.chkey AND f.fragsize_l >= 75) AS fragvol_75, " +
        "(SELECT COUNT(*) FROM chtexturegrp g LEFT JOIN chtexture t ON t.chtgkey = g.chtgkey WHERE g.chkey = ch.chkey AND g.rvindicator = 'Yes') AS rvtex_n, " +
        "(SELECT COUNT(*) FROM chtexturegrp g INNER JOIN chtexture t ON t.chtgkey = g.chtgkey WHERE g.chkey = ch.chkey AND g.rvindicator = 'Yes' AND t.lieutex IN " + ORGANIC_LIEUTEX + ") AS rvtex_org, " +
        "(SELECT SUM(a.huartvol_r) FROM chhuarts a WHERE a.chkey = ch.chkey AND a.huartco = 'Cohesive' AND a.huartper = 'Persistent') AS huart_cp, " +
        "(SELECT SUM(a.huartvol_r) FROM chhuarts a WHERE a.chkey = ch.chkey AND a.huartco = 'Cohesive' AND a.huartper = 'Persistent' AND a.huartsize_r >= 75) AS huart_cp75 " +
        "FROM component c INNER JOIN chorizon ch ON ch.cokey = c.cokey WHERE c.mukey IN (" + keyList(mukeys) + ") " +
        "AND ch.hzdept_r < 150 ORDER BY ch.cokey, ch.hzdept_r";
    },
    site: function (mukeys) {
      return "SELECT c.cokey, c.taxtempregime, c.taxtempcl, " +
        "(SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey) AS resdept, " +
        "(SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey AND (r.reshard LIKE '%strongly cemented%' OR r.reshard LIKE 'indurated%')) AS cemdept, " +
        "(SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey AND r.reskind IN " + CEMENTED_KINDS + ") AS reskinddept, " +
        "(SELECT MIN(ISNULL(sm.soimoistdept_r, 200)) FROM comonth cm INNER JOIN cosoilmoist sm ON sm.comonthkey = cm.comonthkey " +
        "WHERE cm.cokey = c.cokey AND sm.soimoiststat = 'Wet' AND (" + growingSeasonSQL() + ")) AS wtdepth, " +
        "(SELECT COUNT(*) FROM cogeomordesc g WHERE g.cokey = c.cokey) AS landforms, " +
        "(SELECT SUM(s.sfragcov_r) FROM cosurffrags s WHERE s.cokey = c.cokey AND s.sfragsize_l >= 250) AS stones250, " +
        "(SELECT MAX(CASE cm.flodfreqcl WHEN 'Very rare' THEN 1 WHEN 'Rare' THEN 2 WHEN 'Occasional' THEN 3 WHEN 'Common' THEN 3 " +
        "WHEN 'Frequent' THEN 4 WHEN 'Very frequent' THEN 5 ELSE 0 END) FROM comonth cm WHERE cm.cokey = c.cokey) AS floodrater, " +
        "(SELECT MAX(CASE cm.pondfreqcl WHEN 'Rare' THEN 1 WHEN 'Occasional' THEN 2 WHEN 'Common' THEN 2 WHEN 'Frequent' THEN 3 ELSE 0 END) " +
        "FROM comonth cm WHERE cm.cokey = c.cokey) AS pondrater, " +
        "(SELECT COUNT(*) FROM cogeomordesc g WHERE g.cokey = c.cokey AND g.geomfname = 'sinkhole') AS sinkholes " +
        "FROM component c WHERE c.mukey IN (" + keyList(mukeys) + ")";
    }
  };

  // Parse SDA "JSON+COLUMNNAME" payloads: {Table:[[cols...],[row...],...]}
  function parseSDA(payload) {
    var t = payload && payload.Table;
    if (!t || !t.length) return [];
    var cols = t[0];
    return t.slice(1).map(function (row) { var o = {}; cols.forEach(function (c, i) { o[c] = row[i]; }); return o; });
  }

  // Assemble component inputs from the three tabular queries.
  function assemble(ratingRows, horizonRows, siteRows) {
    var comps = {}, order = [];
    ratingRows.forEach(function (r) {
      var ck = String(r.cokey);
      if (!comps[ck]) {
        comps[ck] = { cokey: ck, mukey: String(r.mukey), musym: r.musym, muname: r.muname, areasymbol: r.areasymbol,
          compname: r.compname, comppct_r: n(r.comppct_r), majcompflag: r.majcompflag, slope_r: n(r.slope_r),
          taxorder: r.taxorder, taxsuborder: r.taxsuborder, taxgrtgroup: r.taxgrtgroup, taxsubgrp: r.taxsubgrp,
          top: null, stored: {}, horizons: [], site: {} };
        order.push(ck);
      }
      if (r.ruledepth === null || r.ruledepth === undefined || r.ruledepth === "") return;
      var lev = { ll: n(r.interpll), rep: n(r.interphr), hh: n(r.interphh), cls: r.interphrc, llc: r.interpllc, hhc: r.interphhc };
      if (String(r.ruledepth) === "0") comps[ck].top = lev;
      else { var s = BY_NAME[r.rulename]; if (s) comps[ck].stored[s.key] = lev; }
    });
    horizonRows.forEach(function (h) { var c = comps[String(h.cokey)]; if (c) c.horizons.push(h); });
    siteRows.forEach(function (s) { var c = comps[String(s.cokey)]; if (c) c.site = s; });
    return order.map(function (k) { return comps[k]; });
  }

  return {
    RULE: RULE, DYN_WEIGHT: DYN_WEIGHT, SUBRULES: SUBRULES, BY_KEY: BY_KEY, BY_NAME: BY_NAME,
    SITE_KEYS: SITE_KEYS, DYN_KEYS: DYN_KEYS, CALC_NOTES: CALC_NOTES,
    sRise: sRise, sFall: sFall, bdRatio: bdRatio, slopeO: slopeO, growingMonths: growingMonths, floodNameClass: floodNameClass, combine: combine, classify: classify, classCode: classCode,
    computeProps: computeProps, membershipFromProps: membershipFromProps, buildComponent: buildComponent,
    customScore: customScore, rollup: rollup, SQL: SQL, parseSDA: parseSDA, assemble: assemble, round3: round3
  };
}));
