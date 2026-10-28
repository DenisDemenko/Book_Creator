from __future__ import annotations

import base64

import httpx
import pytest

from grabfusion import contract
from grabfusion.errors import StudioError
from grabfusion.mock_server import FIXTURE_HEADER, PREFIX, TINY_JPEG
from grabfusion.models import Draft
from grabfusion.studio_client import StudioClient

IMG = "data:image/jpeg;base64," + base64.b64encode(TINY_JPEG).decode()


def use(client, fixture):
    client._http.headers[FIXTURE_HEADER] = fixture


def test_limits_cached_and_typed(client):
    lim = client.limits()
    assert lim.maxNoteChars == 500 and lim.pollIntervalMs == 2000
    assert client.poll_interval() == 2.0


def test_create_get_list(client):
    d = client.create_draft("course", title="Ложка")
    assert isinstance(d, Draft) and d.kind == "course" and d.status == "collecting"
    assert client.list_drafts()[0].draftId
    assert client.get_draft(d.draftId).photos


def test_get_variants_parse(client):
    for fx, expect in [("get-draft-structured", "structured"), ("get-draft-written", "written"),
                       ("get-draft-job-failed", None), ("get-draft-manuscript", None)]:
        use(client, fx)
        d = client.get_draft("pd_x")
        if expect:
            assert d.status == expect
    assert d.kind == "manuscript" and any(p.text for p in d.photos)
    client._http.headers.pop(FIXTURE_HEADER)


def test_structured_has_typed_modules(client):
    use(client, "get-draft-structured")
    d = client.get_draft("pd_x")
    assert d.structure and d.structure.modules[0].lessons[0].lessonId
    assert d.assumptions[0].status in {"open", "confirmed", "rejected"}
    client._http.headers.pop(FIXTURE_HEADER)


def test_patch_requires_revision_and_returns_draft(client):
    assert client.patch_draft("pd_x", 3, title="Нова").draftId
    with pytest.raises(StudioError) as e:
        client._request("PATCH", "/photo-drafts/pd_x", json={"title": "x"})
    assert e.value.kind == "bad_input" and e.value.status == 400


def test_add_photo_and_idempotent_duplicate(client):
    first = client.add_photo("pd_dup", "cid-1", IMG)
    assert first.photo.status == "processing" and first.duplicate is False
    again = client.add_photo("pd_dup", "cid-1", IMG)
    assert again.duplicate is True


def test_add_photo_with_note_limit_exactly_500_ok_501_blocked_locally(client):
    assert client.add_photo("pd_n", "n-500", IMG, note="а" * 500)
    with pytest.raises(StudioError) as e:
        client.add_photo("pd_n", "n-501", IMG, note="а" * 501)
    assert e.value.kind == "note_too_long"


def test_server_enforces_note_limit_too(client):
    # Обходимо клієнтську перевірку, щоб побачити відповідь сервера
    with pytest.raises(StudioError) as e:
        client._request("POST", "/photo-drafts/pd_n/photos",
                        json={"clientId": "z", "image": IMG, "note": "б" * 501})
    assert e.value.kind == "note_too_long"


def test_bad_image(client):
    with pytest.raises(StudioError) as e:
        client.add_photo("pd_b", "b1", base64.b64encode(b"not an image").decode())
    assert e.value.kind == "bad_image"


def test_image_bytes(client):
    assert client.photo_image("pd_x", "ph_01a1").startswith(b"\xff\xd8")


def test_notes(client):
    r = client.put_note("pd_x", "n-1", ["ph_01a1"], "Лляна олія")
    assert r.note.noteId and r.revision
    assert client.delete_note("pd_x", "n-1").draftId
    with pytest.raises(StudioError) as e:
        client.put_note("pd_x", "n-1", ["ph_01a1"], "а" * 501)
    assert e.value.kind == "note_too_long"


def test_put_photo_text(client):
    r = client.put_photo_text("pd_m", "ph_01a1", "Виправлений текст")
    assert r.photo.photoId
    with pytest.raises(StudioError) as e:
        client.put_photo_text("pd_m", "ph_01a1", "я" * 20001)
    assert e.value.kind == "bad_input"


def test_retry_delete_photo_discard(client):
    assert client.retry_photo("pd_x", "ph_01a1").photo
    assert client.delete_photo("pd_x", "ph_01a1").draftId
    assert client.discard_draft("pd_x").draftId


def test_structure_generate_return_running_job(client):
    d = client.structure("pd_x", replace=True)
    assert d.job and d.job.running and d.job.kind == "structure"
    g = client.generate_module("pd_x", "m-1")
    assert g.job and g.job.kind == "generate"


def test_submit_follows_draft_kind(client):
    for kind, target in [("course", "course"), ("instruction", "express"), ("book", "inbox"),
                         ("manuscript", "inbox")]:
        fields = {"bookId": "b1"} if kind == "book" else {}
        d = client.create_draft(kind, **fields)
        res = client.submit(d.draftId)
        assert res.target.kind == target and res.target.studioUrl.startswith("/")


@pytest.mark.parametrize("fixture,kind,status", [
    ("error-revision-conflict", "revision_conflict", 409),
    ("error-rate-limited", "rate_limited", 429),
    ("error-scope-denied", "scope_denied", 403),
    ("error-job-running", "job_running", 409),
    ("error-note-too-long", "note_too_long", 400),
])
def test_error_fixtures_become_studio_errors(client, fixture, kind, status):
    use(client, fixture)
    with pytest.raises(StudioError) as e:
        client.get_draft("pd_x")
    assert (e.value.kind, e.value.status) == (kind, status)
    assert e.value.message


def test_submit_blocked_carries_blockers(client):
    use(client, "error-submit-blocked")
    with pytest.raises(StudioError) as e:
        client.submit("pd_x")
    assert e.value.kind == "submit_blocked" and e.value.status == 400
    assert {b["kind"] for b in e.value.blockers} == {"open_assumptions", "module_not_written"}


def test_auth_errors(mock_url):
    with StudioClient(mock_url + PREFIX, "") as c:
        with pytest.raises(StudioError) as e:
            c.limits()
        assert e.value.kind == "unauthenticated" and e.value.status == 401
    with StudioClient(mock_url + PREFIX, "nst_invalid") as c:
        with pytest.raises(StudioError) as e:
            c.limits()
        assert e.value.kind == "invalid_token"
    with StudioClient(mock_url + PREFIX, "nst_wrongscope") as c:
        with pytest.raises(StudioError) as e:
            c.list_drafts()
        assert e.value.kind == "scope_denied"


def test_unknown_fixture_header(client):
    use(client, "nope")
    with pytest.raises(StudioError) as e:
        client.limits()
    assert e.value.kind == "bad_input"
    client._http.headers.pop(FIXTURE_HEADER)


def _flaky_transport(fail_times, fail_with):
    calls = {"n": 0, "bodies": []}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/limits"):
            return httpx.Response(200, json=contract.load_fixture("limits"))
        calls["n"] += 1
        calls["bodies"].append(request.content)
        if calls["n"] <= fail_times:
            if fail_with == "net":
                raise httpx.ConnectError("обрив")
            return httpx.Response(fail_with, text="bad gateway")
        fx = contract.load_fixture("add-photo")
        fx["duplicate"] = calls["n"] > 1
        return httpx.Response(202, json=fx)

    return httpx.MockTransport(handler), calls


@pytest.mark.parametrize("fail_with", ["net", 502, 429])
def test_add_photo_retries_with_same_client_id(fail_with):
    transport, calls = _flaky_transport(2, fail_with)
    c = StudioClient("http://studio/api/external/v1", "t", transport=transport, sleep=lambda _s: None)
    r = c.add_photo("pd_x", "same-id", IMG)
    assert calls["n"] == 3 and r.duplicate is True
    assert len(set(calls["bodies"])) == 1  # той самий clientId і тіло в усіх спробах


def test_add_photo_gives_up_after_retries():
    transport, calls = _flaky_transport(99, 502)
    c = StudioClient("http://studio/api/external/v1", "t", transport=transport, retries=2,
                     sleep=lambda _s: None)
    with pytest.raises(StudioError) as e:
        c.add_photo("pd_x", "id", IMG)
    assert e.value.kind == "server_error" and calls["n"] == 3


def test_add_photo_does_not_retry_client_errors():
    def handler(request):
        if request.url.path.endswith("/limits"):
            return httpx.Response(200, json=contract.load_fixture("limits"))
        handler.n += 1
        return httpx.Response(409, json=contract.load_fixture("error-job-running"))
    handler.n = 0
    c = StudioClient("http://studio/x", "t", transport=httpx.MockTransport(handler), sleep=lambda _s: None)
    with pytest.raises(StudioError):
        c.add_photo("pd_x", "id", IMG)
    assert handler.n == 1


def test_non_json_proxy_error_maps_to_server_error():
    c = StudioClient("http://studio/x", "t", transport=httpx.MockTransport(
        lambda r: httpx.Response(502, text="<html>Bad gateway</html>")))
    with pytest.raises(StudioError) as e:
        c.list_drafts()
    assert e.value.kind == "server_error" and e.value.retryable


def test_wait_until_idle_polls_until_done():
    busy, done = contract.load_fixture("get-draft-collecting"), contract.load_fixture("get-draft-written")
    busy["draft"]["photos"][0]["status"] = "processing"
    seq = [busy, busy, done]
    sleeps: list[float] = []

    def handler(request):
        if request.url.path.endswith("/limits"):
            return httpx.Response(200, json=contract.load_fixture("limits"))
        return httpx.Response(200, json=seq.pop(0))

    c = StudioClient("http://studio/x", "t", transport=httpx.MockTransport(handler), sleep=sleeps.append)
    d = c.wait_until_idle("pd_x")
    assert not d.busy and sleeps == [2.0, 2.0]


def test_wait_until_idle_times_out():
    busy = contract.load_fixture("get-draft-collecting")
    busy["draft"]["photos"][0]["status"] = "processing"

    def handler(request):
        if request.url.path.endswith("/limits"):
            return httpx.Response(200, json=contract.load_fixture("limits"))
        return httpx.Response(200, json=busy)

    c = StudioClient("http://studio/x", "t", transport=httpx.MockTransport(handler), sleep=lambda _s: None)
    with pytest.raises(TimeoutError):
        c.wait_until_idle("pd_x", timeout=0)


def test_models_ignore_unknown_fields():
    fx = contract.load_fixture("get-draft-structured")["draft"]
    fx["brandNew"] = {"x": 1}
    fx["photos"][0]["alsoNew"] = True
    d = Draft.from_dict(fx)
    assert d.draftId == fx["draftId"] and not hasattr(d, "brandNew")
