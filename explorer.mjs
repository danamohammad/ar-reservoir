import {createScenarioView, scenarioFrame, saturationColor} from './scenario.mjs';
import {parseHistory, sampleAt, cellAddress, textureEstimate, parseGLB, accessorFloats, RATE_COLUMNS} from './data.mjs';

const $ = id => document.getElementById(id);
const mv = $('reservoir');
const names = ['Initial oil saturation', 'Permeability · heterogeneous', 'Permeability · homogeneous', 'Porosity · heterogeneous', 'Porosity · homogeneous', 'Depth · TVD'];
const shortNames = ['Oil saturation', 'Permeability · het.', 'Permeability · hom.', 'Porosity · het.', 'Porosity · hom.', 'Depth · TVD'];
const notes = ['Initial state from EQUIL: oil–water contact 6,750 ft; connate water saturation 0.25. No time evolution.', 'Horizontal permeability. Logarithmic scale preserves variation across three orders of magnitude.', 'Original homogeneous-case permeability row. Values are static.', 'Original heterogeneous porosity, shown as a fraction of bulk volume.', 'Original homogeneous-case porosity. Values are static.', 'Original cell-centre true vertical depth, in feet. The vertical scale is not exaggerated.'];
const fmt = (v, row) => row === 5 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) < 1 ? v.toFixed(3) : Number(v.toPrecision(3)).toLocaleString('en-US');
const position = p => `${p.x}m ${p.y}m ${p.z}m`;
let scenario;
const arModel = document.getElementById('ar-reservoir');
let meta, glb, texture, arManifest, assetReady = false, ready = false, selectedProperty = 0, selectedWell = 'PROD-1', selectedCell = null;
let mode = 'flow', playing = false, illustrativeDay = 0, productionIndex = 0, history = null, sourceName = '', playbackRemainder = 0;
let animationFrame = null, lastFrame = null, lastPaint = 0, pointerStart = null;
const wellBounds = new Map(), wellHotspots = new Map(), particles = [];
const ILLUSTRATION_END_DAY = 30;
const fittedRadius = () => mv.clientWidth < 500 ? 1.28 : 1.12;
const fail = message => { $('scene-error').hidden = false; $('scene-error').textContent = message; $('loading').hidden = true; pause(); };
const fetchChecked = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r; };

function setProperty(index) {
  selectedProperty = index;
  const p = index === 6 || (index === 0 && mode === 'flow') ? {min:0,max:1,unit: index === 6 ? 'Sw, fraction' : 'So, fraction',scale:'lin'} : meta.properties[index];
  document.querySelectorAll('.property').forEach((b, i) => { b.classList.toggle('active', i === index); b.setAttribute('aria-pressed', i === index); });
  const dynamic = mode === 'flow' && (index === 0 || index === 6);
  $('scene-title').textContent = dynamic ? `Calculated ${index === 6 ? 'water' : 'oil'} saturation` : index === 6 ? 'Initial water saturation' : names[index];
  $('legend-name').textContent = index === 6 ? 'Water saturation' : shortNames[index];
  document.querySelector('.color-ramp').classList.toggle('saturation', dynamic || index === 6);
  document.querySelector('.color-ramp').classList.toggle('banded', (dynamic || index === 6) && $('contours').checked);
  document.querySelector('.color-ramp').style.background = (dynamic || index === 6) && $('contours').checked ? `linear-gradient(90deg,${Array.from({length:11},(_,n)=>`rgb(${saturationColor(n/10).join(',')}) ${Math.max(0,(n-.5)*10)}% ${Math.min(100,(n+.5)*10)}%`).join(',')})` : '';
  $('legend-scale').textContent = p.scale === 'log' ? 'Logarithmic' : 'Linear';
  const mid = p.scale === 'log' ? Math.sqrt(p.min * p.max) : (p.min + p.max) / 2;
  $('legend-ticks').replaceChildren(...[p.min, mid, p.max].map(v => { const e = document.createElement('span'); e.textContent = fmt(v, index); return e; }));
  $('legend-unit').textContent = p.unit + (dynamic ? ' · fixed 0–1 scale' : '');
  $('property-note').textContent = dynamic ? 'Calculated conservative oil–water scenario. Fixed scale across all days; assumptions in the information panel.' : index === 6 ? 'Initial water = 1 − original initial oil saturation. Not imported dynamic data.' : notes[index];
  const asset = arManifest.properties[index === 6 ? 0 : index];
  arModel.setAttribute('ios-src', asset.usdz);
  arModel.setAttribute('src', asset.glb);
  $('ar-glb').href = asset.glb; $('ar-usdz').href = asset.usdz;
  $('ar-property').textContent = `Static AR property: ${names[index === 6 ? 0 : index]}. Calculated frames stay in the browser.`;
  if (scenario) scenario.paint(index, mode === 'flow' ? illustrativeDay : 0, mode === 'flow', true);

  if (selectedCell !== null) showCell(selectedCell);
}
function estimate(cell, row) {
  if (!texture) return null;
  const offset = (row * meta.grid.ncell + cell) * 4;
  return textureEstimate(texture.slice(offset, offset + 3), meta.properties[row]);
}
function showCell(id) {
  const address = cellAddress(id, meta.grid); if (!address) return;
  selectedCell = id;
  $('cell-prompt').hidden = true; $('cell-readout').hidden = false; $('clear-cell').hidden = false;
  $('cell-address').textContent = `I ${address.i} · J ${address.j} · K ${address.k}  /  cell ${id + 1}`;
  const dynamic = mode === 'flow' && (selectedProperty === 0 || selectedProperty === 6);
  const e = dynamic ? {value: scenario.value(id)} : selectedProperty === 6 ? {value: 1 - estimate(id, 0).value} : estimate(id, selectedProperty), p = selectedProperty === 6 ? {unit:'Sw, fraction'} : meta.properties[selectedProperty];
  $('cell-value').textContent = e ? `≈ ${fmt(e.value, selectedProperty)} ${p.unit.split(', ').at(-1)}` : 'Unavailable';
  $('cell-caption').textContent = dynamic ? `Calculated ${selectedProperty === 6 ? 'water' : 'oil'} saturation · Day ${scenario.info.days[scenarioFrame(illustrativeDay, scenario.info.days)]}. Scenario, not measured data.` : `${selectedProperty === 6 ? 'Initial water saturation' : names[selectedProperty]}. Approximation from the encoded texture; not full-precision simulator data.`;
  $('cell-other').replaceChildren(...[0, 3, 5].filter(r => r !== selectedProperty).map(r => { const d = document.createElement('div'); const a = document.createElement('span'), b = document.createElement('b'); a.textContent = shortNames[r]; const v = estimate(id, r); b.textContent = v ? `≈ ${fmt(v.value, r)}` : '—'; d.append(a, b); return d; }));
}
function selectWell(name) {
  selectedWell = name; const w = meta.wells.find(w => w.name === name);
  $('well-name').textContent = w.name; $('well-kind').textContent = w.kind === 'inj' ? 'Injector' : 'Producer';
  $('well-kind').style.color = w.kind === 'inj' ? 'var(--blue)' : 'var(--pink)';
  $('well-column').textContent = `I ${w.i} · J ${w.j}`;
  const depth = estimate((w.j - 1) * meta.grid.nx + w.i - 1, 5);
  $('well-depth').textContent = depth ? `${fmt(depth.value, 5)} ft` : 'Unavailable';
  let inspect = $('inspect-well');
  if (!inspect) { inspect = document.createElement('button'); inspect.id = 'inspect-well'; inspect.className = 'text-button'; inspect.style.marginTop = '12px'; inspect.textContent = 'Inspect top grid cell ↗'; document.querySelector('.detail-card').append(inspect); }
  inspect.onclick = () => { showCell((w.j - 1) * meta.grid.nx + w.i - 1); $('selection-pin').hidden = true; };
  document.querySelectorAll('.well-button').forEach(b => { const active = b.dataset.well === name; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active); });
  wellHotspots.forEach((b, n) => { b.classList.toggle('selected', name === n); b.setAttribute('aria-pressed', name === n); });
  renderProduction(); updateMotion();
}
function buildWellUI() {
  for (const w of meta.wells) {
    const b = document.createElement('button'); b.className = 'well-button'; b.dataset.well = w.name; b.dataset.kind = w.kind;
    b.innerHTML = '<i></i>'; b.append(document.createTextNode(w.name)); b.addEventListener('click', () => selectWell(w.name)); $('well-list').append(b);
    const hotspot = document.createElement('button'); hotspot.slot = `hotspot-well-${w.name}`; hotspot.className = 'hotspot-well'; hotspot.dataset.position = position(w); hotspot.dataset.normal = '0 1 0'; hotspot.dataset.kind = w.kind; hotspot.dataset.visibilityAttribute = 'visible'; hotspot.setAttribute('aria-label', `Inspect ${w.name}, ${w.kind === 'inj' ? 'injector' : 'producer'}`);
    const label = document.createElement('span'); label.className = 'well-label'; label.innerHTML = '<i></i>'; label.append(document.createTextNode(w.name));
    const stem = document.createElement('span'); stem.className = 'well-stem'; const cap = document.createElement('span'); cap.className = 'well-cap'; hotspot.append(label, stem, cap); hotspot.addEventListener('click', e => { e.stopPropagation(); selectWell(w.name); }); mv.append(hotspot); wellHotspots.set(w.name, hotspot);
    for (let n = 0; n < 2; n++) { const dot = document.createElement('span'); dot.slot = `hotspot-flow-${w.name}-${n}`; dot.className = 'flow-particle'; dot.dataset.kind = w.kind; dot.dataset.position = position(w); dot.dataset.normal = '0 1 0'; dot.setAttribute('aria-hidden', 'true'); dot.hidden = true; mv.append(dot); particles.push({dot, well: w, phase: n / 2}); }
  }
}
function updateMotion() {
  const active = mode === 'flow';
  // Previous decorative tube particles are retired in favor of solved surface flux.
  particles.forEach(p => p.dot.hidden = true);
  $('motion-label').hidden = !active;
  $('motion-label').textContent = active ? 'Calculated transport' : '';
  $('scenario-card').hidden = !active;
  $('flow-caption').hidden = !active || !$('flow-toggle').checked;
  if (scenario) {
    scenario.paint(selectedProperty, active ? illustrativeDay : 0, active);
    scenario.vectors(illustrativeDay, active && $('flow-toggle').checked);
    const w = scenario.well(selectedWell, illustrativeDay);
    $('well-scenario').hidden = !active;
    $('well-scenario').textContent = w.injection > 0 ? `Calculated injection: ${w.injection.toFixed(5)} PV/day · assumed control` : `Calculated oil: ${w.oil.toFixed(5)} · water: ${w.water.toFixed(5)} PV/day`;
    if (selectedCell !== null && (selectedProperty === 0 || selectedProperty === 6)) showCell(selectedCell);
  }
}

function layoutWellLabels() {
  if (!ready || !$('labels-toggle').matches('[aria-pressed="true"]')) return;
  const width = mv.clientWidth, height = mv.clientHeight, occupied = [];
  const labels = [...wellHotspots].map(([name, el]) => ({el, hit: mv.queryHotspot(el.slot)})).filter(v => v.hit).sort((a, b) => a.hit.canvasPosition.x - b.hit.canvasPosition.x);
  for (const {el, hit} of labels) {
    const x = hit.canvasPosition.x, y = hit.canvasPosition.y, label = el.querySelector('.well-label');
    const w = label.offsetWidth || 68, h = label.offsetHeight || 27; let chosen = null;
    for (const dy of [-32, -60, -88, 32, 64, 96, 128]) {
      for (const dx of [0, -42, 42, -78, 78, -110, 110]) {
        const box = {x: x + dx - w / 2, y: y + dy - h / 2, w, h};
        if (box.x < 7 || box.y < 12 || box.x + w > width - 7 || box.y + h > height - 65) continue;
        if (occupied.some(b => box.x < b.x + b.w + 7 && box.x + w + 7 > b.x && box.y < b.y + b.h + 5 && box.y + h + 5 > b.y)) continue;
        chosen = {dx, dy, box}; break;
      }
      if (chosen) break;
    }
    if (!chosen) { const cx = Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, x)); const cy = Math.max(h / 2 + 12, Math.min(height - h / 2 - 65, y - 32)); chosen = {dx: cx - x, dy: cy - y, box: {x: cx - w / 2, y: cy - h / 2, w, h}}; }
    occupied.push(chosen.box); label.style.left = `calc(50% + ${chosen.dx}px)`; label.style.top = `calc(50% + ${chosen.dy}px)`;
    const stem = el.querySelector('.well-stem'); stem.style.height = `${Math.hypot(chosen.dx, chosen.dy)}px`; stem.style.transform = `rotate(${Math.atan2(chosen.dx, -chosen.dy)}rad)`;
  }
}
function pause() { playing = false; if (animationFrame !== null) cancelAnimationFrame(animationFrame); animationFrame = null; lastFrame = null; updateTransport(); if (ready) updateMotion(); }
function play() {
  if (!ready || (mode === 'production' && !history)) return;
  if (mode === 'flow' && illustrativeDay >= ILLUSTRATION_END_DAY) illustrativeDay = 0;
  if (mode === 'production' && productionIndex >= history.days.length - 1) productionIndex = 0;
  playing = true; lastFrame = null; playbackRemainder = 0; updateTransport(); animationFrame = requestAnimationFrame(tick);
}
function tick(now) {
  if (!playing) return;
  const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
  const speed = Number($('speed').value);
  if (mode === 'flow') { illustrativeDay = Math.min(ILLUSTRATION_END_DAY, illustrativeDay + dt * speed); if (now - lastPaint > 32) { updateMotion(); updateTransport(); layoutWellLabels(); lastPaint = now; } if (illustrativeDay >= ILLUSTRATION_END_DAY) return pause(); }
  else { playbackRemainder += dt * speed; if (playbackRemainder >= 1) { const step = Math.floor(playbackRemainder); playbackRemainder -= step; productionIndex = Math.min(history.days.length - 1, productionIndex + step); updateTransport(); renderProduction(); if (productionIndex === history.days.length - 1) return pause(); } }
  animationFrame = requestAnimationFrame(tick);
}
function updateTransport() {
  const production = mode === 'production';
  const available = !production || !!history;
  const first = production ? history?.days[0] : 0;
  const last = production ? history?.days.at(-1) : ILLUSTRATION_END_DAY;
  const day = production ? history?.days[productionIndex] : scenario ? scenario.info.days[scenarioFrame(illustrativeDay, scenario.info.days)] : 0;
  const middle = production ? history?.days[Math.floor((history.days.length - 1) / 2)] : ILLUSTRATION_END_DAY / 2;
  $('play').disabled = !ready || (production && (!history || history.days.length < 2));
  $('play').textContent = playing ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${production ? 'production history' : 'animation days'}`);
  $('timeline').disabled = !ready || !available;
  $('timeline').max = production ? Math.max(0, (history?.days.length ?? 1) - 1) : ILLUSTRATION_END_DAY;
  $('timeline').step = production ? 1 : .25;
  $('timeline').value = production ? productionIndex : illustrativeDay;
  $('timeline').setAttribute('aria-label', production ? 'Recorded production day' : 'Animation day');
  $('timeline').setAttribute('aria-valuetext', available ? `Day ${day}${production ? ', recorded sample' : ', calculated scenario'}` : 'No daily history');
  $('day-kind').textContent = production ? 'Recorded production day' : 'Animation day';
  $('time-label').textContent = available ? `Day ${day}` : 'Day —';
  $('day-end').textContent = available ? `of ${last}${production ? ' · imported history' : ' · calculated scenario'}` : 'Load daily history to begin';
  $('day-start').textContent = available ? `Day ${first}` : '—';
  $('day-middle').textContent = available ? `Day ${middle}` : '—';
  $('day-last').textContent = available ? `Day ${last}` : '—';
  $('playback-state').textContent = !available ? 'Awaiting CSV' : playing ? 'Playing' : day === last ? 'Complete' : day === first ? 'Ready' : 'Paused';
}
function setMode(next) {
  pause(); mode = next;
  $('mode-flow').classList.toggle('active', mode === 'flow'); $('mode-flow').setAttribute('aria-pressed', mode === 'flow');
  $('mode-production').classList.toggle('active', mode === 'production'); $('mode-production').setAttribute('aria-pressed', mode === 'production');
  $('timeline-badge').textContent = mode === 'flow' ? 'Calculated scenario' : history ? `${history.days.length} recorded days` : 'History not supplied';
  $('playback-note').textContent = mode === 'flow' ? 'Calculated scenario days 0–30. At 1×, one assumed day advances per second. Output saved every 0.25 day. Camera remains manual.' : history ? 'One recorded sample per second at 1×, using the actual imported days. No interpolation; blank rates stay missing. Model properties stay static and camera stays manual.' : 'Load a daily history CSV for actual production days and rates, or use Animation day to view well-flow movement.';
  setProperty(selectedProperty); updateTransport(); updateMotion(); renderProduction();
}
function resetPlayback() { pause(); illustrativeDay = 0; productionIndex = 0; playbackRemainder = 0; updateMotion(); updateTransport(); renderProduction(); }
function setView(view) {
  const radius = fittedRadius(); const orbits = {perspective: `35deg 65deg ${radius}m`, top: `0deg 5deg ${radius}m`, side: `90deg 87deg ${radius}m`};
  mv.cameraTarget = '0m 0.035m 0m'; mv.cameraOrbit = orbits[view];
  // Wheel/pinch zoom can change the internal FOV without changing its attribute.
  mv.fieldOfView = '35deg'; mv.requestUpdate('fieldOfView');
  document.querySelectorAll('[data-view]').forEach(b => { const active = b.dataset.view === view; b.classList.toggle('active', active); b.setAttribute('aria-pressed', active); });
}
function renderProduction() {
  $('production-empty').hidden = !!history; $('production-loaded').hidden = !history; $('clear-history').hidden = !history;
  $('data-state').textContent = history ? 'Local CSV' : 'No history';
  if (!history) return;
  const day = history.days[productionIndex], key = $('rate-kind').value;
  const sample = sampleAt(history, day, selectedWell), rate = sample?.[key];
  $('rate-value').textContent = rate == null ? '—' : rate.toLocaleString('en-US', {maximumFractionDigits: 3});
  $('rate-unit').textContent = key === 'gas_scf_day' ? 'scf/day' : 'STB/day';
  $('rate-sample').textContent = rate == null ? `${selectedWell} · Day ${day}: no value recorded for this rate.` : `${selectedWell} · Day ${day}: exact imported sample.`;
  $('data-source').textContent = `Source: ${sourceName}. User-supplied local file; not independently verified.`;
  drawChart(key, day);
}
function drawChart(key, day) {
  const records = history.records.filter(r => r.well === selectedWell);
  const values = records.filter(r => r[key] !== null);
  const root = $('rate-chart'); root.replaceChildren();
  if (!values.length) { root.textContent = 'No samples for this well / metric.'; return; }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 240 90');
  const add = (tag, attrs, text) => { const el = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); if (text != null) el.textContent = text; svg.append(el); return el; };
  const first = history.days[0], last = history.days.at(-1), max = Math.max(...values.map(r => r[key]), 1);
  const x = d => 10 + (d - first) / Math.max(last - first, 1) * 220, y = v => 65 - v / max * 52;
  [13, 39, 65].forEach(v => add('line', {x1: 10, y1: v, x2: 230, y2: v, stroke: '#344154', 'stroke-dasharray': '3 4'}));
  // Discrete sample markers intentionally avoid inventing values between days.
  values.forEach(r => add('circle', {cx: x(r.day), cy: y(r[key]), r: r.day === day ? 4 : 2.5, fill: r.day === day ? '#fff' : '#82dec7'}));
  add('line', {x1: x(day), y1: 8, x2: x(day), y2: 68, stroke: '#e9c58c', 'stroke-width': .7});
  add('text', {x: 10, y: 84, fill: '#a7b4c5', 'font-size': 9}, `Day ${first}`); add('text', {x: 230, y: 84, fill: '#a7b4c5', 'font-size': 9, 'text-anchor': 'end'}, `Day ${last}`);
  add('text', {x: 230, y: 9, fill: '#a7b4c5', 'font-size': 8, 'text-anchor': 'end'}, `max ${Number(max.toPrecision(3))}`);
  root.append(svg); root.setAttribute('aria-label', `${selectedWell}, ${values.length} discrete ${key} samples, days ${first} to ${last}. Current day ${day}.`);
}

$('mode-flow').onclick = () => setMode('flow'); $('mode-production').onclick = () => setMode('production');
$('play').onclick = () => playing ? pause() : play(); $('reset-playback').onclick = resetPlayback;
$('timeline').oninput = () => { const value = Number($('timeline').value); pause(); if (mode === 'flow') { illustrativeDay = value; updateMotion(); } else { productionIndex = value; renderProduction(); } updateTransport(); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('reset-view').onclick = () => setView('perspective');
for (const [id, factor] of [['zoom-in', .8], ['zoom-out', 1.25]]) $(id).onclick = () => { const o = mv.getCameraOrbit(); mv.cameraOrbit = `${o.theta}rad ${o.phi}rad ${Math.max(.55, Math.min(2.5, o.radius * factor))}m`; };
$('labels-toggle').onclick = () => { const show = $('labels-toggle').getAttribute('aria-pressed') !== 'true'; $('labels-toggle').setAttribute('aria-pressed', show); wellHotspots.forEach(b => b.hidden = !show); layoutWellLabels(); };
mv.addEventListener('camera-change', () => requestAnimationFrame(() => { layoutWellLabels(); scenario?.vectors(illustrativeDay, mode === 'flow' && $('flow-toggle').checked); }));
new ResizeObserver(() => requestAnimationFrame(() => { layoutWellLabels(); scenario?.vectors(illustrativeDay, mode === 'flow' && $('flow-toggle').checked); })).observe(mv);
for (const id of ['grid-edges', 'flow-toggle', 'contours']) $(id).onchange = () => { scenario?.refresh(); setProperty(selectedProperty); updateMotion(); };
$('clear-cell').onclick = () => { selectedCell = null; $('cell-prompt').hidden = false; $('cell-readout').hidden = true; $('clear-cell').hidden = true; $('selection-pin').hidden = true; };
mv.addEventListener('pointerdown', e => { pointerStart = {x: e.clientX, y: e.clientY}; });
mv.addEventListener('click', e => {
  if (!ready || !pointerStart || Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 6 || e.target.closest('button')) return;
  const hit = mv.positionAndNormalFromPoint(e.clientX, e.clientY);
  if (!hit?.uv) return;
  const id = Math.floor((hit.uv.v ?? hit.uv.y) * arManifest.atlas.rows) * arManifest.atlas.columns + Math.floor((hit.uv.u ?? hit.uv.x) * arManifest.atlas.columns); if (!cellAddress(id, meta.grid)) return;
  showCell(id); $('selection-pin').hidden = false;
  mv.updateHotspot({name: 'hotspot-selection', position: position(hit.position), normal: `${hit.normal.x} ${hit.normal.y} ${hit.normal.z}`});
});
$('history-file').onchange = async e => {
  const file = e.target.files?.[0]; if (!file || !meta) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('Use a CSV smaller than 5 MB.');
    const parsed = parseHistory(await file.text(), meta.wells.map(w => w.name));
    pause(); history = parsed; sourceName = file.name; productionIndex = 0;
    for (const option of $('rate-kind').options) option.disabled = !history.rates.includes(option.value);
    $('rate-kind').value = history.rates[0];
    $('import-status').textContent = `${history.records.length.toLocaleString()} records loaded locally. Nothing was uploaded.`;
    setMode('production');
  } catch (error) { $('import-status').textContent = error.message; } finally { e.target.value = ''; }
};
$('clear-history').onclick = () => { pause(); history = null; sourceName = ''; productionIndex = 0; $('import-status').textContent = 'Stays in this browser session. Nothing is uploaded.'; setMode(mode); };
$('rate-kind').onchange = renderProduction;
const showARInfo = () => { $('ar-launch').disabled = !arModel.canActivateAR || !arModel.loaded; $('ar-status').textContent = arModel.canActivateAR ? 'This browser reports an available AR launch path.' : 'AR launch is not available in this browser. The interactive 3D view remains available.'; $('ar-dialog').showModal(); };
$('ar-info').onclick = showARInfo; $('close-ar').onclick = () => $('ar-dialog').close();
$('ar-open').onclick = () => { pause(); showARInfo(); };
$('ar-launch').onclick = async () => { if (!arModel.canActivateAR || !arModel.loaded) return; try { await arModel.activateAR(); } catch { $('ar-status').textContent = 'AR launch did not complete. Use a supported phone browser or download the colored asset.'; } };
arModel.addEventListener('load', () => $('ar-launch').disabled = !arModel.canActivateAR);
mv.addEventListener('load', () => { assetReady = true; $('ar-open').disabled = !ready; $('loading').hidden = true; requestAnimationFrame(layoutWellLabels); });
mv.addEventListener('ar-status', e => { if (e.detail.status === 'failed') showARInfo(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
mv.addEventListener('error', () => fail('The model could not load. Check your connection and reload, or use the selected-property GLB / USDZ downloads in AR information.'));

async function bootstrap() {
  const started = performance.now();
  const [metadata, buffer, variants] = await Promise.all([fetchChecked('model.json').then(r => r.json()), fetchChecked('reservoir.glb').then(r => r.arrayBuffer()), fetchChecked('ar/manifest.json').then(r => r.json())]);
  arManifest = variants; meta = metadata; glb = parseGLB(buffer);
  if (meta.grid.ncell !== 1870 || meta.properties.length !== 6) throw new Error('The expected original model metadata was not found.');
  const image = glb.json.images[0], bv = glb.json.bufferViews[image.bufferView];
  const blob = new Blob([new Uint8Array(buffer, glb.binaryOffset + bv.byteOffset, bv.byteLength)], {type: image.mimeType});
  const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(bitmap, 0, 0); texture = context.getImageData(0, 0, canvas.width, canvas.height).data; bitmap.close();
  if (canvas.width !== 1870 || canvas.height !== 6) throw new Error('Unexpected property texture dimensions.');
  for (const mesh of glb.json.meshes.filter(m => m.name !== 'reservoir')) { const p = accessorFloats(glb, mesh.primitives[0].attributes.POSITION); const y = p.filter((_, i) => i % 3 === 1); wellBounds.set(mesh.name, {min: Math.min(...y), max: Math.max(...y)}); }
  [...meta.properties, {scale:'lin'}].forEach((p, i) => { const b = document.createElement('button'); b.className = 'property'; b.innerHTML = `<span class="prop-index">0${i + 1}</span><span>${i === 6 ? 'Water saturation' : shortNames[i]}</span><span class="prop-tag">${p.scale === 'log' ? 'LOG' : i === 5 ? 'FT' : ''}</span>`; b.onclick = () => setProperty(i); $('properties').append(b); });
  await Promise.race([customElements.whenDefined('model-viewer'), new Promise((_, reject) => setTimeout(() => reject(new Error('The viewer library did not become available. Reload to try again.')), 30000))]);
  if (!mv.loaded) await new Promise((resolve, reject) => { mv.addEventListener('load', resolve, {once: true}); mv.addEventListener('error', reject, {once: true}); });
  scenario = await createScenarioView(mv, meta, texture, url => fetchChecked(url).then(r => r.json()));
  buildWellUI(); ready = true; assetReady = true; $('loading').hidden = true; $('ar-open').disabled = false;
  setProperty(0); selectWell(selectedWell); setView('perspective'); updateTransport(); updateMotion(); requestAnimationFrame(layoutWellLabels);
  performance.mark('reservoir-ready'); document.documentElement.dataset.readyMs = (performance.now() - started).toFixed(0);
}
bootstrap().catch(e => fail(`Viewer initialization failed: ${e.message || 'Please reload the page.'}`));
