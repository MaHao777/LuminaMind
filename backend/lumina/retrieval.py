from __future__ import annotations

import json
import math
import re
from datetime import date
from pathlib import Path

from .config import AppSettings
from .db import connect
from .embedding import EmbeddingProvider, cosine_similarity, provider_from_settings
from .indexer import load_vectors
from .models import MemoryNote, RetrievalResult


TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]")


def _tokens(text: str) -> set[str]:
    return {token.lower() for token in TOKEN_RE.findall(text)}


def _row_note(row) -> MemoryNote:
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
        created=row["created_at"] or "",
        updated=row["updated_at"] or "",
        path=row["path"],
        file_hash=row["file_hash"] or "",
    )


def _load_notes(vault_root: Path) -> dict[str, MemoryNote]:
    with connect(vault_root) as conn:
        rows = conn.execute("SELECT * FROM notes WHERE status = 'active'").fetchall()
        link_rows = conn.execute("SELECT source_note_id, target_note_title FROM links").fetchall()
    notes = {row["id"]: _row_note(row) for row in rows}
    for link in link_rows:
        if link["source_note_id"] in notes:
            notes[link["source_note_id"]].links.append(link["target_note_title"])
    return notes


def _keyword_scores(notes: dict[str, MemoryNote], query: str) -> dict[str, float]:
    query_tokens = _tokens(query)
    scores: dict[str, float] = {}
    for note in notes.values():
        text = f"{note.title} {note.content} {' '.join(note.tags)}".lower()
        note_tokens = _tokens(text)
        overlap = len(query_tokens & note_tokens)
        direct = sum(1 for token in query_tokens if token and token in text)
        denominator = max(1, len(query_tokens))
        scores[note.id] = min(1.0, (overlap + direct * 0.5) / denominator)
    return scores


def _semantic_scores(
    vault_root: Path,
    notes: dict[str, MemoryNote],
    query: str,
    provider: EmbeddingProvider,
) -> dict[str, float]:
    vectors = load_vectors(vault_root)
    if not vectors:
        return {note_id: 0.0 for note_id in notes}
    query_embedding = provider.embed([query])[0]
    scores: dict[str, float] = {note_id: 0.0 for note_id in notes}
    for item in vectors:
        note_id = item["note_id"]
        if note_id not in scores:
            continue
        similarity = cosine_similarity(query_embedding, item["embedding"])
        scores[note_id] = max(scores[note_id], similarity)
    return scores


def _link_scores(notes: dict[str, MemoryNote], query: str, keyword_scores: dict[str, float]) -> dict[str, float]:
    scores = {note_id: 0.0 for note_id in notes}
    title_to_id = {note.title: note.id for note in notes.values()}
    query_lower = query.lower()

    for note in notes.values():
        for link in note.links:
            if link.lower() in query_lower:
                scores[note.id] = max(scores[note.id], 1.0)
            linked_id = title_to_id.get(link)
            if linked_id and keyword_scores.get(note.id, 0) > 0:
                scores[linked_id] = max(scores[linked_id], 0.75)
    return scores


def _recency_score(note: MemoryNote) -> float:
    try:
        updated = date.fromisoformat(note.updated[:10])
    except Exception:
        return 0.5
    age_days = max(0, (date.today() - updated).days)
    return math.exp(-age_days / 365)


def retrieve_memories(
    vault_root: Path,
    query: str,
    top_k: int = 8,
    include_graph_expand: bool = True,
    embedding_provider: EmbeddingProvider | None = None,
    settings: AppSettings | None = None,
) -> list[RetrievalResult]:
    notes = _load_notes(vault_root)
    if not notes:
        return []

    provider = embedding_provider or provider_from_settings(settings)
    keyword = _keyword_scores(notes, query)
    semantic = _semantic_scores(vault_root, notes, query, provider)
    link = _link_scores(notes, query, keyword) if include_graph_expand else {note_id: 0.0 for note_id in notes}

    results: list[RetrievalResult] = []
    for note in notes.values():
        importance = max(0.0, min(1.0, note.importance / 5))
        recency = _recency_score(note)
        score = (
            0.45 * semantic.get(note.id, 0.0)
            + 0.20 * keyword.get(note.id, 0.0)
            + 0.15 * link.get(note.id, 0.0)
            + 0.10 * importance
            + 0.10 * recency
        )
        reasons = []
        if semantic.get(note.id, 0) > 0.05:
            reasons.append("语义相似")
        if keyword.get(note.id, 0) > 0:
            reasons.append("关键词命中")
        if link.get(note.id, 0) > 0:
            reasons.append("双链关联")
        if importance >= 0.8:
            reasons.append("重要度高")
        results.append(
            RetrievalResult(
                memory_id=note.id,
                title=note.title,
                score=round(score, 4),
                reason=" + ".join(reasons) or "基础相关性",
                path=note.path,
                content=note.content,
                type=note.type,
                tags=note.tags,
            )
        )

    return sorted(results, key=lambda item: item.score, reverse=True)[:top_k]

