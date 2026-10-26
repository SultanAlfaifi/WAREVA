import unittest

import numpy as np

from synthetic import CHANNELS, stream
from wareva_research.pipeline import GAP, Period, alarm, calibrate, run_period, summarize


class AlarmPolicyTests(unittest.TestCase):
    def test_policies(self):
        s = np.array([np.nan, .9, .1, .9, .9, .1, .9, np.nan, .9])
        np.testing.assert_array_equal(alarm(s, .5, "instant"), [-1, 1, 0, 1, 1, 0, 1, -1, 1])
        # 2-of-3: needs the current score plus 2 hits among the last 3 available scores.
        np.testing.assert_array_equal(alarm(s, .5, "2of3"), [-1, 0, 0, 1, 1, 0, 1, -1, 0])
        np.testing.assert_array_equal(alarm(s, None), [-1, 0, 0, 0, 0, 0, 0, -1, 0])


class CalibrationTests(unittest.TestCase):
    def test_separating_score_is_selected(self):
        labels = np.zeros(4000, np.int8)
        for a in range(200, 4000, 500):
            labels[a:a + 20] = 1
        scores = np.where(labels == 1, .9, .1) + np.random.default_rng(0).normal(0, .01, 4000)
        blocks = np.split(labels, 4), np.split(scores, 4)
        chosen = calibrate(*blocks)
        self.assertEqual(chosen["calibration_events"], 8)
        self.assertEqual(chosen["calibration_false_runs"], 0)

    def test_noise_falls_back_to_never_alarm(self):
        labels = np.zeros(4000, np.int8)
        labels[1000:1010] = 1
        scores = np.random.default_rng(1).random(4000)   # carries no information
        chosen = calibrate(np.split(labels, 4), np.split(scores, 4))
        self.assertGreater(chosen["threshold"], scores.max())
        self.assertFalse((alarm(scores, chosen["threshold"]) == 1).any())


class EndToEndTests(unittest.TestCase):
    def test_run_period_and_summary(self):
        data = stream(7000, seed=3)
        period = Period("synthetic", "demo", CHANNELS, data.iloc[:3000],
                        [data.iloc[a:a + 700] for a in range(3000, 5800, 700)], False,
                        data.iloc[5850:])   # events start at test rows 350 and 750
        result = run_period(period)
        self.assertEqual(result["fit_status"], "fitted")
        self.assertTrue((result["predictions"][:GAP] == -1).all())
        self.assertEqual(len(result["predictions"]), 1150)
        stats = result["stats"]
        self.assertEqual(stats["true_events"], 2)
        self.assertGreaterEqual(stats["confirmed_events"], 1)
        pools, overall = summarize([result])
        self.assertEqual(overall["confirmed_events"], pools["demo"]["confirmed_events"])


if __name__ == "__main__":
    unittest.main()
