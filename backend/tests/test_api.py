from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
from threading import Event, Lock

from fastapi.testclient import TestClient

import main
import lumina.suggestions as suggestions_module
from main import app
from lumina.config import AppSettings, ConfiguredModel
from lumina.conversations import add_message
from lumina.db import db_path
from lumina.indexer import index_status, load_vectors, rebuild_index as real_rebuild_index
from lumina.models import RetrievalResult


def test_health_endpoint_is_available_before_vault_selection() -> None:
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_packaged_file_origin_can_call_backend() -> None:
    client = TestClient(app)

    response = client.options(
        "/api/health",
        headers={
            "Origin": "null",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "null"


def test_api_vault_scan_retrieve_chat_and_review_cycle(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "vault"

    select_response = client.post("/api/vault/select", json={"path": str(vault_path)})
    assert select_response.status_code == 200
    assert select_response.json()["path"] == str(vault_path)

    memory_response = client.post(
        "/api/memories",
        json={
            "title": "个人长期 Agent 项目方向",
            "type": "project",
            "content": "LuminaMind 通过 Markdown 原子笔记、Embedding 和双链检索构建长期记忆。",
            "tags": ["Agent", "Markdown"],
            "importance": 5,
            "links": ["白盒化记忆系统"],
        },
    )
    assert memory_response.status_code == 200
    memory_id = memory_response.json()["id"]

    scan_response = client.post("/api/vault/scan")
    assert scan_response.status_code == 200
    assert scan_response.json()["indexed_notes"] == 1

    index_response = client.post("/api/index/rebuild")
    assert index_response.status_code == 200
    assert index_response.json()["indexed_chunks"] >= 1

    retrieve_response = client.post(
        "/api/retrieve",
        json={
            "query": "长期 Agent 的 Markdown 和 Embedding 路线",
            "top_k": 5,
            "include_graph_expand": True,
        },
    )
    assert retrieve_response.status_code == 200
    first = retrieve_response.json()["results"][0]
    assert first["memory_id"] == memory_id
    assert first["score"] > 0
    monkeypatch.setattr(
        main,
        "generate_answer",
        lambda settings, user_message, memories, conversation_history: "Markdown memory answer",
    )

    chat_response = client.post(
        "/api/chat",
        json={
            "conversation_id": "conv_test",
            "message": "我这个 Agent 项目第一版应该先做什么？",
        },
    )
    assert chat_response.status_code == 200
    chat_payload = chat_response.json()
    assert "Markdown" in chat_payload["answer"]
    assert chat_payload["used_memories"][0]["memory_id"] == memory_id

    generate_response = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": "conv_test"},
    )
    assert generate_response.status_code == 200
    suggestion = generate_response.json()["suggestions"][0]
    assert suggestion["status"] == "pending"

    accept_response = client.post(f"/api/memory-suggestions/{suggestion['id']}/accept")
    assert accept_response.status_code == 200
    assert accept_response.json()["status"] == "accepted"

    all_memories = client.get("/api/memories").json()["memories"]
    assert len(all_memories) >= 2


def test_api_updates_and_deletes_memory_files(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "vault2"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    created = client.post(
        "/api/memories",
        json={
            "title": "旧标题",
            "type": "concept",
            "content": "旧内容",
            "tags": [],
            "importance": 3,
        },
    ).json()

    updated = client.put(
        f"/api/memories/{created['id']}",
        json={
            "title": "新标题",
            "type": "concept",
            "content": "新内容包含双链 [[长期记忆]]。",
            "tags": ["更新"],
            "importance": 4,
            "links": ["长期记忆"],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "新标题"
    indexed = client.post("/api/index/rebuild")
    assert indexed.status_code == 200
    assert load_vectors(vault_path)

    deleted = client.delete(f"/api/memories/{created['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert not Path(created["path"]).exists()
    assert load_vectors(vault_path) == []

    missing = client.delete(f"/api/memories/{created['id']}")
    assert missing.status_code == 404


def test_openrouter_catalog_proxy_uses_capability_specific_endpoints(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "catalog-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    AppSettings(
        vault_path=str(vault_path),
        openrouter_base_url="https://catalog.example/api/v1",
        configured_models=[
            ConfiguredModel(
                id="router-chat",
                name="Router Chat",
                provider="openrouter",
                capability="chat",
                model="provider/chat-model",
                api_key="catalog-key",
            ),
            ConfiguredModel(
                id="local-embedding",
                name="Local Hash",
                provider="local_hash",
                capability="embedding",
                model="local-hash-384",
            ),
        ],
        chat_model_id="router-chat",
        embedding_model_id="local-embedding",
    ).save(vault_path)
    requests: list[tuple[str, dict]] = []

    class FakeResponse:
        def __init__(self, url: str) -> None:
            self.url = url

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "data": [
                    {
                        "id": "provider/embed-model" if "embeddings" in self.url else "provider/chat-model",
                        "name": "Catalog model",
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def get(self, url: str, **kwargs) -> FakeResponse:
            requests.append((url, kwargs))
            return FakeResponse(url)

    monkeypatch.setattr(main.httpx, "Client", FakeClient)

    chat = client.get("/api/provider-models/openrouter", params={"capability": "chat"})
    embedding = client.get("/api/provider-models/openrouter", params={"capability": "embedding"})

    assert chat.json()["models"][0]["id"] == "provider/chat-model"
    assert embedding.json()["models"][0]["id"] == "provider/embed-model"
    assert requests[0][0] == "https://catalog.example/api/v1/models"
    assert requests[1][0] == "https://catalog.example/api/v1/embeddings/models"
    assert requests[0][1]["headers"]["Authorization"] == "Bearer catalog-key"


def test_chat_reports_stale_embedding_index_without_querying_old_vector_space(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "stale-chat-index-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    client.post(
        "/api/memories",
        json={"title": "Status memory", "type": "project", "content": "keyword content", "importance": 3},
    )
    client.post("/api/vault/scan")
    client.post("/api/index/rebuild")
    original = AppSettings.load(vault_path)
    switched = AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            original.chat_model(),
            ConfiguredModel(
                id="new-embedding",
                name="New embedding",
                provider="openrouter",
                capability="embedding",
                model="provider/new-embedding",
                api_key="embedding-key",
            ),
        ],
        chat_model_id=original.chat_model_id,
        embedding_model_id="new-embedding",
    )
    switched.save(vault_path)
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")

    status = client.get("/api/index/status")
    response = client.post("/api/chat", json={"message": "keyword"})

    assert status.json()["embedding_index_stale"] is True
    assert response.status_code == 200
    assert response.json()["memory_index_refresh_required"] is True


def test_rebuild_reports_missing_openrouter_embedding_key_as_configuration_error(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "missing-router-key-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    client.post(
        "/api/memories",
        json={"title": "Needs embedding", "type": "project", "content": "Index this", "importance": 3},
    )
    client.post("/api/vault/scan")
    current = AppSettings.load(vault_path)
    AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            current.chat_model(),
            ConfiguredModel(
                id="router-embedding",
                name="Router embedding",
                provider="openrouter",
                capability="embedding",
                model="provider/embed",
            ),
        ],
        chat_model_id=current.chat_model_id,
        embedding_model_id="router-embedding",
    ).save(vault_path)

    response = client.post("/api/index/rebuild")

    assert response.status_code == 400
    assert "API key" in response.json()["detail"]


def test_chat_model_override_routes_answer_and_memory_generation_through_selected_chat_model(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "chat-model-override-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    current = AppSettings.load(vault_path)
    AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            current.chat_model(),
            ConfiguredModel(
                id="alternate-chat",
                name="Alternate Chat",
                provider="ollama",
                capability="chat",
                model="alternate-chat-model",
            ),
            current.embedding_model(),
        ],
        chat_model_id=current.chat_model_id,
        embedding_model_id=current.embedding_model_id,
    ).save(vault_path)
    answer_models: list[str] = []
    suggestion_models: list[str] = []

    def fake_generate_answer(settings, message, memories, history):
        answer_models.append(settings.chat_model_id)
        return "answer"

    def fake_generate_suggestions(vault_root, conversation_id=None, settings=None):
        suggestion_models.append(settings.chat_model_id)
        return []

    monkeypatch.setattr(main, "generate_answer", fake_generate_answer)
    monkeypatch.setattr(main, "generate_suggestions", fake_generate_suggestions)

    response = client.post(
        "/api/chat",
        json={"message": "Use the alternate model", "chat_model_id": "alternate-chat"},
    )
    conversation_id = response.json()["conversation_id"]
    generated = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": conversation_id, "chat_model_id": "alternate-chat"},
    )

    assert response.status_code == 200
    assert generated.status_code == 200
    assert answer_models == ["alternate-chat"]
    assert suggestion_models == ["alternate-chat"]
    assert AppSettings.load(vault_path).chat_model_id == current.chat_model_id


def test_chat_model_override_rejects_an_embedding_model_assignment(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "chat-model-invalid-override-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    settings = AppSettings.load(vault_path)

    response = client.post(
        "/api/chat",
        json={"message": "Do not run", "chat_model_id": settings.embedding_model_id},
    )

    assert response.status_code == 422
    assert "chat model" in response.json()["detail"]


def test_memory_pin_persists_to_markdown_and_sorts_pinned_notes_first(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "pinned-memory-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    first = client.post(
        "/api/memories",
        json={"title": "Alpha memory", "type": "project", "content": "First", "importance": 3},
    ).json()
    second = client.post(
        "/api/memories",
        json={"title": "Zulu memory", "type": "project", "content": "Second", "importance": 3},
    ).json()
    second_path = Path(second["path"])
    second_raw = second_path.read_text(encoding="utf-8")
    second_raw = second_raw.replace(f"updated: '{second['updated']}'", "updated: '2024-01-01'")
    second_raw = second_raw.replace(f"updated: {second['updated']}", "updated: 2024-01-01")
    assert "2024-01-01" in second_raw
    second_path.write_text(second_raw, encoding="utf-8")
    client.post("/api/vault/scan")

    pinned = client.patch(f"/api/memories/{second['id']}", json={"pinned": True})

    assert pinned.status_code == 200
    assert pinned.json()["pinned"] is True
    assert pinned.json()["updated"] == "2024-01-01"
    assert "pinned: true" in Path(second["path"]).read_text(encoding="utf-8")
    assert client.get("/api/memories").json()["memories"][0]["id"] == second["id"]

    client.post("/api/vault/scan")
    rescanned = client.get("/api/memories").json()["memories"]
    assert rescanned[0]["id"] == second["id"]
    assert rescanned[0]["pinned"] is True
    assert client.patch(f"/api/memories/{first['id']}-missing", json={"pinned": True}).status_code == 404


def test_chat_persists_messages_lists_conversations_and_injects_history(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "chat-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    captured_history: list[list[dict]] = []

    def fake_generate_answer(settings, user_message, memories, conversation_history):
        captured_history.append(conversation_history)
        return f"answer: {user_message}"

    monkeypatch.setattr(main, "generate_answer", fake_generate_answer)

    first = client.post("/api/chat", json={"message": "第一轮：项目叫 LuminaMind"})
    assert first.status_code == 200
    conversation_id = first.json()["conversation_id"]

    second = client.post(
        "/api/chat",
        json={"conversation_id": conversation_id, "message": "第二轮：它的名字是什么？"},
    )
    assert second.status_code == 200

    conversations = client.get("/api/conversations")
    assert conversations.status_code == 200
    assert conversations.json()["conversations"][0]["id"] == conversation_id
    assert conversations.json()["conversations"][0]["message_count"] == 4

    messages = client.get(f"/api/conversations/{conversation_id}/messages")
    assert messages.status_code == 200
    message_payload = messages.json()["messages"]
    assert [message["role"] for message in message_payload] == ["user", "assistant", "user", "assistant"]
    assert message_payload[0]["content"] == "第一轮：项目叫 LuminaMind"
    assert message_payload[2]["content"] == "第二轮：它的名字是什么？"

    assert captured_history[0] == []
    assert [item["content"] for item in captured_history[1]] == [
        "第一轮：项目叫 LuminaMind",
        "answer: 第一轮：项目叫 LuminaMind",
    ]


def test_conversation_search_matches_titles_messages_and_literal_wildcards(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "search-chat-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    roadmap = client.post("/api/conversations", json={"title": "Roadmap planning"}).json()
    client.post(
        "/api/chat",
        json={"conversation_id": roadmap["id"], "message": "hidden needle with 100% coverage"},
    )
    budget = client.post("/api/conversations", json={"title": "Budget log"}).json()
    client.post(
        "/api/chat",
        json={"conversation_id": budget["id"], "message": "1000 records and no match token"},
    )

    assert [item["id"] for item in client.get("/api/conversations", params={"query": "Roadmap"}).json()["conversations"]] == [
        roadmap["id"]
    ]
    assert [item["id"] for item in client.get("/api/conversations", params={"query": "needle"}).json()["conversations"]] == [
        roadmap["id"]
    ]
    assert [item["id"] for item in client.get("/api/conversations", params={"query": "100%"}).json()["conversations"]] == [
        roadmap["id"]
    ]
    assert client.get("/api/conversations", params={"query": "missing"}).json()["conversations"] == []
    assert {item["id"] for item in client.get("/api/conversations", params={"query": "   "}).json()["conversations"]} == {
        roadmap["id"],
        budget["id"],
    }


def test_chat_rejects_missing_llm_credentials_without_persisting_messages(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "missing-credentials-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    response = client.post("/api/chat", json={"message": "解释一下 Transformer 中的 Attention"})

    assert response.status_code == 503
    assert "selected DeepSeek model" in response.json()["detail"]
    assert client.get("/api/conversations").json()["conversations"] == []


def test_chat_rejects_failed_llm_request_without_persisting_messages(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "failed-provider-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    current = AppSettings.load(vault_path)
    AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            current.chat_model().model_copy(update={"api_key": "test-key"}),
            current.embedding_model(),
        ],
        chat_model_id=current.chat_model_id,
        embedding_model_id=current.embedding_model_id,
    ).save(vault_path)
    monkeypatch.setattr(
        "lumina.llm._call_deepseek",
        lambda settings, prompt: (_ for _ in ()).throw(RuntimeError("provider unavailable")),
    )

    response = client.post("/api/chat", json={"message": "解释一下 Transformer 中的 Attention"})

    assert response.status_code == 503
    assert "DeepSeek request failed" in response.json()["detail"]
    assert client.get("/api/conversations").json()["conversations"] == []


def test_chat_returns_before_memory_suggestion_generation_and_then_allows_explicit_generation(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "auto-suggestion-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    generation_calls: list[str | None] = []

    def fake_generate_answer(settings, user_message, memories, conversation_history):
        return "LuminaMind 第一版应围绕 Markdown 记忆和混合检索闭环实现。"

    monkeypatch.setattr(main, "generate_answer", fake_generate_answer)
    real_generate_suggestions = main.generate_suggestions

    def tracked_generate_suggestions(vault_root, conversation_id=None, settings=None):
        generation_calls.append(conversation_id)
        return real_generate_suggestions(vault_root, conversation_id, settings)

    monkeypatch.setattr(main, "generate_suggestions", tracked_generate_suggestions)

    response = client.post(
        "/api/chat",
        json={"message": "我正在长期开发 LuminaMind，它的核心是 Markdown 原子记忆。"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["memory_suggestions"] == []
    assert payload["memory_index_refresh_required"] is True
    assert generation_calls == []

    generated = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": payload["conversation_id"]},
    )
    suggestion = generated.json()["suggestions"][0]
    assert suggestion["conversation_id"] == payload["conversation_id"]
    assert suggestion["status"] == "pending"
    assert generation_calls == [payload["conversation_id"]]

    listed = client.get("/api/memory-suggestions").json()["suggestions"]
    assert any(item["id"] == suggestion["id"] for item in listed)


def test_explicit_post_chat_generation_applies_auto_review_mode(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "automatic-review-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    AppSettings(vault_path=str(vault_path), review_mode="auto").save(vault_path)
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")

    response = client.post("/api/chat", json={"message": "请记住我的自动审查偏好。"})

    assert response.status_code == 200
    generated = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": response.json()["conversation_id"]},
    )
    suggestion = generated.json()["suggestions"][0]
    assert suggestion["status"] == "accepted"
    memories = client.get("/api/memories").json()["memories"]
    assert any(item["title"] == suggestion["title"] for item in memories)


def test_auto_review_does_not_accept_an_existing_pending_duplicate(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "preserved-pending-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    draft = {
        "action": "create",
        "title": "保留人工判断",
        "content": "这个候选已经在人工待审队列中。",
        "type": "log",
        "tags": ["review"],
        "importance": 3,
        "confidence": 0.8,
        "target_note_id": None,
        "reason": "需要人工确认",
    }
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(suggestions_module, "generate_memory_suggestion_drafts", lambda *args: [draft])

    first = client.post("/api/chat", json={"message": "第一次产生候选。"}).json()
    first_suggestions = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": first["conversation_id"]},
    ).json()["suggestions"]
    AppSettings(vault_path=str(vault_path), review_mode="auto").save(vault_path)
    second = client.post(
        "/api/chat",
        json={"conversation_id": first["conversation_id"], "message": "再次讨论相同内容。"},
    ).json()
    second_suggestions = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": second["conversation_id"]},
    ).json()["suggestions"]

    assert first_suggestions[0]["status"] == "pending"
    assert second_suggestions[0]["id"] == first_suggestions[0]["id"]
    assert second_suggestions[0]["status"] == "pending"
    assert all(item["title"] != draft["title"] for item in client.get("/api/memories").json()["memories"])


def test_auto_review_restores_new_suggestion_to_pending_when_write_fails(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "automatic-review-retry-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    AppSettings(vault_path=str(vault_path), review_mode="auto").save(vault_path)
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(suggestions_module, "create_memory", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("write failed")))

    chat = client.post("/api/chat", json={"message": "保存这个决定。"})
    failed = TestClient(app, raise_server_exceptions=False).post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": chat.json()["conversation_id"]},
    )

    assert failed.status_code == 500
    listed = client.get("/api/memory-suggestions").json()["suggestions"]
    assert listed[0]["status"] == "pending"


def test_chat_uses_available_keyword_context_and_defers_missing_index_rebuild(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "chat-index-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    client.post(
        "/api/memories",
        json={
            "title": "LuminaMind 索引测试",
            "type": "project",
            "content": "这个项目依赖 Embedding 向量索引把长期 Markdown 记忆注入聊天。",
            "tags": ["Embedding"],
            "importance": 5,
        },
    )
    assert index_status(vault_path)["indexed_chunks"] == 0

    rebuild_calls: list[Path] = []
    real_rebuild = main.rebuild_index

    def tracked_rebuild(vault_root, *args, **kwargs):
        rebuild_calls.append(vault_root)
        return real_rebuild(vault_root, *args, **kwargs)

    captured_memories = []

    def fake_generate_answer(settings, user_message, memories, conversation_history):
        captured_memories.append(memories)
        return "answer"

    monkeypatch.setattr(main, "rebuild_index", tracked_rebuild)
    monkeypatch.setattr(main, "generate_answer", fake_generate_answer)

    response = client.post("/api/chat", json={"message": "聊天时怎么注入 Embedding 记忆？"})

    assert response.status_code == 200
    assert response.json()["memory_index_refresh_required"] is True
    assert rebuild_calls == []
    assert index_status(vault_path)["indexed_chunks"] == 0
    assert captured_memories[0][0].title == "LuminaMind 索引测试"

    updated = client.post("/api/index/update")

    assert updated.status_code == 200
    assert index_status(vault_path)["indexed_chunks"] >= 1


def test_accepting_memory_suggestion_rebuilds_vector_index(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "accept-index-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    monkeypatch.setattr(main, "generate_answer", lambda settings, user_message, memories, history: "answer")
    chat = client.post(
        "/api/chat",
        json={"message": "请记住：LuminaMind 的长期记忆需要由用户审查后写入 Markdown。"},
    )
    generated = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": chat.json()["conversation_id"]},
    )
    suggestion_id = generated.json()["suggestions"][0]["id"]

    rebuild_calls: list[Path] = []
    real_rebuild = real_rebuild_index

    def tracked_rebuild(vault_root, *args, **kwargs):
        rebuild_calls.append(vault_root)
        return real_rebuild(vault_root, *args, **kwargs)

    monkeypatch.setattr(suggestions_module, "rebuild_index", tracked_rebuild, raising=False)

    accepted = client.post(f"/api/memory-suggestions/{suggestion_id}/accept")

    assert accepted.status_code == 200
    assert accepted.json()["status"] == "accepted"
    assert rebuild_calls == [vault_path]
    assert index_status(vault_path)["indexed_chunks"] >= 1


def test_create_conversation_starts_empty_chat_thread(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "new-chat-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    created = client.post("/api/conversations", json={"title": "新对话"})

    assert created.status_code == 200
    payload = created.json()
    assert payload["title"] == "新对话"
    assert payload["message_count"] == 0

    messages = client.get(f"/api/conversations/{payload['id']}/messages")
    assert messages.status_code == 200
    assert messages.json()["messages"] == []


def test_create_conversation_reuses_the_only_disposable_empty_draft(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "one-empty-draft-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    first = client.post("/api/conversations", json={"title": "First blank"}).json()
    second = client.post("/api/conversations", json={"title": "Second blank"}).json()

    assert second["id"] == first["id"]
    conversations = client.get("/api/conversations").json()["conversations"]
    assert [(item["id"], item["message_count"]) for item in conversations] == [(first["id"], 0)]


def test_create_conversation_allows_a_new_draft_after_the_previous_one_has_messages(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "used-draft-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    first = client.post("/api/conversations", json={"title": "First blank"}).json()
    add_message(vault_path, first["id"], "user", "This conversation is no longer blank.")
    second = client.post("/api/conversations", json={"title": "Second blank"}).json()

    assert second["id"] != first["id"]
    conversations = client.get("/api/conversations").json()["conversations"]
    assert {item["id"] for item in conversations} == {first["id"], second["id"]}


def test_chat_titles_a_default_draft_from_its_first_user_message_without_overwriting_custom_titles(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "draft-title-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    draft = client.post("/api/conversations", json={}).json()
    first_message = "Summarize this conversation from the first message and keep the title concise."
    sent = client.post("/api/chat", json={"conversation_id": draft["id"], "message": first_message})

    assert sent.status_code == 200
    listed = client.get("/api/conversations").json()["conversations"]
    assert next(item for item in listed if item["id"] == draft["id"])["title"] == first_message[:40]

    custom = client.post("/api/conversations", json={"title": "Pinned planning title"}).json()
    client.post("/api/chat", json={"conversation_id": custom["id"], "message": "Do not replace my title."})
    listed = client.get("/api/conversations").json()["conversations"]
    assert next(item for item in listed if item["id"] == custom["id"])["title"] == "Pinned planning title"


def test_selecting_vault_backfills_legacy_default_titles_from_the_first_user_message(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "legacy-title-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    first_message = "Recovered title from an already stored user message that is long enough to truncate."
    with sqlite3.connect(db_path(vault_path)) as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("conv_default_title", "New conversation", "2026-05-20T10:00:00", "2026-05-20T10:01:00"),
        )
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            ("msg_default_title", "conv_default_title", "user", first_message, "2026-05-20T10:00:00"),
        )

    assert client.post("/api/vault/select", json={"path": str(vault_path)}).status_code == 200
    listed = client.get("/api/conversations").json()["conversations"]
    assert next(item for item in listed if item["id"] == "conv_default_title")["title"] == first_message[:40]


def test_chat_persists_only_the_latest_used_memories_for_reloaded_conversations(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "used-memory-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    retrieved = [[RetrievalResult(memory_id="mem_saved", title="Saved source", score=0.91, reason="", path="")], []]
    monkeypatch.setattr(main, "retrieve_memories", lambda *args, **kwargs: retrieved.pop(0))
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    first = client.post("/api/chat", json={"message": "Use a source this time."}).json()
    conversation_id = first["conversation_id"]
    loaded = client.get(f"/api/conversations/{conversation_id}/messages")
    assert loaded.json()["used_memories"] == [{"memory_id": "mem_saved", "title": "Saved source", "score": 0.91}]

    assert client.post(
        "/api/chat",
        json={"conversation_id": conversation_id, "message": "Use no source this time."},
    ).status_code == 200
    loaded = client.get(f"/api/conversations/{conversation_id}/messages")
    assert loaded.json()["used_memories"] == []


def test_deleting_conversation_removes_persisted_used_memories(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "delete-used-memory-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    monkeypatch.setattr(
        main,
        "retrieve_memories",
        lambda *args, **kwargs: [
            RetrievalResult(memory_id="mem_deleted", title="Deleted source", score=0.82, reason="", path="")
        ],
    )
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    conversation_id = client.post("/api/chat", json={"message": "Track the source."}).json()["conversation_id"]
    assert client.delete(f"/api/conversations/{conversation_id}").status_code == 200
    with sqlite3.connect(db_path(vault_path)) as conn:
        count = conn.execute(
            "SELECT COUNT(*) FROM conversation_used_memories WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()[0]
    assert count == 0


def test_selecting_vault_prunes_legacy_duplicate_disposable_drafts(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "legacy-empty-drafts-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    with sqlite3.connect(db_path(vault_path)) as conn:
        conn.executemany(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [
                ("conv_old_blank", "Old blank", "2026-05-20T10:00:00", "2026-05-20T10:00:00"),
                ("conv_new_blank", "New blank", "2026-05-21T10:00:00", "2026-05-21T10:00:00"),
            ],
        )

    client.post("/api/vault/select", json={"path": str(vault_path)})

    conversations = client.get("/api/conversations").json()["conversations"]
    assert [item["id"] for item in conversations] == ["conv_new_blank"]


def test_empty_conversation_with_suggestion_is_not_pruned_as_a_draft(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "review-linked-empty-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    with sqlite3.connect(db_path(vault_path)) as conn:
        conn.executemany(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [
                ("conv_review", "Review-linked", "2026-05-20T10:00:00", "2026-05-20T10:00:00"),
                ("conv_old_blank", "Old blank", "2026-05-21T10:00:00", "2026-05-21T10:00:00"),
                ("conv_new_blank", "New blank", "2026-05-22T10:00:00", "2026-05-22T10:00:00"),
            ],
        )
    suggestions_module.create_suggestion(
        vault_path,
        conversation_id="conv_review",
        title="Review this",
        content="This suggestion preserves the linked conversation.",
    )

    client.post("/api/vault/select", json={"path": str(vault_path)})

    conversations = client.get("/api/conversations").json()["conversations"]
    assert {item["id"] for item in conversations} == {"conv_review", "conv_new_blank"}


def test_delete_conversation_removes_messages_and_suggestions_but_keeps_accepted_memory(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "delete-chat-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    chat = client.post("/api/chat", json={"message": "请记住这个项目决定。"})
    conversation_id = chat.json()["conversation_id"]
    generated = client.post(
        "/api/memory-suggestions/generate",
        json={"conversation_id": conversation_id},
    )
    suggestion = generated.json()["suggestions"][0]
    accepted = client.post(f"/api/memory-suggestions/{suggestion['id']}/accept")
    assert accepted.status_code == 200

    deleted = client.delete(f"/api/conversations/{conversation_id}")

    assert deleted.status_code == 200
    assert deleted.json() == {"deleted": True}
    assert client.get(f"/api/conversations/{conversation_id}/messages").status_code == 404
    suggestions = client.get("/api/memory-suggestions").json()["suggestions"]
    assert all(item["conversation_id"] != conversation_id for item in suggestions)
    memories = client.get("/api/memories").json()["memories"]
    assert any(item["title"] == suggestion["title"] for item in memories)


def test_legacy_conversations_are_migrated_and_pinned_threads_sort_first(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "legacy-chat-vault"
    database_path = db_path(vault_path)
    database_path.parent.mkdir(parents=True)
    with sqlite3.connect(database_path) as conn:
        conn.execute(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT)"
        )
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("conv_old", "Pinned older", "2026-05-22T10:00:00", "2026-05-22T10:00:00"),
        )
        conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            ("conv_new", "Newer regular", "2026-05-23T10:00:00", "2026-05-23T10:00:00"),
        )
        conn.execute(
            """
            CREATE TABLE messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT
            )
            """
        )
        conn.executemany(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            [
                ("msg_old", "conv_old", "user", "Keep pinned history", "2026-05-22T10:00:00"),
                ("msg_new", "conv_new", "user", "Keep recent history", "2026-05-23T10:00:00"),
            ],
        )

    assert client.post("/api/vault/select", json={"path": str(vault_path)}).status_code == 200
    pinned = client.patch("/api/conversations/conv_old", json={"pinned": True})
    assert pinned.status_code == 200
    assert pinned.json()["pinned"] is True

    listed = client.get("/api/conversations").json()["conversations"]
    assert [(conversation["id"], conversation["pinned"]) for conversation in listed] == [
        ("conv_old", True),
        ("conv_new", False),
    ]

    unpinned = client.patch("/api/conversations/conv_old", json={"pinned": False})
    assert unpinned.json()["pinned"] is False
    assert [conversation["id"] for conversation in client.get("/api/conversations").json()["conversations"]] == [
        "conv_new",
        "conv_old",
    ]


def test_chat_includes_history_beyond_twelve_messages_when_budget_allows(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "long-context-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    created = client.post("/api/conversations", json={"title": "Long context"}).json()
    existing: list[str] = []
    for index in range(14):
        content = f"prior-message-{index}"
        existing.append(content)
        add_message(vault_path, created["id"], "user" if index % 2 == 0 else "assistant", content)

    captured_history: list[list[dict]] = []
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: captured_history.append(history) or "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    response = client.post("/api/chat", json={"conversation_id": created["id"], "message": "continue"})

    assert response.status_code == 200
    assert [message["content"] for message in captured_history[0]] == existing


def test_chat_context_budget_drops_only_the_oldest_history(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "bounded-context-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    current = AppSettings.load(vault_path)
    AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            ConfiguredModel(
                id="ollama-chat",
                name="Ollama Chat",
                provider="ollama",
                capability="chat",
                model="qwen2.5:7b",
            ),
            current.embedding_model(),
        ],
        chat_model_id="ollama-chat",
        embedding_model_id=current.embedding_model_id,
        chat_context_window_tokens=16_384,
        chat_max_output_tokens=8_192,
    ).save(vault_path)
    created = client.post("/api/conversations", json={"title": "Bounded context"}).json()
    existing: list[str] = []
    for index in range(12):
        content = f"message-{index}-" + ("x" * 2_000)
        existing.append(content)
        add_message(vault_path, created["id"], "user" if index % 2 == 0 else "assistant", content)

    captured_history: list[list[dict]] = []
    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: captured_history.append(history) or "answer")
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    response = client.post("/api/chat", json={"conversation_id": created["id"], "message": "continue"})

    assert response.status_code == 200
    selected = [message["content"] for message in captured_history[0]]
    assert 0 < len(selected) < len(existing)
    assert selected == existing[-len(selected) :]


def test_chat_rejects_fixed_prompt_that_exceeds_context_without_persisting_messages(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "overflow-context-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    current = AppSettings.load(vault_path)
    AppSettings(
        vault_path=str(vault_path),
        configured_models=[
            ConfiguredModel(
                id="ollama-chat",
                name="Ollama Chat",
                provider="ollama",
                capability="chat",
                model="qwen2.5:7b",
            ),
            current.embedding_model(),
        ],
        chat_model_id="ollama-chat",
        embedding_model_id=current.embedding_model_id,
        chat_context_window_tokens=16_384,
        chat_max_output_tokens=8_192,
    ).save(vault_path)
    monkeypatch.setattr(main, "generate_suggestions", lambda *args, **kwargs: [])

    response = client.post("/api/chat", json={"message": "x" * 8_000})

    assert response.status_code == 422
    assert "context window" in response.json()["detail"].lower()
    assert client.get("/api/conversations").json()["conversations"] == []


def test_accepting_suggestion_twice_creates_one_memory_and_reject_cannot_override_it(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "idempotent-suggestion-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    suggestion = suggestions_module.create_suggestion(
        vault_path,
        conversation_id=None,
        title="唯一记忆",
        content="只允许写入一次。",
    )

    first = client.post(f"/api/memory-suggestions/{suggestion.id}/accept")
    second = client.post(f"/api/memory-suggestions/{suggestion.id}/accept")
    rejected = client.post(f"/api/memory-suggestions/{suggestion.id}/reject")

    assert first.json()["status"] == "accepted"
    assert second.json()["status"] == "accepted"
    memories = client.get("/api/memories").json()["memories"]
    assert [memory["title"] for memory in memories].count("唯一记忆") == 1
    assert rejected.json()["status"] == "accepted"


def test_rejected_suggestion_cannot_be_accepted_after_reaching_terminal_state(tmp_path: Path) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "reject-first-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    suggestion = suggestions_module.create_suggestion(
        vault_path,
        conversation_id=None,
        title="拒绝后的记忆",
        content="拒绝后不得被写入。",
    )

    rejected = client.post(f"/api/memory-suggestions/{suggestion.id}/reject")
    accepted = client.post(f"/api/memory-suggestions/{suggestion.id}/accept")

    assert rejected.json()["status"] == "rejected"
    assert accepted.json()["status"] == "rejected"
    memories = client.get("/api/memories").json()["memories"]
    assert all(memory["title"] != "拒绝后的记忆" for memory in memories)


def test_accepting_suggestion_claims_processing_state_before_persisting_memory(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "concurrent-suggestion-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    suggestion = suggestions_module.create_suggestion(
        vault_path,
        conversation_id=None,
        title="并发记忆",
        content="并发点击仍只生成一份。",
    )

    real_create_memory = suggestions_module.create_memory
    first_create_entered = Event()
    allow_first_create = Event()
    call_lock = Lock()
    create_calls = 0

    def blocking_create_memory(*args, **kwargs):
        nonlocal create_calls
        with call_lock:
            create_calls += 1
            call_number = create_calls
        if call_number == 1:
            first_create_entered.set()
            assert allow_first_create.wait(timeout=2)
        return real_create_memory(*args, **kwargs)

    monkeypatch.setattr(suggestions_module, "create_memory", blocking_create_memory)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(suggestions_module.accept_suggestion, vault_path, suggestion.id)
        assert first_create_entered.wait(timeout=2)
        second = pool.submit(suggestions_module.accept_suggestion, vault_path, suggestion.id)
        second_result = second.result(timeout=2)
        allow_first_create.set()
        first_result = first.result(timeout=2)

    assert second_result.status == "processing"
    assert first_result.status == "accepted"
    assert create_calls == 1
    memories = client.get("/api/memories").json()["memories"]
    assert [memory["title"] for memory in memories].count("并发记忆") == 1


def test_accepting_suggestion_returns_to_pending_when_memory_write_fails(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "retry-suggestion-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    suggestion = suggestions_module.create_suggestion(
        vault_path,
        conversation_id=None,
        title="可重试记忆",
        content="首次失败后允许再次处理。",
    )
    real_create_memory = suggestions_module.create_memory

    def fail_create_memory(*args, **kwargs):
        raise RuntimeError("write failed")

    monkeypatch.setattr(suggestions_module, "create_memory", fail_create_memory)
    failing_client = TestClient(app, raise_server_exceptions=False)
    failed = failing_client.post(f"/api/memory-suggestions/{suggestion.id}/accept")

    assert failed.status_code == 500
    listed = client.get("/api/memory-suggestions").json()["suggestions"]
    assert next(item for item in listed if item["id"] == suggestion.id)["status"] == "pending"

    monkeypatch.setattr(suggestions_module, "create_memory", real_create_memory)
    retried = client.post(f"/api/memory-suggestions/{suggestion.id}/accept")
    assert retried.json()["status"] == "accepted"


def test_index_failure_after_accept_does_not_allow_duplicate_memory(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "index-failure-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})
    suggestion = suggestions_module.create_suggestion(
        vault_path,
        conversation_id=None,
        title="已写入记忆",
        content="索引失败也不能再次写入。",
    )

    def fail_rebuild(*args, **kwargs):
        raise RuntimeError("index failed")

    monkeypatch.setattr(suggestions_module, "rebuild_index", fail_rebuild)
    failing_client = TestClient(app, raise_server_exceptions=False)
    failed = failing_client.post(f"/api/memory-suggestions/{suggestion.id}/accept")
    retried = client.post(f"/api/memory-suggestions/{suggestion.id}/accept")

    assert failed.status_code == 500
    assert retried.json()["status"] == "accepted"
    memories = client.get("/api/memories").json()["memories"]
    assert [memory["title"] for memory in memories].count("已写入记忆") == 1
