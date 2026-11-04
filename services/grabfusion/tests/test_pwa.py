"""PWA: маніфест, service worker, іконки, публічний префікс (/grabfisionstidio) і cookie-шлях."""
from __future__ import annotations

import json
import re
from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from grabfusion.app import SHELL_PATHS, STATIC_DIR, create_app, static_version
from grabfusion.mock_server import PREFIX
from grabfusion.sessions import SessionStore
from grabfusion.settings import Settings, normalize_base_path

BASE = "/grabfisionstidio"


def make(mock_url: str, base: str = "") -> TestClient:
    app = create_app(Settings(studio_url=mock_url + PREFIX, base_path=base), store=SessionStore(":memory:"))
    return TestClient(app)


def test_base_path_normalization_and_env():
    for raw, want in [("", ""), ("/", ""), (None, ""), ("x", "/x"), ("/x/", "/x"), (" /a//b/ ", "/a/b")]:
        assert normalize_base_path(raw) == want
    assert Settings.from_env({"GRABFUSION_BASE_PATH": "grabfisionstidio/"}).base_path == BASE
    assert Settings.from_env({}).base_path == ""


def test_index_gets_base_href_and_pwa_links(mock_url):
    root = make(mock_url).get("/")
    assert root.status_code == 200 and '<base href="/">' in root.text and "__BASE_HREF__" not in root.text
    html = make(mock_url, BASE).get(BASE + "/").text
    assert f'<base href="{BASE}/">' in html
    for needle in ('rel="manifest" href="manifest.webmanifest"', 'rel="apple-touch-icon"', 'href="static/app.css"', 'src="static/app.js"', 'name="theme-color"', 'apple-mobile-web-app-capable'):
        assert needle in html
    # жодних абсолютних адрес на ресурси: під префіксом вони б зламались
    assert not re.search(r'<(?!base)[^>]*\b(?:href|src)="/(?!/)', html)


def test_app_js_has_no_absolute_paths_to_the_service():
    js = (STATIC_DIR / "app.js").read_text(encoding="utf-8")
    assert "'/api" not in js and "`/api" not in js and '"/api' not in js and "/static/" not in js
    assert "register('sw.js'" in js


def test_served_under_prefix_with_and_without_stripping(mock_url):
    c = make(mock_url, BASE)
    for path in ("/", BASE, BASE + "/"):
        assert c.get(path).status_code == 200, path  # проксі зі зрізанням і без
    assert c.get("/static/app.js").status_code == 200 and c.get(BASE + "/static/app.js").status_code == 200
    assert c.get("/api/session").json()["paired"] is False and c.get(BASE + "/api/session").json()["paired"] is False
    assert c.get("/healthz").status_code == 200 and c.get(BASE + "/healthz").status_code == 200
    # інші префікси не зрізаються
    assert c.get(BASE + "x/").status_code == 404


def test_cookie_path_follows_base_path(mock_url):
    for base, want in ((BASE, f"Path={BASE}"), ("", "Path=/")):
        c = make(mock_url, base)
        r = c.post((base or "") + "/api/pair", json={"code": "GF-OK"})
        assert r.status_code == 200
        assert want in r.headers["set-cookie"]
        out = c.post((base or "") + "/api/logout")
        assert want in out.headers["set-cookie"]


def test_manifest(mock_url):
    r = make(mock_url, BASE).get(BASE + "/manifest.webmanifest")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/manifest+json")
    assert r.headers["cache-control"] == "no-cache"
    m = r.json()
    assert m["display"] == "standalone" and m["lang"] == "uk" and m["short_name"] == "GrabFusion"
    # відносні адреси — працюють під будь-яким префіксом
    assert m["start_url"] == "./" and m["scope"] == "./" and not m["start_url"].startswith("/")
    assert all(not i["src"].startswith("/") for i in m["icons"])
    sizes = {(i["sizes"], i["purpose"]) for i in m["icons"]}
    assert ("192x192", "any") in sizes and ("512x512", "any") in sizes and ("512x512", "maskable") in sizes
    for icon in m["icons"]:
        assert make(mock_url, BASE).get(BASE + "/" + icon["src"]).status_code == 200


def test_icons_are_real_pngs_of_declared_size():
    want = {"icon-192.png": (192, 192), "icon-512.png": (512, 512), "icon-maskable-512.png": (512, 512), "apple-touch-icon.png": (180, 180), "favicon-64.png": (64, 64)}
    for name, size in want.items():
        im = Image.open(STATIC_DIR / "icons" / name)
        assert im.format == "PNG" and im.size == size, name
    # іконка для iOS без прозорості (iOS заливає прозоре чорним)
    assert Image.open(STATIC_DIR / "icons" / "apple-touch-icon.png").mode == "RGB"
    # maskable заповнює весь квадрат (кути не прозорі)
    mk = Image.open(STATIC_DIR / "icons" / "icon-maskable-512.png").convert("RGBA")
    assert mk.getpixel((0, 0))[3] == 255 and mk.getpixel((511, 511))[3] == 255


def test_service_worker_is_templated_and_not_cached(mock_url):
    r = make(mock_url, BASE).get(BASE + "/sw.js")
    assert r.status_code == 200 and "javascript" in r.headers["content-type"] and r.headers["cache-control"] == "no-cache"
    js = r.text
    assert "__VERSION__" not in js and "__SHELL__" not in js
    assert static_version() in js
    shell = json.loads(re.search(r"const SHELL = (\[.*?\])\.map", js, re.S).group(1))
    assert shell == SHELL_PATHS and "./" in shell
    for p in SHELL_PATHS:  # усе з оболонки реально існує
        if p.startswith("static/"):
            assert (STATIC_DIR / p[len("static/"):]).is_file(), p
    # дані ніколи не кешуються
    assert "rel.startsWith('api/')" in js


def test_static_version_changes_with_files(tmp_path, monkeypatch):
    import grabfusion.app as appmod

    d = tmp_path / "static"
    d.mkdir()
    (d / "a.js").write_text("1")
    monkeypatch.setattr(appmod, "STATIC_DIR", d)
    v1 = appmod.static_version()
    (d / "a.js").write_text("2")
    assert appmod.static_version() != v1


def test_manifest_and_sw_served_without_prefix_too(mock_url):
    c = make(mock_url)
    assert c.get("/manifest.webmanifest").status_code == 200 and c.get("/sw.js").status_code == 200
