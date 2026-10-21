"""Numerical/asset consistency tests, not field validation."""
import json
import sys
from pathlib import Path
import unittest
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_transport import decoded_properties, setup, solve
from build_ar_assets import read_glb, accessor


class TransportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta, cls.props, cls.source, cls.binary = decoded_properties()
        cls.model = setup(cls.meta, cls.props)
        cls.frames, cls.records, cls.checks = solve(cls.model, cls.props[0])

    def test_balance_bounds_units_and_nonnegative_volumes(self):
        m, f, r = self.model, self.frames, self.records
        self.assertAlmostEqual(m['pv'].sum(), 1)
        self.assertAlmostEqual(m['injection'].sum(), .02)
        self.assertAlmostEqual(m['extraction'].sum(), .02)
        self.assertLess(self.checks['maxPhaseBalanceErrorPV'], 1e-10)
        self.assertLessEqual(self.checks['maxCFL'], .8000000001)
        self.assertGreaterEqual(f.min(), -1e-10)
        self.assertLessEqual(f.max(), 1 + 1e-10)
        np.testing.assert_allclose(f + (1 - f), 1, atol=1e-15)
        np.testing.assert_allclose(f[0], 1 - self.props[0], atol=0)
        for key in ['oilRate', 'waterRate', 'oilPV', 'waterPV', 'cumulativeOil', 'cumulativeWater', 'injectedPV']:
            self.assertGreaterEqual(min(p[key] for p in r), -1e-12)
        self.assertAlmostEqual(r[-1]['injectedPV'], .02 * 30)
        self.assertAlmostEqual(r[-1]['cumulativeOil'] + r[-1]['cumulativeWater'], .02 * 30)
        for frame, record in zip(f, r):
            self.assertAlmostEqual(np.dot(m['pv'], 1 - frame) + record['cumulativeOil'], r[0]['oilPV'])
            self.assertAlmostEqual(sum(w['oil'] for w in record['wells'].values()), record['oilRate'])

    def test_timestep_refinement(self):
        half, _, _ = solve(self.model, self.props[0], cfl_scale=.5)
        self.assertLess(np.dot(self.model['pv'], abs(half[-1] - self.frames[-1])), .001)

    def test_closed_compartment_has_no_spontaneous_transport(self):
        n = 2
        closed = dict(pv=np.array([.4, .6]), src=np.array([], dtype=int), dst=np.array([], dtype=int),
                      flux=np.array([]), outflow=np.zeros(n), injection=np.zeros(n), extraction=np.zeros(n),
                      wells={}, stable_dt=.2, residual=0, iterations=0)
        initial = np.array([.75, 0])
        frames, records, _ = solve(closed, initial, end=2)
        np.testing.assert_allclose(frames, np.tile(1 - initial, (len(frames), 1)), atol=0)
        self.assertEqual(records[-1]['cumulativeOil'], 0)

    def test_single_mixed_tank_matches_analytic_displacement(self):
        # dSw/dt = q*(1-Sw)/PV; exact So = So0 exp(-q*t/PV).
        tank = dict(pv=np.array([1.]), src=np.array([], dtype=int), dst=np.array([], dtype=int), flux=np.array([]),
                    outflow=np.array([.02]), injection=np.array([.02]), extraction=np.array([.02]),
                    wells={'tank': np.array([0])}, stable_dt=.01, residual=0, iterations=0)
        f, _, _ = solve(tank, np.array([.75]), end=5)
        self.assertLess(abs(1 - f[-1, 0] - .75 * np.exp(-.02 * 5)), 1e-5)

    def test_export_and_original_geometry(self):
        info = json.loads((ROOT / 'scenario/transport.json').read_text())
        exported = np.fromfile(ROOT / info['states'], dtype='<f4').reshape(len(info['days']), 1870)
        np.testing.assert_allclose(exported, self.frames, atol=3e-8)
        self.assertLess(max(abs((exported - self.frames) @ self.model['pv'])), 2e-8)
        j, b = read_glb(ROOT / 'scenario/reservoir-web.glb')
        self.assertEqual(len(j['meshes']), len(self.source['meshes']))
        for old, new in zip(self.source['meshes'], j['meshes']):
            op, np_ = old['primitives'][0], new['primitives'][0]
            for attr in ['POSITION', 'NORMAL']:
                if attr in op['attributes']:
                    self.assertEqual(accessor(self.source, self.binary, op['attributes'][attr]), accessor(j, b, np_['attributes'][attr]))
            self.assertEqual(accessor(self.source, self.binary, op['indices']), accessor(j, b, np_['indices']))
        # Every rendered vector must follow the actual conservative flux sign.
        fluxes = {(int(a), int(b)): q for a, b, q in zip(self.model['src'], self.model['dst'], self.model['flux'])}
        for v in info['surfaceFlow']:
            self.assertAlmostEqual(fluxes[v['a'], v['b']], v['fluxPVPerDay'])
            self.assertLess(v['a'], 374); self.assertLess(v['b'], 374)


if __name__ == '__main__':
    unittest.main()
