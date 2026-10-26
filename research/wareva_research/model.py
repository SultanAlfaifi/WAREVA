"""V8 scorer: HistGradientBoosting on long-context features with onset weighting.

Labels are integers: -1 unknown, 0 normal, 1 event. Unknown rows never become
targets, negatives or weights. The score is a classifier ranking in [0, 1],
not a calibrated water-safety probability. Parameters are V8's, unchanged.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from .features import NormalReference, build_features, feature_names, minimum_channels

HGB_PARAMS = dict(max_iter=100, max_leaf_nodes=15, max_depth=None, min_samples_leaf=20,
                  learning_rate=0.08, l2_regularization=1, max_bins=63,
                  early_stopping=False, random_state=20261016)
MIN_NORMAL_FIT_ROWS = 128
ONSET_WINDOW_SAMPLES = 3     # onset rows at offsets 0, 1, 2 of each known-onset event
NEGATIVE_MASS = .5
POSITIVE_POINT_MASS = .125
POSITIVE_EVENT_MASS = .125
POSITIVE_ONSET_MASS = .25


def segments(labels):
    """(start, end_exclusive) of each contiguous run of label 1."""
    change = np.diff(np.r_[False, np.asarray(labels) == 1, False].astype(np.int8))
    return list(zip(np.flatnonzero(change == 1).tolist(), np.flatnonzero(change == -1).tolist()))


def onset_weights(labels, eligible):
    """Normalized training weights (sum 1) and a summary dict.

    Negative mass 0.5 is uniform over eligible normal rows. Positive mass 0.5 is
    0.125 uniform per row + 0.125 uniform per event + 0.25 uniform per known-onset
    event (spread over its eligible rows at offsets 0..2). A known onset must be
    preceded by label 0. With no eligible onset, its 0.25 joins the per-event mass.
    """
    y = np.asarray(labels)
    positive, negative = eligible & (y == 1), eligible & (y == 0)
    events, onsets = [], []
    for start, end in segments(y):
        rows = np.flatnonzero(positive[start:end]) + start
        if len(rows):
            events.append(rows)
        if start > 0 and y[start - 1] == 0:
            first = np.flatnonzero(positive[start:min(end, start + ONSET_WINDOW_SAMPLES)]) + start
            if len(first):
                onsets.append(first)
    weights = np.zeros(len(y))
    info = {"normal_rows": int(negative.sum()), "positive_rows": int(positive.sum()),
            "events": len(events), "onset_events": len(onsets),
            "onset_rows": int(sum(len(r) for r in onsets))}
    if not info["positive_rows"] or not info["normal_rows"]:
        return weights, info
    event_mass = POSITIVE_EVENT_MASS + (0 if onsets else POSITIVE_ONSET_MASS)
    weights[negative] = NEGATIVE_MASS / info["normal_rows"]
    weights[positive] = POSITIVE_POINT_MASS / info["positive_rows"]
    for rows in events:
        weights[rows] += event_mass / (len(events) * len(rows))
    for rows in onsets:
        weights[rows] += POSITIVE_ONSET_MASS / (len(onsets) * len(rows))
    return weights, info


class OnsetWeightedHGBScorer:
    """fit(frame, labels) then score(frame) -> per-row event score (NaN = unavailable)."""

    def __init__(self, channels):
        self.channels = list(channels)
        if not self.channels or len(set(self.channels)) != len(self.channels):
            raise ValueError("channels must be a nonempty list of unique names")
        self.feature_names_ = feature_names(self.channels)
        self.model_ = None
        self.fit_status_ = "not_fitted"

    def _frame(self, frame):
        if not isinstance(frame, pd.DataFrame) or any(c not in frame for c in self.channels):
            raise ValueError("frame must contain every sensor channel")
        x = frame.loc[:, self.channels].astype(float)
        return x.replace([np.inf, -np.inf], np.nan).reset_index(drop=True)

    def features(self, frame):
        return build_features(self._frame(frame), self.reference_)

    def fit(self, frame, labels):
        x = self._frame(frame)
        y = np.asarray(labels)
        if y.shape != (len(x),) or y.dtype.kind not in "biu" or not np.isin(y, [-1, 0, 1]).all():
            raise ValueError("labels must be same-length integer -1/0/1 values")
        y = y.astype(np.int8)
        self.model_ = None
        self.reference_ = NormalReference().fit(x.to_numpy(), y)
        self.weight_info_ = {}
        if self.reference_.supported_.sum() < minimum_channels(len(self.channels)):
            self.fit_status_ = "insufficient_normal_reference"
            return self
        matrix, available = build_features(x, self.reference_)
        eligible = available & (y >= 0)
        weights, self.weight_info_ = onset_weights(y, eligible)
        self.training_weight_ = weights
        if self.weight_info_["normal_rows"] < MIN_NORMAL_FIT_ROWS:
            self.fit_status_ = "insufficient_normal_examples"
            return self
        if not self.weight_info_["positive_rows"]:
            self.fit_status_ = "no_event_training"
            return self
        if not np.isclose(weights.sum(), 1.0, rtol=0, atol=1e-12):
            raise AssertionError("normalized training weights must sum to one")
        sample_weight = weights * int(eligible.sum())
        self.model_ = HistGradientBoostingClassifier(**HGB_PARAMS)
        self.model_.fit(matrix[eligible], y[eligible], sample_weight=sample_weight[eligible])
        self.fit_status_ = "fitted"
        return self

    def score(self, frame):
        x = self._frame(frame)
        out = np.full(len(x), np.nan)
        if self.model_ is None:
            return out
        matrix, available = build_features(x, self.reference_)
        if available.any():
            column = int(np.flatnonzero(self.model_.classes_ == 1)[0])
            out[available] = self.model_.predict_proba(matrix[available])[:, column]
        return out
