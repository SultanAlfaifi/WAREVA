"""Causal long-context features (unchanged from the original V7/V8 scorer).

All windows count samples (minutes at the 60-second GECCO cadence). Every
feature at row t uses only rows <= t. Per-channel references come from
known-normal training rows only; unknown labels (-1) never enter them.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

WINDOWS = (15, 60, 240, 1440)
LAGS = (1, 15, 60, 240, 1440)
MAX_LOOKBACK = 1440
MIN_NORMAL_LEVELS = 128      # finite known-normal readings needed per channel
MIN_NORMAL_DELTAS = 64       # adjacent known-normal differences needed per channel
HISTORY_WINDOW = 60          # prior rows checked for availability
MIN_HISTORY_OBSERVED = 48    # finite readings required in that prior window
LEVEL_CLIP = 32.0
FEATURE_CLIP = 64.0
STALL_NOISE_FRACTION = 0.1

WINDOW_FAMILIES = ("mean_reference_z", "mean_absolute_reference_z", "std_reference_z",
                   "current_minus_mean_z", "range_reference_z", "near_stall_fraction",
                   "observed_fraction", "pair_observed_fraction")
FEATURE_KEYS = (
    ("reference_level_z", "absolute_reference_level_z", "near_stall_run_fraction",
     "current_observed", "reference_supported")
    + tuple(k for lag in LAGS for k in (f"difference_z_lag{lag}", f"lag_pair_observed_{lag}"))
    + tuple(f"{name}_{w}" for w in WINDOWS for name in WINDOW_FAMILIES))


def feature_names(channels):
    names = [f"{c}::{k}" for c in channels for k in FEATURE_KEYS]
    return names + [f"pooled_{p}::{k}" for k in FEATURE_KEYS for p in ("mean", "min", "max")]


def minimum_channels(n_channels):
    return math.ceil(0.75 * n_channels)


class NormalReference:
    """Per-channel median / robust scale / noise floor from known-normal rows."""

    def fit(self, values, labels):
        values = np.asarray(values, float)
        n, c = values.shape
        normal = np.asarray(labels) == 0
        adjacent = np.r_[False, normal[1:] & normal[:-1]] if n else np.zeros(0, bool)
        with np.errstate(over="ignore", invalid="ignore"):
            deltas = np.abs(np.diff(values, axis=0, prepend=np.nan))
        self.median_ = np.full(c, np.nan)
        self.noise_floor_ = np.full(c, np.nan)
        self.scale_ = np.full(c, np.nan)
        self.supported_ = np.zeros(c, bool)
        for j in range(c):
            level = values[normal & np.isfinite(values[:, j]), j]
            change = deltas[adjacent & np.isfinite(deltas[:, j]), j]
            if len(level) < MIN_NORMAL_LEVELS or len(change) < MIN_NORMAL_DELTAS:
                continue
            with np.errstate(over="ignore", invalid="ignore"):
                center = float(np.median(level))
                q25, q75 = np.quantile(level, [.25, .75])
                spread = float(q75 - q25)
                eps = max(abs(center) * 1e-12, 1e-12)
                noise = max(float(np.quantile(change, .75)), eps)
                scale = max(spread / 1.349, noise)
            if np.all(np.isfinite([center, spread, noise, scale])) and scale > 0:
                self.median_[j], self.noise_floor_[j], self.scale_[j] = center, noise, scale
                self.supported_[j] = True
        return self


def _rolling(frame, window):
    return frame.rolling(window, min_periods=1)


def build_features(x: pd.DataFrame, ref: NormalReference):
    """Return (float32 feature matrix, boolean availability mask) for frame x.

    x must hold only the sensor channels, as float, with a fresh RangeIndex.
    Unavailable feature entries become 0 in the matrix; raw readings are never filled.
    """
    values = x.to_numpy()
    n, c = values.shape
    finite = np.isfinite(values)
    supported = ref.supported_[None, :]
    with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
        z = np.clip((values - ref.median_) / ref.scale_, -LEVEL_CLIP, LEVEL_CLIP)
        delta = np.abs(x.diff().to_numpy())
    z[~finite | ~np.broadcast_to(supported, finite.shape)] = np.nan
    pair = finite & np.isfinite(x.shift(1).to_numpy()) & supported
    near = pair & np.isfinite(delta) & (delta <= STALL_NOISE_FRACTION * ref.noise_floor_)
    positions = np.arange(n)
    run = np.zeros((n, c))
    for j in range(c):
        last_break = np.maximum.accumulate(np.where(~near[:, j], positions, -1))
        run[:, j] = np.minimum(positions - last_break, MAX_LOOKBACK) / MAX_LOOKBACK

    fam = {"reference_level_z": z, "absolute_reference_level_z": np.abs(z),
           "near_stall_run_fraction": np.where(supported, run, np.nan),
           "current_observed": finite.astype(float),
           "reference_supported": np.broadcast_to(supported, (n, c)).astype(float)}
    for lag in LAGS:
        past = x.shift(lag).to_numpy()
        observed = finite & np.isfinite(past) & supported
        with np.errstate(over="ignore", invalid="ignore", divide="ignore"):
            diff = np.clip((values - past) / ref.scale_, -FEATURE_CLIP, FEATURE_CLIP)
        fam[f"difference_z_lag{lag}"] = np.where(observed, diff, np.nan)
        fam[f"lag_pair_observed_{lag}"] = observed.astype(float)

    zf, absf = pd.DataFrame(z), pd.DataFrame(np.abs(z))
    obs_f = pd.DataFrame((finite & supported).astype(float))
    pair_f, near_f = pd.DataFrame(pair.astype(float)), pd.DataFrame(near.astype(float))
    for w in WINDOWS:
        roll = _rolling(zf, w)
        center = roll.mean().to_numpy()
        spread = (roll.max() - roll.min()).to_numpy()
        std = roll.std(ddof=0).to_numpy(copy=True)
        std[spread == 0] = 0  # remove rolling-variance roundoff in constant windows
        pairs = _rolling(pair_f, w).sum().to_numpy()
        nears = _rolling(near_f, w).sum().to_numpy()
        fam.update({
            f"mean_reference_z_{w}": center,
            f"mean_absolute_reference_z_{w}": _rolling(absf, w).mean().to_numpy(),
            f"std_reference_z_{w}": std,
            f"current_minus_mean_z_{w}": z - center,
            f"range_reference_z_{w}": spread,
            f"near_stall_fraction_{w}": np.divide(nears, pairs, out=np.full_like(pairs, np.nan),
                                                  where=pairs > 0),
            f"observed_fraction_{w}": _rolling(obs_f, w).sum().to_numpy() / w,
            f"pair_observed_fraction_{w}": pairs / w})

    families = len(FEATURE_KEYS)
    matrix = np.empty((n, (c + 3) * families), dtype=np.float32)
    for k, key in enumerate(FEATURE_KEYS):
        value = np.clip(fam.pop(key), -FEATURE_CLIP, FEATURE_CLIP).astype(np.float32)
        matrix[:, [j * families + k for j in range(c)]] = value
        mask = np.isfinite(value)
        count = mask.sum(axis=1)
        mean = np.divide(np.where(mask, value, 0).sum(axis=1, dtype=np.float64), count,
                         out=np.full(n, np.nan), where=count > 0)
        low = np.min(np.where(mask, value, np.inf), axis=1)
        high = np.max(np.where(mask, value, -np.inf), axis=1)
        low[count == 0], high[count == 0] = np.nan, np.nan
        pooled = c * families + 3 * k
        matrix[:, pooled], matrix[:, pooled + 1], matrix[:, pooled + 2] = mean, low, high
    matrix[~np.isfinite(matrix)] = 0

    history = pd.DataFrame(finite.astype(float)).shift(1).rolling(
        HISTORY_WINDOW, min_periods=1).sum().to_numpy()
    eligible = finite & supported & (history >= MIN_HISTORY_OBSERVED)
    available = eligible.sum(axis=1) >= minimum_channels(c)
    available[:min(HISTORY_WINDOW, n)] = False
    return matrix, available
