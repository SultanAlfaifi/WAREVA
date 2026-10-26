import io
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

from dashboard.server import App, make_handler
from gateway.gateway import Outbox, deliver, read_lines, to_message

# The exact shape main.cpp prints, including a missing chlorine reading.
ESP32_LINE = ('{"device":"wareva-proto-1","boot":"1a2b3c4d","seq":%d,"readings":{"turbidity":0.712,"ph":7.200,'
              '"chlorine":null,"orp":681.000,"p1":2.800,"p2":2.550,"treated_level_percent":40.000,"flow_lpm":0.000},'
              '"decision":{"state":"HOLD","valve_command":"closed","valve_feedback":"closed","reasons":'
              '[{"code":"SENSOR_MISSING","sensor":"chlorine"}],"latched":[]},"irrigated_l":12.500}')


class Parsing(unittest.TestCase):
    def test_esp32_line_becomes_a_message(self):
        message = to_message(ESP32_LINE % 7, "2026-10-26T06:00:00Z")
        self.assertEqual(message["measurement_id"], "wareva-proto-1:1a2b3c4d:7")
        self.assertIsNone(message["readings"]["chlorine"])
        self.assertEqual(message["decision"]["reasons"][0]["sensor"], "chlorine")

    def test_garbage_is_ignored(self):
        for line in ("", "boot ok", "{}", '{"device":1,"boot":"a","seq":1,"readings":{},"decision":{}}'):
            self.assertIsNone(to_message(line, "t"))

    def test_lines_split_across_reads(self):
        stream = io.BytesIO(b'first\nsec' + b'ond\nlast')
        self.assertEqual(list(read_lines(stream)), ["first", "second", "last"])


class Delivery(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.outbox = Outbox(str(Path(self.tmp.name) / "gateway.db"))
        self.app = App(str(Path(self.tmp.name) / "dashboard.db"))
        self.app.control({"source": "device"})
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.app))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.outbox.close()
        self.app.store._db.close()
        self.tmp.cleanup()

    def queue(self, *seqs):
        for seq in seqs:
            self.outbox.put(to_message(ESP32_LINE % seq, "2026-10-26T06:00:00Z"))

    def test_reports_are_delivered_once(self):
        self.queue(1, 2, 3)
        self.queue(2)  # the same report read twice is queued once
        self.assertEqual(deliver(self.outbox, self.url), 3)
        self.assertEqual(self.outbox.pending(), [])
        self.assertEqual(self.app.store.summary()["readings"], {"device": 3})

    def test_lost_receipt_does_not_duplicate(self):
        self.queue(1)
        deliver(self.outbox, self.url)
        with self.outbox._db:  # pretend the receipt never arrived
            self.outbox._db.execute("UPDATE outbox SET delivered_at = NULL")
        self.assertEqual(deliver(self.outbox, self.url), 1)
        self.assertEqual(self.app.store.summary()["readings"], {"device": 1})

    def test_dashboard_down_keeps_reports_queued(self):
        self.queue(1, 2)
        self.assertEqual(deliver(self.outbox, "http://127.0.0.1:9", timeout=0.5), 0)
        self.assertEqual(len(self.outbox.pending()), 2)

    def test_rejected_report_stays_queued_but_others_go(self):
        self.queue(1)
        bad = to_message(ESP32_LINE % 2, "t")
        bad["decision"]["state"] = "OPEN_EVERYTHING"
        self.outbox.put(bad)
        self.queue(3)
        self.assertEqual(deliver(self.outbox, self.url), 2)
        self.assertEqual([m for m, _ in self.outbox.pending()], ["wareva-proto-1:1a2b3c4d:2"])
        self.assertEqual(json.loads(self.outbox.pending()[0][1])["decision"]["state"], "OPEN_EVERYTHING")


if __name__ == "__main__":
    unittest.main()
