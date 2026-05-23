from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from lumina.config import AppSettings
from lumina.conversations import add_message, ensure_conversation
from lumina.indexer import index_status, rebuild_index
from lumina.llm import generate_answer
from lumina.memory.store import create_memory, delete_memory, get_memory, list_memories, scan_vault, update_memory
from lumina.models import (
    ChatRequest,
    ChatResponse,
    GenerateSuggestionsRequest,
    MemoryCreate,
    MemoryUpdate,
    RetrievalRequest,
    SelectVaultRequest,
    UsedMemory,
)
from lumina.retrieval import retrieve_memories
from lumina.suggestions import accept_suggestion, generate_suggestions, list_suggestions, update_suggestion_status
from lumina.vault import initialize_vault


class AppState:
    vault_root: Path | None = None


state = AppState()
app = FastAPI(title="LuminaMind Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def require_vault() -> Path:
    if state.vault_root is None:
        raise HTTPException(status_code=400, detail="Vault is not selected")
    return state.vault_root


@app.get("/api/settings")
def get_settings() -> dict:
    settings = AppSettings.load(state.vault_root)
    return settings.model_dump()


@app.post("/api/settings")
def post_settings(settings: AppSettings) -> dict:
    if settings.vault_path:
        vault = initialize_vault(settings.vault_path)
        state.vault_root = vault.root
    vault_root = require_vault()
    settings.save(vault_root)
    return AppSettings.load(vault_root).model_dump()


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
        "index": index_status(vault_root),
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


@app.delete("/api/memories/{memory_id}")
def api_delete_memory(memory_id: str) -> dict:
    deleted = delete_memory(require_vault(), memory_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"deleted": True}


@app.post("/api/index/rebuild")
def api_rebuild_index() -> dict:
    vault_root = require_vault()
    summary = rebuild_index(vault_root, settings=AppSettings.load(vault_root))
    return summary.model_dump()


@app.post("/api/index/update")
def api_update_index() -> dict:
    vault_root = require_vault()
    scan_vault(vault_root)
    summary = rebuild_index(vault_root, settings=AppSettings.load(vault_root))
    return summary.model_dump()


@app.get("/api/index/status")
def api_index_status() -> dict:
    return index_status(require_vault())


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


@app.post("/api/chat")
def api_chat(payload: ChatRequest) -> dict:
    vault_root = require_vault()
    conversation_id = ensure_conversation(vault_root, payload.conversation_id, payload.message[:40])
    add_message(vault_root, conversation_id, "user", payload.message)
    memories = retrieve_memories(vault_root, payload.message, settings=AppSettings.load(vault_root))
    answer = generate_answer(AppSettings.load(vault_root), payload.message, memories)
    add_message(vault_root, conversation_id, "assistant", answer)
    response = ChatResponse(
        conversation_id=conversation_id,
        answer=answer,
        used_memories=[
            UsedMemory(memory_id=memory.memory_id, title=memory.title, score=memory.score)
            for memory in memories[:8]
        ],
    )
    return response.model_dump()


@app.post("/api/memory-suggestions/generate")
def api_generate_suggestions(payload: GenerateSuggestionsRequest | None = None) -> dict:
    conversation_id = payload.conversation_id if payload else None
    suggestions = generate_suggestions(require_vault(), conversation_id)
    return {"suggestions": [suggestion.model_dump() for suggestion in suggestions]}


@app.get("/api/memory-suggestions")
def api_list_suggestions() -> dict:
    return {"suggestions": [suggestion.model_dump() for suggestion in list_suggestions(require_vault())]}


@app.post("/api/memory-suggestions/{suggestion_id}/accept")
def api_accept_suggestion(suggestion_id: str) -> dict:
    return accept_suggestion(require_vault(), suggestion_id).model_dump()


@app.post("/api/memory-suggestions/{suggestion_id}/reject")
def api_reject_suggestion(suggestion_id: str) -> dict:
    return update_suggestion_status(require_vault(), suggestion_id, "rejected").model_dump()


@app.post("/api/memory-suggestions/{suggestion_id}/edit")
def api_edit_suggestion(suggestion_id: str, payload: MemoryCreate) -> dict:
    # MVP: editing applies the supplied content by creating a replacement pending suggestion.
    rejected = update_suggestion_status(require_vault(), suggestion_id, "rejected")
    created = create_memory(
        require_vault(),
        title=payload.title,
        content=payload.content,
        note_type=payload.type,
        tags=payload.tags,
        importance=payload.importance,
        confidence=payload.confidence,
        source=payload.source,
        links=payload.links,
    )
    return {"previous": rejected.model_dump(), "memory": created.model_dump()}

