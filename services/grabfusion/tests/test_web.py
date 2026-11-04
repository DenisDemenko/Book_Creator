from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from grabfusion import contract
from grabfusion.app import create_app
from grabfusion.mock_server import PREFIX
from grabfusion.sessions import SessionStore
from grabfusion.settings import Settings


def jpeg(size=(300, 200)) -> bytes:
    buf = BytesIO()
    Image.new("RGB", size, (10, 120, 60)).save(buf, "JPEG")
    return buf.getvalue()


@pytest.fixture()
def web(mock_url):
    app = create_app(Settings(studio_url=mock_url + PREFIX), store=SessionStore(":memory:"))
    c = TestClient(app)
    yield c


@pytest.fixture()
def paired(web):
    r = web.post("/api/pair", json={"code": "GF-OK"})
    assert r.status_code == 200
    return web


def test_unpaired_session_and_routes_are_401(web):
    assert web.get("/api/session").json()["paired"] is False
    r = web.get("/api/drafts")
    assert r.status_code == 401 and r.json()["kind"] == "unauthenticated"


def test_pair_sets_httponly_cookie_and_never_returns_token(web):
    r = web.post("/api/pair", json={"code": "GF-OK"})
    assert r.status_code == 200 and "nst_mock_token" not in r.text
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "nst_" not in cookie
    s = web.get("/api/session").json()
    assert s["paired"] is True and s["user"]["name"] == "Тестова Викладачка"
    assert "nst_mock_token" not in web.get("/api/config").text


@pytest.mark.parametrize("code,kind,status", [("BAD", "invalid_code", 404), ("EXPIRED", "code_expired", 410),
                                              ("LOCKED", "too_many_attempts", 429), ("", "bad_input", 400)])
def test_pair_errors(web, code, kind, status):
    r = web.post("/api/pair", json={"code": code})
    assert (r.status_code, r.json()["kind"]) == (status, kind)
    assert web.get("/api/session").json()["paired"] is False


def test_logout(paired):
    paired.post("/api/logout")
    assert paired.get("/api/session").json()["paired"] is False


def test_limits_drafts_roundtrip(paired):
    assert paired.get("/api/limits").json()["limits"]["maxNoteChars"] == 500
    assert paired.get("/api/drafts").json()["drafts"]
    d = paired.post("/api/drafts", json={"kind": "course", "title": "Ложка"})
    assert d.status_code == 201 and d.json()["draft"]["draftId"]
    assert paired.get("/api/drafts/pd_x").json()["draft"]["photos"]
    assert paired.patch("/api/drafts/pd_x", json={"ifRevision": 1, "photoOrder": []}).status_code == 200
    assert paired.delete("/api/drafts/pd_x").status_code == 200


def test_unknown_fields_pass_through_proxy(mock_url):
    def handler(request: httpx.Request):
        d = contract.load_fixture("get-draft-collecting")
        d["draft"]["futureField"] = {"x": 1}
        return httpx.Response(200, json=d)
    app = create_app(Settings(studio_url="http://studio/api"), store=SessionStore(":memory:"),
                     studio_transport=httpx.MockTransport(lambda r: httpx.Response(
                         201, json={"token": "nst_t", "record": {}, "user": {"name": "A"}}) if r.url.path.endswith("/pair") else handler(r)))
    c = TestClient(app)
    c.post("/api/pair", json={"code": "x"})
    assert c.get("/api/drafts/pd_1").json()["draft"]["futureField"] == {"x": 1}


def test_upload_multipart_is_compressed_and_forwarded(paired):
    big = jpeg((4000, 3000))
    r = paired.post("/api/drafts/pd_up/photos", data={"clientId": "c-1", "note": "Лляна олія"},
                    files={"file": ("p.jpg", big, "image/jpeg")})
    assert r.status_code == 202
    body = r.json()
    assert body["photo"]["photoId"] and body["duplicate"] is False
    again = paired.post("/api/drafts/pd_up/photos", data={"clientId": "c-1"}, files={"file": ("p.jpg", big, "image/jpeg")})
    assert again.json()["duplicate"] is True


def test_upload_forwards_stripped_jpeg_under_max_side():
    seen = {}

    def handler(request: httpx.Request):
        if request.url.path.endswith("/pair"):
            return httpx.Response(201, json={"token": "nst_t", "record": {}, "user": {"name": "A"}})
        if request.url.path.endswith("/photos"):
            seen["body"] = json.loads(request.content)
            seen["auth"] = request.headers["authorization"]
            return httpx.Response(202, json=contract.load_fixture("add-photo"))
        return httpx.Response(404, json={"error": "x", "kind": "draft_not_found"})

    app = create_app(Settings(studio_url="http://studio/api"), store=SessionStore(":memory:"),
                     studio_transport=httpx.MockTransport(handler))
    c = TestClient(app)
    c.post("/api/pair", json={"code": "x"})
    c.post("/api/drafts/pd_1/photos", data={"clientId": "c-9", "note": "н", "takenAt": "2026-10-28T10:00:00.000Z"},
           files={"file": ("p.jpg", jpeg((5000, 1000)), "image/jpeg")})
    b = seen["body"]
    assert seen["auth"] == "Bearer nst_t"
    assert b["clientId"] == "c-9" and b["note"] == "н" and b["takenAt"].startswith("2026-10-28")
    assert b["image"].startswith("data:image/jpeg;base64,")
    im = Image.open(BytesIO(base64.b64decode(b["image"].split(",", 1)[1])))
    assert max(im.size) == 2048 and not im.getexif()


def test_upload_rejects_long_note_and_non_image(paired):
    r = paired.post("/api/drafts/pd_up/photos", data={"clientId": "c-2", "note": "а" * 501},
                    files={"file": ("p.jpg", jpeg(), "image/jpeg")})
    assert r.status_code == 400 and r.json()["kind"] == "note_too_long"
    ok = paired.post("/api/drafts/pd_up/photos", data={"clientId": "c-3", "note": "а" * 500},
                     files={"file": ("p.jpg", jpeg(), "image/jpeg")})
    assert ok.status_code == 202
    bad = paired.post("/api/drafts/pd_up/photos", data={"clientId": "c-4"}, files={"file": ("p.txt", b"hi", "text/plain")})
    assert bad.status_code == 400 and bad.json()["kind"] == "bad_image"


def test_photo_image_proxy_and_notes_and_retry_delete(paired):
    r = paired.get("/api/drafts/pd_x/photos/ph_01a1/image")
    assert r.status_code == 200 and r.content[:2] == b"\xff\xd8" and r.headers["content-type"] == "image/jpeg"
    assert paired.put("/api/drafts/pd_x/notes/n-1", json={"photoIds": ["ph_01a1"], "text": "ок"}).status_code == 200
    assert paired.put("/api/drafts/pd_x/notes/n-1", json={"photoIds": ["ph_01a1"], "text": "я" * 501}).json()["kind"] == "note_too_long"
    assert paired.delete("/api/drafts/pd_x/notes/n-1").status_code == 200
    assert paired.post("/api/drafts/pd_x/photos/ph_01a1/retry").status_code == 202
    assert paired.delete("/api/drafts/pd_x/photos/ph_01a1").status_code == 200


def test_photo_image_is_revalidated_not_blindly_cached(paired):
    """id можуть повторитись після перезапуску моку/Studio → кеш на годину показував би чужу картинку."""
    r = paired.get("/api/drafts/pd_x/photos/ph_01a1/image")
    assert "max-age" not in r.headers["cache-control"] and "no-cache" in r.headers["cache-control"]
    etag = r.headers["etag"]
    again = paired.get("/api/drafts/pd_x/photos/ph_01a1/image", headers={"If-None-Match": etag})
    assert again.status_code == 304 and again.content == b""
    assert paired.get("/api/drafts/pd_x/photos/ph_01a1/image", headers={"If-None-Match": '"other"'}).status_code == 200


def test_invalid_token_from_studio_closes_session(mock_url):
    app = create_app(Settings(studio_url=mock_url + PREFIX), store=SessionStore(":memory:"),
                     studio_transport=httpx.MockTransport(lambda r: httpx.Response(
                         201, json={"token": "nst_invalid", "record": {}, "user": {"name": "A"}}) if r.url.path.endswith("/pair")
                         else httpx.Response(401, json={"error": "Токен відкликано", "kind": "invalid_token"})))
    c = TestClient(app)
    c.post("/api/pair", json={"code": "x"})
    r = c.get("/api/drafts")
    assert r.status_code == 401 and r.json()["kind"] == "invalid_token"
    assert c.get("/api/session").json()["paired"] is False


def test_studio_down_gives_502_json(mock_url):
    def boom(request):
        if request.url.path.endswith("/pair"):
            return httpx.Response(201, json={"token": "nst_t", "record": {}, "user": {"name": "A"}})
        raise httpx.ConnectError("down")
    c = TestClient(create_app(Settings(studio_url="http://studio/api"), store=SessionStore(":memory:"),
                              studio_transport=httpx.MockTransport(boom)))
    c.post("/api/pair", json={"code": "x"})
    r = c.get("/api/drafts")
    assert r.status_code == 502 and r.json()["kind"] == "server_error"


def test_index_and_static_served(web):
    assert "GrabFusion" in web.get("/").text
    assert web.get("/static/app.js").status_code == 200
    assert web.get("/healthz").json()["ok"] is True


def test_session_store_persists_in_file(tmp_path):
    p = tmp_path / "s.sqlite3"
    s1 = SessionStore(p)
    sess = s1.create("nst_x", "Ім'я")
    s1.close()
    assert SessionStore(p).get(sess.sid).token == "nst_x"


def test_stage3_proxy_structure_generate_submit_against_sim(sim_url):
    app = create_app(Settings(studio_url=sim_url + PREFIX), store=SessionStore(":memory:"))
    c = TestClient(app)
    c.post("/api/pair", json={"code": "ok"})
    d = c.post("/api/drafts", json={"kind": "course", "title": "Т"}).json()["draft"]
    did = d["draftId"]
    c.post(f"/api/drafts/{did}/photos", data={"clientId": "a"}, files={"file": ("p.jpg", jpeg(), "image/jpeg")})
    c.get(f"/api/drafts/{did}")  # опит: кадр описано
    r = c.post(f"/api/drafts/{did}/structure")  # без тіла
    assert r.status_code == 202 and r.json()["draft"]["job"]["status"] == "running"
    assert c.post(f"/api/drafts/{did}/structure", json={"replace": True}).json()["kind"] == "job_running"
    for _ in range(4):
        d = c.get(f"/api/drafts/{did}").json()["draft"]
    assert d["status"] == "structured"
    blocked = c.post(f"/api/drafts/{did}/submit")
    assert blocked.status_code == 400 and blocked.json()["kind"] == "submit_blocked"
    assert any(b["kind"] == "module_not_written" for b in blocked.json()["blockers"])
    mid = d["structure"]["modules"][0]["moduleId"]
    assert c.post(f"/api/drafts/{did}/modules/{mid}/generate").status_code == 202
    assert c.post(f"/api/drafts/{did}/modules/zzz/generate").json()["kind"] in {"job_running", "module_not_found"}


def test_page_text_proxy_against_sim(sim_url):
    c = TestClient(create_app(Settings(studio_url=sim_url + PREFIX), store=SessionStore(":memory:")))
    c.post("/api/pair", json={"code": "ok"})
    d = c.post("/api/drafts", json={"kind": "manuscript", "title": "Гл", "newBookTitle": "К"}).json()["draft"]
    did = d["draftId"]
    p = c.post(f"/api/drafts/{did}/photos", data={"clientId": "a", "note": "Іван"},
               files={"file": ("p.jpg", jpeg(), "image/jpeg")}).json()["photo"]
    c.get(f"/api/drafts/{did}")
    r = c.put(f"/api/drafts/{did}/photos/{p['photoId']}/text", json={"text": "Виправлено"})
    assert r.status_code == 200 and r.json()["photo"]["textEdited"] is True
    long_ = c.put(f"/api/drafts/{did}/photos/{p['photoId']}/text", json={"text": "я" * 20001})
    assert long_.status_code == 400 and long_.json()["kind"] == "bad_input"
    assert c.put(f"/api/drafts/{did}/photos/{p['photoId']}/text", content=b"nope").json()["kind"] == "bad_input"
