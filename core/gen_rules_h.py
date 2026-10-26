"""Generate the firmware's view of the rules from core/rules.json and core/vectors.json.

    python -m core.gen_rules_h            # writes the files
    python -m core.gen_rules_h --check    # fails if they are out of date (used in CI)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RULES = json.loads((ROOT / "core/rules.json").read_text(encoding="utf-8"))
VECTORS = json.loads((ROOT / "core/vectors.json").read_text(encoding="utf-8"))
RULES_H = ROOT / "firmware/esp32/include/rules.h"
VECTORS_H = ROOT / "firmware/esp32/test/vectors.h"
SENSOR_ENUM = {"turbidity": "Turbidity", "ph": "Ph", "chlorine": "Chlorine", "p1": "P1", "p2": "P2",
               "treated_level_percent": "TreatedLevel", "flow_lpm": "Flow"}
HEADER = "// Generated from core/rules.json by core/gen_rules_h.py. Do not edit.\n"


def num(v) -> str:
    return "NAN" if v is None else repr(float(v))


def rules_h() -> str:
    lim = RULES["limits"]
    lines = [HEADER, "#pragma once\n", "namespace wareva {", "namespace rules {"]
    lines += [f"constexpr double {k.upper()} = {num(v)};" for k, v in lim.items()]
    lines += ["}  // namespace rules", "}  // namespace wareva", "",
              "// Required sensors in rules.json order; SENSOR_MISSING reasons follow this order.",
              "#define WAREVA_REQUIRED_SENSORS(X) " + " ".join(f"X({SENSOR_ENUM[s]})" for s in RULES["required_sensors"]), ""]
    return "\n".join(lines)


def vectors_h() -> str:
    d = VECTORS["defaults"]
    keys = ("turbidity", "ph", "chlorine", "orp", "p1", "p2", "treated_level_percent", "flow_lpm")
    valve = {"open": "Valve::Open", "closed": "Valve::Closed", None: "Valve::Unknown"}
    mode = {"auto": "Mode::Auto", "standby": "Mode::Standby", "backwash": "Mode::Backwash"}
    out = [HEADER, "#pragma once", '#include "safety.h"', "", "namespace wareva {", "",
           "struct VectorStep { Inputs in; const char* state; const char* command; const char* codes[8]; int ncodes; int latched; };",
           "struct VectorCase { const char* name; VectorStep steps[6]; int nsteps; };", "",
           "// latched: -1 = not checked, 0 = nothing latched, 1 = VALVE_MISMATCH latched",
           "static const VectorCase VECTOR_CASES[] = {"]
    for case in VECTORS["cases"]:
        steps = []
        for step in case["steps"]:
            i = {**d, **step["in"], "readings": {**d["readings"], **step["in"].get("readings", {})}}
            r = ", ".join(num(i["readings"].get(k)) for k in keys)
            inputs = (f'Inputs{{{num(i["dt_s"])}, {str(i["power"]).lower()}, {str(i["manual_hold"]).lower()}, '
                      f'{mode[i["mode"]]}, {str(i["reset"]).lower()}, Readings{{{r}}}, {valve[i["valve_feedback"]]}}}')
            e = step["expect"]
            codes = ", ".join(f'"{c}"' for c in e["codes"]) or "nullptr"
            latched = -1 if "latched" not in e else int(bool(e["latched"]))
            steps.append(f'{{{inputs}, "{e["state"]}", "{e["valve_command"]}", {{{codes}}}, {len(e["codes"])}, {latched}}}')
        out.append(f'  {{"{case["name"]}", {{' + ", ".join(steps) + f"}}, {len(steps)}}},")
    out += ["};", "", "}  // namespace wareva", ""]
    return "\n".join(out)


def main():
    targets = {RULES_H: rules_h(), VECTORS_H: vectors_h()}
    if sys.argv[1:] == ["--check"]:
        stale = [str(p.relative_to(ROOT)) for p, text in targets.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            sys.exit(f"out of date, run python -m core.gen_rules_h: {', '.join(stale)}")
        print("firmware rules are current")
        return
    for path, text in targets.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
        print("wrote", path.relative_to(ROOT))


if __name__ == "__main__":
    main()
