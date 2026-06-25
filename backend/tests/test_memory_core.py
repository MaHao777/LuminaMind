import json
from pathlib import Path
import time

import httpx
import pytest

from lumina.config import AppSettings, ConfiguredModel
from lumina.embedding import OpenRouterEmbeddingProvider
from lumina.db import db_path, initialize_database
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
    settings = AppSettings(retrieval_min_similarity=0.0)
    rebuild_index(vault.root, embedding_provider=None, settings=settings)

    results = retrieve_memories(
        vault.root,
        query="这个 Agent 项目的 Markdown Embedding 技术路线是什么？",
        top_k=3,
        include_graph_expand=True,
        embedding_provider=None,
        settings=settings,
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


def test_openrouter_embedding_batches_large_inputs(monkeypatch) -> None:
    requests: list[list[str]] = []

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs) -> httpx.Response:
            inputs = kwargs["json"]["input"]
            requests.append(inputs)
            return httpx.Response(
                200,
                json={"data": [{"embedding": [float(index)]} for index, _ in enumerate(inputs)]},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr("lumina.embedding.httpx.Client", FakeClient)
    texts = [f"text-{index}" for index in range(17)]

    vectors = OpenRouterEmbeddingProvider(
        "https://openrouter.ai/api/v1",
        "router-key",
        "qwen/qwen3-embedding-8b",
    ).embed(texts)

    assert [len(batch) for batch in requests] == [16, 1]
    assert len(vectors) == len(texts)


def test_openrouter_embedding_retries_transient_response(monkeypatch) -> None:
    attempts = 0
    sleeps: list[float] = []

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

        def post(self, url: str, **kwargs) -> httpx.Response:
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return httpx.Response(
                    429,
                    headers={"Retry-After": "0"},
                    json={"error": {"message": "Rate limit exceeded"}},
                    request=httpx.Request("POST", url),
                )
            return httpx.Response(
                200,
                json={"data": [{"embedding": [0.1, 0.2]}]},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr("lumina.embedding.httpx.Client", FakeClient)
    monkeypatch.setattr(time, "sleep", sleeps.append)

    vectors = OpenRouterEmbeddingProvider(
        "https://openrouter.ai/api/v1",
        "router-key",
        "qwen/qwen3-embedding-8b",
    ).embed(["retry me"])

    assert vectors == [[0.1, 0.2]]
    assert attempts == 2
    assert sleeps == [0.0]


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


def test_rebuild_embeds_chunks_across_notes_in_one_provider_call(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "batched-index-vault")
    create_memory(vault.root, title="First note", content="A" * 1_100, note_type="project")
    create_memory(vault.root, title="Second note", content="B" * 1_100, note_type="project")
    scan_vault(vault.root)
    calls: list[list[str]] = []

    class RecordingProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            calls.append(texts)
            return [[float(index), 1.0] for index in range(len(texts))]

    summary = rebuild_index(vault.root, embedding_provider=RecordingProvider(), settings=AppSettings())

    assert summary.indexed_chunks == 4
    assert len(calls) == 1
    assert len(calls[0]) == 4


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


def test_retrieval_settings_have_safe_defaults_and_validate_bounds() -> None:
    settings = AppSettings()

    assert settings.retrieval_min_similarity == 0.35
    assert settings.retrieval_candidate_limit == 40

    with pytest.raises(ValueError):
        AppSettings(retrieval_min_similarity=1.01)
    with pytest.raises(ValueError):
        AppSettings(retrieval_candidate_limit=0)


def test_rebuild_publishes_cosine_chroma_metadata_matching_json_index(tmp_path: Path) -> None:
    chromadb = pytest.importorskip("chromadb")
    vault = initialize_vault(tmp_path / "chroma-metadata-vault")
    create_memory(vault.root, title="Indexed note", content="semantic content", note_type="concept")
    scan_vault(vault.root)
    settings = AppSettings()

    class StableProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[1.0, 0.0] for _ in texts]

    rebuild_index(vault.root, embedding_provider=StableProvider(), settings=settings)

    payload = json.loads(
        (vault.root / ".agent" / "vector_index" / "fallback_vectors.json").read_text(encoding="utf-8")
    )
    collection = chromadb.PersistentClient(
        path=str(vault.root / ".agent" / "vector_index" / "chroma")
    ).get_collection("memories")

    assert collection.metadata["hnsw:space"] == "cosine"
    assert collection.metadata["embedding_signature"] == payload["embedding_signature"]
    assert collection.metadata["vector_count"] == len(payload["vectors"])
    assert collection.count() == len(payload["vectors"])


def test_retrieval_uses_vector_seeds_and_bidirectional_one_hop_neighbors_only(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "candidate-vault")
    root = create_memory(
        vault.root,
        title="Vector root",
        content="root semantic content",
        note_type="concept",
        links=["Linked neighbor"],
    )
    create_memory(
        vault.root,
        title="Linked neighbor",
        content="graph-only content",
        note_type="concept",
    )
    create_memory(
        vault.root,
        title="Unrelated note",
        content="unrelated content",
        note_type="concept",
        importance=5,
    )
    scan_vault(vault.root)
    settings = AppSettings(retrieval_min_similarity=0.8, retrieval_candidate_limit=1)

    class CandidateProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            vectors = []
            for text in texts:
                if text == "find vector root" or "Vector root" in text:
                    vectors.append([1.0, 0.0])
                else:
                    vectors.append([0.0, 1.0])
            return vectors

    provider = CandidateProvider()
    rebuild_index(vault.root, embedding_provider=provider, settings=settings)

    results = retrieve_memories(
        vault.root,
        query="find vector root",
        top_k=10,
        embedding_provider=provider,
        settings=settings,
    )

    assert [result.title for result in results] == ["Vector root", "Linked neighbor"]
    assert results[0].memory_id == root.id
    assert "双链关联" in results[1].reason


def test_link_signal_outranks_keyword_signal_when_other_scores_match(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "link-weight-vault")
    create_memory(
        vault.root,
        title="Root seed",
        content="root seed",
        note_type="concept",
        links=["Graph candidate"],
    )
    create_memory(
        vault.root,
        title="Graph candidate",
        content="graph candidate",
        note_type="concept",
    )
    create_memory(
        vault.root,
        title="Keyword candidate",
        content="question",
        note_type="concept",
    )
    scan_vault(vault.root)
    settings = AppSettings(retrieval_min_similarity=0.35, retrieval_candidate_limit=3)

    class RankingProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            vectors = []
            for text in texts:
                if text == "question" or "Root seed" in text:
                    vectors.append([1.0, 0.0])
                elif "Graph candidate" in text:
                    vectors.append([0.45, 0.8930285549745876])
                elif "Keyword candidate" in text:
                    vectors.append([0.4, 0.916515138991168])
                else:
                    vectors.append([0.0, 1.0])
            return vectors

    provider = RankingProvider()
    rebuild_index(vault.root, embedding_provider=provider, settings=settings)

    results = retrieve_memories(
        vault.root,
        query="question",
        top_k=10,
        embedding_provider=provider,
        settings=settings,
    )
    titles = [result.title for result in results]

    assert titles.index("Graph candidate") < titles.index("Keyword candidate")


def test_valid_vector_index_with_no_threshold_matches_returns_no_memories(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "empty-vector-candidate-vault")
    create_memory(vault.root, title="Far note", content="orthogonal", note_type="concept")
    scan_vault(vault.root)
    settings = AppSettings(retrieval_min_similarity=0.8)

    class OrthogonalProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[1.0, 0.0] if text == "query" else [0.0, 1.0] for text in texts]

    provider = OrthogonalProvider()
    rebuild_index(vault.root, embedding_provider=provider, settings=settings)

    assert retrieve_memories(
        vault.root,
        query="query",
        embedding_provider=provider,
        settings=settings,
    ) == []


def test_retrieval_falls_back_to_json_when_chroma_collection_is_missing(tmp_path: Path) -> None:
    chromadb = pytest.importorskip("chromadb")
    vault = initialize_vault(tmp_path / "json-fallback-vault")
    create_memory(vault.root, title="Fallback target", content="target", note_type="concept")
    scan_vault(vault.root)
    settings = AppSettings(retrieval_min_similarity=0.8)

    class StableProvider:
        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[1.0, 0.0] for _ in texts]

    provider = StableProvider()
    rebuild_index(vault.root, embedding_provider=provider, settings=settings)
    client = chromadb.PersistentClient(path=str(vault.root / ".agent" / "vector_index" / "chroma"))
    client.delete_collection("memories")

    results = retrieve_memories(
        vault.root,
        query="target",
        embedding_provider=provider,
        settings=settings,
    )

    assert results[0].title == "Fallback target"


def test_scan_resolves_forward_links_and_derives_backlinks_after_all_notes_are_loaded(tmp_path: Path) -> None:
    vault = initialize_vault(tmp_path / "backlink-vault")
    source_path = vault.root / "Memories" / "Concepts" / "a-source.md"
    target_path = vault.root / "Memories" / "Concepts" / "z-target.md"
    source_path.write_text(
        build_markdown(title="Source note", content="Source", links=["Target note"]),
        encoding="utf-8",
    )
    target_path.write_text(
        build_markdown(title="Target note", content="Target"),
        encoding="utf-8",
    )

    scan_vault(vault.root)
    memories = {memory.title: memory for memory in list_memories(vault.root)}

    assert memories["Source note"].links == ["Target note"]
    assert memories["Source note"].backlinks == []
    assert memories["Target note"].backlinks == ["Source note"]


def test_initialize_database_adds_links_column_to_legacy_suggestions_table(tmp_path: Path) -> None:
    vault_root = tmp_path / "legacy-suggestion-vault"
    database_path = db_path(vault_root)
    database_path.parent.mkdir(parents=True)
    import sqlite3

    with sqlite3.connect(database_path) as conn:
        conn.execute(
            """
            CREATE TABLE memory_suggestions (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                action TEXT NOT NULL,
                title TEXT,
                content TEXT NOT NULL,
                type TEXT DEFAULT 'log',
                tags TEXT,
                importance INTEGER DEFAULT 3,
                confidence REAL DEFAULT 0.8,
                target_note_id TEXT,
                reason TEXT,
                status TEXT DEFAULT 'pending',
                created_at TEXT,
                updated_at TEXT
            )
            """
        )

    initialize_database(vault_root)

    with sqlite3.connect(database_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(memory_suggestions)")}
    assert "links" in columns
