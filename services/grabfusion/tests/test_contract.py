from __future__ import annotations

import pytest
from jsonschema import ValidationError

from grabfusion import contract
from grabfusion.errors import KIND_STATUS
from grabfusion.mock_server import ROUTES, fixtures_served_by_routes


@pytest.mark.parametrize("name", contract.fixture_names())
def test_every_fixture_matches_schema(name):
    contract.validate(contract.definition_for(name), contract.load_fixture(name))


def test_version_and_fixture_count():
    assert contract.contract_version() == "1.3.0"
    assert len(contract.fixture_names()) == 28


def test_schema_rejects_broken_draft():
    bad = contract.load_fixture("get-draft-collecting")
    del bad["draft"]["revision"]
    with pytest.raises(ValidationError):
        contract.validate("DraftResponse", bad)


def test_schema_allows_unknown_fields():
    d = contract.load_fixture("get-draft-collecting")
    d["draft"]["newField"] = 1
    contract.validate("DraftResponse", d)


def test_error_kinds_in_schema_and_status_table_agree():
    kinds = set(contract.schema()["definitions"]["ErrorKind"]["enum"])
    assert kinds == set(KIND_STATUS)


def test_error_fixture_kinds_have_status():
    for n in contract.fixture_names():
        if n.startswith("error-"):
            assert contract.load_fixture(n)["kind"] in KIND_STATUS


def test_all_non_error_fixtures_are_served_by_the_mock():
    served = fixtures_served_by_routes()
    non_error = {n for n in contract.fixture_names() if not n.startswith("error-")}
    assert non_error == served


def test_route_table_covers_all_16_routes():
    assert len(ROUTES) == 16


def test_note_chars_are_code_points():
    assert contract.count_note_chars("👍") == 1
    assert contract.count_note_chars("а" * 500) == 500
