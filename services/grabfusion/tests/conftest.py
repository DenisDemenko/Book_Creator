from __future__ import annotations

import socket
import threading
import time

import pytest
import uvicorn

from grabfusion.mock_server import PREFIX, create_app
from grabfusion.studio_client import StudioClient


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def mock_url():
    app = create_app()
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    else:  # pragma: no cover
        raise RuntimeError("мок не стартував")
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    t.join(timeout=5)


@pytest.fixture()
def client(mock_url):
    c = StudioClient(mock_url + PREFIX, "nst_test", sleep=lambda _s: None)
    yield c
    c.close()
