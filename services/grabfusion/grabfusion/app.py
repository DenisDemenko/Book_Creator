"""Сервіс GrabFusion: веб-API для сторінки викладача + сама сторінка (grabfusion/static)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import __version__, contract
from .errors import StudioError
from .sessions import SessionStore
from .settings import Settings
from .web import Deps, build_router, error_response

STATIC_DIR = Path(__file__).parent / "static"

MANIFEST = {
    "id": "./",
    "name": "GrabFusion — курс із фото",
    "short_name": "GrabFusion",
    "description": "Зніміть кадри — отримайте курс, інструкцію чи главу книги для Fusion Lab Studio.",
    "lang": "uk",
    # Відносні адреси розв'язуються від адреси маніфесту: працює під будь-яким префіксом.
    "start_url": "./",
    "scope": "./",
    "display": "standalone",
    "orientation": "portrait",
    "background_color": "#f4ece1",
    "theme_color": "#f4ece1",
    "icons": [
        {"src": "static/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
        {"src": "static/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
        {"src": "static/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
    ],
}

# Усе, що потрібно, щоб сторінка відкрилась без звʼязку (шлях відносно області SW).
SHELL_PATHS = ["./", "static/app.css", "static/app.js", "manifest.webmanifest",
               "static/icons/icon-192.png", "static/icons/icon-512.png", "static/icons/apple-touch-icon.png",
               "static/icons/favicon-64.png"]


def static_version() -> str:
    """Відбиток статики: змінюється з будь-яким файлом → service worker оновлює кеш."""
    h = hashlib.sha1(__version__.encode())
    for f in sorted(STATIC_DIR.rglob("*")):
        if f.is_file():
            h.update(f.relative_to(STATIC_DIR).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:12]


class PrefixMiddleware:
    """Зрізає публічний префікс (`/grabfisionstidio`), якщо проксі його не прибрав.

    Тож сервіс однаково працює і за проксі зі зрізанням префікса, і без нього.
    """

    def __init__(self, app, prefix: str) -> None:  # noqa: ANN001
        self.app, self.prefix = app, prefix

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if self.prefix and scope["type"] in ("http", "websocket"):
            path = scope["path"]
            if path == self.prefix or path.startswith(self.prefix + "/"):
                rest = path[len(self.prefix):] or "/"
                scope = dict(scope, path=rest, raw_path=rest.encode())
        await self.app(scope, receive, send)


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

    base_href = (cfg.base_path or "") + "/"
    version = static_version()

    @app.get("/")
    def index() -> Response:
        html = (STATIC_DIR / "index.html").read_text(encoding="utf-8").replace("__BASE_HREF__", base_href)
        return Response(html, media_type="text/html; charset=utf-8", headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest")
    def manifest() -> Response:
        return Response(json.dumps(MANIFEST, ensure_ascii=False), media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})

    @app.get("/sw.js")
    def service_worker() -> Response:
        js = (STATIC_DIR / "sw.js").read_text(encoding="utf-8")
        js = js.replace("__VERSION__", version).replace("__SHELL__", json.dumps(SHELL_PATHS))
        return Response(js, media_type="text/javascript; charset=utf-8", headers={"Cache-Control": "no-cache"})

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    if cfg.base_path:
        app.add_middleware(PrefixMiddleware, prefix=cfg.base_path)
    return app


def main() -> None:  # pragma: no cover
    import uvicorn

    cfg = Settings.from_env()
    uvicorn.run(create_app(cfg), host=cfg.host, port=cfg.port)


if __name__ == "__main__":  # pragma: no cover
    main()
