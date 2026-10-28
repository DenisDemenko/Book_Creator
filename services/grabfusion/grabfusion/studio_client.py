"""Клієнт API Studio `/api/external/v1/photo-drafts*` (контракт 1.3.0).

Синхронний (httpx). Токен тримає сервер GrabFusion. Розгалужуватись слід лише за `StudioError.kind`.
"""
from __future__ import annotations

import time
from typing import Any, Callable

import httpx

from .errors import StudioError
from .models import (Draft, DraftSummary, Limits, Note, NoteResult, Photo, PhotoResult,
                     SubmitResult, Target)

_UNSET: Any = object()


class StudioClient:
    def __init__(self, base_url: str, token: str, *, timeout: float = 30.0,
                 transport: httpx.BaseTransport | None = None,
                 retries: int = 3, backoff: float = 0.5,
                 sleep: Callable[[float], None] = time.sleep):
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(
            base_url=self.base_url, timeout=timeout, transport=transport,
            headers={"Authorization": f"Bearer {token}"} if token else {},
        )
        self._retries = retries
        self._backoff = backoff
        self._sleep = sleep
        self._limits: Limits | None = None

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "StudioClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # --- низький рівень -------------------------------------------------
    def _request(self, method: str, path: str, *, json: Any = None) -> Any:
        resp = self._http.request(method, path, json=json)
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
        """fields: title, craft, audience, level, bookId, newBookTitle, instructionMode, modelCode."""
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
    def structure(self, draft_id: str, *, replace: bool = False) -> Draft:
        body = {"replace": True} if replace else None
        return Draft.from_dict(self._request("POST", f"/photo-drafts/{draft_id}/structure", json=body)["draft"])

    def generate_module(self, draft_id: str, module_id: str) -> Draft:
        return Draft.from_dict(
            self._request("POST", f"/photo-drafts/{draft_id}/modules/{module_id}/generate")["draft"])

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
