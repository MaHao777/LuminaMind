from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from typing import Protocol

import httpx

from .config import AppSettings


TOKEN_RE = re.compile(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]")


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]:
        ...


class EmbeddingConfigurationError(RuntimeError):
    pass


@dataclass
class LocalHashEmbeddingProvider:
    dimensions: int = 384

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._embed_one(text) for text in texts]

    def _embed_one(self, text: str) -> list[float]:
        vector = [0.0] * self.dimensions
        tokens = TOKEN_RE.findall(text.lower())
        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).digest()
            index = int.from_bytes(digest[:4], "little") % self.dimensions
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vector[index] += sign
        norm = math.sqrt(sum(value * value for value in vector)) or 1.0
        return [value / norm for value in vector]


class OllamaEmbeddingProvider:
    def __init__(self, base_url: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        embeddings: list[list[float]] = []
        with httpx.Client(timeout=30.0) as client:
            for text in texts:
                response = client.post(
                    f"{self.base_url}/api/embeddings",
                    json={"model": self.model, "prompt": text},
                )
                response.raise_for_status()
                embeddings.append(response.json()["embedding"])
        return embeddings


class OpenRouterEmbeddingProvider:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not self.api_key:
            raise EmbeddingConfigurationError("OpenRouter API key is required for the selected embedding model.")
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.base_url}/embeddings",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"model": self.model, "input": texts},
            )
            response.raise_for_status()
            payload = response.json()["data"]
        return [item["embedding"] for item in payload]


def provider_from_settings(settings: AppSettings | None) -> EmbeddingProvider:
    if settings is None:
        return LocalHashEmbeddingProvider()
    model = settings.embedding_model()
    if model.provider == "local_hash":
        return LocalHashEmbeddingProvider()
    if model.provider == "ollama":
        return OllamaEmbeddingProvider(base_url=settings.ollama_base_url, model=model.model)
    if model.provider == "openrouter":
        return OpenRouterEmbeddingProvider(
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            model=model.model,
        )
    raise EmbeddingConfigurationError("The selected provider does not support embeddings.")


def embedding_signature(settings: AppSettings | None) -> str:
    if settings is None:
        payload = {"provider": "local_hash", "model": "local-hash-384", "dimensions": 384}
    else:
        model = settings.embedding_model()
        payload: dict[str, str | int] = {"provider": model.provider, "model": model.model}
        if model.provider == "local_hash":
            payload["dimensions"] = 384
        elif model.provider == "ollama":
            payload["base_url"] = settings.ollama_base_url.rstrip("/")
        elif model.provider == "openrouter":
            payload["base_url"] = settings.openrouter_base_url.rstrip("/")
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if not left or not right:
        return 0.0
    size = min(len(left), len(right))
    dot = sum(left[index] * right[index] for index in range(size))
    left_norm = math.sqrt(sum(value * value for value in left[:size]))
    right_norm = math.sqrt(sum(value * value for value in right[:size]))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return max(0.0, dot / (left_norm * right_norm))
