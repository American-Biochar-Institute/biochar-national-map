/*
 * biochar_engine.js  (v1.1, October 2026)
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
 * What is approximate (flagged in CALC_NOTES and in the UI):
 *   - Water table, MEQ, LEP, and flooding do not reproduce every stored NRCS
 *     value from SSURGO properties. The bulk density ratio comes from the NASIS
 *     property script for property 62702 (public NASIS export, July 2024).
 *   - These only matter where NRCS did not store the subrule value (NRCS keeps
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
  var SLOPE_O_TABLE = [
    { oMax: 2, a: 6, b: 15.1 }, { oMax: 4, a: 8, b: 20.1 }, { oMax: 6, a: 10, b: 25.1 },
    { oMax: 8, a: 12, b: 30.1 }, { oMax: 10, a: 15, b: 35.1 }, { oMax: Infinity, a: 20, b: 45.1 }
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
      criteria: "Growing-season water table: >75 cm well suited, 15-75 somewhat, <15 poorly. Null = well suited.",
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
      criteria: "None to very rare well suited; rare to occasional somewhat; frequent poorly. Null = well suited.",
      inputs: [{ id: "cls", label: "Flooding frequency class", type: "select", options: FLOOD_CLASSES }],
      prop: function (p) { return p.floodclass; }, propUnit: "class",
      curve: function (x) { return x === null || x === undefined ? 1 : (x in FLOOD_VALUE ? FLOOD_VALUE[x] : null); },
      fromInputs: function (v) { return { prop: v.cls || null }; } },
    { key: "cobble", group: "site", name: "SOH - Cobble and Stone Content 0-30cm", label: "Cobbles and stones",
      criteria: "Fragments >=75 mm in 0-30 cm: <2% well, >15% poorly. Surface stones >=250 mm: <0.1% well, >3% poorly. Lower of the two.",
      inputs: [{ id: "frag75", label: "Fragments >=75 mm, 0-30 cm (% volume)", unit: "%" }, { id: "stone250", label: "Surface stones >=250 mm (% cover)", unit: "%", def: 0 }],
      prop: function (p) { return p.frag75; }, propUnit: "% vol >=75 mm",
      curve: function (x, p) {
        var a = sFall(isNum(x) ? x : 0, 2, 15), b = sFall(p && isNum(p.stone250) ? p.stone250 : 0, 0.1, 3);
        return Math.min(a, b);
      },
      fromInputs: function (v) { return { prop: isNum(v.frag75) ? +v.frag75 : 0, extra: { stone250: isNum(v.stone250) ? +v.stone250 : 0 } }; } },
    { key: "karst", group: "site", name: "SOH - Karst landform", label: "Karst",
      criteria: "Map unit name contains 'karst', and sinkholes listed or no landform data = poorly suited.",
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

  var CALC_NOTES = {
    ph: "Weighted average 0-30 cm below thin (<20 cm) surface O horizons, stops at a restriction. Matches 99.8% of stored values.",
    oc: "Sum of OM/1.724 x bulk density x thickness x fine-earth volume to 30 cm (fragment weight converted to volume). Matches 99.8%.",
    ksat: "Maximum 0-30 cm from the surface, stops at a restriction. Matches 99.7%.",
    awc: "Weighted average 0-30 cm below thin (<20 cm) surface O horizons. Matches 99.8% on mineral soils, lower with O horizons.",
    meq: "Sum of CEC7 x bulk density x thickness x (1 - fragment volume) to 30 cm. Matches about 97% outside urban survey areas, 71% overall.",
    lep: "Maximum 0-30 cm below thin surface O horizons. Matches about 84% (rarely limiting).",
    bd: "NASIS property 62702: (Db 1/3 bar - ideal) / delta, ideal = (1.65 sand + 1.30 silt + 1.25 clay)/100, delta = 0.002081 sand + 0.003912 silt + 0.0024351 clay. Maximum over horizons starting within 31 cm below the surface O horizon; Histosols and histic soils = 0. Matches 99.9% of stored values.",
    wt: "Shallowest 'Wet' soil moisture depth in any month. Matches about 93%.",
    slope: "Representative slope and surface O-horizon thickness on the response surface. Matches about 99% on mineral soils.",
    cobble: "Max fragment volume >=75 mm in 0-30 cm and surface cover of stones >=250 mm; lower of the two. Matches about 97%.",
    flood: "Most frequent monthly flooding class. Rare = 0.6, occasional = 0.2, frequent = 0.",
    pond: "Most frequent monthly ponding class. Rare = 0.17, occasional or frequent = 0.",
    karst: "'Karst' in the map unit name, with sinkholes listed or no landform data."
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
  // SSURGO properties -> subrule inputs
  // comp.horizons: [{hzname, hzdept_r, hzdepb_r, ph1to1h2o_r, om_r, dbthirdbar_r,
  //   awc_r, ksat_r, lep_r, cec7_r, sieveno10_r, frag3to10_r, fraggt10_r,
  //   fragvol_tot, fragvol_75}]
  // comp.site: {resdept, wtdepth, stones250, floodrater, pondrater, sinkholes}
  // comp.slope_r, comp.muname
  // ---------------------------------------------------------------------------
  function isO(h) { return /^\^?\d*O/.test(h.hzname || ""); }
  function n(v) { return isNum(v) ? +v : null; }

  function computeProps(comp) {
    var hz = (comp.horizons || []).filter(function (h) { return isNum(h.hzdept_r) && isNum(h.hzdepb_r); })
      .map(function (h) { var o = {}; for (var k in h) o[k] = h[k]; o.top = +h.hzdept_r; o.bot = +h.hzdepb_r; return o; })
      .sort(function (a, b) { return a.top - b.top; });
    var site = comp.site || {};
    var res = n(site.resdept);
    var othk = 0;
    for (var i = 0; i < hz.length; i++) { if (isO(hz[i]) && hz[i].top <= othk + 0.01) othk = hz[i].bot; else break; }

    function windowRows(z0, dropO, stopRes, depth) {
      var end = z0 + (depth || 30);
      if (stopRes && res !== null) end = Math.min(end, res);
      var out = [];
      hz.forEach(function (h) {
        if (dropO && isO(h)) return;
        var t = Math.min(h.bot, end) - Math.max(h.top, z0);
        if (t > 0) out.push({ h: h, t: t });
      });
      return out;
    }
    function wavg(rows, f) {
      var s = 0, w = 0;
      rows.forEach(function (r) { var v = n(r.h[f]); if (v !== null) { s += v * r.t; w += r.t; } });
      return w > 0 ? s / w : null;
    }
    function vmax(rows, f) {
      var m = null;
      rows.forEach(function (r) { var v = n(r.h[f]); if (v !== null && (m === null || v > m)) m = v; });
      return m;
    }
    // Window that skips thin surface O horizons (pH, AWC, LEP)
    var mineralTop = null;
    hz.forEach(function (h) { if (!isO(h) && (mineralTop === null || h.top < mineralTop)) mineralTop = h.top; });
    var thinO = othk < 20;
    var wMin = thinO ? windowRows(mineralTop === null ? 0 : mineralTop, true, true) : windowRows(0, false, true);
    var wSurf = windowRows(0, false, true);
    var wSurfNoStop = windowRows(0, false, false);

    function fineEarthVol(h) {
      var s10 = isNum(h.sieveno10_r) ? +h.sieveno10_r / 100 : 1;
      var w75 = ((n(h.frag3to10_r) || 0) + (n(h.fraggt10_r) || 0)) / 100;
      var feW = (1 - w75) * s10, frW = 1 - feW, db = n(h.dbthirdbar_r);
      if (!db || frW <= 0) return 1;
      var vf = (frW / 2.65) / ((frW / 2.65) + (feW / db));
      return 1 - vf;
    }
    var oc = null, meq = null;
    wSurf.forEach(function (r) {
      var om = n(r.h.om_r), db = n(r.h.dbthirdbar_r), cec = n(r.h.cec7_r);
      if (om !== null && db !== null) oc = (oc || 0) + om / 1.724 / 100 * db * r.t * fineEarthVol(r.h) * 10;
      if (cec !== null && db !== null) meq = (meq || 0) + cec / 100 * db * r.t * (1 - (n(r.h.fragvol_tot) || 0) / 100);
    });
    var frag75 = null;
    wSurfNoStop.forEach(function (r) { var v = n(r.h.fragvol_75) || 0; if (frag75 === null || v > frag75) frag75 = v; });

    var fr = n(site.floodrater), pr = n(site.pondrater);
    return {
      othk: othk,
      ph: wavg(wMin, "ph1to1h2o_r"),
      awc: wavg(wMin, "awc_r"),
      lep: vmax(wMin, "lep_r"),
      ksat: vmax(wSurf, "ksat_r"),
      oc: oc, meq: meq,
      frag75: frag75 === null ? 0 : frag75,
      stone250: n(site.stones250) || 0,
      wtdepth: n(site.wtdepth),
      floodclass: fr === null ? null : FLOOD_RATER[fr],
      pondclass: pr === null ? null : POND_RATER[pr],
      slope: n(comp.slope_r),
      karst: (n(site.sinkholes) || 0) > 0 || /karst/i.test(comp.muname || ""),
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
        "(SELECT SUM(f.fragvol_r) FROM chfrags f WHERE f.chkey = ch.chkey) AS fragvol_tot, " +
        "(SELECT SUM(f.fragvol_r) FROM chfrags f WHERE f.chkey = ch.chkey AND f.fragsize_l >= 75) AS fragvol_75 " +
        "FROM component c INNER JOIN chorizon ch ON ch.cokey = c.cokey WHERE c.mukey IN (" + keyList(mukeys) + ") " +
        "AND ch.hzdept_r < 150 ORDER BY ch.cokey, ch.hzdept_r";
    },
    site: function (mukeys) {
      return "SELECT c.cokey, " +
        "(SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey) AS resdept, " +
        "(SELECT MIN(r.resdept_r) FROM corestrictions r WHERE r.cokey = c.cokey AND (r.reshard LIKE '%strongly cemented%' OR r.reshard LIKE 'indurated%')) AS cemdept, " +
        "(SELECT MIN(sm.soimoistdept_r) FROM comonth cm INNER JOIN cosoilmoist sm ON sm.comonthkey = cm.comonthkey " +
        "WHERE cm.cokey = c.cokey AND sm.soimoiststat = 'Wet') AS wtdepth, " +
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
    sRise: sRise, sFall: sFall, bdRatio: bdRatio, slopeO: slopeO, combine: combine, classify: classify, classCode: classCode,
    computeProps: computeProps, membershipFromProps: membershipFromProps, buildComponent: buildComponent,
    customScore: customScore, rollup: rollup, SQL: SQL, parseSDA: parseSDA, assemble: assemble, round3: round3
  };
}));
