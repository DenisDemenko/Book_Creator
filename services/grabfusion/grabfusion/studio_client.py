"""Клієнт API Studio `/api/external/v1/photo-drafts*` (контракт 1.7.0).

Синхронний (httpx). Токен тримає сервер GrabFusion. Розгалужуватись слід лише за `StudioError.kind`.
"""
from __future__ import annotations

import time
from typing import Any, Callable

import httpx

from .errors import StudioError
from .models import (AiOptions, Draft, DraftSummary, Limits, Note, NoteResult, Photo, PhotoResult,
                     SubmitResult, Target)

_UNSET: Any = object()


class StudioClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 30.0,
                 transport: httpx.BaseTransport | None = None,
                 retries: int = 3, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep,
                 limits: Limits | None = None):
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self.base_url, timeout=timeout, transport=transport,
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )
        self._retries = retries
        self._backoff = backoff
        self._sleep = sleep
        self._limits: Limits | None = limits

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "StudioClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # --- низький рівень -------------------------------------------------
    def _request(self, method: str, path: str, *, json: Any = None, params: dict[str, str] | None = None) -> Any:
        resp = self._http.request(method, path, json=json, params=params)
        return self._parse(resp)

    @staticmethod
    def _parse(resp: httpx.Response) -> Any:
        try:
            body = resp.json()
        except ValueError:
            body = None
        if resp.status_code >= 400:
            raise StudioError.from_response(resp.status_code, body)
        return body

    def raw(self, method: str, path: str, *, json: Any = None, params: dict[str, str] | None = None) -> Any:
        """Сире тіло відповіді (для проксі: не губить поля, яких ще не знає модель)."""
        return self._request(method, path, json=json, params=params)

    def raw_bytes(self, method: str, path: str, *, content: bytes, content_type: str = "application/octet-stream") -> Any:
        """Тіло — байти (запечатаний конверт для черги «на мій сервер», журнал #550): сервіс їх не читає й не зберігає."""
        resp = self._http.request(method, path, content=content, headers={"Content-Type": content_type})
        return self._parse(resp)

    # --- межі -----------------------------------------------------------
    def limits(self, *, refresh: bool = False) -> Limits:
        if self._limits is None or refresh:
            self._limits = Limits.from_dict(self._request("GET", "/photo-drafts/limits")["limits"])
        return self._limits

    def poll_interval(self) -> float:
        return self.limits().pollIntervalMs / 1000

    # --- чернетки -------------------------------------------------------
    def list_drafts(self) -> list[DraftSummary]:
        return [DraftSummary.from_dict(x) for x in self._request("GET", "/photo-drafts")["drafts"]]

    def create_draft(self, kind: str, **fields: Any) -> Draft:
        """fields: title, craft, audience, level, bookId, newBookTitle, instructionMode, modelCode, courseSource (лише курс)."""
        body = {"kind": kind, **{k: v for k, v in fields.items() if v is not None}}
        return Draft.from_dict(self._request("POST", "/photo-drafts", json=body)["draft"])

    def get_draft(self, draft_id: str) -> Draft:
        return Draft.from_dict(self._request("GET", f"/photo-drafts/{draft_id}")["draft"])

    def patch_draft(self, draft_id: str, if_revision: int, **fields: Any) -> Draft:
        body = {"ifRevision": if_revision, **fields}
        return Draft.from_dict(self._request("PATCH", f"/photo-drafts/{draft_id}", json=body)["draft"])

    def discard_draft(self, draft_id: str) -> Draft:
        return Draft.from_dict(self._request("DELETE", f"/photo-drafts/{draft_id}")["draft"])

    # --- фото -----------------------------------------------------------
    def add_photo(self, draft_id: str, client_id: str, image: str, *, mime_type: str | None = None,
                  taken_at: str | None = None, note: str | None = None) -> PhotoResult:
        """Ідемпотентно за `client_id`: повтор після обриву повертає те саме фото (`duplicate=True`).

        Тому мережеві помилки, 5xx і 429 повторюємо з тим самим `client_id` — дубля не буде.
        """
        body: dict[str, Any] = {"clientId": client_id, "image": image}
        if mime_type:
            body["mimeType"] = mime_type
        if taken_at:
            body["takenAt"] = taken_at
        if note is not None:
            if len(note) > self.limits().maxNoteChars:
                raise StudioError("note_too_long", "Опис понад ліміт символів.")
            body["note"] = note
        attempt = 0
        while True:
            try:
                data = self._request("POST", f"/photo-drafts/{draft_id}/photos", json=body)
                break
            except (httpx.TransportError, StudioError) as e:
                transient = isinstance(e, httpx.TransportError) or e.retryable
                attempt += 1
                if not transient or attempt > self._retries:
                    raise
                self._sleep(self._backoff * 2 ** (attempt - 1))
        return PhotoResult(Photo.from_dict(data["photo"]), data["revision"], bool(data.get("duplicate")))

    def photo_image(self, draft_id: str, photo_id: str) -> bytes:
        resp = self._http.get(f"/photo-drafts/{draft_id}/photos/{photo_id}/image")
        if resp.status_code >= 400:
            self._parse(resp)
        return resp.content

    def retry_photo(self, draft_id: str, photo_id: str) -> PhotoResult:
        d = self._request("POST", f"/photo-drafts/{draft_id}/photos/{photo_id}/retry")
        return PhotoResult(Photo.from_dict(d["photo"]), d["revision"], bool(d.get("duplicate")))

    def delete_photo(self, draft_id: str, photo_id: str) -> Draft:
        return Draft.from_dict(self._request("DELETE", f"/photo-drafts/{draft_id}/photos/{photo_id}")["draft"])

    def put_photo_text(self, draft_id: str, photo_id: str, text: str) -> PhotoResult:
        """Лише рукопис: виправлений викладачем текст сторінки."""
        d = self._request("PUT", f"/photo-drafts/{draft_id}/photos/{photo_id}/text", json={"text": text})
        return PhotoResult(Photo.from_dict(d["photo"]), d["revision"], bool(d.get("duplicate")))

    # --- описи ----------------------------------------------------------
    def put_note(self, draft_id: str, note_id: str, photo_ids: list[str], text: str) -> NoteResult:
        if len(text) > self.limits().maxNoteChars:
            raise StudioError("note_too_long", "Опис понад ліміт символів.")
        d = self._request("PUT", f"/photo-drafts/{draft_id}/notes/{note_id}",
                          json={"photoIds": photo_ids, "text": text})
        return NoteResult(Note.from_dict(d["note"]), d["revision"])

    def delete_note(self, draft_id: str, note_id: str) -> Draft:
        return Draft.from_dict(self._request("DELETE", f"/photo-drafts/{draft_id}/notes/{note_id}")["draft"])

    # --- проходи ШІ і відправка ----------------------------------------
    def ai_options(self, draft_id: str, *, pass_name: str = "structure", module_id: str | None = None,
                   lesson_id: str | None = None) -> AiOptions:
        """Які моделі можна обрати для проходу й скільки це коштує в балах (з 1.4.0)."""
        params = {"pass": pass_name, **({"moduleId": module_id} if module_id else {}),
                  **({"lessonId": lesson_id} if lesson_id else {})}
        return AiOptions.from_dict(self._request("GET", f"/photo-drafts/{draft_id}/ai-options", params=params))

    def structure(self, draft_id: str, *, replace: bool = False, model_id: str | None = None) -> Draft:
        body: dict[str, Any] = {**({"replace": True} if replace else {}), **({"modelId": model_id} if model_id else {})}
        return Draft.from_dict(self._request("POST", f"/photo-drafts/{draft_id}/structure", json=body or None)["draft"])

    def generate_module(self, draft_id: str, module_id: str, *, model_id: str | None = None) -> Draft:
        body = {"modelId": model_id} if model_id else None
        return Draft.from_dict(
            self._request("POST", f"/photo-drafts/{draft_id}/modules/{module_id}/generate", json=body)["draft"])

    def suggest_lesson(self, draft_id: str, lesson_id: str, *, model_id: str | None = None) -> Draft:
        """Прохід «підказати» (1.7.0): пропозиція до тексту одного уроку; `body` лишається незмінним."""
        body = {"modelId": model_id} if model_id else None
        return Draft.from_dict(
            self._request("POST", f"/photo-drafts/{draft_id}/lessons/{lesson_id}/suggest", json=body)["draft"])

    def resolve_suggestion(self, draft_id: str, lesson_id: str, *, action: str, text: str | None = None) -> Draft:
        """`accept` (з `text` — виправлений викладачем варіант) або `reject`. Обидва прибирають пропозицію."""
        body: dict[str, Any] = {"action": action}
        if text is not None:
            body["text"] = text
        return Draft.from_dict(
            self._request("POST", f"/photo-drafts/{draft_id}/lessons/{lesson_id}/suggestion", json=body)["draft"])

    def submit(self, draft_id: str) -> SubmitResult:
        d = self._request("POST", f"/photo-drafts/{draft_id}/submit")
        return SubmitResult(Draft.from_dict(d["draft"]), Target.from_dict(d["target"]))

    # --- опитування -----------------------------------------------------
    def wait_until_idle(self, draft_id: str, *, timeout: float = 600.0,
                        interval: float | None = None) -> Draft:
        """Опитує чернетку раз на pollIntervalMs, доки фото в processing або job running."""
        step = interval if interval is not None else self.poll_interval()
        deadline = time.monotonic() + timeout
        while True:
            draft = self.get_draft(draft_id)
            if not draft.busy:
                return draft
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Чернетка {draft_id} усе ще зайнята після {timeout} с")
            self._sleep(step)


def _ip_headers(client_ip: str | None) -> dict[str, str]:
    """Адреса телефона для лімітів Studio: інакше всі користувачі виглядали б однією адресою (сервісу GrabFusion)."""
    return {"X-Forwarded-For": client_ip} if client_ip else {}


def pair_with_code(base_url: str, code: str, *, timeout: float = 20.0,
                   transport: httpx.BaseTransport | None = None, client_ip: str | None = None) -> dict[str, Any]:
    """Обмін одноразового коду підключення на токен: `POST /pair` → `{token, record, user}`.

    Помилки: `invalid_code` 404, `code_expired` 410, `too_many_attempts` 429.
    """
    with httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport) as http:
        resp = http.post("/pair", json={"code": code}, headers=_ip_headers(client_ip))
        try:
            body = resp.json()
        except ValueError:
            body = None
    if resp.status_code >= 400:
        raise StudioError.from_response(resp.status_code, body)
    if not isinstance(body, dict) or not isinstance(body.get("token"), str):
        raise StudioError("server_error", "Studio повернула неочікувану відповідь на підключення.")
    return body


def request_pair_email(base_url: str, email: str, *, timeout: float = 20.0,
                       transport: httpx.BaseTransport | None = None, client_ip: str | None = None) -> dict[str, Any]:
    """Код підключення на пошту облікового запису: `POST /pair/email` → `202 {ok, message}`.

    Студія відповідає однаково, чи є такий обліковий запис (по відповіді адресу не вгадати). Помилки:
    `bad_input` 400, `too_many_attempts` 429, `mail_unavailable` 503 (SMTP на сервері не налаштовано).
    """
    with httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport) as http:
        resp = http.post("/pair/email", json={"email": email}, headers=_ip_headers(client_ip))
        try:
            body = resp.json()
        except ValueError:
            body = None
    if resp.status_code >= 400:
        raise StudioError.from_response(resp.status_code, body)
    return body if isinstance(body, dict) else {"ok": True}
