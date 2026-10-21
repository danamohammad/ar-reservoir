// Data interpretation only. Original GLB / USDZ / model.json are never rewritten.
export const RATE_COLUMNS = ['oil_stb_day', 'water_stb_day', 'gas_scf_day', 'injection_stb_day'];
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else if (c === undefined) throw new Error('Unclosed quote in CSV.');
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',' || c === '\n' || c === undefined) {
      row.push(field.trim()); field = '';
      if (c !== ',') { if (row.some(Boolean)) rows.push(row); row = []; }
    } else if (c !== '\r') field += c;
  }
  return rows;
}
export function parseHistory(text, knownWells) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Add daily records below the header. No example rates are included.');
  const headers = rows.shift();
  if (new Set(headers).size !== headers.length) throw new Error('Duplicate CSV column names.');
  if (!headers.includes('day') || !headers.includes('well')) throw new Error('Required columns: day, well.');
  const rates = RATE_COLUMNS.filter(k => headers.includes(k));
  if (!rates.length) throw new Error('Include a rate column with explicit units, such as oil_stb_day.');
  const unsupported = headers.filter(k => !['day', 'well', ...RATE_COLUMNS].includes(k));
  if (unsupported.length) throw new Error(`Unknown columns: ${unsupported.join(', ')}. Use the supplied template; units must be explicit.`);
  if (rows.length > 50000) throw new Error('Use 50,000 records or fewer.');
  const seen = new Set();
  const numeric = (raw, name, line) => {
    if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) throw new Error(`Row ${line}: ${name} must be a non-negative number.`);
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 0) throw new Error(`Row ${line}: invalid ${name}.`);
    return v;
  };
  const records = rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`Row ${i + 2}: column count does not match the header.`);
    const r = Object.fromEntries(headers.map((k, j) => [k, values[j]]));
    if (!knownWells.includes(r.well)) throw new Error(`Row ${i + 2}: unknown well ${r.well}. Expected ${knownWells.join(', ')}.`);
    r.day = numeric(r.day, 'day', i + 2);
    const key = `${r.day}|${r.well}`;
    if (seen.has(key)) throw new Error(`Duplicate day/well record: ${key}.`);
    seen.add(key);
    for (const k of RATE_COLUMNS) r[k] = r[k] == null || r[k] === '' ? null : numeric(r[k], k, i + 2);
    if (!rates.some(k => r[k] !== null)) throw new Error(`Row ${i + 2}: provide at least one rate; blank is missing, not zero.`);
    return r;
  }).sort((a, b) => a.day - b.day || a.well.localeCompare(b.well));
  return {records, days: [...new Set(records.map(r => r.day))], rates};
}
export function sampleAt(history, day, well) {
  // Exact samples only: no interpolation, carry-forward, invented zeros or rates.
  return history?.records.find(r => r.day === day && r.well === well) ?? null;
}
export function cellAddress(id, {nx, ny, ncell}) {
  if (!Number.isInteger(id) || id < 0 || id >= ncell) return null;
  return {i: id % nx + 1, j: Math.floor(id / nx) % ny + 1, k: Math.floor(id / (nx * ny)) + 1};
}
export function textureEstimate(rgb, property) {
  // Invert ONLY the documented four-segment color ramp from the supplied build.py.
  const stops = [[0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]];
  let best = {distance: Infinity, t: 0};
  for (let s = 0; s < 4; s++) {
    const a = stops[s], b = stops[s + 1], d = b.map((v, i) => v - a[i]);
    const f = Math.max(0, Math.min(1, d.reduce((v, x, i) => v + x * (rgb[i] - a[i]), 0) / 65025));
    const distance = a.reduce((v, x, i) => v + (x + f * d[i] - rgb[i]) ** 2, 0);
    if (distance < best.distance) best = {distance, t: (s + f) / 4};
  }
  if (best.distance > 3) return null;
  const map = t => property.scale === 'log'
    ? Math.exp(Math.log(Math.max(property.min, 1e-3)) + t * Math.log(property.max / Math.max(property.min, 1e-3)))
    : property.min + t * (property.max - property.min);
  return {value: map(best.t), lower: map(Math.max(0, best.t - 0.5 / 1020)), upper: map(Math.min(1, best.t + 0.5 / 1020))};
}
export function parseGLB(buffer) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Invalid GLB header.');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const binaryOffset = 20 + jsonLength + 8;
  return {json, buffer, binaryOffset};
}
export function accessorFloats(glb, id) {
  const a = glb.json.accessors[id], bv = glb.json.bufferViews[a.bufferView];
  if (a.componentType !== 5126) throw new Error('Expected float accessor.');
  const components = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4}[a.type];
  const view = new DataView(glb.buffer), result = [];
  const start = glb.binaryOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let n = 0; n < a.count; n++) for (let c = 0; c < components; c++) result.push(view.getFloat32(start + n * (bv.byteStride ?? components * 4) + c * 4, true));
  return result;
}
