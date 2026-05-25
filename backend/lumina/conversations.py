from __future__ import annotations

from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .db import connect
from .models import ChatMessage, ConversationSummary


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


def create_conversation(vault_root: Path, title: str = "New conversation") -> ConversationSummary:
    conv_id = f"conv_{uuid4().hex[:12]}"
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conv_id, title or "New conversation", now, now),
        )
    return get_conversation(vault_root, conv_id)


def delete_conversation(vault_root: Path, conversation_id: str) -> bool:
    with connect(vault_root) as conn:
        row = conn.execute("SELECT id FROM conversations WHERE id = ?", (conversation_id,)).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM memory_suggestions WHERE conversation_id = ?", (conversation_id,))
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return True


def list_conversations(vault_root: Path) -> list[ConversationSummary]:
    with connect(vault_root) as conn:
        rows = conn.execute(
            """
            SELECT
                conversations.id,
                conversations.title,
                conversations.created_at,
                conversations.updated_at,
                COUNT(messages.id) AS message_count
            FROM conversations
            LEFT JOIN messages ON messages.conversation_id = conversations.id
            GROUP BY conversations.id
            ORDER BY conversations.updated_at DESC, conversations.created_at DESC
            """
        ).fetchall()
    return [_row_to_conversation(row) for row in rows]


def get_conversation(vault_root: Path, conversation_id: str) -> ConversationSummary:
    with connect(vault_root) as conn:
        row = conn.execute(
            """
            SELECT
                conversations.id,
                conversations.title,
                conversations.created_at,
                conversations.updated_at,
                COUNT(messages.id) AS message_count
            FROM conversations
            LEFT JOIN messages ON messages.conversation_id = conversations.id
            WHERE conversations.id = ?
            GROUP BY conversations.id
            """,
            (conversation_id,),
        ).fetchone()
    if row is None:
        raise KeyError(conversation_id)
    return _row_to_conversation(row)


def _row_to_conversation(row) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=row["title"] or "Untitled",
        created_at=row["created_at"] or "",
        updated_at=row["updated_at"] or "",
        message_count=row["message_count"] or 0,
    )


def add_message(vault_root: Path, conversation_id: str, role: str, content: str) -> None:
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            (f"msg_{uuid4().hex[:12]}", conversation_id, role, content, now),
        )
        conn.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conversation_id))


def load_messages(vault_root: Path, conversation_id: str | None, limit: int | None = None) -> list[dict]:
    with connect(vault_root) as conn:
        if conversation_id:
            if limit:
                rows = conn.execute(
                    """
                    SELECT id, conversation_id, role, content, created_at FROM (
                        SELECT rowid AS sort_id, id, conversation_id, role, content, created_at
                        FROM messages
                        WHERE conversation_id = ?
                        ORDER BY rowid DESC
                        LIMIT ?
                    )
                    ORDER BY sort_id ASC
                    """,
                    (conversation_id, limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, conversation_id, role, content, created_at
                    FROM messages
                    WHERE conversation_id = ?
                    ORDER BY rowid ASC
                    """,
                    (conversation_id,),
                ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, conversation_id, role, content, created_at FROM messages ORDER BY rowid ASC"
            ).fetchall()
    return [dict(row) for row in rows]


def load_chat_messages(vault_root: Path, conversation_id: str) -> list[ChatMessage]:
    return [ChatMessage(**message) for message in load_messages(vault_root, conversation_id)]
