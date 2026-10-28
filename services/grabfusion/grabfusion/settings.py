from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    studio_url: str = "http://127.0.0.1:8765/api/external/v1"
    studio_token: str = ""
    market_url: str = "https://fusionlab.in.ua"
    host: str = "127.0.0.1"
    port: int = 8000

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        d = cls()
        return cls(
            studio_url=e.get("GRABFUSION_STUDIO_URL", d.studio_url).rstrip("/"),
            studio_token=e.get("GRABFUSION_STUDIO_TOKEN", d.studio_token),
            market_url=e.get("GRABFUSION_MARKET_URL", d.market_url).rstrip("/"),
            host=e.get("GRABFUSION_HOST", d.host),
            port=int(e.get("GRABFUSION_PORT", d.port)),
        )
