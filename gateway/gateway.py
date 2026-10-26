"""Raspberry Pi gateway: reads the ESP32's JSON lines, queues each one in SQLite, delivers it to the dashboard.

The gateway only carries data. It never sends a command to the ESP32, so a Pi or
network failure cannot open the valve. Standard library only.

    python -m gateway.gateway --serial /dev/ttyUSB0            # on the Pi
    python -m gateway.gateway --input recorded.jsonl          # replay a recording
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def to_message(line: str, received_at: str) -> dict | None:
    """Turn one ESP32 line into a dashboard message, or None if the line is not a valid report."""
    try:
        data = json.loads(line)
        device, boot, seq = data["device"], data["boot"], data["seq"]
        readings, decision = data["readings"], data["decision"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    if not (isinstance(device, str) and isinstance(boot, str) and isinstance(seq, int)
            and isinstance(readings, dict) and isinstance(decision, dict)):
        return None
    # boot + seq is unique per report and stable across retries, so the dashboard can drop duplicates.
    return {"measurement_id": f"{device}:{boot}:{seq}", "device_id": device, "time": received_at,
            "readings": readings, "decision": decision, "irrigated_l": data.get("irrigated_l")}


class Outbox:
    """Every report is written here before any delivery attempt, so nothing is lost if the dashboard is down."""

    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.execute("CREATE TABLE IF NOT EXISTS outbox (measurement_id TEXT PRIMARY KEY, body TEXT NOT NULL,"
                             " queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, delivered_at TEXT, reading_id INTEGER)")

    def put(self, message: dict) -> bool:
        with self._lock, self._db:
            cur = self._db.execute("INSERT OR IGNORE INTO outbox (measurement_id, body, queued_at) VALUES (?, ?, ?)",
                                   (message["measurement_id"], json.dumps(message), utc_now()))
            return cur.rowcount == 1

    def pending(self, limit: int = 100) -> list[tuple[str, str]]:
        with self._lock:
            return self._db.execute("SELECT measurement_id, body FROM outbox WHERE delivered_at IS NULL"
                                    " ORDER BY rowid LIMIT ?", (limit,)).fetchall()

    def attempted(self, measurement_id: str):
        with self._lock, self._db:
            self._db.execute("UPDATE outbox SET attempts = attempts + 1 WHERE measurement_id = ?", (measurement_id,))

    def delivered(self, measurement_id: str, reading_id: int):
        with self._lock, self._db:
            self._db.execute("UPDATE outbox SET delivered_at = ?, reading_id = ? WHERE measurement_id = ?",
                             (utc_now(), reading_id, measurement_id))

    def close(self):
        self._db.close()


def deliver(outbox: Outbox, dashboard: str, timeout: float = 5.0) -> int:
    """Send pending reports in order. Stops at the first failure and returns how many were confirmed."""
    sent = 0
    for measurement_id, body in outbox.pending():
        outbox.attempted(measurement_id)
        request = urllib.request.Request(f"{dashboard}/api/ingest", body.encode(), {"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                receipt = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 400:  # the dashboard rejected this report; keep it queued and visible, move on
                print(f"rejected {measurement_id}: {exc.read().decode(errors='replace')}", file=sys.stderr)
                continue
            return sent
        except (urllib.error.URLError, TimeoutError, OSError):
            return sent
        if receipt.get("measurement_id") == measurement_id:
            outbox.delivered(measurement_id, receipt["reading_id"])
            sent += 1
    return sent


def open_serial(device: str, baud: int = 115200):
    """Open a serial port as a text stream using termios (Linux, so the Pi needs no extra package)."""
    import termios
    fd = open(device, "rb", buffering=0)
    attrs = termios.tcgetattr(fd)
    speed = getattr(termios, f"B{baud}")
    attrs[0] = 0                                         # iflag: raw input
    attrs[1] = 0                                         # oflag
    attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    attrs[3] = 0                                         # lflag: no echo, non-canonical
    attrs[4] = attrs[5] = speed
    termios.tcsetattr(fd, termios.TCSANOW, attrs)
    return fd


def read_lines(source):
    buffer = b""
    while True:
        chunk = source.read(256)
        if not chunk:
            if buffer:
                yield buffer.decode("utf-8", errors="replace")
            return
        buffer += chunk
        while b"\n" in buffer:
            line, buffer = buffer.split(b"\n", 1)
            yield line.decode("utf-8", errors="replace").strip()


def main():
    parser = argparse.ArgumentParser(description="WAREVA gateway")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--serial", help="ESP32 serial device, e.g. /dev/ttyUSB0")
    source.add_argument("--input", help="replay a file of recorded ESP32 lines")
    parser.add_argument("--dashboard", default="http://127.0.0.1:8787")
    parser.add_argument("--db", default="gateway.db")
    args = parser.parse_args()

    outbox = Outbox(args.db)
    stream = open_serial(args.serial) if args.serial else open(args.input, "rb")

    def reader():
        for line in read_lines(stream):
            message = to_message(line, utc_now())
            if message:
                outbox.put(message)

    thread = threading.Thread(target=reader, daemon=True)
    thread.start()
    print(f"gateway: {args.serial or args.input} -> {args.dashboard}")
    while True:
        deliver(outbox, args.dashboard)
        if not thread.is_alive() and not outbox.pending(1):
            break
        time.sleep(1)


if __name__ == "__main__":
    main()
