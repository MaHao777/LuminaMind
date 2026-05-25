from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Lock

from fastapi.testclient import TestClient

import main
import lumina.suggestions as suggestions_module
from main import app
from lumina.indexer import index_status, load_vectors, rebuild_index as real_rebuild_index


def test_api_vault_scan_retrieve_chat_and_review_cycle(tmp_path: Path) -> None:
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


def test_chat_auto_generates_pending_memory_suggestions_after_response(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "auto-suggestion-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    def fake_generate_answer(settings, user_message, memories, conversation_history):
        return "LuminaMind 第一版应围绕 Markdown 记忆和混合检索闭环实现。"

    monkeypatch.setattr(main, "generate_answer", fake_generate_answer)

    response = client.post(
        "/api/chat",
        json={"message": "我正在长期开发 LuminaMind，它的核心是 Markdown 原子记忆。"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["memory_suggestions"]
    suggestion = payload["memory_suggestions"][0]
    assert suggestion["conversation_id"] == payload["conversation_id"]
    assert suggestion["status"] == "pending"

    listed = client.get("/api/memory-suggestions").json()["suggestions"]
    assert any(item["id"] == suggestion["id"] for item in listed)


def test_chat_rebuilds_missing_memory_index_before_retrieval(tmp_path: Path, monkeypatch) -> None:
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
    assert rebuild_calls == [vault_path]
    assert index_status(vault_path)["indexed_chunks"] >= 1
    assert captured_memories[0][0].title == "LuminaMind 索引测试"


def test_accepting_memory_suggestion_rebuilds_vector_index(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "accept-index-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    monkeypatch.setattr(main, "generate_answer", lambda settings, user_message, memories, history: "answer")
    chat = client.post(
        "/api/chat",
        json={"message": "请记住：LuminaMind 的长期记忆需要由用户审查后写入 Markdown。"},
    )
    suggestion_id = chat.json()["memory_suggestions"][0]["id"]

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


def test_delete_conversation_removes_messages_and_suggestions_but_keeps_accepted_memory(
    tmp_path: Path, monkeypatch
) -> None:
    client = TestClient(app)
    vault_path = tmp_path / "delete-chat-vault"
    client.post("/api/vault/select", json={"path": str(vault_path)})

    monkeypatch.setattr(main, "generate_answer", lambda settings, message, memories, history: "answer")
    chat = client.post("/api/chat", json={"message": "请记住这个项目决定。"})
    conversation_id = chat.json()["conversation_id"]
    suggestion = chat.json()["memory_suggestions"][0]
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
