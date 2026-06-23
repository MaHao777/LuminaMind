from __future__ import annotations

from pathlib import Path

import pytest

import main


@pytest.fixture(autouse=True)
def isolate_backend_app_state(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LUMINAMIND_APP_STATE_PATH", str(tmp_path / "app-state.json"))
    main.state.vault_root = None
    yield
    main.state.vault_root = None
