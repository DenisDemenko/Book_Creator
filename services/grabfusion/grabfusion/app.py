"""Сервіс GrabFusion: веб-API для сторінки викладача + сама сторінка (grabfusion/static)."""
from __future__ import annotations

from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, contract
from .errors import StudioError
from .sessions import SessionStore
from .settings import Settings
from .web import Deps, build_router, error_response

STATIC_DIR = Path(__file__).parent / "static"


def create_app(settings: Settings | None = None, *, store: SessionStore | None = None,
               studio_transport: httpx.BaseTransport | None = None) -> FastAPI:
    cfg = settings or Settings.from_env()
    app = FastAPI(title="GrabFusion", version=__version__)
    deps = Deps(cfg, store or SessionStore(cfg.session_db), studio_transport)
    app.state.deps = deps

    @app.exception_handler(StudioError)
    async def _studio_error(_req: Request, e: StudioError):  # noqa: ANN202
        return error_response(e)

    @app.get("/healthz")
    def healthz() -> dict[str, object]:
        return {"ok": True, "version": __version__, "contractVersion": contract.contract_version()}

    @app.get("/api/config")
    def config() -> dict[str, object]:
        # Токена тут немає й не буде: він живе лише в сесіях на сервері.
        return {"studioUrl": cfg.studio_url, "marketUrl": cfg.market_url,
                "contractVersion": contract.contract_version()}

    app.include_router(build_router(deps))

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


def main() -> None:  # pragma: no cover
    import uvicorn

    cfg = Settings.from_env()
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port)


if __name__ == "__main__":  # pragma: no cover
    main()
