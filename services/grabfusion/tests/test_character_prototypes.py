"""Герой з фото (запис #597): GrabFusion лише передає фото й поля Студії.

Студію тут підмінено MockTransport, щоб бачити, ЩО саме сервіс їй надсилає:
стиснене JPEG-фото або посилання на фото з медіатеки книги, але не обидва;
ідентифікатори книги/фото/завдання перевіряються до запиту в Студію.
"""
from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from grabfusion.app import create_app
from grabfusion.sessions import SessionStore
from grabfusion.settings import Settings

JOB = "0f8fad5b-d9cb-469f-a165-70867728950e"
BASE = "/api/external/v1/photo-drafts/character-prototypes"


def jpeg(size=(1600, 1200)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, (200, 120, 60)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture()
def studio():
    """Підставна Студія: записує запити й відповідає як справжні маршрути."""
    calls: list[tuple[str, str, dict | None]] = []

    def handler(r: httpx.Request) -> httpx.Response:
        path = r.url.path
        body = json.loads(r.content) if r.content else None
        if path.endswith("/pair"):
            return httpx.Response(201, json={"token": "nst_t", "record": {}, "user": {"name": "Автор"}})
        if path.endswith("/photo-drafts/limits"):
            return httpx.Response(200, json={"limits": {"maxImageBytes": 2_000_000, "recommendedMaxSidePx": 1024,
                                                        "maxNoteChars": 500, "maxPhotosPerDraft": 30}})
        calls.append((r.method, path, body))
        if path == BASE + "/books":
            return httpx.Response(200, json={"books": [{"id": "b1", "title": "Нічні спогади"}]})
        if path == BASE + "/books/b1/photos":
            return httpx.Response(200, json={"photos": [{"id": "md-1", "title": "Сусід"}]})
        if path == BASE + "/books/b1/photos/md-1":
            img = base64.b64encode(jpeg((2000, 1500))).decode()
            return httpx.Response(200, json={"image": "data:image/jpeg;base64," + img})
        if path == BASE + "/books/b1/describe":
            return httpx.Response(202, json={"jobId": JOB})
        if path == BASE + "/jobs/" + JOB:
            return httpx.Response(200, json={"status": "ready", "draft": {"visible": "В", "fiction": "Х"}})
        if path == BASE + "/books/b1/save":
            return httpx.Response(201, json={"characterId": "char-gf-" + JOB, "studioUrl": "/projects/b1/editor"})
        return httpx.Response(404, json={"kind": "not_found", "error": "?"})

    app = create_app(Settings(studio_url="http://studio/api/external/v1"), store=SessionStore(":memory:"),
                     studio_transport=httpx.MockTransport(handler))
    client = TestClient(app)
    assert client.post("/api/pair", json={"code": "GF-OK"}).status_code == 200
    return client, calls


def test_requires_pairing():
    app = create_app(Settings(studio_url="http://studio/api"), store=SessionStore(":memory:"),
                     studio_transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    r = TestClient(app).get("/api/character-prototypes/books")
    assert r.status_code == 401


def test_books_and_library_are_proxied(studio):
    c, _ = studio
    assert c.get("/api/character-prototypes/books").json()["books"][0]["id"] == "b1"
    assert c.get("/api/character-prototypes/books/b1/photos").json()["photos"][0]["id"] == "md-1"


def test_library_thumbnail_is_shrunk_jpeg(studio):
    c, _ = studio
    r = c.get("/api/character-prototypes/books/b1/photos/md-1")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert "no-store" in r.headers["cache-control"]
    assert max(Image.open(BytesIO(r.content)).size) <= 960


def test_camera_photo_is_compressed_and_forwarded(studio):
    c, calls = studio
    r = c.post("/api/character-prototypes/books/b1/describe", data={"note": "кав'ярня", "language": "uk"},
               files={"file": ("cam.jpg", jpeg((4000, 3000)), "image/jpeg")})
    assert r.status_code == 202 and r.json()["jobId"] == JOB
    method, path, body = calls[-1]
    assert (method, path) == ("POST", BASE + "/books/b1/describe")
    assert "assetId" not in body and body["note"] == "кав'ярня" and body["language"] == "uk"
    raw = base64.b64decode(body["image"].split(",", 1)[1])
    assert max(Image.open(BytesIO(raw)).size) < 4000  # стиснуто до рекомендованої сторони ліміту


def test_library_photo_is_sent_by_id_only(studio):
    c, calls = studio
    assert c.post("/api/character-prototypes/books/b1/describe", data={"assetId": "md-1"}).status_code == 202
    body = calls[-1][2]
    assert body["assetId"] == "md-1" and "image" not in body


def test_photo_and_asset_together_are_rejected(studio):
    c, calls = studio
    before = len(calls)
    r = c.post("/api/character-prototypes/books/b1/describe", data={"assetId": "md-1"},
               files={"file": ("cam.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 400 and r.json()["kind"] == "bad_image"
    assert c.post("/api/character-prototypes/books/b1/describe").json()["kind"] == "bad_image"
    assert len(calls) == before


@pytest.mark.parametrize("url", [
    "/api/character-prototypes/books/..%2F..%2Fadmin/photos",
    "/api/character-prototypes/books/b%201/photos",
    "/api/character-prototypes/books/b1/photos/..%2Fx",
    "/api/character-prototypes/jobs/not-a-job",
])
def test_bad_ids_never_reach_studio(studio, url):
    c, calls = studio
    before = len(calls)
    assert c.get(url).status_code in (400, 404)
    assert len(calls) == before


def test_job_and_save_are_forwarded_with_author_text(studio):
    c, calls = studio
    assert c.get("/api/character-prototypes/jobs/" + JOB).json()["draft"]["fiction"] == "Х"
    r = c.post("/api/character-prototypes/books/b1/save",
               data={"jobId": JOB, "name": "Марта", "visible": "Сива коса", "fiction": "Боїться тиші", "assetId": "md-1"})
    assert r.status_code == 200 and r.json()["characterId"] == "char-gf-" + JOB
    body = calls[-1][2]
    assert body == {"assetId": "md-1", "jobId": JOB, "name": "Марта", "visible": "Сива коса", "fiction": "Боїться тиші"}
