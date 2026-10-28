"""Контракт Studio ↔ GrabFusion (1.3.0): схема, фікстури, межі, перевірка відповідей.

Єдине джерело — docs/photo-drafts-api* у репозиторії Studio. Тут лежить знімок;
оновлюється скриптом `scripts/sync_contract.py`.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import jsonschema

DATA_DIR = Path(__file__).parent / "contract_data"
FIXTURES_DIR = DATA_DIR / "fixtures"


@lru_cache(maxsize=1)
def schema() -> dict[str, Any]:
    return json.loads((DATA_DIR / "schema.json").read_text(encoding="utf-8"))


def contract_version() -> str:
    return load_fixture("limits")["contractVersion"]


def fixture_names() -> list[str]:
    return sorted(p.stem for p in FIXTURES_DIR.glob("*.json"))


def load_fixture(name: str) -> Any:
    """Свіжа копія фікстури (мок змінює її, тож кеш не віддаємо)."""
    return json.loads((FIXTURES_DIR / f"{name}.json").read_text(encoding="utf-8"))


def default_limits() -> dict[str, int]:
    return dict(load_fixture("limits")["limits"])


def count_note_chars(text: str) -> int:
    """Кодові точки Unicode — так само, як [...text].length у TypeScript."""
    return len(text)


def _validator(definition: str) -> jsonschema.Draft7Validator:
    root = schema()
    return jsonschema.Draft7Validator(
        {"$ref": f"#/definitions/{definition}", "definitions": root["definitions"]}
    )


def validate(definition: str, data: Any) -> None:
    """Кидає jsonschema.ValidationError, якщо data не відповідає definitions/<definition>."""
    _validator(definition).validate(data)


# Яка частина схеми описує кожну фікстуру. Усе, що не тут, — помилки (Error / SubmitBlockedError).
FIXTURE_DEFINITIONS: dict[str, str] = {
    "limits": "LimitsResponse",
    "list-drafts": "DraftListResponse",
    "create-draft": "DraftResponse",
    "get-draft-collecting": "DraftResponse",
    "get-draft-structured": "DraftResponse",
    "get-draft-written": "DraftResponse",
    "get-draft-job-failed": "DraftResponse",
    "get-draft-manuscript": "DraftResponse",
    "patch-draft": "DraftResponse",
    "discard-draft": "DraftResponse",
    "delete-photo": "DraftResponse",
    "delete-note": "DraftResponse",
    "structure-running": "DraftResponse",
    "generate-running": "DraftResponse",
    "add-photo": "PhotoResponse",
    "retry-photo": "PhotoResponse",
    "put-photo-text": "PhotoResponse",
    "put-note": "NoteResponse",
    "submit-course": "SubmitResponse",
    "submit-instruction": "SubmitResponse",
    "submit-book": "SubmitResponse",
    "submit-manuscript": "SubmitResponse",
    "error-submit-blocked": "SubmitBlockedError",
}


def definition_for(fixture: str) -> str:
    return FIXTURE_DEFINITIONS.get(fixture, "Error")
