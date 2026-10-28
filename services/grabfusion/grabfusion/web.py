"""Веб-API для сторінки викладача (той самий домен, cookie-сесія) → проксі до Studio.

Браузер токена не бачить: він лежить у SessionStore. Помилки віддаються у форматі Studio
`{error, kind}` з тим самим HTTP-кодом, розгалужуватись у сторінці слід за `kind`.
"""
from __future__ import annotations

import base64
import time
from dataclasses import asdict
from typing import Any, Callable

import httpx
from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from fastapi.responses import JSONResponse

from . import contract
from .errors import StudioError
from .imaging import prepare_photo
from .models import Limits
from .sessions import Session, SessionStore
from .settings import Settings
from .studio_client import StudioClient, pair_with_code

COOKIE = "gf_session"
LIMITS_TTL = 600.0
MAX_UPLOAD_BYTES = 40 * 1024 * 1024  # сире фото з телефона до стиснення


class Deps:
    def __init__(self, settings: Settings, store: SessionStore,
                 transport: httpx.BaseTransport | None = None):
        self.settings = settings
        self.store = store
        self.transport = transport
        self._limits: tuple[float, Limits] | None = None

    def client(self, session: Session) -> StudioClient:
        return StudioClient(self.settings.studio_url, session.token, transport=self.transport,
                            limits=self.limits_cached())

    def limits_cached(self) -> Limits:
        if self._limits and time.monotonic() - self._limits[0] < LIMITS_TTL:
            return self._limits[1]
        return Limits.from_dict(contract.default_limits())

    def remember_limits(self, limits: Limits) -> None:
        self._limits = (time.monotonic(), limits)


def error_response(e: StudioError) -> JSONResponse:
    body: dict[str, Any] = {"error": e.message, "kind": e.kind}
    if e.blockers:
        body["blockers"] = e.blockers
    return JSONResponse(body, status_code=e.status)


def build_router(deps: Deps) -> APIRouter:
    router = APIRouter(prefix="/api")

    def current(request: Request) -> Session:
        s = deps.store.get(request.cookies.get(COOKIE))
        if s is None:
            raise StudioError("unauthenticated", "Підключіть застосунок кодом зі Studio.")
        return s

    def call(session: Session, fn: Callable[[StudioClient], Any]) -> Any:
        """Виконує виклик до Studio; недійсний токен → сесію закриваємо, сторінка покаже підключення."""
        c = deps.client(session)
        try:
            return fn(c)
        except StudioError as e:
            if e.kind in {"invalid_token", "unauthenticated"}:
                deps.store.delete(session.sid)
            raise
        except httpx.TransportError:
            raise StudioError("server_error", "Studio зараз недоступна. Спробуйте за хвилину.", 502) from None
        finally:
            c.close()

    @router.get("/session")
    def get_session(request: Request) -> dict[str, Any]:
        s = deps.store.get(request.cookies.get(COOKIE))
        return {"paired": s is not None, "user": {"name": s.user_name} if s else None,
                "contractVersion": contract.contract_version()}

    @router.post("/pair")
    async def pair(request: Request, response: Response) -> dict[str, Any]:
        try:
            body = await request.json()
        except ValueError:
            body = None
        code = str(body.get("code", "")).strip() if isinstance(body, dict) else ""
        if not code:
            raise StudioError("bad_input", "Введіть код підключення зі Studio.")
        try:
            res = pair_with_code(deps.settings.studio_url, code, transport=deps.transport)
        except httpx.TransportError:
            raise StudioError("server_error", "Studio зараз недоступна. Спробуйте за хвилину.", 502) from None
        user = res.get("user") if isinstance(res.get("user"), dict) else {}
        old = request.cookies.get(COOKIE)
        deps.store.delete(old)
        s = deps.store.create(res["token"], str(user.get("name") or user.get("email") or ""))
        response.set_cookie(COOKIE, s.sid, httponly=True, samesite="strict", secure=deps.settings.cookie_secure,
                            max_age=60 * 60 * 24 * 90, path="/")
        return {"paired": True, "user": {"name": s.user_name}}

    @router.post("/logout")
    def logout(request: Request, response: Response) -> dict[str, bool]:
        deps.store.delete(request.cookies.get(COOKIE))
        response.delete_cookie(COOKIE, path="/")
        return {"paired": False}

    @router.get("/limits")
    def limits(s: Session = Depends(current)) -> Any:
        data = call(s, lambda c: c.raw("GET", "/photo-drafts/limits"))
        deps.remember_limits(Limits.from_dict(data["limits"]))
        return data

    @router.get("/drafts")
    def list_drafts(s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("GET", "/photo-drafts"))

    @router.post("/drafts", status_code=201)
    async def create_draft(request: Request, s: Session = Depends(current)) -> Any:
        body = await _json_body(request)
        return call(s, lambda c: c.raw("POST", "/photo-drafts", json=body))

    @router.get("/drafts/{draft_id}")
    def get_draft(draft_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("GET", f"/photo-drafts/{draft_id}"))

    @router.patch("/drafts/{draft_id}")
    async def patch_draft(draft_id: str, request: Request, s: Session = Depends(current)) -> Any:
        body = await _json_body(request)
        return call(s, lambda c: c.raw("PATCH", f"/photo-drafts/{draft_id}", json=body))

    @router.delete("/drafts/{draft_id}")
    def discard_draft(draft_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("DELETE", f"/photo-drafts/{draft_id}"))

    @router.post("/drafts/{draft_id}/photos", status_code=202)
    async def add_photo(draft_id: str, clientId: str = Form(...), file: UploadFile = File(...),
                        note: str | None = Form(None), takenAt: str | None = Form(None),
                        s: Session = Depends(current)) -> Any:
        lim = deps.limits_cached()
        if note is not None and contract.count_note_chars(note) > lim.maxNoteChars:
            raise StudioError("note_too_long", f"Опис понад {lim.maxNoteChars} символів.")
        raw = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(raw) > MAX_UPLOAD_BYTES:
            raise StudioError("image_too_large", "Файл завеликий.")
        jpeg = prepare_photo(raw, max_side=lim.recommendedMaxSidePx, max_bytes=lim.maxImageBytes)
        data = "data:image/jpeg;base64," + base64.b64encode(jpeg).decode()
        res = call(s, lambda c: c.add_photo(draft_id, clientId, data, taken_at=takenAt or None,
                                            note=note or None))
        return {"photo": asdict(res.photo), "revision": res.revision, "duplicate": res.duplicate}

    @router.post("/drafts/{draft_id}/structure", status_code=202)
    async def structure(draft_id: str, request: Request, s: Session = Depends(current)) -> Any:
        body = await _json_body(request, optional=True)
        return call(s, lambda c: c.raw("POST", f"/photo-drafts/{draft_id}/structure", json=body or None))

    @router.post("/drafts/{draft_id}/modules/{module_id}/generate", status_code=202)
    def generate(draft_id: str, module_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("POST", f"/photo-drafts/{draft_id}/modules/{module_id}/generate"))

    @router.post("/drafts/{draft_id}/submit", status_code=201)
    def submit(draft_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("POST", f"/photo-drafts/{draft_id}/submit"))

    @router.get("/drafts/{draft_id}/photos/{photo_id}/image")
    def photo_image(draft_id: str, photo_id: str, s: Session = Depends(current)) -> Response:
        img = call(s, lambda c: c.photo_image(draft_id, photo_id))
        return Response(img, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})

    @router.post("/drafts/{draft_id}/photos/{photo_id}/retry", status_code=202)
    def retry_photo(draft_id: str, photo_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("POST", f"/photo-drafts/{draft_id}/photos/{photo_id}/retry"))

    @router.delete("/drafts/{draft_id}/photos/{photo_id}")
    def delete_photo(draft_id: str, photo_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("DELETE", f"/photo-drafts/{draft_id}/photos/{photo_id}"))

    @router.put("/drafts/{draft_id}/notes/{note_id}")
    async def put_note(draft_id: str, note_id: str, request: Request, s: Session = Depends(current)) -> Any:
        body = await _json_body(request)
        text = body.get("text")
        if isinstance(text, str) and contract.count_note_chars(text) > deps.limits_cached().maxNoteChars:
            raise StudioError("note_too_long", f"Опис понад {deps.limits_cached().maxNoteChars} символів.")
        return call(s, lambda c: c.raw("PUT", f"/photo-drafts/{draft_id}/notes/{note_id}", json=body))

    @router.delete("/drafts/{draft_id}/notes/{note_id}")
    def delete_note(draft_id: str, note_id: str, s: Session = Depends(current)) -> Any:
        return call(s, lambda c: c.raw("DELETE", f"/photo-drafts/{draft_id}/notes/{note_id}"))

    return router


async def _json_body(request: Request, *, optional: bool = False) -> dict[str, Any]:
    raw = await request.body()
    if optional and not raw:
        return {}
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise StudioError("bad_input", "Тіло запиту має бути JSON-обʼєктом.")
    return body
