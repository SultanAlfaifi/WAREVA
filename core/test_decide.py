import json
import unittest
from pathlib import Path

from core.decide import RULES, SafetyController, describe

VECTORS = json.loads((Path(__file__).with_name("vectors.json")).read_text(encoding="utf-8"))


def merge(defaults: dict, override: dict) -> dict:
    merged = {**defaults, **override}
    merged["readings"] = {**defaults["readings"], **override.get("readings", {})}
    return merged


def codes(decision: dict) -> list[str]:
    return [r["code"] + (f':{r["sensor"]}' if "sensor" in r else "") for r in decision["reasons"]]


class SharedVectors(unittest.TestCase):
    def test_every_case(self):
        for case in VECTORS["cases"]:
            controller = SafetyController()
            for i, step in enumerate(case["steps"]):
                with self.subTest(case=case["name"], step=i + 1):
                    out = controller.step(merge(VECTORS["defaults"], step["in"]))
                    want = step["expect"]
                    self.assertEqual(out["state"], want["state"])
                    self.assertEqual(out["valve_command"], want["valve_command"])
                    self.assertEqual(codes(out), want["codes"])
                    if "latched" in want:
                        self.assertEqual(out["latched"], want["latched"])
                    self.assertEqual(out["irrigation_pump"], "on" if want["state"] == "REUSE" else "off")


class Rules(unittest.TestCase):
    def test_every_reason_has_both_languages(self):
        for code, reason in RULES["reasons"].items():
            self.assertTrue(reason["ar"] and reason["en"], code)
            self.assertIn(reason["severity"], ("info", "warning", "critical"), code)

    def test_vectors_cover_every_reason_code(self):
        seen = {c.split(":")[0] for case in VECTORS["cases"] for s in case["steps"] for c in s["expect"]["codes"]}
        self.assertEqual(seen, set(RULES["reasons"]))

    def test_describe_fills_values(self):
        text = describe({"code": "TURBIDITY_HIGH", "value": 8.14, "limit": 2.0})
        self.assertEqual(text, "العكارة 8.14 NTU تتجاوز الحد 2 NTU؛ الري متوقف والماء محتجز.")
        self.assertIn("الكلور المتبقي", describe({"code": "SENSOR_MISSING", "sensor": "chlorine"}))

    def test_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            SafetyController().step({"mode": "turbo"})


if __name__ == "__main__":
    unittest.main()
