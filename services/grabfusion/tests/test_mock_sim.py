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
        client = c

        def call(self, method, path, body=None, expect=None, schema=None):
            r = c.request(method, PREFIX + path, json=body, headers=H)
            if expect is not None:
                assert r.status_code == expect, r.text
            data = r.json()
            if r.status_code < 400 and schema:
                contract.validate(schema, data)
            if r.status_code >= 400:
                contract.validate("SubmitBlockedError" if data["kind"] == "submit_blocked" else "Error", data)
            return data

        def draft(self, did):
            return self.call("GET", f"/photo-drafts/{did}", expect=200, schema="DraftResponse")["draft"]

    return A()


def _new(api, kind="course", photos=3, **fields):
    d = api.call("POST", "/photo-drafts", {"kind": kind, **fields}, expect=201, schema="DraftResponse")["draft"]
    for i in range(photos):
        api.call("POST", f"/photo-drafts/{d['draftId']}/photos", {"clientId": f"c{i}", "image": IMG},
                 expect=202, schema="PhotoResponse")
    api.draft(d["draftId"])  # опит: кадри стають described
    return d["draftId"]


def test_full_happy_path_validates_against_schema(api):
    did = _new(api, title="Ложка")
    r = api.call("POST", f"/photo-drafts/{did}/structure", expect=202, schema="DraftResponse")
    assert r["draft"]["job"]["status"] == "running"
    assert api.call("POST", f"/photo-drafts/{did}/structure", expect=409)["kind"] == "job_running"
    for _ in range(5):
        d = api.draft(did)
        if not d["job"]:
            break
    assert d["status"] == "structured" and d["structure"]["modules"]
    placed = [p for m in d["structure"]["modules"] for les in m["lessons"] for p in les["photoIds"]]
    assert sorted(placed) == sorted(p["photoId"] for p in d["photos"])  # кожен кадр — рівно в одному уроці
    # блокери: нічого не написано + відкрите припущення
    b = api.call("POST", f"/photo-drafts/{did}/submit", expect=400)
    kinds = {x["kind"] for x in b["blockers"]}
    assert {"module_not_written", "open_assumptions"} <= kinds
    for m in d["structure"]["modules"]:
        api.call("POST", f"/photo-drafts/{did}/modules/{m['moduleId']}/generate", expect=202, schema="DraftResponse")
        for _ in range(4):
            d = api.draft(did)
            if not d["job"]:
                break
    assert d["status"] == "written"
    assert {x["kind"] for x in api.call("POST", f"/photo-drafts/{did}/submit", expect=400)["blockers"]} == {"open_assumptions"}
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "assumptions": [
        {"assumptionId": a["assumptionId"], "status": "confirmed"} for a in d["assumptions"]]},
        expect=200, schema="DraftResponse")["draft"]
    res = api.call("POST", f"/photo-drafts/{did}/submit", expect=201, schema="SubmitResponse")
    assert res["target"]["kind"] == "course" and res["draft"]["status"] == "submitted"
    assert api.call("POST", f"/photo-drafts/{did}/submit", expect=409)["kind"] == "wrong_status"


def test_instruction_submit_gives_express_target(api):
    did = _new(api, "instruction", instructionMode="assembly", title="Полиця")
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    d = api.draft(did)
    d = api.draft(did)
    d = api.draft(did)
    api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "assumptions": [
        {"assumptionId": "as-1", "status": "rejected"}]}, expect=200)
    for m in d["structure"]["modules"]:
        api.call("POST", f"/photo-drafts/{did}/modules/{m['moduleId']}/generate", expect=202)
        api.draft(did); api.draft(did)
    res = api.call("POST", f"/photo-drafts/{did}/submit", expect=201, schema="SubmitResponse")
    assert res["target"]["kind"] == "express"


def test_structure_preconditions(api):
    did = _new(api, photos=0)
    assert api.call("POST", f"/photo-drafts/{did}/structure", expect=409)["kind"] == "wrong_status"
    assert api.call("POST", f"/photo-drafts/{did}/modules/m-1/generate", expect=409)["kind"] == "wrong_status"
    did = _new(api)
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    api.draft(did); api.draft(did); api.draft(did)
    assert api.call("POST", f"/photo-drafts/{did}/structure", expect=409)["kind"] == "wrong_status"
    api.call("POST", f"/photo-drafts/{did}/structure", {"replace": True}, expect=202)
    assert api.call("POST", f"/photo-drafts/{did}/modules/zzz/generate", expect=409)["kind"] == "job_running"


def test_revision_conflict_and_lesson_edit_clears_ai_field(api):
    did = _new(api)
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    api.draft(did); api.draft(did)
    d = api.draft(did)
    lesson = d["structure"]["modules"][0]["lessons"][0]
    assert "title" in lesson["aiFields"]
    assert api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"] - 1, "title": "x"},
                    expect=409)["kind"] == "revision_conflict"
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "lessons": [
        {"lessonId": lesson["lessonId"], "title": "Моя назва"}]}, expect=200, schema="DraftResponse")["draft"]
    les = d["structure"]["modules"][0]["lessons"][0]
    assert les["title"] == "Моя назва" and "title" not in les["aiFields"]


def test_new_photo_after_structure_returns_to_collecting_and_notes_photo_order(api):
    did = _new(api)
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    api.draft(did); api.draft(did); api.draft(did)
    api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "late", "image": IMG, "note": "підказка"}, expect=202)
    d = api.draft(did)
    assert d["status"] == "collecting" and d["structure"]  # стара структура лишається до «розкласти заново»
    assert {x["kind"] for x in api.call("POST", f"/photo-drafts/{did}/submit", expect=400)["blockers"]} >= {"no_structure"}
    assert any(n["text"] == "підказка" for n in d["notes"])
    ids = [p["photoId"] for p in d["photos"]]
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "photoOrder": ids[::-1]},
                 expect=200, schema="DraftResponse")["draft"]
    assert [p["photoId"] for p in sorted(d["photos"], key=lambda p: p["order"])] == ids[::-1]


def test_add_photo_idempotent_by_client_id(api):
    did = _new(api, photos=0)
    a = api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "same", "image": IMG}, expect=202)
    b = api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "same", "image": IMG}, expect=202)
    assert a["photo"]["photoId"] == b["photo"]["photoId"] and b["duplicate"] is True
    assert len(api.draft(did)["photos"]) == 1


def test_unknown_draft_and_list_and_discard(api):
    assert api.call("GET", "/photo-drafts/nope", expect=404)["kind"] == "draft_not_found"
    did = _new(api)
    assert api.call("GET", "/photo-drafts", expect=200, schema="DraftListResponse")["drafts"][0]["draftId"] == did
    api.call("DELETE", f"/photo-drafts/{did}", expect=200)
    assert api.call("GET", "/photo-drafts", expect=200)["drafts"] == []


def test_instruction_fields_only_for_instruction_and_valid_mode(api):
    assert api.call("POST", "/photo-drafts", {"kind": "course", "instructionMode": "assembly"}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", "/photo-drafts", {"kind": "instruction", "instructionMode": "zzz"}, expect=400)["kind"] == "bad_input"
    d = api.call("POST", "/photo-drafts", {"kind": "instruction", "modelCode": "TB-100"}, expect=201,
                 schema="DraftResponse")["draft"]
    assert d["instructionMode"] == "assembly" and d["modelCode"] == "TB-100"
    d = api.call("PATCH", f"/photo-drafts/{d['draftId']}", {"ifRevision": d["revision"], "instructionMode": "operation",
                                                              "modelCode": "TB-200"}, expect=200, schema="DraftResponse")["draft"]
    assert (d["instructionMode"], d["modelCode"]) == ("operation", "TB-200")
    c = api.call("POST", "/photo-drafts", {"kind": "course"}, expect=201)["draft"]
    assert api.call("PATCH", f"/photo-drafts/{c['draftId']}", {"ifRevision": c["revision"], "modelCode": "x"},
                    expect=400)["kind"] == "bad_input"


def test_structure_replace_moves_frame_and_keeps_untouched_ai_fields(api):
    did = _new(api, "instruction", photos=3, title="Полиця")
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    api.draft(did); api.draft(did)
    d = api.draft(did)
    lessons = [les for m in d["structure"]["modules"] for les in m["lessons"]]
    src = next(les for les in lessons if len(les["photoIds"]) >= 1)
    dst = next(les for les in lessons if les["lessonId"] != src["lessonId"])
    moved = src["photoIds"][0]
    new = {"modules": [{**m, "lessons": [
        {**les, "photoIds": ([x for x in les["photoIds"] if x != moved] + ([moved] if les["lessonId"] == dst["lessonId"] else []))}
        for les in m["lessons"]]} for m in d["structure"]["modules"]]}
    d2 = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "structure": new},
                  expect=200, schema="DraftResponse")["draft"]
    lessons2 = {les["lessonId"]: les for m in d2["structure"]["modules"] for les in m["lessons"]}
    assert moved in lessons2[dst["lessonId"]]["photoIds"] and moved not in lessons2[src["lessonId"]]["photoIds"]
    assert lessons2[dst["lessonId"]]["aiFields"] == dst["aiFields"]  # заголовок і т. ін. не чіпали
    bad = {"modules": [{**new["modules"][0], "lessons": [{**new["modules"][0]["lessons"][0], "photoIds": ["ph_nope"]}]}]}
    assert api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d2["revision"], "structure": bad},
                    expect=404)["kind"] == "photo_not_found"


def _ms(api, **fields):
    return api.call("POST", "/photo-drafts", {"kind": "manuscript", **fields}, expect=201, schema="DraftResponse")["draft"]


def test_manuscript_create_rules(api):
    assert api.call("POST", "/photo-drafts", {"kind": "manuscript", "bookId": "b1", "newBookTitle": "X"}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", "/photo-drafts", {"kind": "course", "newBookTitle": "X"}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", "/photo-drafts", {"kind": "manuscript", "bookId": "bk_missing_1"}, expect=404)["kind"] == "book_not_found"
    assert api.call("POST", "/photo-drafts", {"kind": "book"}, expect=400)["kind"] == "bad_input"
    d = _ms(api, title="Розділ 1", newBookTitle="Долина тиші")
    assert d["newBookTitle"] == "Долина тиші" and d["bookId"] is None


def test_manuscript_ocr_text_edit_and_submit_to_inbox(api):
    d = _ms(api, title="Розділ 1", newBookTitle="Долина")
    did = d["draftId"]
    r = api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "p1", "image": IMG, "note": "герой — Іван"},
                 expect=202, schema="PhotoResponse")
    pid = r["photo"]["photoId"]
    assert r["photo"]["status"] == "processing" and r["photo"]["text"] is None
    assert api.call("PUT", f"/photo-drafts/{did}/photos/{pid}/text", {"text": "x"}, expect=409)["kind"] == "wrong_status"
    assert {b["kind"] for b in api.call("POST", f"/photo-drafts/{did}/submit", expect=400)["blockers"]} == {"photos_processing"}
    p = api.draft(did)["photos"][0]
    assert p["status"] == "described" and "Іван" in p["text"] and p["textEdited"] is False and p["description"] is None
    api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "p2", "image": IMG, "note": "порожня"}, expect=202)
    d = api.draft(did)
    empty = [x for x in d["photos"] if not x["text"]]
    assert len(empty) == 1
    kinds = {b["kind"] for b in api.call("POST", f"/photo-drafts/{did}/submit", expect=400)["blockers"]}
    assert kinds == {"empty_page"}
    r = api.call("PUT", f"/photo-drafts/{did}/photos/{empty[0]['photoId']}/text", {"text": "Введено вручну"},
                 expect=200, schema="PhotoResponse")
    assert r["photo"]["textEdited"] is True
    assert api.call("PUT", f"/photo-drafts/{did}/photos/{pid}/text", {"text": "я" * 20001}, expect=400)["kind"] == "bad_input"
    assert api.call("PUT", f"/photo-drafts/{did}/photos/{pid}/text", {"text": 5}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", f"/photo-drafts/{did}/structure", expect=409)["kind"] == "wrong_status"
    res = api.call("POST", f"/photo-drafts/{did}/submit", expect=201, schema="SubmitResponse")
    # Контракт 1.5.0: рукопис без наявної книги — Studio створює книгу сама.
    assert res["target"]["kind"] == "book" and res["target"]["studioUrl"] == "/"


def test_manuscript_book_and_title_blockers_and_patch(api):
    d = _ms(api)
    did = d["draftId"]
    api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "a", "image": IMG}, expect=202)
    api.draft(did)
    kinds = {b["kind"] for b in api.call("POST", f"/photo-drafts/{did}/submit", expect=400)["blockers"]}
    assert kinds == {"title_missing", "book_missing"}
    d = api.draft(did)
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "title": "Гл. 2", "bookId": "b_ok"},
                 expect=200, schema="DraftResponse")["draft"]
    assert api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "newBookTitle": "Нова"},
                    expect=400)["kind"] == "bad_input"  # і bookId, і newBookTitle
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "bookId": None, "newBookTitle": "Нова"},
                 expect=200)["draft"]
    assert d["bookId"] is None and d["newBookTitle"] == "Нова"
    assert api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "lessons": []}, expect=409)["kind"] == "wrong_status"
    d = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "newBookTitle": None, "bookId": "b_ok"}, expect=200)["draft"]
    res = api.call("POST", f"/photo-drafts/{did}/submit", expect=201, schema="SubmitResponse")
    assert res["target"]["studioUrl"] == "/media?tab=inbox&bookId=b_ok"


def test_stateful_mock_serves_back_the_uploaded_image(api):
    import io
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 30, 30)).save(buf, "JPEG")
    big = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    did = _new(api, photos=0)
    r = api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "img1", "image": big}, expect=202)
    pid = r["photo"]["photoId"]
    resp = api.client.get(PREFIX + f"/photo-drafts/{did}/photos/{pid}/image", headers=H)
    assert resp.status_code == 200 and Image.open(io.BytesIO(resp.content)).size == (64, 48)


def test_ai_options_scale_with_draft_and_follow_schema(api):
    small, big = _new(api, photos=2), _new(api, photos=12)
    a = api.call("GET", f"/photo-drafts/{small}/ai-options", expect=200, schema="AiOptionsResponse")
    b = api.call("GET", f"/photo-drafts/{big}/ai-options", expect=200, schema="AiOptionsResponse")
    pick = lambda o: next(m for m in o["models"] if m["usable"] and m["credits"])["credits"]["expected"]  # noqa: E731
    assert pick(b) > pick(a) and a["pass"] == "structure" and a["moduleId"] is None
    assert api.call("GET", f"/photo-drafts/{small}/ai-options?pass=bogus", expect=400)["kind"] == "bad_input"
    assert api.call("GET", f"/photo-drafts/{small}/ai-options?pass=generate&moduleId=m-9", expect=404)["kind"] == "module_not_found"


def test_ai_options_for_generate_after_structure(api):
    did = _new(api, title="Ложка")
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202)
    for _ in range(5):
        d = api.draft(did)
        if not d["job"]:
            break
    mid = d["structure"]["modules"][0]["moduleId"]
    o = api.call("GET", f"/photo-drafts/{did}/ai-options?pass=generate&moduleId={mid}", expect=200, schema="AiOptionsResponse")
    assert o["pass"] == "generate" and o["moduleId"] == mid


def test_ai_options_unavailable_for_manuscript(api):
    did = _new(api, kind="manuscript", photos=1, title="Гл", newBookTitle="К")
    assert api.call("GET", f"/photo-drafts/{did}/ai-options", expect=409)["kind"] == "wrong_status"


def test_structure_and_generate_validate_model_id(api):
    did = _new(api, title="Ложка")
    assert api.call("POST", f"/photo-drafts/{did}/structure", {"modelId": 5}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", f"/photo-drafts/{did}/structure", {"modelId": "nope"}, expect=400)["kind"] == "bad_input"
    closed = next(m for m in contract.load_fixture("ai-options")["models"] if not m["usable"])
    err = api.call("POST", f"/photo-drafts/{did}/structure", {"modelId": closed["modelId"]}, expect=400)
    assert closed["note"] in err["error"]
    api.call("POST", f"/photo-drafts/{did}/structure", {"modelId": "claude-sonnet-5"}, expect=202, schema="DraftResponse")
    for _ in range(5):
        d = api.draft(did)
        if not d["job"]:
            break
    mid = d["structure"]["modules"][0]["moduleId"]
    assert api.call("POST", f"/photo-drafts/{did}/modules/{mid}/generate", {"modelId": "nope"}, expect=400)["kind"] == "bad_input"
    api.call("POST", f"/photo-drafts/{did}/modules/{mid}/generate", {"modelId": "claude-sonnet-5"}, expect=202, schema="DraftResponse")


# --- курс зі скану документа (контракт 1.6.0) -------------------------------------------------------------------

def test_course_document_create_rules_and_summary(api):
    d = api.call("POST", "/photo-drafts", {"kind": "course", "courseSource": "document", "title": "Безпека"},
                 expect=201, schema="DraftResponse")["draft"]
    assert d["courseSource"] == "document"
    plain = api.call("POST", "/photo-drafts", {"kind": "course"}, expect=201, schema="DraftResponse")["draft"]
    assert plain["courseSource"] == "photos"
    instr = api.call("POST", "/photo-drafts", {"kind": "instruction"}, expect=201, schema="DraftResponse")["draft"]
    assert "courseSource" not in instr
    assert api.call("POST", "/photo-drafts", {"kind": "instruction", "courseSource": "document"}, expect=400)["kind"] == "bad_input"
    assert api.call("POST", "/photo-drafts", {"kind": "course", "courseSource": "video"}, expect=400)["kind"] == "bad_input"
    listed = api.call("GET", "/photo-drafts", expect=200, schema="DraftListResponse")["drafts"]
    by_id = {x["draftId"]: x for x in listed}
    assert by_id[d["draftId"]]["courseSource"] == "document"
    assert by_id[plain["draftId"]]["courseSource"] == "photos"
    assert "courseSource" not in by_id[instr["draftId"]]


def test_course_document_pages_are_recognized_not_described(api):
    did = _new(api, courseSource="document", title="Безпека", photos=2)
    d = api.draft(did)
    assert d["courseSource"] == "document"
    assert all(p["status"] == "described" and p["text"] and p["description"] is None and p["textEdited"] is False
               for p in d["photos"])
    photo = d["photos"][0]["photoId"]
    r = api.call("PUT", f"/photo-drafts/{did}/photos/{photo}/text", {"text": "Виправлений текст"}, expect=200, schema="PhotoResponse")
    assert r["photo"]["textEdited"] is True and r["photo"]["text"] == "Виправлений текст"
    # курс з кадрів текст сторінки не має
    plain = _new(api, kind="course", photos=1)
    pid = api.draft(plain)["photos"][0]["photoId"]
    assert api.call("PUT", f"/photo-drafts/{plain}/photos/{pid}/text", {"text": "X"}, expect=409)["kind"] == "wrong_status"


def test_course_document_flow_structure_has_summary_and_outcomes_and_submit(api):
    did = _new(api, courseSource="document", title="Безпека", photos=3)
    api.call("POST", f"/photo-drafts/{did}/structure", expect=202, schema="DraftResponse")
    for _ in range(6):
        d = api.draft(did)
        if not d["job"]:
            break
    assert d["status"] == "structured"
    assert d["structure"]["summary"] and len(d["structure"]["outcomes"]) >= 2
    # правка структури без summary/outcomes їх не стирає (так робить застосунок: шле лише модулі)
    r = api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "structure": {"modules": d["structure"]["modules"]}},
                 expect=200, schema="DraftResponse")
    assert r["draft"]["structure"]["summary"] == d["structure"]["summary"]
    for m in d["structure"]["modules"]:
        api.call("POST", f"/photo-drafts/{did}/modules/{m['moduleId']}/generate", expect=202)
        for _ in range(6):
            d = api.draft(did)
            if not d["job"]:
                break
    for a in d["assumptions"]:
        api.call("PATCH", f"/photo-drafts/{did}", {"ifRevision": d["revision"], "assumptions": [{"assumptionId": a["assumptionId"], "status": "confirmed"}]}, expect=200)
        d = api.draft(did)
    sub = api.call("POST", f"/photo-drafts/{did}/submit", expect=201, schema="SubmitResponse")
    assert sub["target"]["kind"] == "course"


def test_course_document_empty_page_blocks_submit(api):
    did = _new(api, courseSource="document", title="Порожній", photos=0)
    api.call("POST", f"/photo-drafts/{did}/photos", {"clientId": "e1", "image": IMG, "note": "порожня"}, expect=202)
    d = api.draft(did)
    assert d["photos"][0]["text"] == ""
    e = api.call("POST", f"/photo-drafts/{did}/submit", expect=400)
    assert any(b["kind"] == "empty_page" for b in e["blockers"])
