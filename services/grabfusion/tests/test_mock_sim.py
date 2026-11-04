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
    assert res["target"]["kind"] == "inbox" and res["target"]["studioUrl"] == "/media?tab=inbox"


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
