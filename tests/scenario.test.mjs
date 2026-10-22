import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB, accessorFloats} from '../data.mjs';
import {canvasTileOrigin, scenarioFrame, saturationColor, controlPeriod} from '../scenario.mjs';

test('every web face UV addresses its original cell after CanvasTexture vertical flip', () => {
  const read = path => {const b = readFileSync(new URL(path, import.meta.url)); return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
  const source = read('../reservoir.glb'), web = read('../scenario/reservoir-web.glb');
  const uv = g => accessorFloats(g, g.json.meshes[0].primitives[0].attributes.TEXCOORD_0);
  const oldUV = uv(source), newUV = uv(web);
  for(let v=0;v<oldUV.length;v+=2){
    const cell = Math.floor(oldUV[v]*1870), [x,y] = canvasTileOrigin(cell);
    const px = newUV[v]*1024, py=(1-newUV[v+1])*512;
    assert.ok(px>=x && px<x+16 && py>=y && py<y+16, `cell ${cell}, vertex ${v/2}`);
  }
  assert.equal(new Set(Array.from({length:1870},(_,i)=>canvasTileOrigin(i).join(','))).size,1870);
});
test('original blue-cyan-green-yellow-red palette and fixed endpoints and displayed days select saved frames',()=>{
  assert.deepEqual(saturationColor(0),[0,0,255]);
  assert.deepEqual(saturationColor(1),[255,0,0]);
  assert.deepEqual(saturationColor(.25),[0,255,255]);
  assert.deepEqual(saturationColor(.5),[0,255,0]);
  assert.deepEqual(saturationColor(.75),[255,255,0]);
  const days=Array.from({length:121},(_,i)=>i/4);
  assert.equal(days[scenarioFrame(15,days)],15);
  assert.equal(scenarioFrame(30,days),120);
});

test('day-7 controls and vectors switch together; reset returns original controls',()=>{
  const info=JSON.parse(readFileSync(new URL('../scenario/transport.json',import.meta.url)));
  for(const day of [0,6,6.75,6.999999]) assert.deepEqual(controlPeriod(day,info.controlPeriods).shutWells,[]);
  for(const day of [7,7.25,30,1000]) {
    const p=controlPeriod(day,info.controlPeriods);
    assert.deepEqual(p.shutWells,['PROD-3']);
    assert.ok(Math.abs(p.injectionPVPerDay-.02*2/3)<1e-17);
    assert.ok(Math.abs(p.injectionPVPerDay-p.totalProductionPVPerDay)<1e-17);
    assert.equal(p.surfaceFlow.length,48);
  }
});
