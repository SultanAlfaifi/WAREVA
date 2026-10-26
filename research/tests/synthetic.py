"""Small synthetic sensor streams for tests (no real data needed)."""
import numpy as np
import pandas as pd

CHANNELS = ["a", "b", "c", "d"]


def stream(n=3000, seed=0, event_every=400, missing=0.01):
    """Four noisy channels; every `event_every` rows a 15-35 row event shifts two channels."""
    rng = np.random.default_rng(seed)
    t = np.arange(n)
    values = rng.normal(0, .05, (n, 4)) + np.sin(t / 300)[:, None] * .1 + np.arange(4)
    labels = np.zeros(n, np.int8)
    for start in range(event_every // 2, n - 40, event_every):
        end = start + int(rng.integers(15, 35))
        labels[start:end] = 1
        values[start:end, :2] += 1.0
    values[rng.random((n, 4)) < missing] = np.nan
    frame = pd.DataFrame(values, columns=CHANNELS)
    frame["EVENT"] = labels
    return frame
