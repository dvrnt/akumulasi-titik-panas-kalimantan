/* global L */
const number = new Intl.NumberFormat('id-ID');
let map, highLayer, concessionLayers = {}, concessionLoading = false, concessionsLoaded = false;

const $ = id => document.getElementById(id);
const concessionLabels = {'Oil Palm': 'Kelapa sawit', 'Mining': 'Tambang', 'Logging': 'Kayu', 'Wood Fiber': 'Kayu fiber'};

function positionHud() {
  const topbar = document.querySelector('.topbar');
  const metrics = document.querySelector('.metrics');
  const controls = document.querySelector('.controls');
  if (!topbar || !metrics || !controls) return;
  const gap = 8;
  const topbarBottom = topbar.getBoundingClientRect().bottom;
  metrics.style.top = `${Math.ceil(topbarBottom + gap)}px`;
  controls.style.top = `${Math.ceil(metrics.getBoundingClientRect().bottom + gap)}px`;
}

const FixedDotLayer = L.Layer.extend({
  initialize(points) {
    this.points = points;
  },
  onAdd(mapInstance) {
    this.map = mapInstance;
    this.canvas = L.DomUtil.create('canvas', 'fixed-hotspot-dots');
    this.map.getPane('hotspotsPane').appendChild(this.canvas);
    this.map.on('moveend zoomend resize', this.redraw, this);
    this.redraw();
  },
  onRemove(mapInstance) {
    mapInstance.off('moveend zoomend resize', this.redraw, this);
    this.canvas?.remove();
  },
  redraw() {
    const size = this.map.getSize();
    const pixelRatio = window.devicePixelRatio || 1;
    const origin = this.map.containerPointToLayerPoint([0, 0]);
    const canvas = this.canvas;
    canvas.width = Math.round(size.x * pixelRatio);
    canvas.height = Math.round(size.y * pixelRatio);
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, origin);
    const context = canvas.getContext('2d');
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size.x, size.y);
    context.fillStyle = '#d74424';
    context.globalAlpha = 0.82;
    context.beginPath();
    for (const [lon, lat] of this.points) {
      const point = this.map.latLngToLayerPoint([lat, lon]);
      const x = point.x - origin.x;
      const y = point.y - origin.y;
      if (x < -3 || y < -3 || x > size.x + 3 || y > size.y + 3) continue;
      context.moveTo(x + 2.25, y);
      context.arc(x, y, 2.25, 0, Math.PI * 2);
    }
    context.fill();
  }
});

function initMap() {
  map = L.map('map', {zoomControl: false}).setView([0.25, 114.1], 5);
  map.createPane('concessionsPane');
  map.getPane('concessionsPane').style.zIndex = 420;
  map.createPane('hotspotsPane');
  map.getPane('hotspotsPane').style.zIndex = 650;
  map.getPane('hotspotsPane').style.pointerEvents = 'none';
  map.createPane('concessionTooltipPane');
  map.getPane('concessionTooltipPane').style.zIndex = 750;
  L.control.zoom({position: 'topright'}).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    updateWhenIdle: true,
    keepBuffer: 1,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

function updateStats(summary) {
  $('totalHigh').textContent = number.format(summary.totalHigh);
  $('insideConcession').textContent = number.format(summary.insideConcession);
  $('concessionPercent').textContent = `${summary.insideConcessionPct.toLocaleString('id-ID', {maximumFractionDigits: 1})}%`;
}

function selectedConcessionTypes() {
  return new Set([...document.querySelectorAll('[data-concession-type]')]
    .filter(input => input.checked)
    .map(input => input.dataset.concessionType));
}

function syncConcessionVisibility() {
  const selected = selectedConcessionTypes();
  Object.entries(concessionLayers).forEach(([rawType, layer]) => {
    const shouldShow = selected.has(rawType);
    if (shouldShow) layer.addTo(map);
    else layer.remove();
  });
}

async function loadConcessions() {
  if (concessionsLoaded || concessionLoading) return;
  concessionLoading = true;
  try {
    const response = await fetch('data/mobile/concessions-lite.geojson', {cache: 'force-cache'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const types = {'Oil Palm':'#7354a3', 'Wood Fiber':'#3f8e75', 'Mining':'#7f6354', 'Logging':'#386d9c'};
    const geojson = await response.json();
    geojson.features.forEach(feature => {
      const rawType = feature.properties.concession_type || 'Tidak diketahui';
      const type = concessionLabels[rawType] || rawType;
      const color = types[rawType] || '#664f91';
      const layer = L.geoJSON(feature, {
        pane: 'concessionsPane',
        style: {color, weight: 1, fillColor: color, fillOpacity: .20}
      });
      layer.bindTooltip(`<b>${type}</b><br>Area konsesi Kalimantan`, {
        sticky: true,
        direction: 'top',
        pane: 'concessionTooltipPane',
        className: 'concession-tooltip'
      });
      layer.on({
        mouseover: event => event.target.setStyle({weight: 2, fillOpacity: .24}),
        mouseout: event => layer.setStyle({weight: 1, fillOpacity: .20})
      });
      concessionLayers[rawType] = layer;
    });
    concessionsLoaded = true;
    syncConcessionVisibility();
  } catch (error) {
    console.error(error);
  } finally {
    concessionLoading = false;
  }
}

async function boot() {
  try {
    const [summaryResponse, hotspotResponse] = await Promise.all([
      fetch('data/mobile/high-summary.json', {cache: 'force-cache'}),
      fetch('data/mobile/hotspots-high-2026-08-01_2026-08-28.json', {cache: 'force-cache'})
    ]);
    if (!summaryResponse.ok || !hotspotResponse.ok) throw new Error('Payload hotspot high tidak tersedia');
    const [summary, hotspots] = await Promise.all([summaryResponse.json(), hotspotResponse.json()]);
    if (hotspots.points.length !== summary.totalHigh) throw new Error('Jumlah titik tidak konsisten');
    initMap();
    updateStats(summary);
    positionHud();
    window.addEventListener('resize', positionHud);
    highLayer = new FixedDotLayer(hotspots.points).addTo(map);
    $('hotspotToggle').addEventListener('change', event => {
      if (event.target.checked) highLayer.addTo(map);
      else highLayer.remove();
    });
    document.querySelectorAll('[data-concession-type]').forEach(input => {
      input.addEventListener('change', async () => {
        await loadConcessions();
        syncConcessionVisibility();
      });
    });
    await loadConcessions();
    $('loading').hidden = true;
  } catch (error) {
    console.error(error);
    $('loading').textContent = 'Peta tidak dapat dimuat. Buka melalui server lokal.';
  }
}

boot();
