"""PWA в справжньому Chromium: service worker під префіксом, оболонка без звʼязку, придатність до встановлення."""
from __future__ import annotations

import socket
import threading
import time

import pytest
import uvicorn

pw = pytest.importorskip("playwright.sync_api")

from grabfusion.app import create_app
from grabfusion.mock_server import PREFIX, create_app as create_mock
from grabfusion.sessions import SessionStore
from grabfusion.settings import Settings

BASE = "/grabfisionstidio"


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
    msrv, mt, murl = _serve(create_mock(stateful=True, poll_interval_ms=300))
    app = create_app(Settings(studio_url=murl + PREFIX, base_path=BASE), store=SessionStore(":memory:"))
    asrv, at, aurl = _serve(app)
    yield aurl
    for srv, t in ((asrv, at), (msrv, mt)):
        srv.should_exit = True
        t.join(timeout=5)


@pytest.fixture(scope="module")
def browser():
    with pw.sync_playwright() as p:
        try:
            b = p.chromium.launch()
        except Exception as e:  # pragma: no cover
            pytest.skip(f"Chromium недоступний: {e}")
        yield b
        b.close()


def test_service_worker_manifest_and_offline_shell(stack, browser):
    ctx = browser.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    url = f"{stack}{BASE}/"
    page.goto(url)
    page.wait_for_selector("#code")

    # service worker зареєстрований у правильній області й керує сторінкою
    page.wait_for_function("navigator.serviceWorker.ready.then(() => true)", timeout=10000)
    scope = page.evaluate("navigator.serviceWorker.getRegistration().then(r => r.scope)")
    assert scope == url
    page.reload()
    page.wait_for_function("!!navigator.serviceWorker.controller", timeout=10000)
    cached = page.evaluate("caches.keys().then(k => k.filter(x => x.startsWith('grabfusion-shell-')).length)")
    assert cached == 1

    # Chrome вважає застосунок придатним до встановлення
    cdp = ctx.new_cdp_session(page)
    mani = cdp.send("Page.getAppManifest")
    assert mani["url"].endswith(f"{BASE}/manifest.webmanifest")
    problems = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
    assert problems == [], problems
    assert cdp.send("Page.getAppManifest")["errors"] == []

    # підключаємось, потім «пропадає звʼязок» і сторінку перезавантажують
    page.fill("#code", "GF-OK")
    page.click("button[type=submit]")
    page.wait_for_selector("#btn-new")
    ctx.set_offline(True)
    page.reload()
    page.wait_for_selector("#app .card")
    assert "Немає звʼязку" in page.inner_text("#app")  # оболонка відкрилась, а не «сторінка недоступна»
    assert page.locator("#net").is_visible() or page.inner_text("#app")
    # API й фото не з кешу
    assert page.evaluate("fetch('api/session').then(() => 'ok').catch(() => 'offline')") == "offline"

    # звʼязок повернувся — застосунок знову працює
    ctx.set_offline(False)
    page.reload()
    page.wait_for_selector("#btn-new", timeout=10000)
    assert not errors, errors
    ctx.close()


def test_ios_hint_shown_once_and_not_in_standalone(stack, browser):
    ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    ctx = browser.new_context(user_agent=ua, viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(f"{stack}{BASE}/")
    page.wait_for_selector("#install-hint:not([hidden])")
    assert "На початковий екран" in page.inner_text("#install-hint")
    page.click("#install-hint-close")
    assert page.locator("#install-hint").is_hidden()
    page.reload()
    page.wait_for_selector("#code")
    assert page.locator("#install-hint").is_hidden()
    ctx.close()

    desktop = browser.new_context()
    p2 = desktop.new_page()
    p2.goto(f"{stack}{BASE}/")
    p2.wait_for_selector("#code")
    assert p2.locator("#install-hint").is_hidden()
    assert p2.locator("#btn-install").is_hidden()  # без події beforeinstallprompt кнопки немає
    desktop.close()
