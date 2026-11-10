"""Підключення за QR: посилання `…#pair=КОД` (запис #537).

Код у фрагменті адреси: його не бачать ні проксі, ні сервер, ні журнали, ні Referer. Сторінка читає його сама, міняє
на токен через `POST /pair` і прибирає з адреси. Тут перевіряється чиста логіка розбору (`pairCodeFromHash` з app.js,
запускається в Node, якщо він є) і те, що сторінка справді викликає обмін і чистить адресу до нього.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

APP_JS = Path(__file__).resolve().parent.parent / "grabfusion" / "static" / "app.js"


def _source() -> str:
    return APP_JS.read_text(encoding="utf-8")


def _function(name: str) -> str:
    src = _source()
    m = re.search(r"function " + name + r"\([^)]*\) \{.*?\n\}", src, re.S)
    assert m, f"у app.js немає функції {name}"
    return m.group(0)


@pytest.mark.skipif(shutil.which("node") is None, reason="потрібен Node для запуску функції з app.js")
def test_pair_code_from_hash_in_node():
    cases = {
        "#pair=ABCD-EFGH": "ABCD-EFGH",
        "#pair=abcd1234": "abcd1234",
        "": None,
        "#": None,
        "#pair=": None,
        "#pair=AB": None,                       # закороткий
        "#pair=" + "A" * 33: None,             # задовгий
        "#pair=AB CD": None,                   # пробіл
        "#pair=ABCD-EFGH&x=1": None,           # зайві параметри — не наш код
        "#pair=<script>": None,
        "#other=ABCD-EFGH": None,
        "?pair=ABCD-EFGH": None,               # не фрагмент
        "#pair=ABCD-EFGH#more": None,
    }
    script = _function("pairCodeFromHash") + "\nconst cases = " + json.dumps(list(cases)) + ";\n" \
        "console.log(JSON.stringify(cases.map(pairCodeFromHash)));"
    out = subprocess.run(["node", "-e", script], capture_output=True, text=True, timeout=30, check=True).stdout
    assert json.loads(out) == list(cases.values())


def test_boot_exchanges_qr_code_and_clears_address_first():
    src = _source()
    boot = src[src.index("(async function boot()"):]
    boot = boot[: boot.index("/* ---------- PWA")]
    assert "pairCodeFromHash(location.hash)" in boot
    # адресу чистимо ДО обміну: код одноразовий і не мусить лишитися в історії чи закладках
    assert boot.index("history.replaceState") < boot.index("api('POST', '/pair'")
    # QR має пріоритет над наявною сесією: інший автор — інший акаунт на цьому телефоні
    assert boot.index("api('POST', '/pair'") < boot.index("api('GET', '/session')")
    # після невдачі лишається ручний ввід і зрозуміле повідомлення
    assert "state.pairNotice" in boot and "go('pair')" in boot


def test_pair_screen_shows_the_notice_once_and_mentions_qr():
    src = _source()
    view = src[src.index("function viewPair()"):]
    view = view[: view.index("/* ---------- список чернеток")]
    assert "state.pairNotice" in view and "state.pairNotice = ''" in view
    assert "QR" in view
