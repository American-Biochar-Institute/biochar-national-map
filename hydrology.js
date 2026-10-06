/* National overview: Natural Earth. Close-up waterways: USGS National Hydrography Dataset. */
(function () {
  'use strict';
  var service = 'https://biochar-national-data.abi-verified-api.workers.dev/hydro/';
  var cache = new Map(), overview = {}, pendingOverview = {};
  function loadOverview(kind) {
    if (!pendingOverview[kind]) pendingOverview[kind] = fetch(kind === 'rivers' ? 'hydro-major-rivers.geojson' : 'hydro-lakes.geojson')
      .then(function (r) { if (!r.ok) throw Error('Water overview unavailable'); return r.json(); })
      .then(function (j) { overview[kind] = j; return j; }).catch(function (e) { delete pendingOverview[kind]; throw e; });
    return pendingOverview[kind];
  }
  async function query(id, where, bounds, zoom, signal) {
    var bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    var key = id + ':' + zoom + ':' + bbox.map(function (n) { return n.toFixed(4); }).join(',');
    if (cache.has(key)) return cache.get(key);
    var features = [], offset = 0;
    while (true) {
      var params = new URLSearchParams({ f: 'geojson', where: where, geometry: bbox.join(','), geometryType: 'esriGeometryEnvelope',
        inSR: '4326', outSR: '4326', outFields: id === 4 ? 'OBJECTID,GNIS_NAME,FTYPE,StreamOrde' : id === 6 ? 'OBJECTID,gnis_name,ftype' : 'OBJECTID,GNIS_NAME,FTYPE,AREASQKM',
        spatialRel: 'esriSpatialRelIntersects', returnGeometry: 'true', returnZ: 'false', returnM: 'false',
        maxAllowableOffset: String(360 / (256 * Math.pow(2, zoom))), resultRecordCount: '2000' });
      if (offset) params.set('resultOffset', String(offset));
      var response = await fetch(service + id + '/query?' + params, { signal: signal });
      if (!response.ok) throw Error('USGS water detail unavailable');
      var j = await response.json();
      if (j.error || !Array.isArray(j.features)) throw Error('USGS water detail unavailable');
      features = features.concat(j.features); offset += j.features.length;
      if (!j.exceededTransferLimit && j.features.length < 2000) break;
      if (!j.features.length) break;
      if (offset >= 40000) throw Error('Zoom closer for full water detail');
    }
    var result = { type: 'FeatureCollection', features: features };
    cache.set(key, result); while (cache.size > 16) cache.delete(cache.keys().next().value);
    return result;
  }
  function name(f) { var p = f.properties || {}; return String(p.gnis_name || p.GNIS_NAME || p.name || p.name_en || '').trim(); }
  function waterType(p) { var value = p.FTYPE || p.ftype, numeric = Number(value); if (Number.isFinite(numeric)) return numeric;
    return { streamriver: 460, artificialpath: 558, connector: 334, lakepond: 390, reservoir: 436 }[String(value).toLowerCase().replace(/[^a-z]/g, '')] || 0;
  }
  function labelPoints(f, bounds) {
    var points = []; function visit(c) { if (typeof c[0] === 'number') { if (bounds.contains([c[1], c[0]])) points.push(c); } else c.forEach(visit); }
    visit(f.geometry.coordinates); return points;
  }
  var WaterLayer = L.Layer.extend({
    initialize: function (kind) { this.kind = kind; this._group = L.layerGroup(); this._refresh = this._refresh.bind(this); this._generation = 0; },
    onAdd: function (map) { this._map = map; this._group.addTo(map); map.on('moveend', this._refresh); this._refresh(); },
    onRemove: function (map) { map.off('moveend', this._refresh); map.removeLayer(this._group); this._generation++; clearTimeout(this._timer); clearTimeout(this._retryTimer); if (this._abort) this._abort.abort(); this._map = null; this._status(''); },
    getAttribution: function () { return 'Water: <a href="https://www.naturalearthdata.com/">Natural Earth</a>' + (this.kind === 'rivers' ? ', <a href="https://www.usgs.gov/national-hydrography">USGS</a>' : ''); },
    _status: function (text) { var el = document.getElementById('water-status-' + this.kind); if (el) { el.textContent = text; el.style.display = text ? 'block' : 'none'; } },
    _paint: function (collections, detailed) {
      if (!this._map) return;
      var map = this._map, zoom = map.getZoom(), bounds = map.getBounds(), kind = this.kind, group = this._group;
      this._group.clearLayers(); var features = [];
      collections.forEach(function (collection) { features = features.concat(collection.features); });
      features = features.filter(function (f) { return detailed || Number(f.properties.min_zoom || 0) <= zoom + 0.5; });
      var gj = { type: 'FeatureCollection', features: features };
      if (kind === 'rivers') {
        L.geoJSON(gj, { pane: 'riverPane', interactive: false, renderer: L.canvas({ pane: 'riverPane' }), style: { color: '#ffffff', weight: zoom >= 10 ? 4.2 : 3.2, opacity: 0.85 } }).addTo(this._group);
        L.geoJSON(gj, { pane: 'riverPane', interactive: false, renderer: L.canvas({ pane: 'riverPane' }), style: { color: '#1879ba', weight: zoom >= 10 ? 2.2 : 1.5, opacity: 1 } }).addTo(this._group);
      } else {
        L.geoJSON(gj, { pane: 'waterPane', interactive: false, renderer: L.canvas({ pane: 'waterPane' }), style: { color: '#378abd', weight: 0.7, opacity: 0.9, fillColor: '#b4dceb', fillOpacity: 0.95 } }).addTo(this._group);
      }
      var candidates = new Map(), occupied = [], shown = 0;
      features.forEach(function (f) { var nm = name(f); if (!nm) return; var points = labelPoints(f, bounds); if (!points.length) return; var old = candidates.get(nm); if (!old || points.length > old.length) candidates.set(nm, points); });
      if (zoom < (kind === 'rivers' ? 5 : 6)) return;
      candidates.forEach(function (points, nm) {
        if (shown >= 30) return; var p = points[Math.floor(points.length / 2)], screen = map.latLngToContainerPoint([p[1], p[0]]);
        if (occupied.some(function (q) { return Math.abs(q.x - screen.x) < 135 && Math.abs(q.y - screen.y) < 25; })) return;
        occupied.push(screen); shown++; var label = document.createElement('span'); label.textContent = nm;
        L.marker([p[1], p[0]], { pane: 'waterLabelPane', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'water-name', html: label.outerHTML, iconSize: [160, 16], iconAnchor: [80, 8] }) }).addTo(group);
      });
    },
    _refresh: function (retry) {
      var self = this; clearTimeout(this._timer); clearTimeout(this._retryTimer); if(retry !== true) this._retries = 0; if (this._abort) this._abort.abort(); var generation = ++this._generation;
      this._timer = setTimeout(async function () {
        if (!self._map) return; var map = self._map, zoom = map.getZoom();
        try { var gj = await loadOverview(self.kind); if (generation !== self._generation) return;
          if (self._detail && self._detailBounds.contains(map.getBounds())) self._paint(self._detail, true); else self._paint([gj], false);
        } catch (e) { self._status('Water overview unavailable.'); }
        if (generation !== self._generation || !self._map) return;
        if (self.kind === 'water') { self._status(''); return; }
        if (zoom < (self.kind === 'rivers' ? 8 : 10)) { self._status(''); return; }
        self._abort = new AbortController(); var abort = self._abort; var timeout = setTimeout(function () { abort.abort(); }, 30000);
        self._status('Loading water detail…');
        try {
          var bounds = map.getBounds(); var data;
          if (self.kind === 'rivers') {
            var lines = await query(zoom >= 12 ? 6 : 4, zoom >= 12 ? '1=1' : "StreamOrde >= " + (zoom <= 8 ? 7 : zoom === 9 ? 6 : 5) + " OR GNIS_NAME LIKE '%River%'", bounds, zoom, abort.signal);
            data = [{ type: 'FeatureCollection', features: lines.features.filter(function (f) {
              var p = f.properties; return [460, 558, 334].includes(waterType(p)) && (Number(p.StreamOrde || 0) >= (zoom <= 8 ? 7 : zoom === 9 ? 6 : 5) || /\b(river|fork)\b/i.test(name(f)));
            }) }];
          }
          if (generation === self._generation && self._map) { self._detail = data; self._detailBounds = bounds; self._paint(data, true); self._status(''); }
        } catch (e) { if (generation === self._generation && self._map) { console.warn('Water detail: ' + e.message);
          if(self._retries < 2) { self._retries++; self._status('Retrying water detail…'); self._retryTimer = setTimeout(function(){self._refresh(true);},1000); }
          else self._status('USGS water detail unavailable.');
        } }
        finally { clearTimeout(timeout); }
      }, 250);
    }
  });
  window.createNationalWaterLayers = function (map) {
    [['waterPane', 330], ['riverPane', 390], ['waterLabelPane', 405]].forEach(function (p) { if (!map.getPane(p[0])) map.createPane(p[0]); map.getPane(p[0]).style.zIndex = p[1]; map.getPane(p[0]).style.pointerEvents = 'none'; });
    return { rivers: new WaterLayer('rivers'), water: new WaterLayer('water') };
  };
}());
