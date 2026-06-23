from __future__ import annotations

import json
import os
import sys
from pathlib import Path


APP_STATE_PATH_ENV = "LUMINAMIND_APP_STATE_PATH"


def app_state_path() -> Path:
    override = os.environ.get(APP_STATE_PATH_ENV)
    if override:
        return Path(override).expanduser()

    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / "LuminaMind" / "state.json"

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "LuminaMind" / "state.json"

    base = os.environ.get("XDG_CONFIG_HOME")
    return (Path(base).expanduser() if base else Path.home() / ".config") / "LuminaMind" / "state.json"


def load_last_vault_path() -> Path | None:
    path = app_state_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    value = payload.get("last_vault_path") if isinstance(payload, dict) else None
    if not isinstance(value, str) or not value.strip():
        return None
    return Path(value).expanduser()


def save_last_vault_path(vault_root: Path) -> None:
    path = app_state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp")
    temporary_path.write_text(
        json.dumps({"last_vault_path": str(vault_root)}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(path)
