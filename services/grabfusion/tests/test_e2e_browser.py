"""Наскрізна перевірка сторінки в справжньому Chromium (Playwright) на моку Studio.

Пропускається, якщо Playwright або браузера немає. Знімки екранів — у GRABFUSION_SHOTS, якщо задано.
"""
from __future__ import annotations

import os
import socket
import threading
import time
from io import BytesIO

import pytest
import uvicorn
from PIL import Image

pw = pytest.importorskip("playwright.sync_api")

from grabfusion.app import create_app  # noqa: E402
from grabfusion.mock_server import PREFIX, create_app as create_mock  # noqa: E402
from grabfusion.sessions import SessionStore  # noqa: E402
from grabfusion.settings import Settings  # noqa: E402


def _serve(app):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    srv = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    for _ in range(100):
        if srv.started:
            break
        time.sleep(0.05)
    return srv, t, f"http://127.0.0.1:{port}"


@pytest.fixture(scope="module")
def stack():
    mock = create_mock()
    msrv, mt, murl = _serve(mock)
    app = create_app(Settings(studio_url=murl + PREFIX), store=SessionStore(":memory:"))
    asrv, at, aurl = _serve(app)
    yield aurl, mock
    for srv, t in ((asrv, at), (msrv, mt)):
        srv.should_exit = True
        t.join(timeout=5)


@pytest.fixture(scope="module")
def stack3():
    """Стаціонарний мок із швидким опитуванням: чернетка справді проходить усі етапи."""
    mock = create_mock(stateful=True, poll_interval_ms=300)
    msrv, mt, murl = _serve(mock)
    app = create_app(Settings(studio_url=murl + PREFIX), store=SessionStore(":memory:"))
    asrv, at, aurl = _serve(app)
    yield aurl, murl
    for srv, t in ((asrv, at), (msrv, mt)):
        srv.should_exit = True
        t.join(timeout=5)


@pytest.fixture(scope="module")
def browser_page():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # pragma: no cover
            pytest.skip(f"Chromium недоступний: {e}")
        ctx = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        yield ctx, page
        b.close()


def _jpeg(path, size=(3000, 2000)):
    Image.new("RGB", size, (40, 130, 100)).save(path, "JPEG")
    return str(path)


def _posts(mock):
    return [c for c in mock.state.calls if c[0] == "POST /photo-drafts/:draftId/photos"]


def _wait(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.1)
    raise AssertionError("умова не виконалась за " + str(timeout) + " с")


def _shot(page, name):
    d = os.environ.get("GRABFUSION_SHOTS")
    if d:
        os.makedirs(d, exist_ok=True)
        page.screenshot(path=os.path.join(d, name + ".png"), full_page=True)


def test_full_flow(stack, browser_page, tmp_path):
    url, mock = stack
    ctx, page = browser_page
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)

    # 1. підключення: неправильний код → повідомлення, правильний → список
    page.wait_for_selector("#code")
    _shot(page, "1-pair")
    page.fill("#code", "BAD")
    page.click("button[type=submit]")
    page.wait_for_selector("#pair-err:not(:empty)")
    assert "невірний" in page.inner_text("#pair-err")
    page.fill("#code", "GF-OK")
    page.click("button[type=submit]")
    page.wait_for_selector("#btn-new")
    _shot(page, "2-list")
    assert page.locator("[data-draft]").count() >= 1

    # 2. нова чернетка
    page.click("#btn-new")
    page.fill("#f-title", "Ложка з вишні")
    page.click("button[type=submit]")
    page.wait_for_selector("#lbl-cam")
    assert "Ложка" in page.inner_text("#title") or page.inner_text("#title")

    # 3. фото з галереї → картка кадру з'являється, у мок пішов POST
    before = len(_posts(mock))
    page.set_input_files("#file-gal", _jpeg(tmp_path / "a.jpg"))
    page.wait_for_selector("[data-photo]")
    _wait(lambda: len(_posts(mock)) == before + 1)
    page.wait_for_function("document.querySelectorAll('[data-queued]').length === 0")
    _shot(page, "3-draft")

    # 4. ліміт символів: 500 ок, 501 — червоний лічильник
    ta = page.locator("[data-photo] textarea").first
    ta.fill("я" * 500)
    assert "500 / 500" in page.locator("[data-photo] .counter").first.inner_text()
    assert "over" not in (page.locator("[data-photo] .counter").first.get_attribute("class") or "")
    ta.fill("я" * 501)
    assert "over" in page.locator("[data-photo] .counter").first.get_attribute("class")
    ta.fill("👍" * 500)  # емодзі — по одному символу
    assert "500 / 500" in page.locator("[data-photo] .counter").first.inner_text()
    ta.blur()

    # 5. без звʼязку: фото стає в чергу, а після відновлення звʼязку надсилається само
    ctx.set_offline(True)
    page.wait_for_function("!navigator.onLine")
    n_before = len(_posts(mock))
    page.set_input_files("#file-gal", _jpeg(tmp_path / "b.jpg"))
    page.wait_for_selector("[data-queued]")
    assert "без звʼязку" in page.inner_text("#net").lower()
    assert "у черзі" in page.locator("[data-queued] .badge").first.inner_text()
    _shot(page, "4-queued-offline")
    assert len(_posts(mock)) == n_before
    ctx.set_offline(False)
    _wait(lambda: len(_posts(mock)) == n_before + 1, 15)
    page.wait_for_function("document.querySelectorAll('[data-queued]').length === 0", timeout=15000)

    # 6. порядок: кнопка ↓ відправляє PATCH з photoOrder
    page.locator("[data-photo] button[title='Нижче']").first.click()
    _wait(lambda: any(c[0] == "PATCH /photo-drafts/:draftId" for c in mock.state.calls))

    # 7. вихід
    page.click("#btn-logout")
    page.wait_for_selector("#code")
    assert not errors, errors


def test_stage3_structure_write_validate_submit(stack3, browser_page, tmp_path):
    url, studio_url = stack3
    ctx, page = browser_page
    ctx.clear_cookies()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_selector("#code")
    page.fill("#code", "GF-OK")
    page.click("button[type=submit]")
    page.wait_for_selector("#btn-new")
    page.click("#btn-new")
    page.fill("#f-title", "Ложка з вишні")
    page.click("button[type=submit]")
    page.wait_for_selector("#lbl-cam")

    # без кадрів кнопка «Розкласти» неактивна
    assert page.locator("#btn-structure").is_disabled()
    page.set_input_files("#file-gal", [_jpeg(tmp_path / "1.jpg"), _jpeg(tmp_path / "2.jpg", (1200, 900))])
    page.wait_for_function("document.querySelectorAll('[data-photo]').length === 2 && document.querySelectorAll('[data-queued]').length === 0", timeout=15000)
    page.wait_for_function("!document.querySelector('#btn-structure').disabled", timeout=15000)
    _shot(page, "s3-1-before-structure")

    # прохід 2
    page.click("#btn-structure")
    page.wait_for_selector("#job-banner")
    page.wait_for_selector("#structure", timeout=15000)
    assert page.locator("[data-module]").count() == 2
    assert page.locator("[data-lesson]").count() == 3
    assert page.locator("[data-assumption]").count() == 1
    _shot(page, "s3-2-structure")

    # передчасна відправка неможлива — але кнопки «Відправити» ще й немає; пишемо курс
    assert page.locator("#btn-submit").count() == 0
    page.click("#btn-write")
    page.wait_for_function("document.querySelectorAll('[data-module] .badge.described').length === 2", timeout=20000)
    page.wait_for_selector("#btn-submit:not([disabled])", timeout=10000)
    _shot(page, "s3-3-written")

    # блокер: відкрите припущення
    page.click("#btn-submit")
    page.wait_for_selector("#blockers")
    assert page.locator("[data-blocker='open_assumptions']").count() == 1
    _shot(page, "s3-4-blocked")

    # правка уроку знімає позначку «ШІ» з поля
    title = page.locator("[data-lesson] input[data-field=title]").first
    assert page.locator("[data-lesson]").first.locator(".badge.ai").count() >= 1
    title.fill("Моя назва уроку")
    title.blur()
    page.wait_for_function("document.querySelector('[data-lesson] input[data-field=title]').value === 'Моя назва уроку'")
    page.wait_for_function("[...document.querySelectorAll('[data-lesson]')][0].querySelectorAll('label .badge.ai').length === 2")
    first = page.locator("[data-lesson]").first
    assert first.locator("label:has(+ input[data-field=title]) .badge.ai").count() == 0

    # підтверджуємо припущення й відправляємо
    page.click("[data-assumption] [data-act=confirm]")
    page.wait_for_function("document.querySelector('[data-assumption] .badge.described')")
    page.click("#btn-submit")
    page.wait_for_selector("#submitted")
    href = page.get_attribute("#open-studio", "href")
    assert "/courses/crs_sim" in href and href.startswith("http")
    _shot(page, "s3-5-submitted")
    assert not errors, errors
