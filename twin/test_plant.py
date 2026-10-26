import json
import unittest
from pathlib import Path

from twin.plant import CAPACITY_L, Plant, trace


class Twin(unittest.TestCase):
    def test_trace_is_current(self):
        """twin/trace.json is the contract with plant.js; regenerate it with `python -m twin.plant --write-trace`."""
        saved = json.loads(Path(__file__).with_name("trace.json").read_text(encoding="utf-8"))
        self.assertEqual(trace(), saved)

    def test_contamination_holds_water_and_stops_irrigation(self):
        plant = Plant()
        plant.step(30)
        irrigated = plant.volumes["irrigated"]
        plant.set_fault("turbidity")
        s = plant.step(30)
        self.assertEqual(s["decision"]["state"], "HOLD")
        self.assertEqual(s["volumes_l"]["irrigated"], irrigated)
        self.assertGreater(s["tanks"]["treated"]["liters"], 2000)

    def test_stuck_valve_is_caught_within_ten_seconds(self):
        plant = Plant()
        plant.set_fault("valve_stuck")
        states = [plant.step(1)["decision"]["state"] for _ in range(10)]
        self.assertIn("HOLD", states)
        self.assertLessEqual(states.index("HOLD") + 1, 10)

    def test_long_run_keeps_the_water_balance(self):
        plant = Plant()
        for i in range(24 * 60):
            if i == 300:
                plant.set_fault("turbidity")
            s = plant.step(60)
        self.assertLessEqual(s["tanks"]["treated"]["liters"], CAPACITY_L)
        self.assertGreater(s["volumes_l"]["overflow"], 0)

    def test_invalid_controls(self):
        plant = Plant()
        with self.assertRaises(ValueError):
            plant.set_fault("flood")
        with self.assertRaises(ValueError):
            plant.step(0)


if __name__ == "__main__":
    unittest.main()
