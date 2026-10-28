"""Каркас сервісу GrabFusion: перевірка живості й конфігурація (без секретів). Далі — екрани B1+."""
from __future__ import annotations

from fastapi import FastAPI

from . import __version__, contract
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    app = FastAPI(title="GrabFusion", version=__version__)

    @app.get("/healthz")
    def healthz() -> dict[str, object]:
        return {"ok": True, "version": __version__, "contractVersion": contract.contract_version()}

    @app.get("/api/config")
    def config() -> dict[str, object]:
        # Токен Studio сюди не потрапляє — він живе лише на сервері.
        return {"studioUrl": cfg.studio_url, "marketUrl": cfg.market_url,
                "hasStudioToken": bool(cfg.studio_token),
                "contractVersion": contract.contract_version()}

    return app


def main() -> None:  # pragma: no cover
    import uvicorn

    cfg = Settings.from_env()
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port)


if __name__ == "__main__":  # pragma: no cover
    main()
