import json
from pathlib import Path

import pytest

from lumina.config import AppSettings, ConfiguredModel
from lumina.embedding import OpenRouterEmbeddingProvider
from lumina.indexer import index_status, rebuild_index
from lumina.llm import _call_deepseek, _call_ollama, _call_openrouter, build_rag_prompt, generate_memory_suggestion_drafts
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

    updated = settings.model_copy(update={"review_mode": "auto"})
    updated.save(vault.root)

    loaded = AppSettings.load(vault.root)
    assert loaded.review_mode == "auto"


def test_settings_save_writes_model_api_keys_without_legacy_provider_fields(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "model-key-vault")
    settings = AppSettings(
        vault_path=str(vault.root),
        configured_models=[
            ConfiguredModel(
                id="deepseek-chat",
                name="DeepSeek Chat",
                provider="deepseek",
                capability="chat",
                model="deepseek-v4-flash",
                api_key="deepseek-model-key",
            ),
            ConfiguredModel(
                id="local-embedding",
                name="Local Hash",
                provider="local_hash",
                capability="embedding",
                model="local-hash-384",
            ),
        ],
        chat_model_id="deepseek-chat",
        embedding_model_id="local-embedding",
    )
    settings.save(vault.root)

    raw = json.loads(AppSettings.config_path(vault.root).read_text(encoding="utf-8"))
    loaded = AppSettings.load(vault.root)

    assert raw["configured_models"][0]["api_key"] == "deepseek-model-key"
    assert loaded.chat_model().api_key == "deepseek-model-key"
    assert "deepseek_api_key" not in raw
    assert "openrouter_api_key" not in raw
    assert "llm_provider" not in raw
    assert "ollama_chat_model" not in raw
    assert "embedding_fallback_to_local" not in raw


def test_settings_resolve_context_defaults_and_reject_oversubscribed_output() -> None:
    assert AppSettings().effective_chat_context_window_tokens() == 1_000_000
    assert AppSettings(
        configured_models=[
            ConfiguredModel(
                id="ollama-chat",
                name="Ollama Chat",
                provider="ollama",
                capability="chat",
                model="qwen2.5:7b",
            ),
            ConfiguredModel(
                id="local-embedding",
                name="Local Hash",
                provider="local_hash",
                capability="embedding",
                model="local-hash-384",
            ),
        ],
        chat_model_id="ollama-chat",
        embedding_model_id="local-embedding",
    ).effective_chat_context_window_tokens() == 32_768
    assert (
        AppSettings(chat_context_window_tokens=65_536, chat_max_output_tokens=2_048)
        .effective_chat_context_window_tokens()
        == 65_536
    )

    with pytest.raises(ValueError, match="chat_max_output_tokens"):
        AppSettings(chat_context_window_tokens=16_384, chat_max_output_tokens=15_360)


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

    deepseek = AppSettings(
        configured_models=[
            ConfiguredModel(
                id="deepseek-chat",
                name="DeepSeek Chat",
                provider="deepseek",
                capability="chat",
                model="deepseek-chat",
                api_key="deepseek-model-key",
            ),
            ConfiguredModel(
                id="local-embedding",
                name="Local Hash",
                provider="local_hash",
                capability="embedding",
                model="local-hash-384",
            ),
        ],
        chat_model_id="deepseek-chat",
        embedding_model_id="local-embedding",
        chat_context_window_tokens=16_384,
        chat_max_output_tokens=2_048,
    )
    ollama = AppSettings(
        configured_models=[
            ConfiguredModel(
                id="ollama-chat",
                name="Ollama Chat",
                provider="ollama",
                capability="chat",
                model="qwen2.5:7b",
            ),
            ConfiguredModel(
                id="local-embedding",
                name="Local Hash",
                provider="local_hash",
                capability="embedding",
                model="local-hash-384",
            ),
        ],
        chat_model_id="ollama-chat",
        embedding_model_id="local-embedding",
        chat_context_window_tokens=16_384,
        chat_max_output_tokens=2_048,
    )
    assert _call_deepseek(deepseek, "prompt") == "deepseek"
    assert _call_ollama(ollama, "prompt") == "ollama"

    assert payloads[0]["model"] == "deepseek-chat"
    assert payloads[0]["max_tokens"] == 2_048
    assert payloads[1]["options"] == {"num_ctx": 16_384, "num_predict": 2_048}


def test_openrouter_chat_and_embedding_requests_use_selected_models(monkeypatch) -> None:
    requests: list[tuple[str, dict]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": "openrouter chat"}}],
                "data": [{"embedding": [0.1, 0.2]}, {"embedding": [0.3, 0.4]}],
            }

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs) -> FakeResponse:
            requests.append((url, kwargs))
            return FakeResponse()

    monkeypatch.setattr("lumina.llm.httpx.Client", FakeClient)
    monkeypatch.setattr("lumina.embedding.httpx.Client", FakeClient)
    settings = AppSettings(
        configured_models=[
            ConfiguredModel(
                id="router-chat",
                name="Router chat",
                provider="openrouter",
                capability="chat",
                model="openai/gpt-4.1-mini",
                api_key="router-chat-key",
            ),
            ConfiguredModel(
                id="router-embed",
                name="Router embed",
                provider="openrouter",
                capability="embedding",
                model="openai/text-embedding-3-small",
                api_key="router-embed-key",
            ),
        ],
        chat_model_id="router-chat",
        embedding_model_id="router-embed",
        chat_max_output_tokens=1024,
    )

    assert _call_openrouter(settings, "prompt", settings.chat_model()) == "openrouter chat"
    vectors = OpenRouterEmbeddingProvider(
        settings.openrouter_base_url,
        settings.embedding_model().api_key,
        settings.embedding_model().model,
    ).embed(["one", "two"])

    assert requests[0][0] == "https://openrouter.ai/api/v1/chat/completions"
    assert requests[0][1]["headers"]["Authorization"] == "Bearer router-chat-key"
    assert requests[0][1]["json"]["model"] == "openai/gpt-4.1-mini"
    assert requests[0][1]["json"]["max_tokens"] == 1024
    assert requests[1][0] == "https://openrouter.ai/api/v1/embeddings"
    assert requests[1][1]["headers"]["Authorization"] == "Bearer router-embed-key"
    assert requests[1][1]["json"] == {"model": "openai/text-embedding-3-small", "input": ["one", "two"]}
    assert vectors == [[0.1, 0.2], [0.3, 0.4]]


def test_memory_extraction_uses_chat_assignment_instead_of_embedding_assignment(monkeypatch) -> None:
    selected_models: list[str] = []
    settings = AppSettings(
        configured_models=[
            ConfiguredModel(
                id="router-chat",
                name="Router chat",
                provider="openrouter",
                capability="chat",
                model="openrouter/chat-model",
                api_key="router-chat-key",
            ),
            ConfiguredModel(
                id="router-embed",
                name="Router embedding",
                provider="openrouter",
                capability="embedding",
                model="openrouter/embedding-model",
                api_key="router-embed-key",
            ),
        ],
        chat_model_id="router-chat",
        embedding_model_id="router-embed",
    )

    monkeypatch.setattr(
        "lumina.llm._call_openrouter",
        lambda current_settings, prompt, model: selected_models.append(model.model) or "[]",
    )

    assert generate_memory_suggestion_drafts(settings, [{"role": "user", "content": "remember this"}], []) == []
    assert selected_models == ["openrouter/chat-model"]


def test_embedding_signature_marks_changed_binding_stale_and_failed_rebuild_preserves_index(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "signature-vault")
    create_memory(vault.root, title="Stable index", content="Vector content stays published.", note_type="project")
    scan_vault(vault.root)
    local_settings = AppSettings()
    rebuild_index(vault.root, settings=local_settings)
    vector_path = vault.root / ".agent" / "vector_index" / "fallback_vectors.json"
    published_payload = vector_path.read_text(encoding="utf-8")

    remote_settings = AppSettings(
        configured_models=[
            local_settings.chat_model(),
            ConfiguredModel(
                id="remote-embedding",
                name="Remote embedding",
                provider="openrouter",
                capability="embedding",
                model="provider/embed",
                api_key="remote-key",
            ),
        ],
        chat_model_id=local_settings.chat_model_id,
        embedding_model_id="remote-embedding",
    )

    assert index_status(vault.root, remote_settings)["embedding_index_stale"] is True

    class FailingProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            raise RuntimeError("remote unavailable")

    with pytest.raises(RuntimeError, match="remote unavailable"):
        rebuild_index(vault.root, embedding_provider=FailingProvider(), settings=remote_settings)

    assert vector_path.read_text(encoding="utf-8") == published_payload


def test_remote_query_embedding_failure_falls_back_to_nonsemantic_retrieval(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "query-fallback-vault")
    create_memory(vault.root, title="Keyword target", content="The project uses aurora indexing.", note_type="project")
    scan_vault(vault.root)
    settings = AppSettings()
    rebuild_index(vault.root, settings=settings)

    class FailingProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            raise RuntimeError("query remote unavailable")

    results = retrieve_memories(
        vault.root,
        query="aurora indexing",
        settings=settings,
        embedding_provider=FailingProvider(),
    )

    assert results[0].title == "Keyword target"
