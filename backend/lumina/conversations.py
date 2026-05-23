from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .db import connect


def ensure_conversation(vault_root: Path, conversation_id: str | None, title: str = "") -> str:
    conv_id = conversation_id or f"conv_{uuid4().hex[:12]}"
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        conn.execute(
            """
            INSERT INTO conversations (id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at
            """,
            (conv_id, title or "Untitled", now, now),
        )
    return conv_id


def add_message(vault_root: Path, conversation_id: str, role: str, content: str) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (f"msg_{uuid4().hex[:12]}", conversation_id, role, content, now),
        )
        conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation_id))


def load_messages(vault_root: Path, conversation_id: str | None) -> list[dict]:
    with connect(vault_root) as conn:
        if conversation_id:
            rows = conn.execute(
                "SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
                (conversation_id,),
            ).fetchall()
        else:
            rows = conn.execute("SELECT role, content, created_at FROM messages ORDER BY created_at ASC").fetchall()
    return [dict(row) for row in rows]

