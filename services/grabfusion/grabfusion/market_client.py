"""Публічний каталог маркетплейсу — лише читання, без ключа мосту (контракт §6).

Маршрути шаблонні: у Studio публічних маршрутів каталогу курсів поки немає, а правило B → A —
просити коментарем у документі плану. Коли A опублікує маршрут, змінюється лише шаблон шляху.
"""
from __future__ import annotations

from typing import Any

import httpx

from .errors import StudioError


class MarketClient:
    COURSE_PATH = "/api/public/courses/{slug}"  # припущення, узгодити з A

    def __init__(self, base_url: str, *, timeout: float = 20.0,
                 transport: httpx.BaseTransport | None = None):
        # Свідомо без Authorization: це публічні маршрути.
        self._http = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport)

    def close(self) -> None:
        self._http.close()

    def get_json(self, path: str) -> Any:
        resp = self._http.get(path)
        try:
            body = resp.json()
        except ValueError:
            body = None
        if resp.status_code >= 400:
            raise StudioError.from_response(resp.status_code, body)
        return body

    def get_course(self, slug: str) -> dict[str, Any]:
        return self.get_json(self.COURSE_PATH.format(slug=slug))
