import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB, accessorFloats} from '../data.mjs';
import {canvasTileOrigin, scenarioFrame, saturationColor} from '../scenario.mjs';

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
test('oil and water colors share fixed endpoints and displayed days select saved frames',()=>{
  assert.deepEqual(saturationColor(0),[32,52,83]);
  assert.deepEqual(saturationColor(1),[246,219,72]);
  const days=Array.from({length:121},(_,i)=>i/4);
  assert.equal(days[scenarioFrame(15,days)],15);
  assert.equal(scenarioFrame(30,days),120);
});
