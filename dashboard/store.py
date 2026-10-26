"""SQLite operating log: one row per reading (with its decision) and one per event."""
from __future__ import annotations

import csv
import io
import json
import sqlite3
import threading
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('twin', 'device')),
  device_id TEXT,
  measurement_id TEXT UNIQUE,
  state TEXT NOT NULL,
  valve_command TEXT NOT NULL,
  valve_feedback TEXT,
  irrigated_l REAL NOT NULL DEFAULT 0,
  readings_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  source TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  state TEXT NOT NULL,
  codes TEXT NOT NULL,
  message TEXT NOT NULL,
  acknowledged_at TEXT
);
CREATE INDEX IF NOT EXISTS readings_time ON readings(time);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class Store:
    def __init__(self, path: str):
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.executescript(SCHEMA)

    def add_reading(self, *, time, source, state, valve_command, valve_feedback, irrigated_l, readings, reasons,
                    device_id=None, measurement_id=None) -> tuple[int, bool]:
        """Insert a reading. Returns (id, created). A repeated measurement_id returns the first row."""
        with self._lock, self._db:
            if measurement_id:
                row = self._db.execute("SELECT id FROM readings WHERE measurement_id = ?", (measurement_id,)).fetchone()
                if row:
                    return row["id"], False
            cur = self._db.execute(
                "INSERT INTO readings (time, received_at, source, device_id, measurement_id, state, valve_command,"
                " valve_feedback, irrigated_l, readings_json, reasons_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (time, now(), source, device_id, measurement_id, state, valve_command, valve_feedback,
                 irrigated_l, json.dumps(readings), json.dumps(reasons, ensure_ascii=False)))
            return cur.lastrowid, True

    def add_event(self, *, time, source, severity, state, codes, message) -> int:
        with self._lock, self._db:
            cur = self._db.execute(
                "INSERT INTO events (time, source, severity, state, codes, message) VALUES (?,?,?,?,?,?)",
                (time, source, severity, state, ",".join(codes), message))
            return cur.lastrowid

    def acknowledge(self, event_id: int) -> bool:
        with self._lock, self._db:
            cur = self._db.execute("UPDATE events SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL",
                                   (now(), event_id))
            return cur.rowcount == 1

    def events(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def summary(self) -> dict:
        with self._lock:
            by_source = self._db.execute("SELECT source, COUNT(*) AS n FROM readings GROUP BY source").fetchall()
            open_events = self._db.execute("SELECT COUNT(*) FROM events WHERE acknowledged_at IS NULL").fetchone()[0]
        return {"readings": {r["source"]: r["n"] for r in by_source}, "open_events": open_events}

    def csv(self, table: str) -> str:
        if table not in ("readings", "events"):
            raise ValueError(table)
        with self._lock:
            cur = self._db.execute(f"SELECT * FROM {table} ORDER BY id")
            rows = cur.fetchall()
            header = [d[0] for d in cur.description]
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(header)
        writer.writerows(tuple(r) for r in rows)
        return out.getvalue()
