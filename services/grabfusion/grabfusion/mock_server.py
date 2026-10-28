"""Мок-сервер API Studio на фікстурах A0 — для розробки й тестів без справжньої Studio.

Маршрути — за таблицею розділу 4 контракту. Відповідь — фікстура маршруту; щоб отримати іншу
(зокрема помилку `error-*.json`), передайте заголовок `X-Mock-Fixture: <назва>`. Код HTTP помилки —
за `kind` (розділ 5). Мінімальна перевірка тіл: ліміти (`note_too_long`, `image_too_large`, `bad_image`,
`bad_input`) і ідемпотентність додавання фото за `clientId`. Токени `nst_invalid` і `nst_wrongscope`
дають `invalid_token` і `scope_denied`.
"""
from __future__ import annotations

import base64
import binascii
import json
import re
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

from . import contract
from .errors import KIND_STATUS
from .mock_sim import Sim

PREFIX = "/api/external/v1"
FIXTURE_HEADER = "X-Mock-Fixture"

# 1×1 JPEG для маршруту `…/image`
TINY_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////"
    "////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgB"
    "AQABPxA="
)


@dataclass(frozen=True)
class Route:
    method: str
    pattern: re.Pattern[str]
    status: int
    fixture: str | None  # None — байти зображення
    name: str


def _r(method: str, path: str, status: int, fixture: str | None) -> Route:
    rx = re.sub(r":(\w+)", r"(?P<\1>[^/]+)", path)
    return Route(method, re.compile(f"^{rx}$"), status, fixture, f"{method} {path}")


ROUTES: list[Route] = [
    _r("GET", "/photo-drafts/limits", 200, "limits"),
    _r("GET", "/photo-drafts", 200, "list-drafts"),
    _r("POST", "/photo-drafts", 201, "create-draft"),
    _r("GET", "/photo-drafts/:draftId", 200, "get-draft-collecting"),
    _r("PATCH", "/photo-drafts/:draftId", 200, "patch-draft"),
    _r("DELETE", "/photo-drafts/:draftId", 200, "discard-draft"),
    _r("POST", "/photo-drafts/:draftId/photos", 202, "add-photo"),
    _r("GET", "/photo-drafts/:draftId/photos/:photoId/image", 200, None),
    _r("POST", "/photo-drafts/:draftId/photos/:photoId/retry", 202, "retry-photo"),
    _r("DELETE", "/photo-drafts/:draftId/photos/:photoId", 200, "delete-photo"),
    _r("PUT", "/photo-drafts/:draftId/notes/:noteId", 200, "put-note"),
    _r("DELETE", "/photo-drafts/:draftId/notes/:noteId", 200, "delete-note"),
    _r("PUT", "/photo-drafts/:draftId/photos/:photoId/text", 200, "put-photo-text"),
    _r("POST", "/photo-drafts/:draftId/structure", 202, "structure-running"),
    _r("POST", "/photo-drafts/:draftId/modules/:moduleId/generate", 202, "generate-running"),
    _r("POST", "/photo-drafts/:draftId/submit", 201, "submit-course"),
]

SUBMIT_BY_KIND = {"course": "submit-course", "instruction": "submit-instruction",
                  "book": "submit-book", "manuscript": "submit-manuscript"}


def fixtures_served_by_routes() -> set[str]:
    """Усі фікстури, які мок може віддати за таблицею (без ручного вибору заголовком)."""
    names = {r.fixture for r in ROUTES if r.fixture}
    names |= set(SUBMIT_BY_KIND.values())
    names |= {"get-draft-structured", "get-draft-written", "get-draft-job-failed", "get-draft-manuscript"}
    return names


def _err(kind: str, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse({"error": message, "kind": kind, **extra}, status_code=KIND_STATUS[kind])


def _image_kind(raw: bytes) -> bool:
    return (raw[:3] == b"\xff\xd8\xff" or raw[:8] == b"\x89PNG\r\n\x1a\n"
            or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"))


def _check_photo_body(body: Any, limits: dict[str, int]) -> JSONResponse | None:
    if not isinstance(body, dict) or not isinstance(body.get("clientId"), str) or not body["clientId"]:
        return _err("bad_input", "Потрібен clientId.")
    img = body.get("image")
    if not isinstance(img, str) or not img:
        return _err("bad_input", "Потрібне поле image.")
    note = body.get("note")
    if note is not None:
        if not isinstance(note, str):
            return _err("bad_input", "note має бути рядком.")
        if contract.count_note_chars(note) > limits["maxNoteChars"]:
            return _err("note_too_long", f"Опис понад {limits['maxNoteChars']} символів.")
    payload = img.split(",", 1)[1] if img.startswith("data:") else img
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return _err("bad_image", "Дані не є зображенням.")
    if len(raw) > limits["maxImageBytes"]:
        return _err("image_too_large", "Фото завелике.")
    if not _image_kind(raw):
        return _err("bad_image", "Потрібен JPEG, PNG або WEBP.")
    return None


async def _pair(request: Request) -> Response:
    """Обмін коду на токен. Коди для тестів: BAD → 404, EXPIRED → 410, LOCKED → 429; інші — успіх."""
    try:
        body = json.loads(await request.body() or b"{}")
    except ValueError:
        body = {}
    code = body.get("code") if isinstance(body, dict) else None
    if code == "BAD" or not isinstance(code, str) or not code:
        return JSONResponse({"error": "Код підключення невірний або вже використаний.", "kind": "invalid_code"}, 404)
    if code == "EXPIRED":
        return JSONResponse({"error": "Код підключення прострочений. Отримайте новий у Студії.",
                             "kind": "code_expired"}, 410)
    if code == "LOCKED":
        return JSONResponse({"error": "Забагато невдалих спроб. Зачекайте 10 хвилин.",
                             "kind": "too_many_attempts"}, 429)
    return JSONResponse({"token": "nst_mock_token", "record": {"id": "tok_mock", "scope": "photo-drafts"},
                         "user": {"name": "Тестова Викладачка", "email": "teacher@example.com"}}, 201)


def create_app(*, stateful: bool = False, poll_interval_ms: int | None = None) -> FastAPI:
    app = FastAPI(title="GrabFusion mock of Studio photo-drafts API", docs_url=None, redoc_url=None)
    limits = contract.default_limits()
    seen_clients: dict[tuple[str, str], bool] = {}
    kinds: dict[str, str] = {}
    app.state.calls = []  # (METHOD path, fixture) — для тестів
    sim = Sim() if stateful else None
    app.state.sim = sim

    @app.api_route(PREFIX + "/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    async def handle(rest: str, request: Request) -> Response:
        path = "/" + rest
        method = request.method
        if method == "POST" and path == "/pair":
            return await _pair(request)
        route = params = None
        for r in ROUTES:
            if r.method != method:
                continue
            m = r.pattern.match(path)
            if m:
                route, params = r, m.groupdict()
                break
        if route is None:
            return JSONResponse(
                {"error": f"Маршруту {method} {path} немає в контракті.", "kind": "bad_input"}, status_code=404)

        auth = request.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            return _err("unauthenticated", "Потрібен заголовок Authorization: Bearer.")
        token = auth[7:].strip()
        if token == "nst_invalid":
            return _err("invalid_token", "Токен недійсний або відкликаний.")
        if token == "nst_wrongscope":
            return _err("scope_denied", "Токен не має області photo-drafts.")

        body: Any = None
        if method in ("POST", "PUT", "PATCH"):
            raw = await request.body()
            if raw:
                try:
                    body = json.loads(raw)
                except ValueError:
                    return _err("bad_input", "Тіло не є JSON.")

        override = request.headers.get(FIXTURE_HEADER)
        if override:
            if override not in contract.fixture_names():
                return _err("bad_input", f"Немає фікстури {override}.")
            app.state.calls.append((route.name, override))
            fx = contract.load_fixture(override)
            if override.startswith("error-"):
                return JSONResponse(fx, status_code=KIND_STATUS[fx["kind"]])
            return JSONResponse(fx, status_code=route.status)

        if sim is not None and route.name != "GET /photo-drafts/limits":
            if route.name == "POST /photo-drafts/:draftId/photos":
                bad = _check_photo_body(body, limits)
                if bad:
                    return bad
            res = sim.handle(route.name, params, body)
            if res is not None:
                app.state.calls.append((route.name, "sim"))
                return JSONResponse(res[1], status_code=res[0])

        fixture = route.fixture
        extra: dict[str, Any] = {}
        if route.name == "GET /photo-drafts/limits" and poll_interval_ms:
            fx = contract.load_fixture("limits")
            fx["limits"]["pollIntervalMs"] = poll_interval_ms  # лише для швидких тестів
            app.state.calls.append((route.name, "limits"))
            return JSONResponse(fx)

        if route.name == "POST /photo-drafts":
            if not isinstance(body, dict) or body.get("kind") not in {"course", "instruction", "book", "manuscript"}:
                return _err("bad_input", "Невалідний kind.")
        elif route.name == "PATCH /photo-drafts/:draftId":
            if not isinstance(body, dict) or not isinstance(body.get("ifRevision"), int):
                return _err("bad_input", "Потрібен ifRevision.")
        elif route.name == "POST /photo-drafts/:draftId/photos":
            bad = _check_photo_body(body, limits)
            if bad:
                return bad
            key = (params["draftId"], body["clientId"])
            if key in seen_clients:
                extra["duplicate"] = True
            seen_clients[key] = True
        elif route.name == "PUT /photo-drafts/:draftId/notes/:noteId":
            if not isinstance(body, dict) or not isinstance(body.get("text"), str) \
                    or not isinstance(body.get("photoIds"), list):
                return _err("bad_input", "Потрібні photoIds і text.")
            if contract.count_note_chars(body["text"]) > limits["maxNoteChars"]:
                return _err("note_too_long", f"Опис понад {limits['maxNoteChars']} символів.")
        elif route.name == "PUT /photo-drafts/:draftId/photos/:photoId/text":
            if not isinstance(body, dict) or not isinstance(body.get("text"), str) \
                    or len(body["text"]) > limits["maxPageTextChars"]:
                return _err("bad_input", "Потрібен text (рядок у межах maxPageTextChars).")
        elif route.name == "POST /photo-drafts/:draftId/submit":
            fixture = SUBMIT_BY_KIND.get(kinds.get(params["draftId"], "course"), "submit-course")

        app.state.calls.append((route.name, fixture))
        if fixture is None:
            return Response(TINY_JPEG, media_type="image/jpeg")
        fx = contract.load_fixture(fixture)
        if extra.get("duplicate"):
            fx["duplicate"] = True
        if route.name == "POST /photo-drafts" and isinstance(body, dict):
            kinds[fx["draft"]["draftId"]] = body["kind"]
        return JSONResponse(fx, status_code=route.status)

    return app


app = create_app()


def main() -> None:  # pragma: no cover
    import os
    import sys

    import uvicorn

    stateful = "--stateful" in sys.argv or os.environ.get("GRABFUSION_MOCK_STATEFUL") == "1"
    uvicorn.run(create_app(stateful=stateful) if stateful else app, host=os.environ.get("GRABFUSION_HOST", "127.0.0.1"),
                port=int(os.environ.get("GRABFUSION_MOCK_PORT", "8765")))


if __name__ == "__main__":  # pragma: no cover
    main()
