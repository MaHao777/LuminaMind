from __future__ import annotations

import json
import logging
import re

import httpx

from .config import CHAT_CONTEXT_SAFETY_TOKENS, AppSettings
from .models import RetrievalResult


MESSAGE_OVERHEAD_TOKENS = 16
logger = logging.getLogger(__name__)


class ContextWindowExceededError(ValueError):
    pass


class LLMUnavailableError(RuntimeError):
    pass


def estimate_prompt_tokens(prompt: str) -> int:
    """Conservatively treat each UTF-8 byte as a token budget unit."""
    return len(prompt.encode("utf-8")) + MESSAGE_OVERHEAD_TOKENS


def select_conversation_history(
    settings: AppSettings,
    user_message: str,
    memories: list[RetrievalResult],
    conversation_history: list[dict] | None,
) -> list[dict]:
    input_budget = (
        settings.effective_chat_context_window_tokens()
        - settings.chat_max_output_tokens
        - CHAT_CONTEXT_SAFETY_TOKENS
    )
    prompt_tokens = estimate_prompt_tokens(build_rag_prompt(user_message, memories, []))
    if prompt_tokens > input_budget:
        raise ContextWindowExceededError(
            "Chat input exceeds the configured context window before conversation history can be included."
        )

    empty_history_bytes = len(_format_conversation_history([]).encode("utf-8"))
    selected_reversed: list[dict] = []
    for message in reversed(conversation_history or []):
        line_bytes = len(_format_conversation_history([message]).encode("utf-8"))
        history_delta = line_bytes - empty_history_bytes if not selected_reversed else line_bytes + 1
        if prompt_tokens + history_delta > input_budget:
            break
        prompt_tokens += history_delta
        selected_reversed.append(message)
    return list(reversed(selected_reversed))


def _format_conversation_history(conversation_history: list[dict] | None) -> str:
    if not conversation_history:
        return "无"
    return "\n".join(
        f"{message.get('role', 'unknown')}: {message.get('content', '')}"
        for message in conversation_history
    )


def build_rag_prompt(
    user_message: str,
    memories: list[RetrievalResult],
    conversation_history: list[dict] | None = None,
) -> str:
    context = "\n\n".join(
        f"[{index + 1}] {memory.title}\n{memory.content}" for index, memory in enumerate(memories)
    )
    history = _format_conversation_history(conversation_history)
    return f"""你是用户的个人长期 Agent。请基于检索出的长期记忆回答。

要求：
1. 优先使用已提供的记忆内容。
2. 同一会话内的历史对话是短期上下文，必须用于理解代词、省略和连续问题。
3. 如果记忆不足，明确说明哪些部分是推断。
4. 不要编造用户没有提供过的个人信息。
5. 回答应具体、可执行。

本次会话历史：
{history}

用户问题：
{user_message}

相关记忆：
{context}
"""


def build_memory_extraction_prompt(
    conversation_messages: list[dict],
    related_memories: list[RetrievalResult],
) -> str:
    conversation = "\n".join(
        f"{message.get('role', 'unknown')}: {message.get('content', '')}"
        for message in conversation_messages[-12:]
    )
    related = "\n\n".join(
        f"[{index + 1}] id={memory.memory_id} title={memory.title}\n{memory.content}"
        for index, memory in enumerate(related_memories[:6])
    ) or "无"
    return f"""你是一个长期记忆提取器。请从以下对话中判断是否存在值得保存到长期记忆库的信息。

请只提取对未来回答有持续帮助的信息，包括：
- 用户长期目标
- 用户项目背景
- 用户学习方向
- 用户稳定偏好
- 重要任务进展
- 已发生变化的旧记忆

不要保存：
- 闲聊
- 临时信息
- 重复信息
- 低置信度猜测
- 用户没有明确表达的敏感信息

请只输出 JSON 数组，不要输出解释文字。数组元素格式：
[
  {{
    "action": "create | update | archive | ignore",
    "title": "记忆标题",
    "type": "profile | project | concept | task | log",
    "content": "记忆正文",
    "tags": ["标签1", "标签2"],
    "importance": 1,
    "confidence": 0.9,
    "target_note_id": null,
    "reason": "为什么值得保存或更新"
  }}
]

对话内容：
{conversation}

已有相关记忆：
{related}
"""


def generate_memory_suggestion_drafts(
    settings: AppSettings,
    conversation_messages: list[dict],
    related_memories: list[RetrievalResult],
) -> list[dict]:
    prompt = build_memory_extraction_prompt(conversation_messages, related_memories)
    try:
        if settings.llm_provider == "deepseek":
            if not settings.deepseek_api_key:
                return []
            raw = _call_deepseek(settings, prompt)
        elif settings.llm_provider == "ollama":
            raw = _call_ollama(settings, prompt)
        else:
            return []
    except Exception:
        return []
    return _parse_memory_drafts(raw)


def _parse_memory_drafts(raw: str) -> list[dict]:
    payload = _extract_json_payload(raw)
    if payload is None:
        return []
    if isinstance(payload, dict):
        if isinstance(payload.get("suggestions"), list):
            items = payload["suggestions"]
        else:
            items = [payload]
    elif isinstance(payload, list):
        items = payload
    else:
        return []
    return [draft for item in items if isinstance(item, dict) for draft in [_normalize_memory_draft(item)] if draft]


def _extract_json_payload(raw: str):
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    array_start = text.find("[")
    object_start = text.find("{")
    starts = [position for position in [array_start, object_start] if position >= 0]
    if not starts:
        return None
    start = min(starts)
    end_char = "]" if text[start] == "[" else "}"
    end = text.rfind(end_char)
    if end < start:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None


def _normalize_memory_draft(item: dict) -> dict | None:
    allowed_actions = {"create", "update", "archive", "ignore"}
    allowed_types = {"profile", "project", "concept", "task", "log"}
    action = str(item.get("action", "create")).strip().lower()
    note_type = str(item.get("type", "log")).strip().lower()
    title = str(item.get("title") or "").strip()
    content = str(item.get("content") or "").strip()

    if action not in allowed_actions:
        action = "create"
    if note_type not in allowed_types:
        note_type = "log"
    if action != "ignore" and (not title or not content):
        return None

    tags = item.get("tags")
    if not isinstance(tags, list):
        tags = []
    clean_tags = [str(tag).strip() for tag in tags if str(tag).strip()][:8]

    try:
        importance = int(item.get("importance", 3))
    except (TypeError, ValueError):
        importance = 3
    importance = max(1, min(5, importance))

    try:
        confidence = float(item.get("confidence", 0.8))
    except (TypeError, ValueError):
        confidence = 0.8
    confidence = max(0.0, min(1.0, confidence))

    target_note_id = item.get("target_note_id")
    return {
        "action": action,
        "title": title or "忽略记忆",
        "type": note_type,
        "content": content,
        "tags": clean_tags,
        "importance": importance,
        "confidence": confidence,
        "target_note_id": str(target_note_id).strip() if target_note_id else None,
        "reason": str(item.get("reason") or "").strip(),
    }


def generate_answer(
    settings: AppSettings,
    user_message: str,
    memories: list[RetrievalResult],
    conversation_history: list[dict] | None = None,
) -> str:
    prompt = build_rag_prompt(user_message, memories, conversation_history)
    if settings.llm_provider == "deepseek":
        if not settings.deepseek_api_key:
            raise LLMUnavailableError(
                "DeepSeek API key is not configured. Configure it in Settings or switch to an available Ollama model."
            )
        try:
            return _call_deepseek(settings, prompt)
        except Exception as exc:
            logger.exception("DeepSeek chat request failed for model %s", settings.deepseek_model)
            raise LLMUnavailableError(
                "DeepSeek request failed. Check the API key, model configuration, or service availability, then retry."
            ) from exc

    if settings.llm_provider == "ollama":
        try:
            return _call_ollama(settings, prompt)
        except Exception as exc:
            logger.exception("Ollama chat request failed for model %s", settings.ollama_chat_model)
            raise LLMUnavailableError(
                "Ollama request failed. Check that the service is running and the configured chat model is installed, then retry."
            ) from exc

    raise LLMUnavailableError("No supported LLM provider is configured.")


def _call_deepseek(settings: AppSettings, prompt: str) -> str:
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": settings.deepseek_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
                "max_tokens": settings.chat_max_output_tokens,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


def _call_ollama(settings: AppSettings, prompt: str) -> str:
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json={
                "model": settings.ollama_chat_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
                "options": {
                    "num_ctx": settings.effective_chat_context_window_tokens(),
                    "num_predict": settings.chat_max_output_tokens,
                },
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]
