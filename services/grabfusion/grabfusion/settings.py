from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    studio_url: str = "http://127.0.0.1:8765/api/external/v1"
    market_url: str = "https://fusionlab.in.ua"
    host: str = "127.0.0.1"
    port: int = 8000
    session_db: str = "grabfusion.sqlite3"
    cookie_secure: bool = False
    # Публічний шлях, під яким сторінка живе на домені (напр. "/grabfisionstidio"); "" — корінь.
    base_path: str = ""

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        d = cls()
        return cls(
            studio_url=e.get("GRABFUSION_STUDIO_URL", d.studio_url).rstrip("/"),
            market_url=e.get("GRABFUSION_MARKET_URL", d.market_url).rstrip("/"),
            host=e.get("GRABFUSION_HOST", d.host),
            # Railway/Render/Heroku віддають порт у PORT; явний GRABFUSION_PORT має пріоритет.
            port=int(e.get("GRABFUSION_PORT") or e.get("PORT") or d.port),
            session_db=e.get("GRABFUSION_SESSION_DB", d.session_db),
            cookie_secure=e.get("GRABFUSION_COOKIE_SECURE", "").lower() in {"1", "true", "yes"},
            base_path=normalize_base_path(e.get("GRABFUSION_BASE_PATH", d.base_path)),
        )


def normalize_base_path(value: str | None) -> str:
    """"/x/", "x", " /x " → "/x"; "", "/" → "" (корінь)."""
    parts = [p for p in (value or "").strip().split("/") if p]
    return "/" + "/".join(parts) if parts else ""
