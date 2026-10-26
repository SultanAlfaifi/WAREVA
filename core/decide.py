"""WAREVA safety controller: decides, every tick, whether the irrigation valve may open.

Rules and limits live in rules.json. This module, core/decide.js and the ESP32
firmware implement the same algorithm and must pass core/vectors.json.

The controller keeps three pieces of state: the last valve command, the seconds
since that command changed, and latched faults that only an operator reset clears.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

RULES = json.loads((Path(__file__).with_name("rules.json")).read_text(encoding="utf-8"))
LIMITS = RULES["limits"]
MODES = ("auto", "standby", "backwash")


def _present(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


class SafetyController:
    def __init__(self, rules: dict = RULES):
        self.limits = rules["limits"]
        self.required = rules["required_sensors"]
        self.command = "closed"
        self.since_s = 0.0
        self.latched: list[str] = []

    def step(self, inputs: dict) -> dict:
        """Advance by inputs["dt_s"] seconds and return the decision for this tick."""
        lim = self.limits
        mode = inputs.get("mode", "auto")
        if mode not in MODES:
            raise ValueError(f"unknown mode: {mode}")
        readings = inputs.get("readings", {})
        if inputs.get("reset"):
            self.latched = []
        self.since_s += float(inputs.get("dt_s", 0))

        # Valve supervision uses the command that was in force during the elapsed time.
        # Without power the normally-closed valve shuts by itself, so there is nothing to supervise.
        power = inputs.get("power", True)
        feedback = inputs.get("valve_feedback")
        flow = readings.get("flow_lpm")
        if power and self.since_s >= lim["valve_settle_s"]:
            position_wrong = feedback is not None and feedback != self.command
            flowing_while_closed = self.command == "closed" and _present(flow) and flow > lim["closed_flow_max_lpm"]
            if (position_wrong or flowing_while_closed) and "VALVE_MISMATCH" not in self.latched:
                self.latched.append("VALVE_MISMATCH")

        reasons: list[dict] = []
        add = lambda code, **detail: reasons.append({"code": code, **detail})

        if not power:
            add("POWER_LOSS")
        if inputs.get("manual_hold", False):
            add("MANUAL_HOLD")
        for code in self.latched:
            add(code)

        # Power loss and manual hold stop everything; a latched fault still lets the
        # readings be checked so the operator sees every active reason.
        if not power or inputs.get("manual_hold", False):
            state = "HOLD"
        elif mode == "standby":
            add("STANDBY_MODE")
            state = "HOLD" if self.latched else "STANDBY"
        else:
            level = readings.get("treated_level_percent")
            if _present(level) and level < lim["treated_level_min_percent"]:
                add("TREATED_TANK_LOW", value=level, limit=lim["treated_level_min_percent"])
            if mode == "backwash":
                if not reasons:
                    add("BACKWASH_MODE")
                    state = "BACKWASH"
                else:
                    state = "HOLD"
            else:
                self._check_readings(readings, feedback, add)
                state = "HOLD" if reasons else "REUSE"

        new_command = "open" if state == "REUSE" else "closed"
        if new_command != self.command:
            self.command = new_command
            self.since_s = 0.0
        return {
            "state": state,
            "valve_command": self.command,
            "irrigation_pump": "on" if state == "REUSE" else "off",
            "reasons": reasons,
            "latched": list(self.latched),
        }

    def _check_readings(self, r: dict, feedback, add) -> None:
        lim = self.limits
        for sensor in self.required:
            if not _present(r.get(sensor)):
                add("SENSOR_MISSING", sensor=sensor)
        if feedback not in ("open", "closed"):
            add("SENSOR_MISSING", sensor="valve_position")
        ok = lambda key: _present(r.get(key))
        if ok("turbidity") and r["turbidity"] > lim["turbidity_max_ntu"]:
            add("TURBIDITY_HIGH", value=r["turbidity"], limit=lim["turbidity_max_ntu"])
        if ok("ph") and not lim["ph_min"] <= r["ph"] <= lim["ph_max"]:
            add("PH_OUT_OF_RANGE", value=r["ph"], limit=f'{lim["ph_min"]}–{lim["ph_max"]}')
        if ok("chlorine") and not lim["chlorine_min_mg_l"] <= r["chlorine"] <= lim["chlorine_max_mg_l"]:
            add("CHLORINE_OUT_OF_RANGE", value=r["chlorine"], limit=f'{lim["chlorine_min_mg_l"]}–{lim["chlorine_max_mg_l"]}')
        if ok("p1") and ok("p2") and r["p1"] - r["p2"] > lim["filter_dp_max_bar"]:
            add("FILTER_DP_HIGH", value=round(r["p1"] - r["p2"], 3), limit=lim["filter_dp_max_bar"])
        line = max((r[k] for k in ("p1", "p2") if ok(k)), default=None)
        if line is not None and line > lim["line_pressure_max_bar"]:
            add("LINE_PRESSURE_HIGH", value=line, limit=lim["line_pressure_max_bar"])


def describe(reason: dict, lang: str = "ar") -> str:
    """Render a reason as the sentence from rules.json, with its values filled in."""
    template = RULES["reasons"][reason["code"]][lang]
    sensor = reason.get("sensor")
    label = RULES["sensors"][sensor][lang] if sensor else ""
    fmt = lambda v: f"{round(v, 2):g}" if isinstance(v, (int, float)) else str(v)
    return (template.replace("{sensor}", label)
            .replace("{value}", fmt(reason.get("value", "")))
            .replace("{limit}", fmt(reason.get("limit", ""))))
