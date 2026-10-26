"""Train the V8 scorer on each GECCO development period and report event metrics.

    py -3 download_data.py
    py -3 run.py                               # all 13 GECCO periods (slow: ~100k-row fits)
    py -3 run.py --period 2019_disclosed_test  # one period
    py -3 run.py --source 2019 --json out.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time

from wareva_research.pipeline import FILES, gecco_periods, run_period, summarize

HERE = Path(__file__).resolve().parent
ROW = "{:<22} {:>8} {:>10} {:>12} {:>14}"


def _line(name, s):
    return ROW.format(name, f"{s['confirmed_events']}/{s['true_events']}", s["false_positive_runs"],
                      f"{s['fp_duration_seconds'] / 60:g}", f"{100 * (s['f1_observed_points'] or 0):.2f}%")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=HERE / "data")
    parser.add_argument("--source", action="append", choices=sorted(FILES),
                        help="limit to one or more GECCO years (default: all)")
    parser.add_argument("--period", action="append", help="limit to named periods, e.g. 2017_fold_1")
    parser.add_argument("--json", type=Path, help="write per-period and pooled metrics here")
    args = parser.parse_args()
    sources = tuple(args.source or FILES)
    missing = [p for s in sources for p in ([FILES[s]] if isinstance(FILES[s], str) else FILES[s])
               if not (args.data_dir / p).exists()]
    if missing:
        sys.exit("Missing data files; run download_data.py first:\n  " + "\n  ".join(missing))

    print(ROW.format("period", "events", "fragments", "FA minutes", "point F1"))
    results = []
    for period in gecco_periods(args.data_dir, sources):
        if args.period and period.name not in args.period:
            continue
        started = time.perf_counter()
        result = run_period(period)
        results.append(result)
        sel = result["selected"]
        print(_line(period.name, result["stats"]),
              f"  [{result['fit_status']}, threshold={sel['threshold']}, {sel['policy']},"
              f" {time.perf_counter() - started:.0f}s]", flush=True)
    if not results:
        sys.exit("No period matched the filters.")
    pools, overall = summarize(results)
    print()
    for name, stats in pools.items():
        print(_line(f"pool {name}", stats))
    print(_line("TOTAL", overall))
    if args.json:
        args.json.write_text(json.dumps({
            "periods": [{k: v for k, v in r.items() if k not in ("labels", "predictions")} for r in results],
            "pools": pools, "total": overall}, indent=2))


if __name__ == "__main__":
    main()
