"""Reproducible, normalized two-component transport SCENARIO, not a field forecast.

Only original texture values / IJK addresses are used as source data. Missing
physical inputs are replaced by the explicit assumptions in SCENARIO-MODEL.md.
No raw field records or credentials are inputs. Run with Python/numpy/Pillow.
"""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys

import numpy as np
from PIL import Image
from build_ar_assets import read_glb, accessor, pack_glb

ROOT = Path(__file__).resolve().parents[1]


def decoded_properties():
    j, binary = read_glb(ROOT / 'reservoir.glb')
    v = j['bufferViews'][j['images'][0]['bufferView']]
    rgb = np.asarray(Image.open(io.BytesIO(binary[v['byteOffset']:v['byteOffset'] + v['byteLength']])).convert('RGB'), dtype=float)
    meta = json.loads((ROOT / 'model.json').read_text())
    stops = np.array([[0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]])
    rows = []
    for r, p in enumerate(meta['properties']):
        error = np.full(1870, np.inf)
        t = np.zeros(1870)
        for s in range(4):
            a, b = stops[s:s + 2]
            d = b - a
            f = np.clip(np.sum((rgb[r] - a) * d, axis=1) / 65025, 0, 1)
            e = np.sum((a + f[:, None] * d - rgb[r]) ** 2, axis=1)
            use = e < error
            t[use], error[use] = (s + f[use]) / 4, e[use]
        assert np.max(error) <= 3
        if p['scale'] == 'log':
            rows.append(np.exp(np.log(p['min']) + t * np.log(p['max'] / p['min'])))
        else:
            rows.append(p['min'] + t * (p['max'] - p['min']))
    return meta, np.array(rows), j, binary


def setup(meta, props):
    nx, ny, nz = (meta['grid'][k] for k in ['nx', 'ny', 'nz'])
    n = nx * ny * nz
    a, b = [], []
    for k in range(nz):
        for y in range(ny):
            for x in range(nx):
                c = k * nx * ny + y * nx + x
                for valid, step in [(x + 1 < nx, 1), (y + 1 < ny, nx), (k + 1 < nz, nx * ny)]:
                    if valid:
                        a.append(c); b.append(c + step)
    a, b = np.array(a), np.array(b)
    perm = props[1]
    conductance = 2 / (1 / perm[a] + 1 / perm[b]) / np.mean(perm)
    # Equal bulk-volume compartments, actual reconstructed porosity weighting.
    pv = props[3] / props[3].sum()
    injection = np.zeros(n)
    extraction = np.zeros(n)
    wells = {}
    for w in meta['wells']:
        ids = np.arange(nz) * nx * ny + (w['j'] - 1) * nx + w['i'] - 1
        wells[w['name']] = ids
        if w['kind'] == 'inj':
            injection[ids] = .02 / nz
        else:
            extraction[ids] = .02 / 3 / nz
    rhs = injection - extraction
    diagonal = np.bincount(a, conductance, n) + np.bincount(b, conductance, n)

    def matvec(x):
        flux = conductance * (x[a] - x[b])
        return np.bincount(a, flux, n) - np.bincount(b, flux, n)

    # Projected Jacobi-PCG for the connected Neumann graph (zero-mean gauge).
    potential = np.zeros(n)
    r = rhs.copy()
    z = r / diagonal; z -= z.mean()
    direction = z.copy()
    rz = np.dot(r, z)
    for iterations in range(1, 10001):
        ad = matvec(direction)
        alpha = rz / np.dot(direction, ad)
        potential += alpha * direction
        r -= alpha * ad; r -= r.mean()
        if np.max(np.abs(r)) < 1e-17:
            break
        z = r / diagonal; z -= z.mean()
        next_rz = np.dot(r, z)
        direction = z + next_rz / rz * direction
        rz = next_rz
    else:
        raise ValueError('Graph potential failed to converge')
    flux = conductance * (potential[a] - potential[b])
    src, dst = np.where(flux >= 0, a, b), np.where(flux >= 0, b, a)
    flux = abs(flux)
    outflow = np.bincount(src, flux, n) + extraction
    inflow = np.bincount(dst, flux, n) + injection
    # Both denominators checked: the tiny solve residual cannot violate a bound.
    stable_dt = .8 * np.min(pv / np.maximum(outflow, inflow))
    residual = float(np.max(abs(matvec(potential) - rhs)))
    assert residual < 1e-12
    return dict(pv=pv, src=src, dst=dst, flux=flux, outflow=outflow,
                injection=injection, extraction=extraction, wells=wells,
                stable_dt=stable_dt, residual=residual, iterations=iterations)


def solve(model, initial, cfl_scale=1, end=30, frame_step=.25):
    pv, src, dst, flux = (model[k] for k in ['pv', 'src', 'dst', 'flux'])
    inj, ext, outflow = (model[k] for k in ['injection', 'extraction', 'outflow'])
    sw = 1 - initial.copy()
    initial_oil, initial_water = float(np.dot(pv, 1 - sw)), float(np.dot(pv, sw))
    cumulative_oil = cumulative_water = cumulative_inj = day = 0.
    frames, records = [], []
    worst = 0.
    steps = 0
    for target in np.arange(0, end + frame_step / 2, frame_step):
        while day < target - 1e-13:
            dt = min(model['stable_dt'] * cfl_scale, target - day)
            water_flux = flux * sw[src]
            divergence = np.bincount(dst, water_flux, len(sw)) - np.bincount(src, water_flux, len(sw))
            qo, qw = float(np.dot(ext, 1 - sw)), float(np.dot(ext, sw))
            sw += dt * (divergence + inj - ext * sw) / pv
            # Never clip to conceal numerical mass loss.
            assert sw.min() > -1e-10 and sw.max() < 1 + 1e-10
            cumulative_oil += qo * dt; cumulative_water += qw * dt
            cumulative_inj += float(inj.sum()) * dt
            day += dt; steps += 1
        oil, water = float(np.dot(pv, 1 - sw)), float(np.dot(pv, sw))
        err = max(abs(oil + cumulative_oil - initial_oil),
                  abs(water + cumulative_water - cumulative_inj - initial_water))
        worst = max(worst, err)
        rates = {name: {'oil': float(np.dot(ext[ids], 1 - sw[ids])),
                        'water': float(np.dot(ext[ids], sw[ids])),
                        'injection': float(inj[ids].sum())}
                 for name, ids in model['wells'].items()}
        frames.append(sw.copy())
        records.append(dict(day=float(target), oilRate=float(np.dot(ext, 1 - sw)),
                            waterRate=float(np.dot(ext, sw)), oilPV=oil, waterPV=water,
                            cumulativeOil=cumulative_oil, cumulativeWater=cumulative_water,
                            injectedPV=cumulative_inj, balanceError=err, wells=rates))
    frames = np.array(frames)
    assert worst < 1e-10 and np.all(np.diff([r['cumulativeOil'] for r in records]) >= 0)
    checks = dict(maxPhaseBalanceErrorPV=worst, saturationMin=float(frames.min()),
                  saturationMax=float(frames.max()), maxSaturationSumError=0,
                  maxCFL=float(model['stable_dt'] * np.max(outflow / pv)),
                  stableTimeStepDays=float(model['stable_dt']), steps=steps,
                  localFluxResidualPVPerDay=model['residual'], pressureSolveIterations=model['iterations'])
    return frames, records, checks


def web_geometry(j, binary):
    web = copy.deepcopy(j)
    p = web['meshes'][0]['primitives'][0]
    uv_id = p['attributes']['TEXCOORD_0']
    old = np.array(accessor(j, binary, uv_id)).reshape(-1, 2)
    ids = np.floor(old[:, 0] * 1870).astype(int)
    corners = np.tile(np.array([[1, 1], [15, 1], [15, 15], [1, 15]]), (len(ids) // 4, 1))
    uv = np.column_stack(((ids % 64 * 16 + corners[:, 0]) / 1024,
                          (ids // 64 * 16 + corners[:, 1]) / 512)).astype('<f4')
    data = bytearray(binary); data.extend(b'\0' * (-len(data) % 4))
    offset = len(data); data.extend(uv.tobytes())
    web['bufferViews'][web['accessors'][uv_id]['bufferView']] = dict(buffer=0, byteOffset=offset, byteLength=uv.nbytes)
    for key in ['min', 'max']:
        web['accessors'][uv_id].pop(key, None)
    web['materials'][0]['pbrMetallicRoughness']['baseColorTexture'].pop('extensions', None)
    web['materials'][0]['pbrMetallicRoughness']['roughnessFactor'] = .78
    web.pop('extensionsUsed', None)
    web['asset']['generator'] = 'Reservoir Explorer web presentation; original mesh geometry; atlas UV only'
    # No cell or vertex position, normal or index is added/modified.
    return pack_glb(web, bytes(data)), ids[::4]


def surface_vectors(j, binary, model):
    p = j['meshes'][0]['primitives'][0]
    pos = np.array(accessor(j, binary, p['attributes']['POSITION'])).reshape(-1, 4, 3)
    normals = np.array(accessor(j, binary, p['attributes']['NORMAL'])).reshape(-1, 4, 3)[:, 0]
    cells = (np.array(accessor(j, binary, p['attributes']['TEXCOORD_0']))[::8] * 1870).astype(int)
    # Only exact top-shell face centroids; no invented internal coordinates.
    top = {int(c): q.mean(axis=0) for c, q, n in zip(cells, pos, normals) if c < 374 and n[1] > .05}
    candidates = []
    for a, b, q in zip(model['src'], model['dst'], model['flux']):
        if int(a) in top and int(b) in top:
            candidates.append((int(a), int(b), float(q)))
    # Spatially distributed, strongest local connections; always actual flux sign.
    seen, arrows = set(), []
    for a, b, q in sorted(candidates, key=lambda x: -x[2]):
        bucket = (a % 17 // 2, a // 17 // 2)
        if bucket in seen:
            continue
        seen.add(bucket)
        arrows.append(dict(a=a, b=b, start=top[a].tolist(), end=top[b].tolist(),
                           fluxPVPerDay=q, transitDays=float((model['pv'][a] + model['pv'][b]) / (2 * q))))
        if len(arrows) >= 48:
            break
    return arrows


def main():
    meta, props, j, binary = decoded_properties()
    model = setup(meta, props)
    frames, records, checks = solve(model, props[0])
    refined, _, _ = solve(model, props[0], cfl_scale=.5)
    checks['halfStepPoreWeightedFinalL1'] = float(np.dot(model['pv'], abs(frames[-1] - refined[-1])))
    checks['exportFloat32MaxBalanceErrorPV'] = float(max(abs((frames.astype('<f4') - frames) @ model['pv'])))
    out = ROOT / 'scenario'; out.mkdir(exist_ok=True)
    (out / 'water-saturation.f32').write_bytes(frames.astype('<f4').tobytes())
    web, _ = web_geometry(j, binary)
    (out / 'reservoir-web.glb').write_bytes(web)
    result = dict(version=1, title='Conservative transport scenario', cellCount=1870,
                  days=[r['day'] for r in records], states='scenario/water-saturation.f32',
                  units=dict(rate='PV/day', volume='PV', day='assumed scenario day'),
                  ratePVPerDay=.02, records=records, checks=checks,
                  sourceGLBSha256=hashlib.sha256((ROOT / 'reservoir.glb').read_bytes()).hexdigest(),
                  poreWeights=model['pv'].tolist(), surfaceFlow=surface_vectors(j, binary, model),
                  assumptions=['Equal bulk cell volumes; total pore volume normalized to 1.',
                               'Six-neighbor logical connectivity; unit geometric factors; isotropic PERMX.',
                               'No-flow outer boundaries; pure-water injection 0.02 PV/day at INJ.',
                               'Equal total extraction across 3 producers; equal allocation across all 5 layers.',
                               'Incompressible oil/water; equal viscosity and linear relative permeability; fw=Sw.',
                               'No gas, gravity segregation, capillarity, compressibility, trapping or polymer.',
                               'Texture-decoded porosity/permeability/initial saturation are quantized approximations.'])
    (out / 'transport.json').write_text(json.dumps(result, separators=(',', ':')) + '\n')
    print(json.dumps(checks, indent=2))
    print('surface vectors:', len(result['surfaceFlow']), 'frames:', len(frames))


if __name__ == '__main__':
    main()
