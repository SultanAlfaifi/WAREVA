"""Virtual WAREVA unit for demos and tests: raw tank -> treatment -> treated tank -> safety controller -> irrigation.

Volumes and flows are a simple, deterministic inventory model. Sensor values are
illustrative signals, not a water-chemistry model. The safety decision comes from
core.decide, the same controller the dashboard and firmware use.
twin/plant.js is the browser copy and must reproduce twin/trace.json.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from core.decide import RULES, SafetyController, describe

CAPACITY_L = 5000.0
INLET_LPM = 1000 / 60          # ablution water arriving, 1 m3/h
FEED_LPM = 1000 / 60           # treatment feed, 1 m3/h = 15 m3/day over 15 h
IRRIGATION_LPM = 1000 / 60
BACKWASH_LPM = 65.0
VALVE_TRAVEL_S = 2.0
FAULTS = ("none", "turbidity", "sensor_dropout", "clogging", "power_loss", "valve_stuck")
MODES = ("auto", "standby", "backwash")
MAX_STEP_S = 60.0


class Plant:
    def __init__(self, start: str = "2026-10-26T06:00:00Z"):
        self.start = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(timezone.utc)
        self.elapsed_s = 0.0
        self.raw_l, self.treated_l = 3000.0, 2000.0
        self.initial_l = self.raw_l + self.treated_l
        self.valve_opening = 0.0
        self.mode, self.fault, self.manual_hold = "auto", "none", False
        self._reset_requested = False
        self.controller = SafetyController()
        self.flows = dict.fromkeys(("inlet", "feed", "irrigation", "backwash", "overflow"), 0.0)
        self.volumes = dict.fromkeys(("inlet", "treated", "irrigated", "overflow", "backwash"), 0.0)
        # Start from steady operation: the first decision is taken and the valve has already moved to it.
        self.decision = self.controller.step(self._inputs(0.0))
        self.valve_opening = 1.0 if self.decision["valve_command"] == "open" else 0.0
        self.readings = self._sensors()

    # Controls -----------------------------------------------------------
    def set_fault(self, fault: str):
        if fault not in FAULTS:
            raise ValueError(f"unknown fault: {fault}")
        self.fault = fault

    def set_mode(self, mode: str):
        if mode not in MODES:
            raise ValueError(f"unknown mode: {mode}")
        self.mode = mode

    def set_manual_hold(self, hold: bool):
        self.manual_hold = bool(hold)

    def reset(self):
        """Operator confirms a latched fault was inspected; applied on the next step."""
        self._reset_requested = True

    # Simulation -----------------------------------------------------------
    @property
    def power(self) -> bool:
        return self.fault != "power_loss"

    def _sensors(self) -> dict:
        if not self.power:
            return dict.fromkeys(("turbidity", "ph", "chlorine", "orp", "p1", "p2", "treated_level_percent", "flow_lpm"))
        t = self.elapsed_s
        wave = math.sin(t / 600)
        feeding = self.flows["feed"] > 0
        r = {
            "turbidity": 0.65 + 0.08 * wave,
            "ph": 7.2 + 0.05 * math.sin(t / 900),
            "chlorine": 0.35 + 0.02 * math.sin(t / 720),
            "orp": 680 + 8 * math.sin(t / 800),
            "p1": 2.8 + 0.03 * wave if feeding else 0.0,
            "p2": 2.55 + 0.03 * wave if feeding else 0.0,
            "treated_level_percent": self.treated_l / CAPACITY_L * 100,
            "flow_lpm": self.flows["irrigation"],
        }
        if self.fault == "turbidity":
            r["turbidity"] = 8.0 + 0.2 * wave
        if self.fault == "sensor_dropout":
            r["chlorine"] = None
        if self.fault == "clogging" and feeding:
            r["p1"], r["p2"] = 2.9, 1.5
        return r

    def _feedback(self):
        return "open" if self.valve_opening > 0.5 else "closed"

    def _inputs(self, dt_s: float) -> dict:
        inputs = {"dt_s": dt_s, "power": self.power, "manual_hold": self.manual_hold, "mode": self.mode,
                  "reset": self._reset_requested, "readings": self._sensors(), "valve_feedback": self._feedback()}
        self._reset_requested = False
        return inputs

    def step(self, dt_s: float) -> dict:
        if not 0 < dt_s <= MAX_STEP_S:
            raise ValueError(f"step must be in (0, {MAX_STEP_S}] seconds")
        inputs = self._inputs(dt_s)
        self.readings = inputs["readings"]
        d = self.decision = self.controller.step(inputs)

        # The valve travels toward the command. Without power the spring closes it; the
        # valve_stuck fault jams it shut whatever the command says.
        target = 1.0 if (d["valve_command"] == "open" and self.power) else 0.0
        if not self.power or self.fault == "valve_stuck":
            self.valve_opening = 0.0
        else:
            move = dt_s / VALVE_TRAVEL_S
            self.valve_opening = min(target, self.valve_opening + move) if target > self.valve_opening else max(target, self.valve_opening - move)

        minutes = dt_s / 60
        inlet = INLET_LPM * minutes
        feeding = self.power and not self.manual_hold and self.mode == "auto"
        feed = min(FEED_LPM * minutes, self.raw_l + inlet, CAPACITY_L - self.treated_l) if feeding else 0.0
        washing = d["state"] == "BACKWASH"
        backwash = min(BACKWASH_LPM * minutes, self.treated_l + feed) if washing else 0.0
        irrigating = d["irrigation_pump"] == "on" and self.valve_opening > 0.5
        irrigated = min(IRRIGATION_LPM * minutes, self.treated_l + feed - backwash) if irrigating else 0.0
        raw = self.raw_l + inlet - feed
        overflow = max(0.0, raw - CAPACITY_L)
        self.raw_l = raw - overflow
        self.treated_l = self.treated_l + feed - backwash - irrigated

        moved = {"inlet": inlet, "treated": feed, "irrigated": irrigated, "overflow": overflow, "backwash": backwash}
        for key, liters in moved.items():
            self.volumes[key] += liters
        self.flows = {"inlet": inlet / minutes, "feed": feed / minutes, "irrigation": irrigated / minutes,
                      "backwash": backwash / minutes, "overflow": overflow / minutes}
        self.elapsed_s += dt_s
        self._check_balance()
        return self.snapshot()

    def _check_balance(self):
        v = self.volumes
        error = self.initial_l + v["inlet"] - self.raw_l - self.treated_l - v["irrigated"] - v["overflow"] - v["backwash"]
        if abs(error) > 1e-6 or self.raw_l < -1e-9 or self.treated_l < -1e-9 or self.treated_l > CAPACITY_L + 1e-9:
            raise ArithmeticError(f"water balance broken by {error} L")

    def snapshot(self) -> dict:
        d = self.decision
        return {
            "source": "twin",
            "time": (self.start + timedelta(seconds=self.elapsed_s)).isoformat().replace("+00:00", "Z"),
            "elapsed_s": self.elapsed_s,
            "mode": self.mode, "fault": self.fault, "manual_hold": self.manual_hold, "power": self.power,
            "readings": dict(self.readings),
            "decision": {**d, "reasons": [{**r, "text": describe(r)} for r in d["reasons"]]},
            "valve": {"command": d["valve_command"], "feedback": self._feedback(), "opening": self.valve_opening},
            "tanks": {name: {"liters": liters, "percent": liters / CAPACITY_L * 100}
                      for name, liters in (("raw", self.raw_l), ("treated", self.treated_l))},
            "flows_lpm": dict(self.flows),
            "volumes_l": dict(self.volumes),
        }


# The fixed scenario both the Python and the browser twin must reproduce: (seconds, action before the step).
SCENARIO = [
    (30, None), (30, None), (30, None), (30, None),
    (10, ("fault", "turbidity")), (10, None), (10, None), (10, None),
    (10, ("fault", "none")), (10, None), (10, None),
    (5, ("fault", "valve_stuck")), (5, None), (5, None),
    (5, ("fault", "none")), (5, ("reset", None)), (5, None), (5, None),
    (20, ("fault", "power_loss")), (20, ("fault", "none")),
    (60, ("mode", "backwash")), (60, ("mode", "auto")),
    (30, ("fault", "clogging")), (30, ("fault", "sensor_dropout")),
    (30, ("hold", True)), (30, ("hold", False)), (30, ("fault", "none")),
]


def trace() -> list[dict]:
    plant, out = Plant(), []
    for dt, action in SCENARIO:
        if action:
            kind, value = action
            if kind == "fault":
                plant.set_fault(value)
            elif kind == "mode":
                plant.set_mode(value)
            elif kind == "hold":
                plant.set_manual_hold(value)
            else:
                plant.reset()
        s = plant.step(dt)
        out.append({"state": s["decision"]["state"], "codes": [r["code"] for r in s["decision"]["reasons"]],
                    "valve": s["valve"]["feedback"], "raw_l": round(s["tanks"]["raw"]["liters"], 6),
                    "treated_l": round(s["tanks"]["treated"]["liters"], 6), "irrigated_l": round(s["volumes_l"]["irrigated"], 6)})
    return out


if __name__ == "__main__":
    import json, sys
    if sys.argv[1:] == ["--write-trace"]:
        from pathlib import Path
        Path(__file__).with_name("trace.json").write_text(json.dumps(trace(), indent=1), encoding="utf-8")
        print("wrote twin/trace.json")
