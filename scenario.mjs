// Precomputed conservative scenario; no field calibration is implied.
export const scenarioFrame = (day, days) => Math.max(0, Math.min(days.length - 1, Math.round(day / (days[1] - days[0]))));
// model-viewer's CanvasTexture keeps Three.js flipY=true, unlike loaded GLB PNGs.
// Reflect tile rows so original glTF UVs still address the correct source cell.
export const canvasTileOrigin = cell => [cell % 64 * 16, (31 - Math.floor(cell / 64)) * 16];
export const saturationColor = value => {
  // Fixed, perceptually ordered cividis-like ramp. Both phases use [0,1].
  const stops = [[32, 52, 83], [57, 80, 109], [103, 115, 113], [165, 154, 105], [246, 219, 72]];
  const t = Math.max(0, Math.min(1, value)) * 4, s = Math.min(3, Math.floor(t)), f = t - s;
  return stops[s].map((v, i) => Math.round(v + f * (stops[s + 1][i] - v)));
};

export async function createScenarioView(mv, meta, originalTexture, readJSON) {
  const info = await readJSON('scenario/transport.json');
  const response = await fetch(info.states);
  if (!response.ok) throw new Error('Calculated saturation file could not load.');
  const states = new Float32Array(await response.arrayBuffer());
  if (states.length !== info.cellCount * info.days.length || [...states].some(v => !Number.isFinite(v) || v < -1e-7 || v > 1 + 1e-7)) throw new Error('Calculated saturation validation failed.');
  const texture = mv.createCanvasTexture(), canvas = texture.source.element;
  canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d');
  mv.model.materials[0].pbrMetallicRoughness.baseColorTexture.setTexture(texture);
  let lastKey = '', current = {frame: 0, row: 0, active: true};
  const $ = id => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const arrows = info.surfaceFlow.map((v, i) => {
    const endpoints = ['start', 'end'].map((key, j) => {
      const e = document.createElement('span'); e.slot = `hotspot-vector-${i}-${j}`;
      e.className = 'vector-anchor'; e.dataset.position = v[key].map(x => `${x}m`).join(' '); e.dataset.normal = '0 1 0';
      e.setAttribute('aria-hidden', 'true'); mv.append(e); return e.slot;
    });
    const line = document.createElementNS(svgNS, 'path'); line.setAttribute('class', 'flux-line'); $('flow-vectors').append(line);
    const dot = document.createElementNS(svgNS, 'circle'); dot.setAttribute('r', '2.5'); dot.setAttribute('class', 'flux-dot'); $('flow-vectors').append(dot);
    return {...v, endpoints, line, dot};
  });
  function vectors(day, visible) {
    const svg = $('flow-vectors'); svg.hidden = !visible;
    if (!visible) return;
    svg.setAttribute('viewBox', `0 0 ${mv.clientWidth} ${mv.clientHeight}`);
    for (const a of arrows) {
      const s = mv.queryHotspot(a.endpoints[0]), e = mv.queryHotspot(a.endpoints[1]);
      const on = s?.facingCamera && e?.facingCamera;
      a.line.style.display = a.dot.style.display = on ? '' : 'none';
      if (!on) continue;
      const x = s.canvasPosition.x, y = s.canvasPosition.y, dx = e.canvasPosition.x - x, dy = e.canvasPosition.y - y;
      const length = Math.hypot(dx, dy); if (length < 2) continue;
      const ux = dx / length, uy = dy / length, ex = x + dx * .83, ey = y + dy * .83;
      a.line.setAttribute('d', `M${x + dx * .12},${y + dy * .12}L${ex},${ey}m${-ux * 4 - uy * 2},${-uy * 4 + ux * 2}L${ex},${ey}l${-ux * 4 + uy * 2},${-uy * 4 - ux * 2}`);
      // Glyph traverses a calculated directed connection over its pore residence time.
      const t = (day / a.transitDays) % 1;
      a.dot.setAttribute('cx', x + dx * t); a.dot.setAttribute('cy', y + dy * t);
    }
  }
  function paint(row, day, active, force = false) {
    const frame = scenarioFrame(day, info.days), edges = $('grid-edges').checked, contours = $('contours').checked;
    current = {frame, row, active};
    const key = `${row}|${active ? frame : 0}|${active}|${edges}|${contours}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    ctx.clearRect(0, 0, 1024, 512);
    for (let cell = 0; cell < 1870; cell++) {
      const [x, y] = canvasTileOrigin(cell);
      const dynamic = active && (row === 0 || row === 6);
      const value = row === 6 ? states[frame * 1870 + cell] : 1 - states[frame * 1870 + cell];
      let rgb;
      if (dynamic || row === 6) rgb = saturationColor(contours ? Math.round(value * 10) / 10 : value);
      else { const offset = (row * 1870 + cell) * 4; rgb = Array.from(originalTexture.slice(offset, offset + 3)); }
      ctx.fillStyle = `rgb(${rgb.join(',')})`; ctx.fillRect(x, y, 16, 16);
      if (edges) { ctx.strokeStyle = 'rgba(12,23,36,.7)'; ctx.lineWidth = .8; ctx.strokeRect(x + 1, y + 1, 14, 14); }
    }
    texture.source.update();
    if (active) {
      const r = info.records[frame];
      $('scenario-oil').textContent = r.oilRate.toFixed(5);
      $('scenario-water').textContent = r.waterRate.toFixed(5);
      $('scenario-cumulative').textContent = r.cumulativeOil.toFixed(4);
      $('scenario-injected').textContent = r.injectedPV.toFixed(3);
      $('scenario-balance').textContent = `${r.balanceError.toExponential(1)} PV`;
      $('scenario-sample').textContent = `Calculated Day ${info.days[frame]} · whole model · assumed controls`;
      $('scenario-chart').innerHTML = `<svg viewBox="0 0 240 64" role="img" aria-label="Calculated oil rate decreases as water replaces oil. Fixed vertical scale zero to 0.02 pore volumes per day."><path d="M5 5V54H235" fill="none" stroke="#3d4a5c"/><path d="${info.records.map((p, i) => `${i ? 'L' : 'M'}${5 + p.day / 30 * 230},${54 - p.oilRate / .02 * 48}`).join('')}" fill="none" stroke="#e7c75f" stroke-width="2"/><path d="M${5 + r.day / 30 * 230} 4V55" stroke="#bcd7de"/><text x="5" y="63" fill="#aab5c3" font-size="8">0 days</text><text x="210" y="63" fill="#aab5c3" font-size="8">30 days</text></svg>`;
    }
  }
  return {info, paint, vectors,
    value: cell => current.row === 6 ? states[current.frame * 1870 + cell] : 1 - states[current.frame * 1870 + cell],
    refresh: () => { lastKey = ''; },
    well: (name, day) => info.records[scenarioFrame(day, info.days)].wells[name]
  };
}
