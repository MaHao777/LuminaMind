from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, Field


DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com"
DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434"


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

