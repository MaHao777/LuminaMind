from pathlib import Path

import pytest

from lumina.config import AppSettings
from lumina.indexer import rebuild_index
from lumina.llm import _call_deepseek, _call_ollama, build_rag_prompt
from lumina.memory.markdown import build_markdown, parse_markdown_note
from lumina.memory.store import create_memory, list_memories, scan_vault
from lumina.retrieval import retrieve_memories
from lumina.vault import initialize_vault


def test_initialize_vault_creates_expected_structure(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "MyAgentMemory")

    assert vault.root.exists()
    for relative in [
        "Memories/Profile",
        "Memories/Projects",
        "Memories/Concepts",
        "Memories/Tasks",
        "Memories/Logs",
        "Inbox",
        "Attachments",
        ".agent/cache",
        ".agent/vector_index",
    ]:
        assert (vault.root / relative).exists()
    assert (vault.root / ".agent/config.json").exists()
    assert (vault.root / ".agent/index.db").exists()


def test_parse_markdown_note_reads_frontmatter_body_and_wikilinks() -> None:
    raw = """---
id: mem_20260523_001
title: 个人长期 Agent 项目方向
type: project
tags:
  - Agent
  - 长期记忆
importance: 5
confidence: 0.95
source: chat
status: active
created: 2026-05-23
updated: 2026-05-23
links:
  - "[[白盒化记忆系统]]"
---

用户正在开发 [[LuminaMind]]，希望通过 Markdown 和 Embedding 管理长期记忆。
"""

    note = parse_markdown_note(raw, Path("Memories/Projects/luminamind.md"))

    assert note.id == "mem_20260523_001"
    assert note.title == "个人长期 Agent 项目方向"
    assert note.type == "project"
    assert note.tags == ["Agent", "长期记忆"]
    assert note.importance == 5
    assert note.confidence == 0.95
    assert note.links == ["白盒化记忆系统", "LuminaMind"]
    assert "Markdown 和 Embedding" in note.content


def test_scan_vault_indexes_markdown_metadata_and_links(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "vault")
    note_path = vault.root / "Memories" / "Projects" / "luminamind.md"
    note_path.write_text(
        build_markdown(
            title="LuminaMind 项目",
            note_type="project",
            content="项目使用 [[白盒化记忆系统]] 和双轨检索。",
            tags=["Agent", "Memory"],
            links=["白盒化记忆系统"],
        ),
        encoding="utf-8",
    )

    summary = scan_vault(vault.root)
    memories = list_memories(vault.root)

    assert summary.scanned_files == 1
    assert summary.indexed_notes == 1
    assert memories[0].title == "LuminaMind 项目"
    assert memories[0].links == ["白盒化记忆系统"]


def test_memory_markdown_roundtrips_pinned_metadata(tmp_path: Path) -> None:
    raw = build_markdown(
        title="Pinned memory",
        note_type="project",
        content="Keep this memory near the top.",
        pinned=True,
    )

    note = parse_markdown_note(raw, tmp_path / "pinned.md")

    assert "pinned: true" in raw
    assert note.pinned is True


def test_rag_prompt_uses_retrieved_context_without_exposing_internal_memory_mechanics() -> None:
    prompt = build_rag_prompt("What should I do next?", [], [])

    assert "不要主动提及记忆库、检索过程或上下文注入机制" in prompt
    assert "你之前提到" in prompt
    assert "请基于检索出的长期记忆回答" not in prompt


def test_retrieve_memories_fuses_keyword_link_importance_and_vector_scores(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "vault")
    create_memory(
        vault.root,
        title="LuminaMind 技术路线",
        content="LuminaMind 使用 Markdown 原子笔记、Chroma 向量索引和双链图谱做长期记忆。",
        note_type="project",
        tags=["Agent", "Embedding"],
        importance=5,
        links=["白盒化记忆系统"],
    )
    create_memory(
        vault.root,
        title="无关购物清单",
        content="牛奶、咖啡和纸巾。",
        note_type="log",
        tags=["生活"],
        importance=1,
    )
    scan_vault(vault.root)
    rebuild_index(vault.root, embedding_provider=None)

    results = retrieve_memories(
        vault.root,
        query="这个 Agent 项目的 Markdown Embedding 技术路线是什么？",
        top_k=3,
        include_graph_expand=True,
        embedding_provider=None,
    )

    assert results
    assert results[0].title == "LuminaMind 技术路线"
    assert results[0].score > 0
    assert "关键词" in results[0].reason or "语义" in results[0].reason


def test_rebuild_index_publishes_fallback_vectors_by_atomic_replace(tmp_path: Path, monkeypatch) -> None:
    vault = initialize_vault(tmp_path / "atomic-vector-vault")
    create_memory(vault.root, title="Atomic index", content="Index this content.", note_type="project")
    replacements: list[tuple[Path, Path]] = []
    original_replace = Path.replace

    def tracked_replace(source: Path, target: Path):
        replacements.append((source, target))
        return original_replace(source, target)

    monkeypatch.setattr(Path, "replace", tracked_replace)

    rebuild_index(vault.root, embedding_provider=None)

    vector_path = vault.root / ".agent" / "vector_index" / "fallback_vectors.json"
    assert replacements
    assert replacements[-1][1] == vector_path
    assert replacements[-1][0] != vector_path
    assert vector_path.exists()


def test_settings_roundtrip_prefers_vault_config(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "vault")
    settings = AppSettings.load(vault.root)
    assert settings.review_mode == "manual"

    updated = settings.model_copy(
        update={
            "llm_provider": "ollama",
            "ollama_chat_model": "qwen2.5:7b",
            "deepseek_api_key": "test-key",
            "review_mode": "auto",
        }
    )
    updated.save(vault.root)

    loaded = AppSettings.load(vault.root)
    assert loaded.llm_provider == "ollama"
    assert loaded.ollama_chat_model == "qwen2.5:7b"
    assert loaded.deepseek_api_key == "test-key"
    assert loaded.review_mode == "auto"


def test_settings_resolve_context_defaults_and_reject_oversubscribed_output() -> None:
    assert AppSettings(deepseek_model="deepseek-chat").effective_chat_context_window_tokens() == 1_000_000
    assert AppSettings(llm_provider="ollama").effective_chat_context_window_tokens() == 32_768
    assert (
        AppSettings(chat_context_window_tokens=65_536, chat_max_output_tokens=2_048)
        .effective_chat_context_window_tokens()
        == 65_536
    )

    with pytest.raises(ValueError, match="chat_max_output_tokens"):
        AppSettings(llm_provider="ollama", chat_context_window_tokens=16_384, chat_max_output_tokens=15_360)


def test_provider_requests_apply_configured_context_limits(monkeypatch) -> None:
    payloads: list[dict] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "deepseek"}}], "message": {"content": "ollama"}}

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs) -> FakeResponse:
            payloads.append(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr("lumina.llm.httpx.Client", FakeClient)

    deepseek = AppSettings(deepseek_api_key="key", chat_context_window_tokens=16_384, chat_max_output_tokens=2_048)
    ollama = AppSettings(llm_provider="ollama", chat_context_window_tokens=16_384, chat_max_output_tokens=2_048)
    assert _call_deepseek(deepseek, "prompt") == "deepseek"
    assert _call_ollama(ollama, "prompt") == "ollama"

    assert payloads[0]["max_tokens"] == 2_048
    assert payloads[1]["options"] == {"num_ctx": 16_384, "num_predict": 2_048}
