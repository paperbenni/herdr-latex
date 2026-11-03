"""Boundary tests for JSON crossing processes and persisted state."""

import math

import pytest
from remote import parse_config, parse_discovery, parse_metadata, parse_status


@pytest.mark.parametrize(
    "value", [None, [], 7, {"folder": 4}, {"folder": " "}, {"folder": "/p", "engine": "sh"}]
)
def test_invalid_config_is_rejected(value: object) -> None:
    with pytest.raises(ValueError):
        parse_config(value)


def test_config_normalizes_paths_and_defaults() -> None:
    assert parse_config({"folder": " /project ", "machine": " host ", "tex": " main.tex "}) == {
        "folder": "/project",
        "machine": "host",
        "tex": "main.tex",
        "pdf": "",
        "engine": "pdflatex",
    }


@pytest.mark.parametrize("stamp", [None, [], [1, 2], [1, 2, 3, 4], [True, 2, 3], [1, "2", 3]])
def test_invalid_metadata_is_rejected(stamp: object) -> None:
    with pytest.raises(ValueError):
        parse_metadata({"path": "/p.pdf", "stamp": stamp})


def test_metadata_keeps_exact_integer_stamp() -> None:
    stamp = [1800000000000000001, 100, 5]
    assert parse_metadata({"path": "/p.pdf", "stamp": stamp})["stamp"] == stamp


@pytest.mark.parametrize(
    "value",
    [
        {"watching": 1},
        {"pid": True},
        {"heartbeat": "now"},
        {"stamp": []},
        {"error": 7},
        {"heartbeat": math.inf},
        {"updated": math.nan},
    ],
)
def test_corrupt_status_is_rejected(value: object) -> None:
    with pytest.raises(ValueError):
        parse_status(value)


def test_status_discards_unknown_fields_and_preserves_stop_state() -> None:
    assert parse_status({"watching": False, "pid": None, "build_code": 0, "unknown": "x"}) == {
        "watching": False,
        "pid": None,
        "build_code": 0,
    }


def test_discovery_rejects_malformed_document() -> None:
    with pytest.raises(ValueError):
        parse_discovery({"files": [{"path": "main.tex", "main": "yes"}], "errors": []})
