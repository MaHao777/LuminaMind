from __future__ import annotations

import logging
from pathlib import Path
from threading import Lock
from typing import Literal

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from lumina.config import AppSettings
from lumina.embedding import EmbeddingConfigurationError, embedding_signature
from lumina.conversations import (
    add_message,
    create_conversation,
    delete_conversation,
    ensure_conversation,
    get_conversation,
    list_conversations,
    load_chat_messages,
    load_messages,
    load_used_memories,
    save_used_memories,
    update_conversation_pin,
)
from lumina.indexer import index_status, rebuild_index
from lumina.llm import ContextWindowExceededError, LLMUnavailableError, generate_answer, select_conversation_history
from lumina.memory.store import (
    create_memory,
    delete_memory,
    get_memory,
    list_memories,
    scan_vault,
    update_memory,
    update_memory_pin,
)
from lumina.models import (
    ChatRequest,
    ChatResponse,
    ConversationCreate,
    ConversationUpdate,
    GenerateSuggestionsRequest,
    MemoryCreate,
    MemoryPinUpdate,
    MemoryUpdate,
    RetrievalRequest,
    SelectVaultRequest,
    UsedMemory,
)
from lumina.retrieval import retrieve_memories
from lumina.suggestions import (
    accept_suggestion,
    generate_suggestions,
    list_suggestions,
    reject_suggestion,
    update_suggestion_status,
)
from lumina.vault import initialize_vault


logger = logging.getLogger(__name__)


class AppState:
    vault_root: Path | None = None


state = AppState()
app = FastAPI(title="LuminaMind Agent")
_index_locks_guard = Lock()
_index_locks: dict[Path, Lock] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_vault() -> Path:
    if state.vault_root is None:
        raise HTTPException(status_code=400, detail="Vault is not selected")
    return state.vault_root


def index_lock(vault_root: Path) -> Lock:
    with _index_locks_guard:
        return _index_locks.setdefault(vault_root.resolve(), Lock())


def refresh_index(vault_root: Path, settings: AppSettings, scan_first: bool = False):
    with index_lock(vault_root):
        if scan_first:
            scan_vault(vault_root)
        return rebuild_index(vault_root, settings=settings)


def refresh_index_request(vault_root: Path, settings: AppSettings, scan_first: bool = False):
    try:
        return refresh_index(vault_root, settings, scan_first=scan_first)
    except EmbeddingConfigurationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None


def background_refresh_index(vault_root: Path) -> None:
    try:
        refresh_index(vault_root, AppSettings.load(vault_root), scan_first=True)
    except Exception:
        logger.exception("Background index refresh failed for %s", vault_root)


def chat_memory_index_refresh_required(vault_root: Path, settings: AppSettings) -> bool:
    status = index_status(vault_root, settings)
    return (
        status["indexed_notes"] == 0
        or status["indexed_chunks"] == 0
        or status["embedding_index_stale"]
    )


def resolve_chat_settings(settings: AppSettings, chat_model_id: str | None) -> AppSettings:
    try:
        return settings.with_chat_model(chat_model_id)
    except ValueError:
        raise HTTPException(status_code=422, detail="Selected chat model is not a configured chat model.") from None


@app.get("/api/settings")
def get_settings() -> dict:
    settings = AppSettings.load(state.vault_root)
    return settings.model_dump()


@app.post("/api/settings")
def post_settings(settings: AppSettings, background_tasks: BackgroundTasks) -> dict:
    previous_settings = AppSettings.load(state.vault_root) if state.vault_root else None
    if settings.vault_path:
        vault = initialize_vault(settings.vault_path)
        state.vault_root = vault.root
    vault_root = require_vault()
    settings.save(vault_root)
    if previous_settings and embedding_signature(previous_settings) != embedding_signature(settings):
        background_tasks.add_task(background_refresh_index, vault_root)
    return AppSettings.load(vault_root).model_dump()


@app.get("/api/provider-models/openrouter")
def get_openrouter_models(capability: Literal["chat", "embedding"]) -> dict:
    settings = AppSettings.load(state.vault_root)
    suffix = "/models" if capability == "chat" else "/embeddings/models"
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"} if settings.openrouter_api_key else {}
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(f"{settings.openrouter_base_url.rstrip('/')}{suffix}", headers=headers)
            response.raise_for_status()
            items = response.json().get("data", [])
    except Exception as exc:
        raise HTTPException(status_code=502, detail="OpenRouter model catalog is unavailable.") from exc
    return {
        "models": [
            {"id": item["id"], "name": item.get("name") or item["id"]}
            for item in items
            if isinstance(item, dict) and item.get("id")
        ]
    }


@app.post("/api/vault/select")
def select_vault(request: SelectVaultRequest) -> dict:
    vault = initialize_vault(request.path)
    state.vault_root = vault.root
    return {"path": str(vault.root)}


@app.post("/api/vault/scan")
def scan_selected_vault() -> dict:
    summary = scan_vault(require_vault())
    return summary.model_dump()


@app.get("/api/vault/status")
def vault_status() -> dict:
    vault_root = require_vault()
    return {
        "path": str(vault_root),
        "exists": vault_root.exists(),
        "settings": AppSettings.load(vault_root).model_dump(),
        "index": index_status(vault_root, AppSettings.load(vault_root)),
    }


@app.get("/api/memories")
def api_list_memories() -> dict:
    return {"memories": [memory.model_dump() for memory in list_memories(require_vault())]}


@app.get("/api/memories/{memory_id}")
def api_get_memory(memory_id: str) -> dict:
    memory = get_memory(require_vault(), memory_id)
    if memory is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return memory.model_dump()


@app.post("/api/memories")
def api_create_memory(payload: MemoryCreate) -> dict:
    memory = create_memory(
        require_vault(),
        title=payload.title,
        content=payload.content,
        note_type=payload.type,
        tags=payload.tags,
        importance=payload.importance,
        confidence=payload.confidence,
        source=payload.source,
        status=payload.status,
        links=payload.links,
    )
    return memory.model_dump()


@app.put("/api/memories/{memory_id}")
def api_update_memory(memory_id: str, payload: MemoryUpdate) -> dict:
    memory = update_memory(
        require_vault(),
        memory_id,
        title=payload.title,
        content=payload.content,
        note_type=payload.type,
        tags=payload.tags,
        importance=payload.importance,
        confidence=payload.confidence,
        source=payload.source,
        status=payload.status,
        links=payload.links,
    )
    if memory is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return memory.model_dump()


@app.patch("/api/memories/{memory_id}")
def api_update_memory_pin(memory_id: str, payload: MemoryPinUpdate) -> dict:
    memory = update_memory_pin(require_vault(), memory_id, payload.pinned)
    if memory is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return memory.model_dump()


@app.delete("/api/memories/{memory_id}")
def api_delete_memory(memory_id: str) -> dict:
    vault_root = require_vault()
    deleted = delete_memory(vault_root, memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    refresh_index(vault_root, AppSettings.load(vault_root))
    return {"deleted": True}


@app.post("/api/index/rebuild")
def api_rebuild_index() -> dict:
    vault_root = require_vault()
    summary = refresh_index_request(vault_root, AppSettings.load(vault_root))
    return summary.model_dump()


@app.post("/api/index/update")
def api_update_index() -> dict:
    vault_root = require_vault()
    summary = refresh_index_request(vault_root, AppSettings.load(vault_root), scan_first=True)
    return summary.model_dump()


@app.get("/api/index/status")
def api_index_status() -> dict:
    vault_root = require_vault()
    return index_status(vault_root, AppSettings.load(vault_root))


@app.post("/api/retrieve")
def api_retrieve(payload: RetrievalRequest) -> dict:
    vault_root = require_vault()
    results = retrieve_memories(
        vault_root,
        payload.query,
        top_k=payload.top_k,
        include_graph_expand=payload.include_graph_expand,
        settings=AppSettings.load(vault_root),
    )
    return {"results": [result.model_dump() for result in results]}


@app.get("/api/conversations")
def api_list_conversations(query: str = "") -> dict:
    return {
        "conversations": [
            conversation.model_dump() for conversation in list_conversations(require_vault(), query=query)
        ]
    }


@app.post("/api/conversations")
def api_create_conversation(payload: ConversationCreate) -> dict:
    conversation = create_conversation(require_vault(), payload.title)
    return conversation.model_dump()


@app.patch("/api/conversations/{conversation_id}")
def api_update_conversation(conversation_id: str, payload: ConversationUpdate) -> dict:
    try:
        return update_conversation_pin(require_vault(), conversation_id, payload.pinned).model_dump()
    except KeyError:
        raise HTTPException(status_code=404, detail="Conversation not found") from None


@app.delete("/api/conversations/{conversation_id}")
def api_delete_conversation(conversation_id: str) -> dict:
    deleted = delete_conversation(require_vault(), conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": True}


@app.get("/api/conversations/{conversation_id}/messages")
def api_get_conversation_messages(conversation_id: str) -> dict:
    try:
        get_conversation(require_vault(), conversation_id)
        messages = load_chat_messages(require_vault(), conversation_id)
        used_memories = load_used_memories(require_vault(), conversation_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Conversation not found") from None
    return {
        "messages": [message.model_dump() for message in messages],
        "used_memories": [memory.model_dump() for memory in used_memories],
    }


@app.post("/api/chat")
def api_chat(payload: ChatRequest) -> dict:
    vault_root = require_vault()
    settings = resolve_chat_settings(AppSettings.load(vault_root), payload.chat_model_id)
    memory_index_refresh_required = chat_memory_index_refresh_required(vault_root, settings)
    all_history = load_messages(vault_root, payload.conversation_id) if payload.conversation_id else []
    memories = retrieve_memories(vault_root, payload.message, settings=settings)
    try:
        conversation_history = select_conversation_history(settings, payload.message, memories, all_history)
    except ContextWindowExceededError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    try:
        answer = generate_answer(settings, payload.message, memories, conversation_history)
    except LLMUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from None
    conversation_id = ensure_conversation(vault_root, payload.conversation_id, payload.message[:40])
    add_message(vault_root, conversation_id, "user", payload.message)
    add_message(vault_root, conversation_id, "assistant", answer)
    used_memories = [
        UsedMemory(memory_id=memory.memory_id, title=memory.title, score=memory.score)
        for memory in memories[:8]
    ]
    save_used_memories(vault_root, conversation_id, used_memories)
    response = ChatResponse(
        conversation_id=conversation_id,
        answer=answer,
        used_memories=used_memories,
        memory_suggestions=[],
        memory_index_refresh_required=memory_index_refresh_required,
    )
    return response.model_dump()


@app.post("/api/memory-suggestions/generate")
def api_generate_suggestions(payload: GenerateSuggestionsRequest | None = None) -> dict:
    conversation_id = payload.conversation_id if payload else None
    vault_root = require_vault()
    settings = resolve_chat_settings(AppSettings.load(vault_root), payload.chat_model_id if payload else None)
    suggestions = generate_suggestions(vault_root, conversation_id, settings=settings)
    return {"suggestions": [suggestion.model_dump() for suggestion in suggestions]}


@app.get("/api/memory-suggestions")
def api_list_suggestions() -> dict:
    return {"suggestions": [suggestion.model_dump() for suggestion in list_suggestions(require_vault())]}


@app.post("/api/memory-suggestions/{suggestion_id}/accept")
def api_accept_suggestion(suggestion_id: str) -> dict:
    vault_root = require_vault()
    return accept_suggestion(vault_root, suggestion_id, settings=AppSettings.load(vault_root)).model_dump()


@app.post("/api/memory-suggestions/{suggestion_id}/reject")
def api_reject_suggestion(suggestion_id: str) -> dict:
    return reject_suggestion(require_vault(), suggestion_id).model_dump()


@app.post("/api/memory-suggestions/{suggestion_id}/edit")
def api_edit_suggestion(suggestion_id: str, payload: MemoryCreate) -> dict:
    # MVP: editing applies the supplied content by creating a replacement pending suggestion.
    vault_root = require_vault()
    rejected = update_suggestion_status(vault_root, suggestion_id, "rejected")
    created = create_memory(
        vault_root,
        title=payload.title,
        content=payload.content,
        note_type=payload.type,
        tags=payload.tags,
        importance=payload.importance,
        confidence=payload.confidence,
        source=payload.source,
        links=payload.links,
    )
    refresh_index(vault_root, AppSettings.load(vault_root))
    return {"previous": rejected.model_dump(), "memory": created.model_dump()}
