import unittest

import numpy as np

from wareva_research.metrics import event_stats, total


class EventMetricTests(unittest.TestCase):
    def test_hand_made_example(self):
        #          0  1  2  3  4  5  6  7  8  9 10  11 12 13 14 15 16 17
        labels = [0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 0, -1, 1, 1, 0, 0, 0, 0]
        alarms = [0, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 0]
        s = event_stats(np.array(labels), np.array(alarms), cadence_seconds=60)
        # Events: [2,5) and [8,10). [12,14) follows an unknown label -> censored.
        self.assertEqual(s["true_events"], 2)
        # [2,5) has a 0->1 at row 3; [8,10) is covered by an alarm that began at row 7.
        self.assertEqual(s["confirmed_events"], 1)
        self.assertEqual(s["confirmed_event_ids"], [1])
        self.assertEqual(s["confirmed_latency_seconds"], [60.0])
        # Normal rows under alarm: 5 | 7 | 10 | 14,15 (row 11 is unknown and splits).
        self.assertEqual(s["false_positive_runs"], 4)
        self.assertEqual(s["fp"], 5)
        self.assertEqual(s["false_alarm_minutes"], 5)
        self.assertEqual((s["tp"], s["fn"], s["tn"]), (5, 2, 5))
        self.assertEqual(s["normal_observed_seconds"], 600)
        self.assertEqual(s["false_runs_per_day"], 4 * 86400 / 600)
        self.assertAlmostEqual(s["f1_observed_points"], 10 / 17)

    def test_unavailable_to_alarm_and_series_start_do_not_count(self):
        s = event_stats(np.array([0, 0, 1, 1, 0]), np.array([0, -1, 1, 1, 0]))
        self.assertEqual((s["true_events"], s["confirmed_events"]), (1, 0))
        s = event_stats(np.array([1, 1, 0, 0]), np.array([0, 1, 0, 0]))
        self.assertEqual(s["true_events"], 0)   # starts at row 0 -> censored

    def test_unknown_labels_are_never_false_alarms(self):
        s = event_stats(np.array([-1, -1, -1]), np.array([1, 1, 1]))
        self.assertEqual((s["fp"], s["false_positive_runs"], s["false_runs_per_day"]), (0, 0, None))

    def test_total_sums_pools_and_recomputes_ratios(self):
        a = event_stats(np.array([0, 0, 1, 1, 0, 0]), np.array([0, 0, 1, 1, 0, 1]))
        b = event_stats(np.array([0, 1, 0, 0]), np.array([0, 0, 1, 0]))
        t = total([a, b])
        self.assertEqual((t["true_events"], t["confirmed_events"]), (2, 1))
        self.assertEqual((t["false_positive_runs"], t["fp"]), (2, 2))
        self.assertEqual(t["false_alarm_minutes"], 2)
        self.assertEqual(t["normal_observed_seconds"], (2 + 5) * 60)
        self.assertEqual(t["false_runs_per_day"], 2 * 86400 / 420)

    def test_rejects_bad_inputs(self):
        with self.assertRaises(ValueError):
            event_stats(np.array([0, 2]), np.array([0, 0]))
        with self.assertRaises(ValueError):
            event_stats(np.array([0, 1]), np.array([0]))


if __name__ == "__main__":
    unittest.main()
