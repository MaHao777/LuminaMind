from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, model_validator


DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
CHAT_CONTEXT_SAFETY_TOKENS = 1_024
DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS = 32_768
DEEPSEEK_CHAT_CONTEXT_WINDOW_TOKENS = 1_000_000
DEEPSEEK_LONG_CONTEXT_MODELS = {
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
}


class ConfiguredModel(BaseModel):
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    provider: Literal["deepseek", "ollama", "openrouter", "local_hash"]
    capability: Literal["chat", "embedding"]
    model: str = Field(min_length=1)
    api_key: str = ""

    @model_validator(mode="after")
    def validate_provider_capability(self) -> "ConfiguredModel":
        if self.provider == "deepseek" and self.capability != "chat":
            raise ValueError("DeepSeek models may only be assigned to chat")
        if self.provider == "local_hash":
            if self.capability != "embedding" or self.model != "local-hash-384":
                raise ValueError("Local hash is an embedding-only model with id local-hash-384")
        return self


class AppSettings(BaseModel):
    vault_path: str = ""
    review_mode: Literal["manual", "auto"] = "manual"
    deepseek_base_url: str = DEFAULT_DEEPSEEK_BASE_URL
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    openrouter_base_url: str = DEFAULT_OPENROUTER_BASE_URL
    configured_models: list[ConfiguredModel] = Field(default_factory=list)
    chat_model_id: str = ""
    embedding_model_id: str = ""
    retrieval_min_similarity: float = Field(default=0.35, ge=0.0, le=1.0)
    retrieval_candidate_limit: int = Field(default=40, ge=1, le=200)
    chat_context_window_tokens: int | None = Field(default=None, ge=16_384)
    chat_max_output_tokens: int = Field(default=8_192, ge=1)

    def effective_chat_context_window_tokens(self) -> int:
        if self.chat_context_window_tokens is not None:
            return self.chat_context_window_tokens
        chat_model = self.chat_model()
        if chat_model.provider == "deepseek" and chat_model.model.lower() in DEEPSEEK_LONG_CONTEXT_MODELS:
            return DEEPSEEK_CHAT_CONTEXT_WINDOW_TOKENS
        return DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS

    @model_validator(mode="after")
    def populate_models_and_validate_chat_context_budget(self) -> "AppSettings":
        if not self.configured_models:
            self.configured_models = [
                ConfiguredModel(
                    id="deepseek_chat",
                    name="DeepSeek Chat",
                    provider="deepseek",
                    capability="chat",
                    model="deepseek-chat",
                ),
                ConfiguredModel(
                    id="ollama_chat",
                    name="Ollama Chat",
                    provider="ollama",
                    capability="chat",
                    model="qwen2.5:7b",
                ),
                ConfiguredModel(
                    id="ollama_embedding",
                    name="Ollama Embedding",
                    provider="ollama",
                    capability="embedding",
                    model="bge-m3",
                ),
                ConfiguredModel(
                    id="local_hash_embedding",
                    name="Local Hash",
                    provider="local_hash",
                    capability="embedding",
                    model="local-hash-384",
                ),
            ]
            self.chat_model_id = "deepseek_chat"
            self.embedding_model_id = "local_hash_embedding"
        self.chat_model()
        self.embedding_model()
        context_window = self.effective_chat_context_window_tokens()
        if self.chat_max_output_tokens + CHAT_CONTEXT_SAFETY_TOKENS >= context_window:
            raise ValueError(
                "chat_max_output_tokens plus the 1024 token safety margin must be less than "
                "the effective chat context window"
            )
        return self

    def _assigned_model(self, model_id: str, capability: Literal["chat", "embedding"]) -> ConfiguredModel:
        model = next((item for item in self.configured_models if item.id == model_id), None)
        if model is None:
            raise ValueError(f"{capability}_model_id must refer to a configured model")
        if model.capability != capability:
            raise ValueError(f"{capability}_model_id must refer to a {capability} model")
        return model

    def chat_model(self) -> ConfiguredModel:
        return self._assigned_model(self.chat_model_id, "chat")

    def with_chat_model(self, chat_model_id: str | None) -> "AppSettings":
        if not chat_model_id or chat_model_id == self.chat_model_id:
            return self
        return type(self).model_validate({**self.model_dump(), "chat_model_id": chat_model_id})

    def embedding_model(self) -> ConfiguredModel:
        return self._assigned_model(self.embedding_model_id, "embedding")

    @classmethod
    def config_path(cls, vault_root: Path) -> Path:
        return vault_root / ".agent" / "config.json"

    @classmethod
    def load(cls, vault_root: Path | None = None) -> "AppSettings":
        if vault_root is None:
            return cls()

        path = cls.config_path(vault_root)
        if not path.exists():
            return cls(vault_path=str(vault_root))

        data = json.loads(path.read_text(encoding="utf-8"))
        data.setdefault("vault_path", str(vault_root))
        return cls(**data)

    def save(self, vault_root: Path) -> None:
        path = self.config_path(vault_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = self.model_dump()
        data["vault_path"] = str(vault_root)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
