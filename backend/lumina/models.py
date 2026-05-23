from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field


MemoryType = Literal["profile", "project", "concept", "task", "log"]
MemoryStatus = Literal["active", "outdated", "archived"]
SuggestionAction = Literal["create", "update", "archive", "ignore"]
SuggestionStatus = Literal["pending", "accepted", "rejected"]


class MemoryNote(BaseModel):
    id: str
    title: str
    type: MemoryType = "concept"
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    importance: int = Field(default=3, ge=1, le=5)
    confidence: float = Field(default=0.9, ge=0, le=1)
    source: str = "manual"
    status: MemoryStatus = "active"
    created: str = Field(default_factory=lambda: date.today().isoformat())
    updated: str = Field(default_factory=lambda: date.today().isoformat())
    links: list[str] = Field(default_factory=list)
    path: str = ""
    file_hash: str = ""


class MemoryCreate(BaseModel):
    title: str
    type: MemoryType = "concept"
    content: str
    tags: list[str] = Field(default_factory=list)
    importance: int = Field(default=3, ge=1, le=5)
    confidence: float = Field(default=0.9, ge=0, le=1)
    source: str = "manual"
    status: MemoryStatus = "active"
    links: list[str] = Field(default_factory=list)


class MemoryUpdate(MemoryCreate):
    pass


class VaultInfo(BaseModel):
    root: Path


class ScanSummary(BaseModel):
    scanned_files: int = 0
    indexed_notes: int = 0
    skipped_files: int = 0


class IndexSummary(BaseModel):
    indexed_notes: int = 0
    indexed_chunks: int = 0
    vector_store: str = "fallback-json"


class RetrievalRequest(BaseModel):
    query: str
    top_k: int = Field(default=8, ge=1, le=50)
    include_graph_expand: bool = True


class RetrievalResult(BaseModel):
    memory_id: str
    title: str
    score: float
    reason: str
    path: str
    content: str = ""
    type: str = "concept"
    tags: list[str] = Field(default_factory=list)


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str


class UsedMemory(BaseModel):
    memory_id: str
    title: str
    score: float


class ChatResponse(BaseModel):
    conversation_id: str
    answer: str
    used_memories: list[UsedMemory]


class MemorySuggestion(BaseModel):
    id: str
    conversation_id: str | None = None
    action: SuggestionAction = "create"
    title: str
    content: str
    type: MemoryType = "log"
    tags: list[str] = Field(default_factory=list)
    importance: int = Field(default=3, ge=1, le=5)
    confidence: float = Field(default=0.8, ge=0, le=1)
    target_note_id: str | None = None
    reason: str = ""
    status: SuggestionStatus = "pending"
    created_at: str = ""
    updated_at: str = ""


class GenerateSuggestionsRequest(BaseModel):
    conversation_id: str | None = None


class SelectVaultRequest(BaseModel):
    path: str

