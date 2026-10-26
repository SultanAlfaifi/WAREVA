"""WAREVA dashboard: runs the digital twin or receives device readings, logs every decision, serves the UI.

Standard library only, so it runs unchanged on the Raspberry Pi:
    python -m dashboard.server            # from the repository root
The dashboard records decisions; it never opens a valve. With a real unit the
ESP32 decides and the gateway posts its readings and decision to /api/ingest.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from core.decide import RULES, describe
from dashboard.store import Store, now
from twin.plant import FAULTS, MODES, Plant

ROOT = Path(__file__).resolve().parents[1]
STATIC = {"/static/": ROOT / "dashboard/static", "/brand/": ROOT / "brand"}
SPEEDS = (1, 10, 60)
STALE_AFTER_S = 10
SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}
ALL_CLEAR = "كل القراءات ضمن الحدود؛ الري مسموح."


class App:
    def __init__(self, db_path: str):
        self.store = Store(db_path)
        self.lock = threading.Lock()
        self.plant = Plant(start=now())
        self.source, self.speed, self.running = "twin", 1, True
        self.snapshot = self.plant.snapshot()
        self.device_seen = 0.0
        self.signature = None

    # Recording ----------------------------------------------------------
    def record(self, snap: dict, device_id=None, measurement_id=None) -> tuple[int, bool]:
        d = snap["decision"]
        reading_id, created = self.store.add_reading(
            time=snap["time"], source=snap["source"], state=d["state"], valve_command=d["valve_command"],
            valve_feedback=snap["valve"]["feedback"], irrigated_l=snap["volumes_l"]["irrigated"],
            readings=snap["readings"], reasons=d["reasons"], device_id=device_id, measurement_id=measurement_id)
        codes = [r["code"] for r in d["reasons"]]
        signature = (snap["source"], d["state"], tuple(codes))
        if created and signature != self.signature:
            if self.signature is not None or codes:
                severity = max((RULES["reasons"][c]["severity"] for c in codes), key=SEVERITY_RANK.get, default="info")
                message = " ".join(r["text"] for r in d["reasons"]) or ALL_CLEAR
                self.store.add_event(time=snap["time"], source=snap["source"], severity=severity,
                                     state=d["state"], codes=codes, message=message)
            self.signature = signature
        return reading_id, created

    def tick(self):
        with self.lock:
            if self.source == "twin" and self.running:
                self.snapshot = self.plant.step(self.speed)
                self.record(self.snapshot)

    # Commands -------------------------------------------------------------
    def control(self, body: dict):
        allowed = {"fault", "mode", "manual_hold", "speed", "running", "reset", "source"}
        if not isinstance(body, dict) or not body or set(body) - allowed:
            raise ValueError(f"control accepts only {sorted(allowed)}")
        with self.lock:
            if "source" in body:
                if body["source"] not in ("twin", "device"):
                    raise ValueError("source must be twin or device")
                self.source = body["source"]
            if "fault" in body:
                if body["fault"] not in FAULTS:
                    raise ValueError("unknown fault")
                self.plant.set_fault(body["fault"])
            if "mode" in body:
                if body["mode"] not in MODES:
                    raise ValueError("unknown mode")
                self.plant.set_mode(body["mode"])
            if "manual_hold" in body:
                self.plant.set_manual_hold(body["manual_hold"] is True)
            if "speed" in body:
                if body["speed"] not in SPEEDS:
                    raise ValueError(f"speed must be one of {SPEEDS}")
                self.speed = body["speed"]
            if "running" in body:
                self.running = body["running"] is True
            if body.get("reset") is True:
                self.plant.reset()

    def ingest(self, body: dict) -> dict:
        """Accept one message from the gateway: device readings plus the ESP32's own decision."""
        need = {"measurement_id": str, "device_id": str, "time": str, "readings": dict, "decision": dict}
        for key, kind in need.items():
            if not isinstance(body.get(key), kind):
                raise ValueError(f"{key} is required")
        d = body["decision"]
        if d.get("state") not in RULES["states"] or d.get("valve_command") not in ("open", "closed"):
            raise ValueError("decision.state or decision.valve_command is invalid")
        reasons = d.get("reasons", [])
        if not isinstance(reasons, list) or any(not isinstance(r, dict) or r.get("code") not in RULES["reasons"] for r in reasons):
            raise ValueError("decision.reasons must list known reason codes")
        readings = {k: v for k, v in body["readings"].items() if k in RULES["sensors"]}
        if any(v is not None and not isinstance(v, (int, float)) for v in readings.values()):
            raise ValueError("readings must be numbers or null")
        snap = {
            "source": "device", "time": body["time"], "readings": readings,
            "decision": {"state": d["state"], "valve_command": d["valve_command"],
                         "irrigation_pump": "on" if d["state"] == "REUSE" else "off",
                         "reasons": [{**r, "text": describe(r)} for r in reasons], "latched": d.get("latched", [])},
            "valve": {"command": d["valve_command"], "feedback": d.get("valve_feedback")},
            "volumes_l": {"irrigated": float(body.get("irrigated_l") or 0)},
        }
        with self.lock:
            reading_id, created = self.record(snap, body["device_id"], body["measurement_id"])
            if created:
                self.device_snapshot, self.device_seen = snap, time.time()
        return {"measurement_id": body["measurement_id"], "reading_id": reading_id, "duplicate": not created}

    def state(self) -> dict:
        with self.lock:
            if self.source == "device":
                snap = getattr(self, "device_snapshot", None)
                stale = snap is None or time.time() - self.device_seen > STALE_AFTER_S
                return {"source": "device", "stale": stale, "snapshot": snap}
            return {"source": "twin", "speed": self.speed, "running": self.running, "stale": False, "snapshot": self.snapshot}


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "WAREVA"

        def log_message(self, fmt, *args):  # keep the console quiet; the log lives in SQLite
            pass

        def send(self, status: int, body, kind="application/json; charset=utf-8", headers=None):
            data = body if isinstance(body, bytes) else (
                body.encode() if isinstance(body, str) else json.dumps(body, ensure_ascii=False).encode())
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def body(self) -> dict:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 64_000:
                raise ValueError("body too large")
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            path = self.path.split("?")[0]
            if path == "/":
                return self.static(ROOT / "dashboard/static/index.html")
            for prefix, folder in STATIC.items():
                if path.startswith(prefix):
                    return self.static(folder / path[len(prefix):], folder)
            if path == "/api/state":
                return self.send(200, app.state())
            if path == "/api/rules":
                return self.send(200, RULES)
            if path == "/api/events":
                return self.send(200, app.store.events())
            if path == "/api/summary":
                return self.send(200, app.store.summary())
            m = re.fullmatch(r"/api/export/(readings|events)\.csv", path)
            if m:
                name = f"wareva-{m[1]}.csv"
                return self.send(200, "﻿" + app.store.csv(m[1]), "text/csv; charset=utf-8",
                                 {"Content-Disposition": f'attachment; filename="{name}"'})
            self.send(404, {"error": "not found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            try:
                if path == "/api/control":
                    app.control(self.body())
                    return self.send(200, app.state())
                if path == "/api/ingest":
                    return self.send(200, app.ingest(self.body()))
                m = re.fullmatch(r"/api/events/(\d+)/ack", path)
                if m:
                    return self.send(200, {"acknowledged": app.store.acknowledge(int(m[1]))})
            except (ValueError, json.JSONDecodeError) as exc:
                return self.send(400, {"error": str(exc)})
            self.send(404, {"error": "not found"})

        def static(self, file: Path, folder: Path | None = None):
            file = file.resolve()
            if folder and not file.is_relative_to(folder.resolve()) or not file.is_file():
                return self.send(404, {"error": "not found"})
            kind = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
            if kind.startswith("text/") or kind in ("application/javascript", "image/svg+xml"):
                kind += "; charset=utf-8"
            self.send(200, file.read_bytes(), kind)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="WAREVA dashboard")
    parser.add_argument("--host", default="127.0.0.1", help="use 0.0.0.0 only on a trusted local network; there is no login")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--db", default=str(ROOT / "dashboard/wareva.db"))
    args = parser.parse_args()
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("font/woff2", ".woff2")
    app = App(args.db)

    def ticker():
        while True:
            time.sleep(1)
            app.tick()

    threading.Thread(target=ticker, daemon=True).start()
    server = ThreadingHTTPServer((args.host, args.port), make_handler(app))
    print(f"WAREVA dashboard on http://{args.host}:{args.port}  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
