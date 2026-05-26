from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from .config import AppSettings
from .db import connect
from .embedding import EmbeddingProvider, provider_from_settings
from .models import IndexSummary


def split_text(text: str, chunk_size: int = 900, overlap: int = 120) -> list[str]:
    clean = text.strip()
    if not clean:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(clean):
        end = min(len(clean), start + chunk_size)
        chunks.append(clean[start:end])
        if end == len(clean):
            break
        start = max(end - overlap, start + 1)
    return chunks


def _fallback_vector_path(vault_root: Path) -> Path:
    return vault_root / ".agent" / "vector_index" / "fallback_vectors.json"


def rebuild_index(
    vault_root: Path,
    embedding_provider: EmbeddingProvider | None = None,
    settings: AppSettings | None = None,
) -> IndexSummary:
    provider = embedding_provider or provider_from_settings(settings)
    now = datetime.now().isoformat(timespec="seconds")
    vectors: list[dict] = []

    with connect(vault_root) as conn:
        notes = conn.execute("SELECT id, title, content FROM notes ORDER BY title").fetchall()
        conn.execute("DELETE FROM chunks")
        for note in notes:
            parts = split_text(f"{note['title']}\n\n{note['content']}")
            embeddings = provider.embed(parts) if parts else []
            for index, chunk_text in enumerate(parts):
                chunk_id = f"{note['id']}::chunk::{index}"
                conn.execute(
                    """
                    INSERT INTO chunks (id, note_id, chunk_index, chunk_text, embedding_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (chunk_id, note["id"], index, chunk_text, chunk_id, now, now),
                )
                vectors.append(
                    {
                        "id": chunk_id,
                        "note_id": note["id"],
                        "chunk_index": index,
                        "text": chunk_text,
                        "embedding": embeddings[index],
                    }
                )

    vector_path = _fallback_vector_path(vault_root)
    vector_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = vector_path.with_name(f".{vector_path.name}.{uuid4().hex}.tmp")
    try:
        temporary_path.write_text(json.dumps(vectors, ensure_ascii=False), encoding="utf-8")
        temporary_path.replace(vector_path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()

    vector_store = "fallback-json"
    try:
        import chromadb

        client = chromadb.PersistentClient(path=str(vault_root / ".agent" / "vector_index" / "chroma"))
        try:
            client.delete_collection("memories")
        except Exception:
            pass
        collection = client.get_or_create_collection("memories")
        if vectors:
            collection.add(
                ids=[item["id"] for item in vectors],
                documents=[item["text"] for item in vectors],
                embeddings=[item["embedding"] for item in vectors],
                metadatas=[{"note_id": item["note_id"], "chunk_index": item["chunk_index"]} for item in vectors],
            )
        vector_store = "chroma"
    except Exception:
        vector_store = "fallback-json"

    return IndexSummary(indexed_notes=len(notes), indexed_chunks=len(vectors), vector_store=vector_store)


def index_status(vault_root: Path) -> dict:
    with connect(vault_root) as conn:
        notes = conn.execute("SELECT COUNT(*) AS count FROM notes").fetchone()["count"]
        chunks = conn.execute("SELECT COUNT(*) AS count FROM chunks").fetchone()["count"]
    return {
        "indexed_notes": notes,
        "indexed_chunks": chunks,
        "vector_store": "chroma" if (vault_root / ".agent" / "vector_index" / "chroma").exists() else "fallback-json",
    }


def load_vectors(vault_root: Path) -> list[dict]:
    path = _fallback_vector_path(vault_root)
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))
