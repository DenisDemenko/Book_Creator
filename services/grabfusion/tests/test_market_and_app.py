from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from grabfusion.app import create_app
from grabfusion.errors import StudioError
from grabfusion.market_client import MarketClient
from grabfusion.settings import Settings


def test_market_get_course_is_public_no_auth_header():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        seen["path"] = request.url.path
        return httpx.Response(200, json={"slug": "lozhka", "title": "Ложка"})

    c = MarketClient("https://market.example", transport=httpx.MockTransport(handler))
    assert c.get_course("lozhka")["title"] == "Ложка"
    assert seen["auth"] is None and seen["path"].endswith("/lozhka")


def test_market_404():
    c = MarketClient("https://m", transport=httpx.MockTransport(
        lambda r: httpx.Response(404, json={"error": "Немає", "kind": "draft_not_found"})))
    with pytest.raises(StudioError) as e:
        c.get_course("x")
    assert e.value.status == 404


def test_settings_from_env_strips_slash():
    s = Settings.from_env({"GRABFUSION_STUDIO_URL": "https://s/api/external/v1/", "GRABFUSION_PORT": "9000"})
    assert s.studio_url == "https://s/api/external/v1" and s.port == 9000


def test_app_health_and_config_have_no_token_fields():
    from grabfusion.sessions import SessionStore
    c = TestClient(create_app(Settings(), store=SessionStore(":memory:")))
    assert c.get("/healthz").json()["contractVersion"] == "1.3.0"
    cfg = c.get("/api/config").json()
    assert set(cfg) == {"studioUrl", "marketUrl", "contractVersion"}
