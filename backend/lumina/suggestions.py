from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .config import AppSettings
from .conversations import load_messages
from .db import connect
from .indexer import rebuild_index
from .llm import generate_memory_suggestion_drafts
from .memory.store import create_memory, get_memory, update_memory
from .models import MemorySuggestion
from .retrieval import retrieve_memories


def _row_to_suggestion(row) -> MemorySuggestion:
    return MemorySuggestion(
        id=row["id"],
        conversation_id=row["conversation_id"],
        action=row["action"],
        title=row["title"] or "未命名记忆",
        content=row["content"],
        type=row["type"] or "log",
        tags=json.loads(row["tags"] or "[]"),
        importance=row["importance"] or 3,
        confidence=row["confidence"] or 0.8,
        target_note_id=row["target_note_id"],
        reason=row["reason"] or "",
        status=row["status"] or "pending",
        created_at=row["created_at"] or "",
        updated_at=row["updated_at"] or "",
    )


def create_suggestion(
    vault_root: Path,
    *,
    conversation_id: str | None,
    title: str,
    content: str,
    action: str = "create",
    note_type: str = "log",
    tags: list[str] | None = None,
    importance: int = 3,
    confidence: float = 0.8,
    reason: str = "",
    target_note_id: str | None = None,
) -> MemorySuggestion:
    now = datetime.now().isoformat(timespec="seconds")
    suggestion_id = f"sug_{uuid4().hex[:12]}"
    with connect(vault_root) as conn:
        conn.execute(
            """
            INSERT INTO memory_suggestions (
                id, conversation_id, action, title, content, type, tags, importance,
                confidence, target_note_id, reason, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            """,
            (
                suggestion_id,
                conversation_id,
                action,
                title,
                content,
                note_type,
                json.dumps(tags or [], ensure_ascii=False),
                importance,
                confidence,
                target_note_id,
                reason,
                now,
                now,
            ),
        )
    return get_suggestion(vault_root, suggestion_id)


def _fallback_draft(messages: list[dict]) -> dict:
    last_user = next((message for message in reversed(messages) if message["role"] == "user"), messages[-1])
    title = last_user["content"].strip().replace("\n", " ")[:32] or "对话摘要"
    content = "\n".join(f"{message['role']}: {message['content']}" for message in messages[-6:])
    return {
        "action": "create",
        "title": f"对话记忆：{title}",
        "type": "log",
        "content": content,
        "tags": ["对话", "LuminaMind"],
        "importance": 3,
        "confidence": 0.8,
        "target_note_id": None,
        "reason": "对话中包含可能影响后续回答的项目上下文，需由用户审查确认。",
    }


def _suggestion_query(messages: list[dict]) -> str:
    return "\n".join(message["content"] for message in messages[-6:])


def _find_existing_pending(
    vault_root: Path,
    *,
    conversation_id: str | None,
    action: str,
    title: str,
    content: str,
) -> MemorySuggestion | None:
    with connect(vault_root) as conn:
        if conversation_id is None:
            row = conn.execute(
                """
                SELECT * FROM memory_suggestions
                WHERE conversation_id IS NULL AND action = ? AND title = ? AND content = ? AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (action, title, content),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT * FROM memory_suggestions
                WHERE conversation_id = ? AND action = ? AND title = ? AND content = ? AND status = 'pending'
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (conversation_id, action, title, content),
            ).fetchone()
    return _row_to_suggestion(row) if row else None


def _apply_review_mode(
    vault_root: Path,
    suggestion: MemorySuggestion,
    settings: AppSettings,
) -> MemorySuggestion:
    if settings.review_mode == "auto":
        return accept_suggestion(vault_root, suggestion.id, settings=settings)
    return suggestion


def generate_suggestions(
    vault_root: Path,
    conversation_id: str | None = None,
    settings: AppSettings | None = None,
) -> list[MemorySuggestion]:
    settings = settings or AppSettings.load(vault_root)
    messages = load_messages(vault_root, conversation_id)
    useful = [message for message in messages if message["role"] in {"user", "assistant"}]
    if not useful:
        suggestion = create_suggestion(
            vault_root,
            conversation_id=conversation_id,
            title="对话摘要",
            content="用户开始使用 LuminaMind 记录长期记忆。",
            tags=["LuminaMind"],
            reason="这是一个可审查的候选记忆，用于验证写入闭环。",
        )
        return [_apply_review_mode(vault_root, suggestion, settings)]

    related_memories = retrieve_memories(
        vault_root,
        _suggestion_query(useful),
        top_k=5,
        include_graph_expand=True,
        settings=settings,
    )
    drafts = generate_memory_suggestion_drafts(settings, useful[-12:], related_memories)
    if not drafts:
        drafts = [_fallback_draft(useful)]

    suggestions: list[MemorySuggestion] = []
    for draft in drafts:
        if draft["action"] == "ignore":
            continue
        existing = _find_existing_pending(
            vault_root,
            conversation_id=conversation_id,
            action=draft["action"],
            title=draft["title"],
            content=draft["content"],
        )
        if existing is not None:
            suggestions.append(existing)
            continue
        created = create_suggestion(
            vault_root,
            conversation_id=conversation_id,
            title=draft["title"],
            content=draft["content"],
            action=draft["action"],
            note_type=draft["type"],
            tags=draft["tags"],
            importance=draft["importance"],
            confidence=draft["confidence"],
            reason=draft["reason"],
            target_note_id=draft["target_note_id"],
        )
        suggestions.append(_apply_review_mode(vault_root, created, settings))
    return suggestions


def list_suggestions(vault_root: Path) -> list[MemorySuggestion]:
    with connect(vault_root) as conn:
        rows = conn.execute("SELECT * FROM memory_suggestions ORDER BY created_at DESC").fetchall()
    return [_row_to_suggestion(row) for row in rows]


def get_suggestion(vault_root: Path, suggestion_id: str) -> MemorySuggestion:
    with connect(vault_root) as conn:
        row = conn.execute("SELECT * FROM memory_suggestions WHERE id = ?", (suggestion_id,)).fetchone()
    if row is None:
        raise KeyError(suggestion_id)
    return _row_to_suggestion(row)


def update_suggestion_status(vault_root: Path, suggestion_id: str, status: str) -> MemorySuggestion:
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        conn.execute(
            "UPDATE memory_suggestions SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, suggestion_id),
        )
    return get_suggestion(vault_root, suggestion_id)


def _transition_suggestion_status(
    vault_root: Path,
    suggestion_id: str,
    expected_status: str,
    next_status: str,
) -> MemorySuggestion | None:
    now = datetime.now().isoformat(timespec="seconds")
    with connect(vault_root) as conn:
        cursor = conn.execute(
            """
            UPDATE memory_suggestions SET status = ?, updated_at = ?
            WHERE id = ? AND status = ?
            """,
            (next_status, now, suggestion_id, expected_status),
        )
    if cursor.rowcount != 1:
        return None
    return get_suggestion(vault_root, suggestion_id)


def reject_suggestion(vault_root: Path, suggestion_id: str) -> MemorySuggestion:
    suggestion = get_suggestion(vault_root, suggestion_id)
    if suggestion.status != "pending":
        return suggestion
    rejected = _transition_suggestion_status(vault_root, suggestion_id, "pending", "rejected")
    return rejected or get_suggestion(vault_root, suggestion_id)


def accept_suggestion(
    vault_root: Path,
    suggestion_id: str,
    settings: AppSettings | None = None,
) -> MemorySuggestion:
    suggestion = get_suggestion(vault_root, suggestion_id)
    if suggestion.status != "pending":
        return suggestion
    claimed = _transition_suggestion_status(vault_root, suggestion_id, "pending", "processing")
    if claimed is None:
        return get_suggestion(vault_root, suggestion_id)
    suggestion = claimed
    should_rebuild = False
    memory_persisted = False
    try:
        if suggestion.action == "create":
            create_memory(
                vault_root,
                title=suggestion.title,
                content=suggestion.content,
                note_type=suggestion.type,
                tags=suggestion.tags,
                importance=suggestion.importance,
                confidence=suggestion.confidence,
                source="chat",
            )
            memory_persisted = True
            should_rebuild = True
        elif suggestion.action == "update" and suggestion.target_note_id:
            current = get_memory(vault_root, suggestion.target_note_id)
            if current is not None:
                update_memory(
                    vault_root,
                    suggestion.target_note_id,
                    title=suggestion.title or current.title,
                    content=suggestion.content,
                    note_type=suggestion.type or current.type,
                    tags=suggestion.tags or current.tags,
                    importance=suggestion.importance,
                    confidence=suggestion.confidence,
                    source="chat",
                    status=current.status,
                    links=current.links,
                )
                memory_persisted = True
                should_rebuild = True
        elif suggestion.action == "archive" and suggestion.target_note_id:
            current = get_memory(vault_root, suggestion.target_note_id)
            if current is not None:
                update_memory(
                    vault_root,
                    suggestion.target_note_id,
                    title=current.title,
                    content=current.content,
                    note_type=current.type,
                    tags=current.tags,
                    importance=current.importance,
                    confidence=current.confidence,
                    source=current.source,
                    status="archived",
                    links=current.links,
                )
                memory_persisted = True
                should_rebuild = True
        accepted = update_suggestion_status(vault_root, suggestion_id, "accepted")
    except Exception:
        if not memory_persisted:
            _transition_suggestion_status(vault_root, suggestion_id, "processing", "pending")
        raise
    if should_rebuild:
        rebuild_index(vault_root, settings=settings or AppSettings.load(vault_root))
    return accepted
