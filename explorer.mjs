import {parseHistory, sampleAt, cellAddress, textureEstimate, parseGLB, accessorFloats, RATE_COLUMNS} from './data.mjs';

const $ = id => document.getElementById(id);
const mv = $('reservoir');
const names = ['Initial oil saturation', 'Permeability · heterogeneous', 'Permeability · homogeneous', 'Porosity · heterogeneous', 'Porosity · homogeneous', 'Depth · TVD'];
const shortNames = ['Oil saturation', 'Permeability · het.', 'Permeability · hom.', 'Porosity · het.', 'Porosity · hom.', 'Depth · TVD'];
const notes = ['Initial state from EQUIL: oil–water contact 6,750 ft; connate water saturation 0.25. No time evolution.', 'Horizontal permeability. Logarithmic scale preserves variation across three orders of magnitude.', 'Original homogeneous-case permeability row. Values are static.', 'Original heterogeneous porosity, shown as a fraction of bulk volume.', 'Original homogeneous-case porosity. Values are static.', 'Original cell-centre true vertical depth, in feet. The vertical scale is not exaggerated.'];
const fmt = (v, row) => row === 5 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) < 1 ? v.toFixed(3) : Number(v.toPrecision(3)).toLocaleString('en-US');
const position = p => `${p.x}m ${p.y}m ${p.z}m`;
let meta, glb, texture, sampler, ready = false, selectedProperty = 0, selectedWell = 'PROD-1', selectedCell = null;
let mode = 'tour', playing = false, tourTime = 0, productionIndex = 0, history = null, sourceName = '', playbackRemainder = 0;
let animationFrame = null, lastFrame = null, lastPaint = 0, pointerStart = null;
const wellBounds = new Map(), wellHotspots = new Map(), particles = [];
const fittedRadius = () => mv.clientWidth < 500 ? 1.28 : 1.12;
const fail = message => { $('scene-error').hidden = false; $('scene-error').textContent = message; $('loading').hidden = true; pause(); };
const fetchChecked = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r; };

function setProperty(index) {
  selectedProperty = index;
  const p = meta.properties[index];
  document.querySelectorAll('.property').forEach((b, i) => { b.classList.toggle('active', i === index); b.setAttribute('aria-pressed', i === index); });
  $('scene-title').textContent = names[index]; $('legend-name').textContent = shortNames[index];
  $('legend-scale').textContent = p.scale === 'log' ? 'Logarithmic' : 'Linear';
  const mid = p.scale === 'log' ? Math.sqrt(p.min * p.max) : (p.min + p.max) / 2;
  $('legend-ticks').replaceChildren(...[p.min, mid, p.max].map(v => { const e = document.createElement('span'); e.textContent = fmt(v, index); return e; }));
  $('legend-unit').textContent = p.unit; $('property-note').textContent = notes[index];
  if (sampler) sampler.setOffset({u: 0, v: p.row / meta.properties.length});
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
  const e = estimate(id, selectedProperty), p = meta.properties[selectedProperty];
  $('cell-value').textContent = e ? `≈ ${fmt(e.value, selectedProperty)} ${p.unit.split(', ').at(-1)}` : 'Unavailable';
  $('cell-caption').textContent = `${names[selectedProperty]}. Approximation from the encoded texture; not full-precision simulator data.`;
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
  renderProduction();
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
  const show = mode === 'tour' && playing;
  $('motion-label').hidden = !show;
  for (const p of particles) {
    p.dot.hidden = !show; if (!show) continue;
    const bound = wellBounds.get(p.well.name); if (!bound) continue;
    let phase = (tourTime / 2.8 + p.phase) % 1; if (p.well.kind === 'inj') phase = 1 - phase;
    mv.updateHotspot({name: p.dot.slot, position: position({...p.well, y: bound.min + (bound.max - bound.min) * phase})});
  }
}
function layoutWellLabels() {
  if (!ready || !$('labels-toggle').matches('[aria-pressed="true"]')) return;
  const width = mv.clientWidth, height = mv.clientHeight, occupied = [];
  const labels = [...wellHotspots].map(([name, el]) => ({el, hit: mv.queryHotspot(el.slot)})).filter(v => v.hit).sort((a, b) => a.hit.canvasPosition.x - b.hit.canvasPosition.x);
  for (const {el, hit} of labels) {
    const x = hit.canvasPosition.x, y = hit.canvasPosition.y, label = el.querySelector('.well-label');
    const w = label.offsetWidth || 68, h = label.offsetHeight || 27; let chosen = null;
    for (const dy of [-32, -60, -88, 32, 60]) {
      for (const dx of [0, -42, 42, -78, 78, -110, 110]) {
        const box = {x: x + dx - w / 2, y: y + dy - h / 2, w, h};
        if (box.x < 7 || box.y < 12 || box.x + w > width - 7 || box.y + h > height - 65) continue;
        if (occupied.some(b => box.x < b.x + b.w + 7 && box.x + w + 7 > b.x && box.y < b.y + b.h + 5 && box.y + h + 5 > b.y)) continue;
        chosen = {dx, dy, box}; break;
      }
      if (chosen) break;
    }
    if (!chosen) chosen = {dx: 0, dy: -32, box: {x: x - w / 2, y: y - 45, w, h}};
    occupied.push(chosen.box); label.style.left = `calc(50% + ${chosen.dx}px)`; label.style.top = `calc(50% + ${chosen.dy}px)`;
    const stem = el.querySelector('.well-stem'); stem.style.height = `${Math.hypot(chosen.dx, chosen.dy)}px`; stem.style.transform = `rotate(${Math.atan2(chosen.dx, -chosen.dy)}rad)`;
  }
}
function applyTourCamera() {
  mv.cameraOrbit = `${35 + tourTime * 12}deg ${65 - 12 * Math.sin(tourTime / 30 * Math.PI * 2)}deg ${fittedRadius()}m`;
  document.querySelectorAll('[data-view]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed', 'false'); });
}
function pause() { playing = false; if (animationFrame !== null) cancelAnimationFrame(animationFrame); animationFrame = null; lastFrame = null; updateTransport(); if (ready) updateMotion(); }
function play() {
  if (!ready || (mode === 'production' && !history)) return;
  if (mode === 'tour' && tourTime >= 30) tourTime = 0;
  if (mode === 'production' && productionIndex >= history.days.length - 1) productionIndex = 0;
  playing = true; lastFrame = null; playbackRemainder = 0; updateTransport(); animationFrame = requestAnimationFrame(tick);
}
function tick(now) {
  if (!playing) return;
  const dt = lastFrame === null ? 0 : Math.min((now - lastFrame) / 1000, .1); lastFrame = now;
  const speed = Number($('speed').value);
  if (mode === 'tour') { tourTime = Math.min(30, tourTime + dt * speed); if (now - lastPaint > 32) { applyTourCamera(); updateMotion(); updateTransport(); layoutWellLabels(); lastPaint = now; } if (tourTime >= 30) return pause(); }
  else { playbackRemainder += dt * speed; if (playbackRemainder >= 1) { const step = Math.floor(playbackRemainder); playbackRemainder -= step; productionIndex = Math.min(history.days.length - 1, productionIndex + step); updateTransport(); renderProduction(); if (productionIndex === history.days.length - 1) return pause(); } }
  animationFrame = requestAnimationFrame(tick);
}
function updateTransport() {
  const production = mode === 'production';
  $('play').disabled = !ready || (production && (!history || history.days.length < 2));
  $('play').textContent = playing ? 'Ⅱ' : '▶'; $('play').setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} ${production ? 'production history' : 'presentation'}`);
  $('timeline').disabled = !ready || (production && !history);
  $('timeline').max = production ? Math.max(0, (history?.days.length ?? 1) - 1) : 30;
  $('timeline').step = production ? 1 : .1; $('timeline').value = production ? productionIndex : tourTime;
  $('timeline').setAttribute('aria-label', production ? 'Recorded day' : 'Presentation time in seconds');
  if (production) { const day = history?.days[productionIndex]; $('time-label').textContent = history ? `Day ${day} / ${history.days.at(-1)}` : 'Days — awaiting daily history'; $('timeline').setAttribute('aria-valuetext', history ? `Day ${day}` : 'No daily history'); }
  else { const time = `0:${String(Math.floor(tourTime)).padStart(2, '0')}`; $('time-label').innerHTML = `${time} <span>/ 0:30</span>`; $('timeline').setAttribute('aria-valuetext', `${tourTime.toFixed(1)} seconds`); }
}
function setMode(next) {
  pause(); mode = next;
  $('mode-tour').classList.toggle('active', mode === 'tour'); $('mode-tour').setAttribute('aria-pressed', mode === 'tour');
  $('mode-production').classList.toggle('active', mode === 'production'); $('mode-production').setAttribute('aria-pressed', mode === 'production');
  $('timeline-badge').textContent = mode === 'tour' ? '30-second model tour' : history ? `${history.days.length} recorded days` : 'History not supplied';
  $('playback-note').textContent = mode === 'tour' ? 'A camera tour with directional well cues. The reservoir properties remain static.' : history ? 'One recorded day per second at 1×. Exact samples only; blank values stay missing. Geometry and property colors remain static.' : 'Daily rates and restart frames were not supplied. Load a CSV to enable recorded-day playback. The model remains static.';
  updateTransport(); updateMotion(); renderProduction();
}
function resetPlayback() { pause(); tourTime = 0; productionIndex = 0; playbackRemainder = 0; if (mode === 'tour') setView('perspective'); updateTransport(); renderProduction(); }
function setView(view) {
  pause(); const radius = fittedRadius(); const orbits = {perspective: `35deg 65deg ${radius}m`, top: `0deg 5deg ${radius}m`, side: `90deg 87deg ${radius}m`};
  mv.cameraTarget = '0m 0.035m 0m'; mv.cameraOrbit = orbits[view];
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

$('mode-tour').onclick = () => setMode('tour'); $('mode-production').onclick = () => setMode('production');
$('play').onclick = () => playing ? pause() : play(); $('reset-playback').onclick = resetPlayback;
$('timeline').oninput = () => { const value = Number($('timeline').value); pause(); if (mode === 'tour') { tourTime = value; applyTourCamera(); } else { productionIndex = value; renderProduction(); } updateTransport(); };
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
$('reset-view').onclick = () => setView('perspective');
for (const [id, factor] of [['zoom-in', .8], ['zoom-out', 1.25]]) $(id).onclick = () => { pause(); const o = mv.getCameraOrbit(); mv.cameraOrbit = `${o.theta}rad ${o.phi}rad ${Math.max(.55, Math.min(2.5, o.radius * factor))}m`; };
$('labels-toggle').onclick = () => { const show = $('labels-toggle').getAttribute('aria-pressed') !== 'true'; $('labels-toggle').setAttribute('aria-pressed', show); wellHotspots.forEach(b => b.hidden = !show); layoutWellLabels(); };
mv.addEventListener('camera-change', layoutWellLabels);
let narrowScene = mv.clientWidth < 500;
new ResizeObserver(() => { const next = mv.clientWidth < 500; if (ready && next !== narrowScene) setView('perspective'); narrowScene = next; requestAnimationFrame(layoutWellLabels); }).observe(mv);
$('clear-cell').onclick = () => { selectedCell = null; $('cell-prompt').hidden = false; $('cell-readout').hidden = true; $('clear-cell').hidden = true; $('selection-pin').hidden = true; };
mv.addEventListener('pointerdown', e => { pointerStart = {x: e.clientX, y: e.clientY}; if (playing && mode === 'tour') pause(); });
mv.addEventListener('click', e => {
  if (!ready || !pointerStart || Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y) > 6 || e.target.closest('button')) return;
  const hit = mv.positionAndNormalFromPoint(e.clientX, e.clientY);
  if (!hit?.uv) return;
  const id = Math.floor((hit.uv.u ?? hit.uv.x) * meta.grid.ncell); if (!cellAddress(id, meta.grid)) return;
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
const showARInfo = () => { $('ar-status').textContent = mv.canActivateAR ? 'This browser reports an available AR launch path.' : 'AR launch is not available in this browser. The interactive 3D view remains available.'; $('ar-dialog').showModal(); };
$('ar-info').onclick = showARInfo; $('close-ar').onclick = () => $('ar-dialog').close();
$('ar-open').onclick = async () => { if (mv.canActivateAR) { try { await mv.activateAR(); } catch { showARInfo(); } } else showARInfo(); };
mv.addEventListener('ar-status', e => { if (e.detail.status === 'failed') showARInfo(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
mv.addEventListener('error', () => fail('The model could not load. Check your connection and reload, or use the original GLB / USDZ downloads in AR information.'));

async function bootstrap() {
  const started = performance.now();
  const [metadata, buffer] = await Promise.all([fetchChecked('model.json').then(r => r.json()), fetchChecked('reservoir.glb').then(r => r.arrayBuffer())]);
  meta = metadata; glb = parseGLB(buffer);
  if (meta.grid.ncell !== 1870 || meta.properties.length !== 6) throw new Error('The expected original model metadata was not found.');
  const image = glb.json.images[0], bv = glb.json.bufferViews[image.bufferView];
  const blob = new Blob([new Uint8Array(buffer, glb.binaryOffset + bv.byteOffset, bv.byteLength)], {type: image.mimeType});
  const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
  const context = canvas.getContext('2d', {willReadFrequently: true}); context.drawImage(bitmap, 0, 0); texture = context.getImageData(0, 0, canvas.width, canvas.height).data; bitmap.close();
  if (canvas.width !== 1870 || canvas.height !== 6) throw new Error('Unexpected property texture dimensions.');
  for (const mesh of glb.json.meshes.filter(m => m.name !== 'reservoir')) { const p = accessorFloats(glb, mesh.primitives[0].attributes.POSITION); const y = p.filter((_, i) => i % 3 === 1); wellBounds.set(mesh.name, {min: Math.min(...y), max: Math.max(...y)}); }
  meta.properties.forEach((p, i) => { const b = document.createElement('button'); b.className = 'property'; b.innerHTML = `<span class="prop-index">0${i + 1}</span><span>${shortNames[i]}</span><span class="prop-tag">${p.scale === 'log' ? 'LOG' : i === 5 ? 'FT' : ''}</span>`; b.onclick = () => setProperty(i); $('properties').append(b); });
  await Promise.race([customElements.whenDefined('model-viewer'), new Promise((_, reject) => setTimeout(() => reject(new Error('The viewer library did not become available. Reload to try again.')), 30000))]);
  if (!mv.loaded) await new Promise((resolve, reject) => { mv.addEventListener('load', resolve, {once: true}); mv.addEventListener('error', reject, {once: true}); });
  sampler = mv.model.materials.find(m => m.name === 'reservoir-property').pbrMetallicRoughness.baseColorTexture.texture.sampler;
  // Material presentation only. No geometry, property texture or source files are changed.
  for (const m of mv.model.materials.filter(m => ['producer', 'injector'].includes(m.name))) { m.pbrMetallicRoughness.setMetallicFactor(.15); m.pbrMetallicRoughness.setRoughnessFactor(.28); }
  buildWellUI(); ready = true; $('loading').hidden = true; $('ar-open').disabled = false;
  setProperty(0); selectWell(selectedWell); setView('perspective'); updateTransport(); requestAnimationFrame(layoutWellLabels);
  performance.mark('reservoir-ready'); document.documentElement.dataset.readyMs = (performance.now() - started).toFixed(0);
}
bootstrap().catch(e => fail(`Viewer initialization failed: ${e.message || 'Please reload the page.'}`));
