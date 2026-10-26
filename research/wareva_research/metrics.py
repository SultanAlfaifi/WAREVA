"""Event-level accounting used for every V8/V9 result (original row axis).

labels: -1 unknown, 0 normal, 1 event.  predictions: -1 unavailable, 0 quiet, 1 alarm.

* An event is a contiguous run of label 1 whose first row directly follows a
  label 0 ("established onset"). Runs at the series start or after an unknown
  label are left-censored and are not counted as events.
* An event is detected when the prediction goes 0 -> 1 on adjacent rows inside
  it. An alarm already on before the event, or starting after -1, does not count.
* A false-alarm fragment is a contiguous run of rows with label 0 and alarm 1.
  Unknown labels split fragments. False-alarm minutes = such rows x cadence / 60.
"""
from __future__ import annotations

import numpy as np

SUM_KEYS = ("true_events", "confirmed_events", "tp", "fp", "fn", "tn",
            "false_positive_runs", "normal_observed_seconds", "fp_duration_seconds", "rows")


def _ternary(values, name):
    a = np.asarray(values)
    if a.ndim != 1 or a.dtype.kind not in "biu" or not np.isin(a, (-1, 0, 1)).all():
        raise ValueError(f"{name} must be a 1-D integer array of -1/0/1")
    return a.astype(np.int8)


def _derived(s):
    ratio = lambda a, b: float(a / b) if b else None
    s["false_alarm_minutes"] = s["fp_duration_seconds"] / 60
    s["false_runs_per_day"] = ratio(s["false_positive_runs"] * 86400, s["normal_observed_seconds"])
    s["normal_alarm_fraction"] = ratio(s["fp"], s["fp"] + s["tn"])
    s["f1_observed_points"] = ratio(2 * s["tp"], 2 * s["tp"] + s["fp"] + s["fn"])
    return s


def event_stats(labels, predictions, cadence_seconds=60):
    y, p = _ternary(labels, "labels"), _ternary(predictions, "predictions")
    if y.shape != p.shape:
        raise ValueError("labels and predictions must have equal shape")
    alarm = p == 1
    false = (y == 0) & alarm
    runs = int((false & ~np.r_[False, false[:-1]]).sum()) if len(y) else 0
    new_alarm = alarm & np.r_[False, p[:-1] == 0] if len(y) else alarm
    change = np.diff(np.r_[False, y == 1, False].astype(np.int8))
    events, detected, latencies = 0, [], []
    for event_id, (a, b) in enumerate(zip(np.flatnonzero(change == 1), np.flatnonzero(change == -1)), 1):
        if a == 0 or y[a - 1] != 0:
            continue  # left-censored: not an established onset
        events += 1
        hits = np.flatnonzero(new_alarm[a:b])
        if len(hits):
            detected.append(event_id)
            latencies.append(float(hits[0] * cadence_seconds))
    fp, tn = int(false.sum()), int(((y == 0) & (p == 0)).sum())
    return _derived({
        "true_events": events, "confirmed_events": len(detected),
        "confirmed_event_ids": detected, "confirmed_latency_seconds": latencies,
        "tp": int(((y == 1) & alarm).sum()), "fp": fp,
        "fn": int(((y == 1) & (p == 0)).sum()), "tn": tn, "false_positive_runs": runs,
        "normal_observed_seconds": float((fp + tn) * cadence_seconds),
        "fp_duration_seconds": float(fp * cadence_seconds), "rows": len(y)})


def total(stats_list):
    """Sum independent pools (e.g. one per source), then recompute ratios."""
    return _derived({key: sum(s[key] for s in stats_list) for key in SUM_KEYS})
