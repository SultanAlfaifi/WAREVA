import json
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

from dashboard.server import App, make_handler


def device_message(measurement_id="m-1", state="REUSE", reasons=()):
    return {"measurement_id": measurement_id, "device_id": "esp32-proto-1", "time": "2026-10-26T06:00:00Z",
            "readings": {"turbidity": 0.7, "ph": 7.2, "chlorine": 0.35, "p1": 2.8, "p2": 2.55,
                         "treated_level_percent": 40, "flow_lpm": 16.6},
            "decision": {"state": state, "valve_command": "open" if state == "REUSE" else "closed",
                         "valve_feedback": "open" if state == "REUSE" else "closed", "reasons": list(reasons)},
            "irrigated_l": 120.5}


class DashboardApp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = App(str(Path(self.tmp.name) / "test.db"))

    def tearDown(self):
        self.app.store._db.close()
        self.tmp.cleanup()

    def test_every_twin_tick_is_logged(self):
        for _ in range(5):
            self.app.tick()
        self.assertEqual(self.app.store.summary()["readings"], {"twin": 5})
        self.assertIn("REUSE", self.app.store.csv("readings"))

    def test_state_change_creates_one_event(self):
        self.app.tick()
        self.app.control({"fault": "turbidity"})
        for _ in range(3):
            self.app.tick()
        events = self.app.store.events()
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["severity"], events[0]["codes"]), ("warning", "TURBIDITY_HIGH"))
        self.assertTrue(self.app.store.acknowledge(events[0]["id"]))
        self.assertFalse(self.app.store.acknowledge(events[0]["id"]))

    def test_paused_twin_logs_nothing(self):
        self.app.control({"running": False})
        self.app.tick()
        self.assertEqual(self.app.store.summary()["readings"], {})

    def test_control_rejects_unknown_input(self):
        for bad in ({}, {"fault": "flood"}, {"speed": 7}, {"open_valve": True}, {"source": "cloud"}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.app.control(bad)

    def test_ingest_is_idempotent(self):
        self.app.control({"source": "device"})
        first = self.app.ingest(device_message())
        again = self.app.ingest(device_message())
        self.assertFalse(first["duplicate"])
        self.assertTrue(again["duplicate"])
        self.assertEqual(first["reading_id"], again["reading_id"])
        state = self.app.state()
        self.assertEqual((state["source"], state["stale"]), ("device", False))
        self.assertEqual(state["snapshot"]["decision"]["state"], "REUSE")

    def test_ingest_adds_reason_text(self):
        self.app.ingest(device_message("m-2", "HOLD", [{"code": "TURBIDITY_HIGH", "value": 4.2, "limit": 2.0}]))
        event = self.app.store.events()[0]
        self.assertIn("4.2 NTU", event["message"])

    def test_ingest_rejects_bad_messages(self):
        bad = [{**device_message(), "measurement_id": None},
               {**device_message(), "decision": {"state": "OPEN_ALL", "valve_command": "open"}},
               device_message(reasons=[{"code": "MADE_UP"}]),
               {**device_message(), "readings": {"turbidity": "high"}}]
        for message in bad:
            with self.subTest(message=message), self.assertRaises(ValueError):
                self.app.ingest(message)

    def test_device_without_messages_is_stale(self):
        self.app.control({"source": "device"})
        self.assertTrue(self.app.state()["stale"])


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.app = App(str(Path(cls.tmp.name) / "http.db"))
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(cls.app))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.app.store._db.close()
        cls.tmp.cleanup()

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.headers["Content-Type"], r.read()

    def post(self, path, body):
        req = urllib.request.Request(self.base + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_pages_and_assets(self):
        self.assertEqual(self.get("/")[0], 200)
        self.assertTrue(self.get("/brand/tokens.css")[1].startswith("text/css"))
        self.assertEqual(self.get("/api/rules")[0], 200)

    def test_path_traversal_is_refused(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/static/../server.py")
        self.assertEqual(ctx.exception.code, 404)

    def test_control_errors_are_400(self):
        status, body = self.post("/api/control", {"fault": "flood"})
        self.assertEqual(status, 400)
        self.assertIn("unknown fault", body["error"])


if __name__ == "__main__":
    unittest.main()
