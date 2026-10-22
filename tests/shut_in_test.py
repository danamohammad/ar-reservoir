"""PROD-3 schedule and the resulting model-compatibility guard."""
import json
import sys
import unittest
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from build_transport import decoded_properties, well_controls, setup, solve, ControlBalanceError


class ShutInTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta, cls.props, _, _ = decoded_properties()

    def test_exact_identity(self):
        wells = [w for w in self.meta['wells'] if w['name'] == 'PROD-3']
        self.assertEqual(len(wells), 1)
        self.assertEqual((wells[0]['i'], wells[0]['j'], wells[0]['kind']), (13, 5, 'prod'))

    def test_day6_active_day7_and_later_zero_without_redistribution(self):
        old_inj, old_ext, wells = well_controls(self.meta)
        for day in [6, 6.75, 6.999999]:
            inj, ext, _ = well_controls(self.meta, day, 7)
            np.testing.assert_array_equal(inj, old_inj)
            np.testing.assert_array_equal(ext, old_ext)
        for day in [7, 7.25, 30, 1000]:
            inj, ext, _ = well_controls(self.meta, day, 7)
            np.testing.assert_array_equal(inj, old_inj)
            np.testing.assert_array_equal(ext[wells['PROD-3']], np.zeros(5))
            for name in ['PROD-1', 'PROD-2']:
                np.testing.assert_array_equal(ext[wells[name]], old_ext[wells[name]])
            self.assertAlmostEqual(ext.sum(), .02 * 2 / 3)
            self.assertAlmostEqual(inj.sum() - ext.sum(), .02 / 3)

    def test_pre_shutin_saturation_and_conservation_are_unchanged(self):
        m = setup(self.meta, self.props, prod3_shut_in_day=7)
        frames, records, checks = solve(m, self.props[0], end=6.75)
        published = np.fromfile(ROOT / 'scenario/water-saturation.f32', dtype='<f4').reshape(-1,1870)
        np.testing.assert_array_equal(frames.astype('<f4'), published[:len(frames)])
        baseline = json.loads((ROOT / 'scenario/transport.json').read_text())
        self.assertEqual(records[24]['wells']['PROD-3'], baseline['records'][24]['wells']['PROD-3'])
        self.assertLess(checks['maxPhaseBalanceErrorPV'], 1e-10)
        self.assertLessEqual(checks['maxCFL'], .8000000001)

    def test_incompatible_post_shutin_flow_is_rejected(self):
        with self.assertRaisesRegex(ControlBalanceError, 'Day 7'):
            setup(self.meta, self.props, day=7, prod3_shut_in_day=7)
        m = setup(self.meta, self.props, prod3_shut_in_day=7)
        with self.assertRaisesRegex(ControlBalanceError, 'cannot store this excess'):
            solve(m, self.props[0], end=30)


if __name__ == '__main__':
    unittest.main()
