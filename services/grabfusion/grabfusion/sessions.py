"""Сесії викладачів: cookie → токен Studio. Токен лишається на сервері й у браузер не потрапляє."""
from __future__ import annotations

import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Session:
    sid: str
    token: str
    user_name: str
    created_at: float


class SessionStore:
    def __init__(self, path: str | Path = ":memory:"):
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("""CREATE TABLE IF NOT EXISTS sessions (
                sid TEXT PRIMARY KEY, token TEXT NOT NULL, user_name TEXT NOT NULL, created_at REAL NOT NULL)""")
            self._db.commit()
        if str(path) != ":memory:":
            try:
                Path(path).chmod(0o600)
            except OSError:  # pragma: no cover  (Windows)
                pass

    def create(self, token: str, user_name: str) -> Session:
        s = Session(secrets.token_urlsafe(32), token, user_name, time.time())
        with self._lock:
            self._db.execute("INSERT INTO sessions VALUES (?,?,?,?)", (s.sid, s.token, s.user_name, s.created_at))
            self._db.commit()
        return s

    def get(self, sid: str | None) -> Session | None:
        if not sid:
            return None
        with self._lock:
            row = self._db.execute("SELECT sid, token, user_name, created_at FROM sessions WHERE sid=?",
                                   (sid,)).fetchone()
        return Session(*row) if row else None

    def delete(self, sid: str | None) -> None:
        if sid:
            with self._lock:
                self._db.execute("DELETE FROM sessions WHERE sid=?", (sid,))
                self._db.commit()

    def close(self) -> None:
        self._db.close()
