from pathlib import Path

from fastapi.testclient import TestClient

import main
from main import app


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

    deleted = client.delete(f"/api/memories/{created['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True
    assert not Path(created["path"]).exists()


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
