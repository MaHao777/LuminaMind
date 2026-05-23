from pathlib import Path

from fastapi.testclient import TestClient

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
