from __future__ import annotations

from pathlib import Path

from .config import AppSettings
from .db import initialize_database
from .models import VaultInfo


MEMORY_DIRS = [
    "Memories/Profile",
    "Memories/Projects",
    "Memories/Concepts",
    "Memories/Tasks",
    "Memories/Logs",
    "Inbox",
    "Attachments",
    ".agent/cache",
    ".agent/vector_index",
]


def initialize_vault(path: str | Path) -> VaultInfo:
    root = Path(path).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    for relative in MEMORY_DIRS:
        (root / relative).mkdir(parents=True, exist_ok=True)

    initialize_database(root)
    config_path = AppSettings.config_path(root)
    if not config_path.exists():
        AppSettings(vault_path=str(root)).save(root)
    return VaultInfo(root=root)

