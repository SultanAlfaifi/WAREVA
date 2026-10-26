import unittest

import numpy as np
import pandas as pd

from synthetic import CHANNELS, stream
from wareva_research.model import HGB_PARAMS, OnsetWeightedHGBScorer


def onset_fixture():
    """Events with censored, partially unavailable and fully available onsets (from V8's tests)."""
    rng = np.random.default_rng(44)
    frame = pd.DataFrame(rng.normal(size=(1200, 4)), columns=CHANNELS)
    labels = np.zeros(1200, np.int8)
    for a, b in ((0, 90), (300, 310), (400, 420), (500, 520), (600, 601), (700, 705), (800, 810)):
        labels[a:b] = 1
    labels[[299, 699]] = -1          # events at 300 and 700 follow an unknown label
    labels[1000:1020] = -1
    frame.iloc[[400, 402], :] = np.nan
    frame.iloc[500:503, :] = np.nan  # the whole onset window of the event at 500
    return frame, labels


class OnsetWeightTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frame, cls.labels = onset_fixture()
        cls.scorer = OnsetWeightedHGBScorer(CHANNELS).fit(cls.frame, cls.labels)
        cls.w = cls.scorer.training_weight_

    def test_masses(self):
        info, y, w = self.scorer.weight_info_, self.labels, self.w
        self.assertAlmostEqual(w.sum(), 1, places=12)
        self.assertAlmostEqual(w[y == 0].sum(), .5, places=12)
        self.assertAlmostEqual(w[y == 1].sum(), .5, places=12)
        self.assertTrue((w[y == -1] == 0).all())
        self.assertEqual((info["events"], info["onset_events"], info["onset_rows"]), (7, 3, 5))

    def test_onset_bonus_only_on_known_onsets(self):
        w, bonus = self.w, .25 / 3          # 0.25 shared by the 3 events with an eligible onset
        self.assertAlmostEqual(w[800] - w[803], bonus / 3)   # all three onset rows available
        self.assertAlmostEqual(w[401] - w[403], bonus)       # only row 401 is available
        self.assertEqual(w[503], w[510])                      # onset rows unavailable: no shift
        for row in (61, 301, 701):                            # censored onsets: uniform
            self.assertGreater(w[row], 0)
            self.assertEqual(w[row], w[row + 2])

    def test_mass_moves_to_events_when_no_onset_is_eligible(self):
        labels = np.zeros(1200, np.int8)
        labels[:90] = 1
        labels[299], labels[300:310] = -1, 1
        labels[500:520] = 1
        scorer = OnsetWeightedHGBScorer(CHANNELS).fit(self.frame, labels)
        self.assertEqual(scorer.weight_info_["onset_events"], 0)
        w = scorer.training_weight_
        per_event = [w[a:b][w[a:b] > 0].sum() - .125 * (w[a:b] > 0).sum() / (w[labels == 1] > 0).sum()
                     for a, b in ((0, 90), (300, 310), (500, 520))]
        np.testing.assert_allclose(per_event, .375 / 3)


class ScorerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.train, cls.test = stream(3000, seed=1), stream(1500, seed=2)
        cls.scorer = OnsetWeightedHGBScorer(CHANNELS).fit(cls.train, cls.train["EVENT"].to_numpy())
        cls.scores = cls.scorer.score(cls.test)

    def test_parameters_are_v8(self):
        self.assertEqual(HGB_PARAMS, dict(max_iter=100, max_leaf_nodes=15, max_depth=None,
                                          min_samples_leaf=20, learning_rate=0.08, l2_regularization=1,
                                          max_bins=63, early_stopping=False, random_state=20261016))
        self.assertEqual(self.scorer.model_.get_params()["max_iter"], 100)

    def test_fit_and_score(self):
        self.assertEqual(self.scorer.fit_status_, "fitted")
        _, available = self.scorer.features(self.test)
        np.testing.assert_array_equal(np.isfinite(self.scores), available)
        finite = self.scores[available]
        self.assertTrue(((finite >= 0) & (finite <= 1)).all())
        y = self.test["EVENT"].to_numpy()[available]
        self.assertGreater(finite[y == 1].mean(), finite[y == 0].mean() + .3)

    def test_deterministic(self):
        again = OnsetWeightedHGBScorer(CHANNELS).fit(self.train, self.train["EVENT"].to_numpy())
        np.testing.assert_array_equal(again.score(self.test), self.scores)

    def test_too_little_normal_data_gives_no_model(self):
        tiny = self.train.iloc[:100]
        scorer = OnsetWeightedHGBScorer(CHANNELS).fit(tiny, tiny["EVENT"].to_numpy())
        self.assertEqual(scorer.fit_status_, "insufficient_normal_reference")
        self.assertTrue(np.isnan(scorer.score(self.test)).all())


if __name__ == "__main__":
    unittest.main()
