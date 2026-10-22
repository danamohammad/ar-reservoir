"""Approved balanced day-7 shut-in: regression and numerical consistency."""
import json
import subprocess
import sys
import unittest
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_transport import decoded_properties, well_controls, setup, solve, require_balanced_controls, ControlBalanceError, surface_vectors
BASELINE = 'ae2ca391bae1f98f54578c05c7a13477d602fbac'

class ShutInTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta, cls.props, cls.source, cls.binary = decoded_properties()
        cls.model = setup(cls.meta, cls.props, prod3_shut_in_day=7)
        cls.post = setup(cls.meta, cls.props, day=7, prod3_shut_in_day=7)
        cls.frames, cls.records, cls.checks = solve(cls.model, cls.props[0])

    def test_exact_identity(self):
        wells = [w for w in self.meta['wells'] if w['name'] == 'PROD-3']
        self.assertEqual(len(wells), 1)
        self.assertEqual((wells[0]['i'], wells[0]['j'], wells[0]['kind']), (13, 5, 'prod'))

    def test_day6_active_day7_and_later_zero_with_exact_balance(self):
        old_inj, old_ext, wells = well_controls(self.meta)
        for day in [6, 6.75, 6.999999]:
            inj, ext, _ = well_controls(self.meta, day, 7)
            np.testing.assert_array_equal(inj, old_inj)
            np.testing.assert_array_equal(ext, old_ext)
        for day in [7, 7.25, 30, 1000]:
            inj, ext, _ = well_controls(self.meta, day, 7)
            np.testing.assert_array_equal(ext[wells['PROD-3']], np.zeros(5))
            for name in ['PROD-1', 'PROD-2']:
                np.testing.assert_array_equal(ext[wells[name]], old_ext[wells[name]])
            self.assertLess(abs(ext.sum() - .02 * 2 / 3), 1e-17)
            self.assertLess(abs(inj.sum() - ext.sum()), 1e-17)
            self.assertNotEqual(inj.sum(), .01333)

    def test_pre_shutin_matches_previous_release_and_event_is_continuous(self):
        def original(path):
            return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], cwd=ROOT)
        published = np.frombuffer(original('scenario/water-saturation.f32'), dtype='<f4').reshape(-1,1870)
        baseline = json.loads(original('scenario/transport.json'))
        # Day 7 state integrates only pre-event controls; rates change at that instant.
        np.testing.assert_array_equal(self.frames[:29].astype('<f4'), published[:29])
        self.assertEqual(self.records[:28], baseline['records'][:28])
        for key in ['oilPV', 'waterPV', 'cumulativeOil', 'cumulativeWater', 'injectedPV']:
            self.assertEqual(self.records[28][key], baseline['records'][28][key])
        self.assertFalse(np.array_equal(self.frames[-1].astype('<f4'), published[-1]))
        for r in self.records[28:]:
            self.assertEqual(r['wells']['PROD-3'], {'oil':0., 'water':0., 'injection':0.})
            self.assertAlmostEqual(r['oilRate'] + r['waterRate'], .02 * 2 / 3, places=15)
        self.assertGreater(sum(self.records[24]['wells']['PROD-3'].values()), 0)

    def test_conservation_stability_refinement_and_saved_output(self):
        c, r, f = self.checks, self.records, self.frames
        self.assertLess(c['maxPhaseBalanceErrorPV'], 1e-10)
        self.assertLessEqual(c['maxCFL'], .8000000001)
        self.assertGreaterEqual(f.min(), -1e-10)
        self.assertLessEqual(f.max(), 1 + 1e-10)
        np.testing.assert_allclose(f + (1-f), 1, atol=1e-15)
        expected = 7*.02 + 23*(.02*2/3)
        self.assertAlmostEqual(r[-1]['injectedPV'], expected, places=13)
        self.assertAlmostEqual(r[-1]['cumulativeOil']+r[-1]['cumulativeWater'], expected, places=13)
        half, _, _ = solve(self.model, self.props[0], cfl_scale=.5)
        self.assertLess(np.dot(self.model['pv'], abs(half[-1]-f[-1])), .001)
        for key in ['oilRate','waterRate','oilPV','waterPV','cumulativeOil','cumulativeWater','injectedPV']:
            self.assertGreaterEqual(min(p[key] for p in r), -1e-12)
        exported = np.fromfile(ROOT/'scenario/water-saturation.f32', dtype='<f4').reshape(-1,1870)
        np.testing.assert_array_equal(exported, f.astype('<f4'))

    def test_event_also_splits_steps_between_output_frames(self):
        f, r, c = solve(self.model, self.props[0], frame_step=.3)
        self.assertLess(c['maxPhaseBalanceErrorPV'], 1e-10)
        self.assertAlmostEqual(r[-1]['injectedPV'], 7*.02+23*.02*2/3, places=13)
        self.assertEqual(r[24]['wells']['PROD-3']['oil'], 0)

    def test_post_event_flow_recomputed_and_rendered_vectors_match(self):
        self.assertFalse(np.array_equal(self.model['flux'], self.post['flux']))
        info = json.loads((ROOT/'scenario/transport.json').read_text())
        periods = info['controlPeriods']
        self.assertEqual(periods[1]['startDay'], 7)
        self.assertEqual(periods[1]['shutWells'], ['PROD-3'])
        self.assertEqual(periods[1]['surfaceFlow'], surface_vectors(self.source,self.binary,self.post))
        self.assertNotEqual(periods[1]['surfaceFlow'], info['surfaceFlow'])

    def test_unbalanced_controls_still_rejected(self):
        inj, ext, _ = well_controls(self.meta, 7, 7)
        with self.assertRaises(ControlBalanceError):
            require_balanced_controls(inj*1.5, ext, 7)

if __name__ == '__main__':
    unittest.main()
