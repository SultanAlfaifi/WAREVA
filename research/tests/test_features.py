import unittest

import numpy as np

from synthetic import CHANNELS, stream
from wareva_research.features import FEATURE_KEYS, NormalReference, build_features, feature_names


def fitted(frame):
    x = frame[CHANNELS].astype(float)
    return x, NormalReference().fit(x.to_numpy(), frame["EVENT"].to_numpy())


class FeatureTests(unittest.TestCase):
    def setUp(self):
        self.frame = stream(2000)
        self.x, self.ref = fitted(self.frame)

    def test_shape_names_and_dtype(self):
        matrix, available = build_features(self.x, self.ref)
        self.assertEqual(len(FEATURE_KEYS), 47)
        self.assertEqual(matrix.shape, (2000, (4 + 3) * 47))
        self.assertEqual(len(feature_names(CHANNELS)), matrix.shape[1])
        self.assertEqual(matrix.dtype, np.float32)
        self.assertTrue(np.isfinite(matrix).all())
        self.assertEqual(available.shape, (2000,))

    def test_first_60_rows_unavailable_then_available(self):
        _, available = build_features(self.x, self.ref)
        self.assertFalse(available[:60].any())
        self.assertGreater(available[60:].mean(), .99)

    def test_features_are_causal(self):
        full, full_available = build_features(self.x, self.ref)
        prefix, prefix_available = build_features(self.x.iloc[:1500], self.ref)
        np.testing.assert_array_equal(full[:1500], prefix)
        np.testing.assert_array_equal(full_available[:1500], prefix_available)

    def test_reference_uses_only_known_normal_rows(self):
        changed = self.frame.copy()
        labels = changed["EVENT"].to_numpy().copy()
        labels[100:150] = -1
        changed["EVENT"] = labels
        _, before = fitted(changed)
        changed.loc[(labels != 0), CHANNELS] = 1e6   # alter every unknown/event reading
        _, after = fitted(changed)
        np.testing.assert_array_equal(before.median_, after.median_)
        np.testing.assert_array_equal(before.scale_, after.scale_)

    def test_availability_needs_three_of_four_supported_channels(self):
        one_dead = self.frame.copy()
        one_dead["d"] = np.nan
        x, ref = fitted(one_dead)
        self.assertEqual(ref.supported_.tolist(), [True, True, True, False])
        self.assertGreater(build_features(x, ref)[1].mean(), .9)
        one_dead["c"] = np.nan
        x, ref = fitted(one_dead)
        self.assertFalse(build_features(x, ref)[1].any())


if __name__ == "__main__":
    unittest.main()
