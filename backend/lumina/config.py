from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"
CHAT_CONTEXT_SAFETY_TOKENS = 1_024
DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS = 32_768
DEEPSEEK_CHAT_CONTEXT_WINDOW_TOKENS = 1_000_000
DEEPSEEK_LONG_CONTEXT_MODELS = {
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-v4-flash",
    "deepseek-v4-pro",
}


class AppSettings(BaseModel):
    vault_path: str = ""
    llm_provider: str = Field(default="deepseek", pattern="^(deepseek|ollama)$")
    deepseek_base_url: str = DEFAULT_DEEPSEEK_BASE_URL
    deepseek_model: str = "deepseek-chat"
    deepseek_api_key: str = ""
    ollama_base_url: str = DEFAULT_OLLAMA_BASE_URL
    ollama_chat_model: str = "qwen2.5:7b"
    ollama_embedding_model: str = "bge-m3"
    embedding_fallback_to_local: bool = True
    chat_context_window_tokens: int | None = Field(default=None, ge=16_384)
    chat_max_output_tokens: int = Field(default=8_192, ge=1)

    def effective_chat_context_window_tokens(self) -> int:
        if self.chat_context_window_tokens is not None:
            return self.chat_context_window_tokens
        if self.llm_provider == "deepseek" and self.deepseek_model.lower() in DEEPSEEK_LONG_CONTEXT_MODELS:
            return DEEPSEEK_CHAT_CONTEXT_WINDOW_TOKENS
        return DEFAULT_CHAT_CONTEXT_WINDOW_TOKENS

    @model_validator(mode="after")
    def validate_chat_context_budget(self) -> "AppSettings":
        context_window = self.effective_chat_context_window_tokens()
        if self.chat_max_output_tokens + CHAT_CONTEXT_SAFETY_TOKENS >= context_window:
            raise ValueError(
                "chat_max_output_tokens plus the 1024 token safety margin must be less than "
                "the effective chat context window"
            )
        return self

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
