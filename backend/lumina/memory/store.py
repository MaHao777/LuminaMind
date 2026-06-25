from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from ..db import connect, initialize_database
from ..models import MemoryCreate, MemoryNote, MemoryUpdate, ScanSummary
from .markdown import build_markdown, parse_markdown_note


TYPE_DIRS = {
    "profile": "Profile",
    "project": "Projects",
    "concept": "Concepts",
    "task": "Tasks",
    "log": "Logs",
}


def _slugify(title: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", title).strip(" ._")
    return cleaned[:60] or "memory"


def _note_dir(vault_root: Path, note_type: str) -> Path:
    return vault_root / "Memories" / TYPE_DIRS.get(note_type, "Concepts")


def _unique_path(vault_root: Path, title: str, note_type: str) -> Path:
    directory = _note_dir(vault_root, note_type)
    directory.mkdir(parents=True, exist_ok=True)
    base = _slugify(title)
    candidate = directory / f"{base}.md"
    if not candidate.exists():
        return candidate
    return directory / f"{base}-{uuid4().hex[:8]}.md"


def _row_to_note(row) -> MemoryNote:
    return MemoryNote(
        id=row["id"],
        title=row["title"],
        type=row["type"] or "concept",
        content=row["content"] or "",
        tags=json.loads(row["tags"] or "[]"),
        importance=row["importance"] or 3,
        confidence=row["confidence"] or 0.9,
        source=row["source"] or "manual",
        status=row["status"] or "active",
        pinned=bool(row["pinned"]),
        created=row["created_at"] or "",
        updated=row["updated_at"] or "",
        links=[],
        backlinks=[],
        path=row["path"],
        file_hash=row["file_hash"] or "",
    )


def _resolve_link_targets(conn) -> None:
    conn.execute(
        """
        UPDATE links
        SET target_note_id = (
            SELECT notes.id
            FROM notes
            WHERE notes.title = links.target_note_title
            LIMIT 1
        )
        """
    )


def _hydrate_links(vault_root: Path, note: MemoryNote) -> MemoryNote:
    with connect(vault_root) as conn:
        forward_rows = conn.execute(
            "SELECT target_note_title FROM links WHERE source_note_id = ? ORDER BY id",
            (note.id,),
        ).fetchall()
        backlink_rows = conn.execute(
            """
            SELECT notes.title
            FROM links
            JOIN notes ON notes.id = links.source_note_id
            WHERE links.target_note_id = ?
            ORDER BY notes.title
            """,
            (note.id,),
        ).fetchall()
    note.links = list(dict.fromkeys(row["target_note_title"] for row in forward_rows))
    note.backlinks = list(dict.fromkeys(row["title"] for row in backlink_rows))
    return note


def upsert_note(vault_root: Path, note: MemoryNote, *, resolve_links: bool = True) -> None:
    with connect(vault_root) as conn:
        conn.execute(
            """
            INSERT INTO notes (
                id, title, path, type, tags, content, importance, confidence,
                source, status, pinned, created_at, updated_at, file_hash
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                path=excluded.path,
                type=excluded.type,
                tags=excluded.tags,
                content=excluded.content,
                importance=excluded.importance,
                confidence=excluded.confidence,
                source=excluded.source,
                status=excluded.status,
                pinned=excluded.pinned,
                created_at=excluded.created_at,
                updated_at=excluded.updated_at,
                file_hash=excluded.file_hash
            """,
            (
                note.id,
                note.title,
                note.path,
                note.type,
                json.dumps(note.tags, ensure_ascii=False),
                note.content,
                note.importance,
                note.confidence,
                note.source,
                note.status,
                int(note.pinned),
                note.created,
                note.updated,
                note.file_hash,
            ),
        )
        conn.execute("DELETE FROM links WHERE source_note_id = ?", (note.id,))
        for link in note.links:
            conn.execute(
                """
                INSERT INTO links (source_note_id, target_note_title, target_note_id, link_type)
                VALUES (?, ?, (SELECT id FROM notes WHERE title = ? LIMIT 1), 'wikilink')
                """,
                (note.id, link, link),
            )
        if resolve_links:
            _resolve_link_targets(conn)
        conn.execute("DELETE FROM notes_fts WHERE note_id = ?", (note.id,))
        conn.execute(
            "INSERT INTO notes_fts (note_id, title, content, tags) VALUES (?, ?, ?, ?)",
            (note.id, note.title, note.content, " ".join(note.tags)),
        )


def scan_vault(vault_root: Path) -> ScanSummary:
    initialize_database(vault_root)
    summary = ScanSummary()
    search_roots = [vault_root / "Memories", vault_root / "Inbox"]
    markdown_files = [path for root in search_roots if root.exists() for path in root.rglob("*.md")]

    with connect(vault_root) as conn:
        conn.execute("DELETE FROM links")
        conn.execute("DELETE FROM chunks")
        conn.execute("DELETE FROM notes")
        conn.execute("DELETE FROM notes_fts")

    for path in markdown_files:
        summary.scanned_files += 1
        try:
            raw = path.read_text(encoding="utf-8")
            note = parse_markdown_note(raw, path.resolve())
            upsert_note(vault_root, note, resolve_links=False)
            summary.indexed_notes += 1
        except Exception:
            summary.skipped_files += 1
    with connect(vault_root) as conn:
        _resolve_link_targets(conn)
    return summary


def list_memories(vault_root: Path) -> list[MemoryNote]:
    with connect(vault_root) as conn:
        rows = conn.execute("SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC, title ASC").fetchall()
    return [_hydrate_links(vault_root, _row_to_note(row)) for row in rows]


def get_memory(vault_root: Path, memory_id: str) -> MemoryNote | None:
    with connect(vault_root) as conn:
        row = conn.execute("SELECT * FROM notes WHERE id = ?", (memory_id,)).fetchone()
    return _hydrate_links(vault_root, _row_to_note(row)) if row else None


def create_memory(vault_root: Path, **kwargs) -> MemoryNote:
    if "note_type" in kwargs and "type" not in kwargs:
        kwargs["type"] = kwargs.pop("note_type")
    data = MemoryCreate(**kwargs)
    note_id = f"mem_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:6]}"
    path = _unique_path(vault_root, data.title, data.type)
    raw = build_markdown(
        title=data.title,
        note_type=data.type,
        content=data.content,
        tags=data.tags,
        links=data.links,
        importance=data.importance,
        confidence=data.confidence,
        source=data.source,
        status=data.status,
        note_id=note_id,
    )
    path.write_text(raw, encoding="utf-8")
    note = parse_markdown_note(raw, path.resolve())
    upsert_note(vault_root, note)
    return note


def update_memory(vault_root: Path, memory_id: str, **kwargs) -> MemoryNote | None:
    current = get_memory(vault_root, memory_id)
    if current is None:
        return None
    if "note_type" in kwargs and "type" not in kwargs:
        kwargs["type"] = kwargs.pop("note_type")
    data = MemoryUpdate(**kwargs)
    raw = build_markdown(
        title=data.title,
        note_type=data.type,
        content=data.content,
        tags=data.tags,
        links=data.links,
        importance=data.importance,
        confidence=data.confidence,
        source=data.source,
        status=data.status,
        pinned=current.pinned,
        note_id=current.id,
        created=current.created,
    )
    path = Path(current.path)
    path.write_text(raw, encoding="utf-8")
    note = parse_markdown_note(raw, path.resolve())
    upsert_note(vault_root, note)
    return note


def update_memory_pin(vault_root: Path, memory_id: str, pinned: bool) -> MemoryNote | None:
    current = get_memory(vault_root, memory_id)
    if current is None:
        return None
    raw = build_markdown(
        title=current.title,
        note_type=current.type,
        content=current.content,
        tags=current.tags,
        links=current.links,
        importance=current.importance,
        confidence=current.confidence,
        source=current.source,
        status=current.status,
        pinned=pinned,
        note_id=current.id,
        created=current.created,
        updated=current.updated,
    )
    path = Path(current.path)
    path.write_text(raw, encoding="utf-8")
    note = parse_markdown_note(raw, path.resolve())
    upsert_note(vault_root, note)
    return note


def delete_memory(vault_root: Path, memory_id: str) -> bool:
    current = get_memory(vault_root, memory_id)
    if current is None:
        return False
    path = Path(current.path)
    if path.exists():
        path.unlink()
    with connect(vault_root) as conn:
        conn.execute("UPDATE links SET target_note_id = NULL WHERE target_note_id = ?", (memory_id,))
        conn.execute("DELETE FROM notes WHERE id = ?", (memory_id,))
        conn.execute("DELETE FROM notes_fts WHERE note_id = ?", (memory_id,))
    return True
