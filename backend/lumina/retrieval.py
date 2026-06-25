from __future__ import annotations

import json
import math
import re
from datetime import date
from pathlib import Path

from .config import AppSettings
from .db import connect
from .embedding import EmbeddingProvider, cosine_similarity, embedding_signature, provider_from_settings
from .indexer import load_vector_index
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


def _load_notes(vault_root: Path, note_ids: set[str] | None = None) -> dict[str, MemoryNote]:
    parameters: tuple[str, ...] = ()
    condition = "status = 'active'"
    if note_ids is not None:
        if not note_ids:
            return {}
        placeholders = ", ".join("?" for _ in note_ids)
        condition += f" AND id IN ({placeholders})"
        parameters = tuple(note_ids)
    with connect(vault_root) as conn:
        rows = conn.execute(f"SELECT * FROM notes WHERE {condition}", parameters).fetchall()
        notes = {row["id"]: _row_note(row) for row in rows}
        if not notes:
            return {}
        placeholders = ", ".join("?" for _ in notes)
        link_rows = conn.execute(
            f"""
            SELECT source_note_id, target_note_title
            FROM links
            WHERE source_note_id IN ({placeholders})
            ORDER BY id
            """,
            tuple(notes),
        ).fetchall()
    for link in link_rows:
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


def _chroma_chunk_candidates(
    vault_root: Path,
    *,
    query_embedding: list[float],
    vector_index: dict,
    candidate_limit: int,
) -> list[tuple[str, float]] | None:
    try:
        import chromadb

        client = chromadb.PersistentClient(path=str(vault_root / ".agent" / "vector_index" / "chroma"))
        collection = client.get_collection("memories")
        metadata = collection.metadata or {}
        vector_count = len(vector_index["vectors"])
        if (
            metadata.get("hnsw:space") != "cosine"
            or metadata.get("embedding_signature") != vector_index["embedding_signature"]
            or metadata.get("vector_count") != vector_count
            or collection.count() != vector_count
        ):
            return None
        if vector_count == 0:
            return []
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=min(candidate_limit, vector_count),
            include=["metadatas", "distances"],
        )
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        candidates: list[tuple[str, float]] = []
        for metadata_item, distance in zip(metadatas, distances, strict=True):
            if not metadata_item or not metadata_item.get("note_id"):
                continue
            similarity = max(0.0, min(1.0, 1.0 - float(distance)))
            candidates.append((str(metadata_item["note_id"]), similarity))
        return candidates
    except Exception:
        return None


def _json_chunk_candidates(
    vector_index: dict,
    *,
    query_embedding: list[float],
    candidate_limit: int,
) -> list[tuple[str, float]]:
    candidates = [
        (str(item["note_id"]), cosine_similarity(query_embedding, item["embedding"]))
        for item in vector_index["vectors"]
        if item.get("note_id") and item.get("embedding")
    ]
    candidates.sort(key=lambda item: item[1], reverse=True)
    return candidates[:candidate_limit]


def _semantic_candidates(
    vault_root: Path,
    query: str,
    provider: EmbeddingProvider,
    settings: AppSettings,
) -> tuple[dict[str, float], bool]:
    vector_index = load_vector_index(vault_root)
    vectors = vector_index["vectors"]
    if not vectors or vector_index["embedding_signature"] != embedding_signature(settings):
        return {}, False
    try:
        query_embedding = provider.embed([query])[0]
    except Exception:
        return {}, False

    chunk_candidates = _chroma_chunk_candidates(
        vault_root,
        query_embedding=query_embedding,
        vector_index=vector_index,
        candidate_limit=settings.retrieval_candidate_limit,
    )
    if chunk_candidates is None:
        chunk_candidates = _json_chunk_candidates(
            vector_index,
            query_embedding=query_embedding,
            candidate_limit=settings.retrieval_candidate_limit,
        )

    scores: dict[str, float] = {}
    for note_id, similarity in chunk_candidates:
        if similarity < settings.retrieval_min_similarity:
            continue
        scores[note_id] = max(scores.get(note_id, 0.0), similarity)
    return scores, True


def _graph_expansion(vault_root: Path, seed_ids: set[str]) -> tuple[set[str], set[str]]:
    if not seed_ids:
        return set(), set()
    placeholders = ", ".join("?" for _ in seed_ids)
    parameters = (*seed_ids, *seed_ids)
    with connect(vault_root) as conn:
        rows = conn.execute(
            f"""
            SELECT links.source_note_id, links.target_note_id
            FROM links
            JOIN notes AS source ON source.id = links.source_note_id
            JOIN notes AS target ON target.id = links.target_note_id
            WHERE source.status = 'active'
              AND target.status = 'active'
              AND links.target_note_id IS NOT NULL
              AND (
                links.source_note_id IN ({placeholders})
                OR links.target_note_id IN ({placeholders})
              )
            """,
            parameters,
        ).fetchall()

    neighbors: set[str] = set()
    linked_candidates: set[str] = set()
    for row in rows:
        source_id = row["source_note_id"]
        target_id = row["target_note_id"]
        if source_id in seed_ids and target_id != source_id:
            neighbors.add(target_id)
            linked_candidates.add(target_id)
        if target_id in seed_ids and source_id != target_id:
            neighbors.add(source_id)
            linked_candidates.add(source_id)
    return neighbors, linked_candidates


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
    effective_settings = settings or AppSettings()
    provider = embedding_provider or provider_from_settings(effective_settings)
    semantic, semantic_available = _semantic_candidates(
        vault_root,
        query,
        provider,
        effective_settings,
    )

    loaded_notes: dict[str, MemoryNote] | None = None
    if semantic_available:
        seed_notes = _load_notes(vault_root, set(semantic))
        seed_ids = set(seed_notes)
        semantic = {note_id: score for note_id, score in semantic.items() if note_id in seed_ids}
        if not seed_ids:
            return []
    else:
        loaded_notes = _load_notes(vault_root)
        if not loaded_notes:
            return []
        fallback_keywords = _keyword_scores(loaded_notes, query)
        seed_ids = {note_id for note_id, score in fallback_keywords.items() if score > 0}
        if not seed_ids:
            return []

    neighbors: set[str] = set()
    linked_candidates: set[str] = set()
    if include_graph_expand:
        neighbors, linked_candidates = _graph_expansion(vault_root, seed_ids)
    candidate_ids = seed_ids | neighbors
    notes = (
        {note_id: note for note_id, note in loaded_notes.items() if note_id in candidate_ids}
        if loaded_notes is not None
        else _load_notes(vault_root, candidate_ids)
    )
    keyword = _keyword_scores(notes, query)

    results: list[RetrievalResult] = []
    for note in notes.values():
        importance = max(0.0, min(1.0, note.importance / 5))
        recency = _recency_score(note)
        link_score = 1.0 if note.id in linked_candidates else 0.0
        score = (
            0.45 * semantic.get(note.id, 0.0)
            + 0.25 * link_score
            + 0.15 * keyword.get(note.id, 0.0)
            + 0.10 * importance
            + 0.05 * recency
        )
        reasons = []
        if semantic.get(note.id, 0) >= effective_settings.retrieval_min_similarity:
            reasons.append("语义相似")
        if keyword.get(note.id, 0) > 0:
            reasons.append("关键词命中")
        if link_score > 0:
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

    return sorted(results, key=lambda item: (-item.score, item.title))[:top_k]
