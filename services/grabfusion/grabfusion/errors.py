from __future__ import annotations

from typing import Any

# kind -> HTTP (розділ 5 контракту)
KIND_STATUS: dict[str, int] = {
    "unauthenticated": 401,
    "invalid_token": 401,
    "scope_denied": 403,
    "forbidden": 403,
    "bad_input": 400,
    "bad_image": 400,
    "image_too_large": 413,
    "note_too_long": 400,
    "too_many_photos": 409,
    "too_many_drafts": 409,
    "rate_limited": 429,
    "quota_exceeded": 402,
    "ai_budget_exceeded": 402,
    "draft_not_found": 404,
    "photo_not_found": 404,
    "note_not_found": 404,
    "module_not_found": 404,
    "book_not_found": 404,
    "wrong_status": 409,
    "job_running": 409,
    "revision_conflict": 409,
    "submit_blocked": 400,
    "server_error": 500,
}


# Помилки обміну коду підключення (`POST /pair`) — поза схемою photo-drafts, але в тому ж форматі {error, kind}
PAIR_KIND_STATUS: dict[str, int] = {
    "invalid_code": 404,
    "code_expired": 410,
    "too_many_attempts": 429,
}


class StudioError(Exception):
    """Помилка API Studio. Розгалужуватись слід лише за `kind`; `message` — текст для викладача."""

    def __init__(self, kind: str, message: str, status: int | None = None,
                 blockers: list[dict[str, Any]] | None = None):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.status = status if status is not None else {**KIND_STATUS, **PAIR_KIND_STATUS}.get(kind, 500)
        self.blockers = blockers or []

    @classmethod
    def from_response(cls, status: int, body: Any) -> "StudioError":
        if isinstance(body, dict) and isinstance(body.get("kind"), str):
            return cls(body["kind"], str(body.get("error", "")), status, body.get("blockers"))
        # Проксі хостингу (502/504) або не-JSON відповідь
        return cls("server_error", f"Studio відповіла {status} без розбору.", status)

    @property
    def retryable(self) -> bool:
        return self.kind in {"server_error", "rate_limited"} or self.status >= 500

    def __repr__(self) -> str:  # pragma: no cover
        return f"StudioError({self.kind!r}, status={self.status}, message={self.message!r})"
