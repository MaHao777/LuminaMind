from __future__ import annotations

import sqlite3
from pathlib import Path


SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    type TEXT,
    tags TEXT,
    content TEXT,
    importance INTEGER DEFAULT 3,
    confidence REAL DEFAULT 0.9,
    source TEXT DEFAULT 'manual',
    status TEXT DEFAULT 'active',
    created_at TEXT,
    updated_at TEXT,
    file_hash TEXT
);

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_note_id TEXT NOT NULL,
    target_note_title TEXT NOT NULL,
    target_note_id TEXT,
    link_type TEXT DEFAULT 'wikilink',
    FOREIGN KEY (source_note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_text TEXT NOT NULL,
    embedding_id TEXT,
    created_at TEXT,
    updated_at TEXT,
    FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memory_suggestions (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    action TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    type TEXT DEFAULT 'log',
    tags TEXT,
    importance INTEGER DEFAULT 3,
    confidence REAL DEFAULT 0.8,
    target_note_id TEXT,
    reason TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT,
    updated_at TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    note_id UNINDEXED,
    title,
    content,
    tags
);
"""


def db_path(vault_root: Path) -> Path:
    return vault_root / ".agent" / "index.db"


def connect(vault_root: Path) -> sqlite3.Connection:
    path = db_path(vault_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def initialize_database(vault_root: Path) -> None:
    with connect(vault_root) as conn:
        conn.executescript(SCHEMA)

