from pathlib import Path

from lumina.config import AppSettings
from lumina.indexer import rebuild_index
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


def test_settings_roundtrip_prefers_vault_config(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "vault")
    settings = AppSettings.load(vault.root)

    updated = settings.model_copy(
        update={
            "llm_provider": "ollama",
            "ollama_chat_model": "qwen2.5:7b",
            "deepseek_api_key": "test-key",
        }
    )
    updated.save(vault.root)

    loaded = AppSettings.load(vault.root)
    assert loaded.llm_provider == "ollama"
    assert loaded.ollama_chat_model == "qwen2.5:7b"
    assert loaded.deepseek_api_key == "test-key"
