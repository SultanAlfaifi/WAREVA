"""GECCO development periods, alarm policy, calibration and evaluation.

Geometry is the original V8 protocol for its 13 GECCO periods: expanding past
training, four adjacent past calibration blocks, then one test period. Each
calibration/test segment discards its first 120 rows before features are built
(GECCO 2019 calibration is scored as one continuous segment, as in V8).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .metrics import event_stats, total
from .model import OnsetWeightedHGBScorer

GAP = 120
CADENCE_SECONDS = 60
CHANNELS_2017_2018 = ["Tp", "Cl", "pH", "Redox", "Leit", "Trueb", "Cl_2", "Fm", "Fm_2"]
CHANNELS_2019 = ["Tp", "pH", "Cond", "Turb", "SAC", "PFM"]
FILES = {"2017": "gecco2017/1_gecco2017_water_quality.csv",
         "2018": "gecco2018/1_gecco2018_water_quality.csv",
         "2019": ("gecco2019/7_gecco2019_train_water_quality.csv",
                  "gecco2019/8_gecco2019_valid_water_qulity.csv",
                  "gecco2019/6_gecco2019_test_water_quality.csv")}
POLICIES = {"instant": (1, 1), "2of3": (2, 3), "3of5": (3, 5)}   # m alarms in last w rows
THRESHOLD_QUANTILES = np.linspace(.90, 1, 41)
MAX_FALSE_RUNS_PER_DAY = 1.0        # calibration budget (original baseline protocol)
MAX_NORMAL_ALARM_FRACTION = 0.01


@dataclass
class Period:
    name: str
    source: str
    channels: list
    train: pd.DataFrame
    calibration: list
    continuous_calibration: bool
    test: pd.DataFrame


def labels_of(frame):
    return frame["EVENT"].to_numpy(np.int8)


def _read(path):
    return pd.read_csv(path).rename(columns={"Event": "EVENT"})


def gecco_periods(data_dir, sources=("2017", "2018", "2019")):
    data_dir = Path(data_dir)
    for year in ("2017", "2018"):
        if year not in sources:
            continue
        df = _read(data_dir / FILES[year])
        n = len(df)
        for k in range(4, 10):
            train_end, test_start, test_end = (n * p // 10 for p in (k - 2, k, k + 1))
            b = np.linspace(train_end, test_start, 5, dtype=int)
            yield Period(f"{year}_fold_{k - 3}", year, CHANNELS_2017_2018, df.iloc[:train_end],
                         [df.iloc[b[i]:b[i + 1]] for i in range(4)], False,
                         df.iloc[test_start:test_end])
    if "2019" in sources:
        train, valid, test = (_read(data_dir / f) for f in FILES["2019"])
        b = np.linspace(0, len(valid), 5, dtype=int)
        yield Period("2019_disclosed_test", "2019", CHANNELS_2019, train,
                     [valid.iloc[b[i]:b[i + 1]] for i in range(4)], True, test)


def score_with_gap(model, frame, gap=GAP):
    """Discard the first `gap` rows (fresh context), score the rest; NaN = unavailable."""
    head = np.full(min(gap, len(frame)), np.nan)
    return np.r_[head, model.score(frame.iloc[gap:])]


def alarm(scores, threshold, policy="instant"):
    """-1 where the score is unavailable; 1 when the current score and at least m of
    the last w (all available) scores reach the threshold; else 0."""
    s = np.asarray(scores, float)
    finite = np.isfinite(s)
    if threshold is None:
        return np.where(finite, 0, -1).astype(np.int8)
    m, w = POLICIES[policy]
    hit = finite & (s >= threshold)
    gate = np.zeros(len(s), bool)
    if len(s) >= w:
        ones = np.ones(w, int)
        complete = np.convolve(finite.astype(int), ones, "valid") == w
        gate[w - 1:] = complete & (np.convolve(hit.astype(int), ones, "valid") >= m)
    return np.where(finite, (gate & hit).astype(np.int8), -1).astype(np.int8)


def calibrate(label_blocks, score_blocks):
    """Pick (threshold, policy) on adjacent past blocks only.

    Feasible: <= 1 false-alarm fragment per known-normal day and <= 1% of normal
    time under alarm. Rank: most detected events, then fewest fragments, then
    fewest false-alarm rows, then the higher threshold. The threshold above the
    maximum score (never alarm) is always feasible.
    """
    labels = np.concatenate(label_blocks)
    pooled = np.concatenate(score_blocks)
    pooled = pooled[np.isfinite(pooled)]
    if not len(pooled):
        return {"threshold": None, "policy": "instant", "status": "no_scores"}
    thresholds = np.unique(np.r_[np.quantile(pooled, THRESHOLD_QUANTILES),
                                 np.nextafter(pooled.max(), np.inf)])
    best, best_key = None, None
    for p_index, policy in enumerate(POLICIES):
        for threshold in thresholds:
            pred = np.concatenate([alarm(s, threshold, policy) for s in score_blocks])
            st = event_stats(labels, pred, CADENCE_SECONDS)
            if (st["false_runs_per_day"] or 0) > MAX_FALSE_RUNS_PER_DAY or \
               (st["normal_alarm_fraction"] or 0) > MAX_NORMAL_ALARM_FRACTION:
                continue
            key = (-st["confirmed_events"], st["false_positive_runs"], st["fp"], -threshold, p_index)
            if best_key is None or key < best_key:
                best_key = key
                best = {"threshold": float(threshold), "policy": policy, "status": "selected",
                        "calibration_events": st["confirmed_events"],
                        "calibration_true_events": st["true_events"],
                        "calibration_false_runs": st["false_positive_runs"]}
    return best


def run_period(period: Period):
    model = OnsetWeightedHGBScorer(period.channels).fit(period.train, labels_of(period.train))
    if period.continuous_calibration:
        whole = score_with_gap(model, pd.concat(period.calibration, ignore_index=True))
        cuts = np.cumsum([len(b) for b in period.calibration])[:-1]
        score_blocks = np.split(whole, cuts)
    else:
        score_blocks = [score_with_gap(model, b) for b in period.calibration]
    selected = calibrate([labels_of(b) for b in period.calibration], score_blocks)
    y = labels_of(period.test)
    pred = alarm(score_with_gap(model, period.test), selected["threshold"], selected["policy"])
    return {"name": period.name, "source": period.source, "fit_status": model.fit_status_,
            "selected": selected, "labels": y, "predictions": pred,
            "stats": event_stats(y, pred, CADENCE_SECONDS)}


def summarize(results):
    """Pool each source's contiguous test periods, then sum the source pools."""
    sources = {}
    for r in results:
        sources.setdefault(r["source"], []).append(r)
    pools = {name: event_stats(np.concatenate([r["labels"] for r in rs]),
                               np.concatenate([r["predictions"] for r in rs]), CADENCE_SECONDS)
             for name, rs in sources.items()}
    return pools, total(list(pools.values()))
