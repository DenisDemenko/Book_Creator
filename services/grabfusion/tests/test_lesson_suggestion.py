"""Прохід «підказати» до тексту уроку (контракт 1.7.0) — бік GrabFusion.

ЩО САМЕ ТУТ ВАЖИТЬ. Пропозиція ШІ навмисно лежить ПОРУЧ із текстом уроку, а не в
ньому: доки викладач не натиснув «Прийняти», поле лишається тим, що було. Якщо це
зламати, «Відхилити» означатиме відновлення затертого — а відновлювати нема з чого.
Тому перевіряємо не «запит пройшов», а саме межі:

 1. запуск кладе пропозицію й НЕ чіпає `body`;
 2. «прийняти» як є → текст від ШІ (мітка `aiFields`), «прийняти» з правкою → текст
    ВИКЛАДАЧІВ (без мітки), щоб наступний прохід «Написати» його не перезаписав;
 3. «відхилити» лишає текст уроку недоторканим;
 4. повторне рішення по тій самій пропозиції — 409, а не тихе ніщо;
 5. маршрути самого сервісу (`/api/drafts/.../suggest`) доносять тіло й помилки.
"""
from __future__ import annotations

import base64

import pytest
from fastapi.testclient import TestClient

from grabfusion import contract
from grabfusion.mock_server import PREFIX, TINY_JPEG, create_app

IMG = "data:image/jpeg;base64," + base64.b64encode(TINY_JPEG).decode()
H = {"Authorization": "Bearer nst_t"}


@pytest.fixture()
def api():
    c = TestClient(create_app(stateful=True))

    class A:
        def call(self, method, path, body=None, expect=None, schema=None):
            r = c.request(method, PREFIX + path, json=body, headers=H)
            if expect is not None:
                assert r.status_code == expect, r.text
            data = r.json()
            if r.status_code < 400 and schema:
                contract.validate(schema, data)
            if r.status_code >= 400:
                contract.validate("Error", data)
            return data

        def draft(self, did):
            return self.call("GET", f"/photo-drafts/{did}", expect=200, schema="DraftResponse")["draft"]

    return A()


def _structured(api, kind="course", photos=3):
    """Чернетка, доведена до «розкладено»: саме там зʼявляються уроки."""
    d = api.call("POST", "/photo-drafts", {"kind": kind, "title": "Ложка"}, expect=201,
                 schema="DraftResponse")["draft"]
    did = d["draftId"]
    for i in range(photos):
        api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": f"c{i}", "image": IMG},
                 expect=202, schema="PhotoResponse")
    api.draft(did)
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202, schema="DraftResponse")
    for _ in range(5):
        d = api.draft(did)
        if not d["job"]:
            break
    assert d["structure"], "структура мала зʼявитись"
    return did, d


def _lesson(d, lesson_id):
    for m in d["structure"]["modules"]:
        for les in m["lessons"]:
            if les["lessonId"] == lesson_id:
                return m, les
    raise AssertionError(f"уроку {lesson_id} немає")


def _run_suggest(api, did, lesson_id):
    r = api.call("POST", f"/photo-drafts/{did}/lessons/{lesson_id}/suggest", expect=202,
                 schema="DraftResponse")
    assert r["draft"]["job"]["kind"] == "suggest"
    assert r["draft"]["job"]["lessonId"] == lesson_id
    for _ in range(5):
        d = api.draft(did)
        if not d["job"]:
            break
    return d


def test_suggestion_lands_beside_the_body_and_does_not_touch_it(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    before = _lesson(d, lid)[1]["body"]
    d = _run_suggest(api, did, lid)
    les = _lesson(d, lid)[1]
    assert les["suggestion"]["text"]
    assert les["body"] == before, "текст уроку не можна чіпати до рішення викладача"
    limit = contract.default_limits()["maxLessonSuggestionChars"]
    assert contract.count_note_chars(les["suggestion"]["text"]) <= limit


def test_accept_as_is_marks_the_text_as_written_by_ai(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    d = _run_suggest(api, did, lid)
    proposed = _lesson(d, lid)[1]["suggestion"]["text"]
    out = api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion", {"action": "accept"},
                   expect=200, schema="DraftResponse")["draft"]
    les = _lesson(out, lid)[1]
    assert les["body"] == proposed
    assert "body" in les["aiFields"]
    assert les["suggestion"] is None


def test_accept_with_edits_makes_the_text_the_teachers_own(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    _run_suggest(api, did, lid)
    out = api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion",
                   {"action": "accept", "text": "Мій текст."}, expect=200, schema="DraftResponse")["draft"]
    les = _lesson(out, lid)[1]
    assert les["body"] == "Мій текст."
    # Без цього наступний прохід «Написати» затер би правку викладача.
    assert "body" not in les["aiFields"]


def test_reject_keeps_the_lesson_text(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    before = _lesson(d, lid)[1]["body"]
    _run_suggest(api, did, lid)
    out = api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion", {"action": "reject"},
                   expect=200, schema="DraftResponse")["draft"]
    les = _lesson(out, lid)[1]
    assert les["suggestion"] is None and les["body"] == before
    second = api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion", {"action": "reject"}, expect=409)
    assert second["kind"] == "wrong_status"


def test_bad_requests(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    assert api.call("POST", f"/photo-drafts/{did}/lessons/l-404/suggest", expect=404)["kind"] == "lesson_not_found"
    _run_suggest(api, did, lid)
    assert api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion",
                    {"action": "maybe"}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", f"/photo-drafts/{did}/lessons/{lid}/suggestion",
                    {"action": "reject", "text": "щось"}, expect=400)["kind"] == "bad_input"


def test_ai_options_for_the_lesson_pass(api):
    did, d = _structured(api)
    lid = d["structure"]["modules"][0]["lessons"][0]["lessonId"]
    mid = d["structure"]["modules"][0]["moduleId"]
    r = api.call("GET", f"/photo-drafts/{did}/ai-options?pass=lesson&lessonId={lid}", expect=200,
                 schema="AiOptionsResponse")
    assert r["pass"] == "lesson" and r["lessonId"] == lid and r["moduleId"] == mid
    assert api.call("GET", f"/photo-drafts/{did}/ai-options?pass=lesson&lessonId=l-404",
                    expect=404)["kind"] == "lesson_not_found"


def test_client_methods_round_trip(client):
    """Клієнт сервісу: ті самі два кроки через StudioClient (мок без стану не веде чернетку)."""
    draft = client.suggest_lesson("pd_7f3a9c2e41b0", "l-2")
    assert draft.job is not None and draft.job.kind == "suggest"
    assert draft.job.lessonId == "l-2"
    out = client.resolve_suggestion("pd_7f3a9c2e41b0", "l-2", action="accept")
    les = next(l for m in out.structure.modules for l in m.lessons if l.lessonId == "l-2")
    assert les.body and les.suggestion is None


def test_service_routes_pass_the_body_through(mock_url):
    """Маршрути самого GrabFusion (`/api/drafts/...`) — тонкий проксі, але тіло мусить доїхати."""
    from grabfusion.app import create_app as create_service
    from grabfusion.sessions import SessionStore
    from grabfusion.settings import Settings

    c = TestClient(create_service(Settings(studio_url=mock_url + PREFIX), store=SessionStore(":memory:")))
    assert c.post("/api/pair", json={"code": "GF-OK"}).status_code == 200
    r = c.post("/api/drafts/pd_7f3a9c2e41b0/lessons/l-2/suggest", json={"modelId": "openai:gpt-4o"})
    assert r.status_code == 202, r.text
    assert r.json()["draft"]["job"]["kind"] == "suggest"
    r2 = c.post("/api/drafts/pd_7f3a9c2e41b0/lessons/l-2/suggestion", json={"action": "reject"})
    assert r2.status_code == 200, r2.text
