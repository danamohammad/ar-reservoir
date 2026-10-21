import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseHistory, sampleAt, cellAddress, textureEstimate, parseGLB, accessorFloats} from '../data.mjs';
const wells = ['PROD-1', 'PROD-2', 'PROD-3', 'INJ'];
test('import uses exact recorded days, preserves zero and missing values, and sorts', () => {
  const h = parseHistory('day,well,oil_stb_day,water_stb_day\n10,PROD-1,100,\n0,PROD-1,0,2\n5,INJ,,9', wells);
  assert.deepEqual(h.days, [0, 5, 10]);
  assert.equal(sampleAt(h, 0, 'PROD-1').oil_stb_day, 0);
  assert.equal(sampleAt(h, 10, 'PROD-1').water_stb_day, null);
  assert.equal(sampleAt(h, 5, 'PROD-1'), null);
  assert.equal(sampleAt(h, 4, 'PROD-1'), null);
});
test('rejects ambiguous units, unknown wells, duplicate records and invalid numbers', () => {
  for (const csv of ['day,well,rate\n0,PROD-1,10', 'day,well,oil_stb_day\n0,OTHER,10', 'day,well,oil_stb_day\n0,PROD-1,10\n0,PROD-1,11', 'day,well,oil_stb_day\n0,PROD-1,-2', 'day,well,oil_stb_day\n0,PROD-1,Infinity', 'day,well,oil_stb_day\n0,PROD-1,', 'day,well,oil_stb_day\n,PROD-1,10', 'day,well,oil_stb_day\n0,PROD-1,=1+2']) assert.throws(() => parseHistory(csv, wells));
});
test('quoted CSV, BOM and decimals work without unit conversion', () => {
  const h = parseHistory('\uFEFFday,well,gas_scf_day\r\n0.5,"PROD-1",1.25e3\r\n', wells);
  assert.equal(h.records[0].gas_scf_day, 1250); assert.equal(h.days[0], .5);
});
test('source grid addressing retains original I/J/K ordering', () => {
  const grid = {nx: 17, ny: 22, ncell: 1870};
  assert.deepEqual(cellAddress(0, grid), {i:1,j:1,k:1});
  assert.deepEqual(cellAddress(1869, grid), {i:17,j:22,k:5});
  assert.deepEqual(cellAddress(374, grid), {i:1,j:1,k:2});
  assert.equal(cellAddress(1870, grid), null);
});
test('texture inversion handles every original ramp step within quantization interval', () => {
  const stops = [[0,0,255],[0,255,255],[0,255,0],[255,255,0],[255,0,0]];
  for (const scale of ['lin', 'log']) for (let n = 0; n <= 10000; n++) {
    const t = n / 10000, segment = Math.min(3, Math.floor(t * 4)), f = t * 4 - segment;
    const rgb = stops[segment].map((v, i) => Math.round(v + f * (stops[segment + 1][i] - v)));
    const p = {min: .1, max: 397.2, scale}; const e = textureEstimate(rgb, p);
    const exact = scale === 'log' ? Math.exp(Math.log(.1) + t * Math.log(3972)) : .1 + t * 397.1;
    assert.ok(exact >= e.lower - 1e-9 && exact <= e.upper + 1e-9);
  }
});
test('original model assets remain byte-identical and well bounds are readable', () => {
  const expected = {'reservoir.glb':'3566eae7ca1ddb380f0712c34fd951eb2f64d5362fbb5a0bf71b3e32ac32d8c0','reservoir.usdz':'a1fb0e6f3dcff29ff29735d154dded80eaa167594ae680e019a7d0b657ebdf62','model.json':'6be5a41cedf129bebedbfbfb9012b8271e2743e6e398d0de9a7bed4808dfb825'};
  for (const [name, hash] of Object.entries(expected)) assert.equal(createHash('sha256').update(readFileSync(new URL('../' + name, import.meta.url))).digest('hex'), hash);
  const b = readFileSync(new URL('../reservoir.glb', import.meta.url)); const g = parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  assert.equal(g.json.meshes.length, 5);
  for (const m of g.json.meshes.slice(1)) { const a = accessorFloats(g, m.primitives[0].attributes.POSITION); assert.equal(a.length,84); assert.ok(a.every(Number.isFinite)); }
});
