from __future__ import annotations

import httpx

from .config import AppSettings
from .models import RetrievalResult


def _fallback_answer(
    user_message: str,
    memories: list[RetrievalResult],
    conversation_history: list[dict] | None = None,
) -> str:
    history_hint = ""
    if conversation_history:
        recent = conversation_history[-2:]
        recent_lines = "；".join(f"{item.get('role')}: {item.get('content')}" for item in recent)
        history_hint = f" 我也会把本次会话历史作为短期上下文；最近上下文：{recent_lines}"

    if not memories:
        return (
            f"我还没有检索到可用的长期记忆。针对“{user_message}”，"
            f"建议先补充相关 Markdown 记忆并重建索引。{history_hint}"
        )

    memory_lines = "；".join(f"{item.title}: {item.content[:80]}" for item in memories[:3])
    return (
        "基于当前检索到的长期记忆，第一版应先完成 Markdown 记忆库、"
        "SQLite 元数据、Chroma/Embedding 索引、双链扩展和聊天引用来源这个闭环。"
        f" 相关记忆：{memory_lines}{history_hint}"
    )


def _format_conversation_history(conversation_history: list[dict] | None) -> str:
    if not conversation_history:
        return "无"
    return "\n".join(
        f"{message.get('role', 'unknown')}: {message.get('content', '')}"
        for message in conversation_history[-12:]
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


def generate_answer(
    settings: AppSettings,
    user_message: str,
    memories: list[RetrievalResult],
    conversation_history: list[dict] | None = None,
) -> str:
    prompt = build_rag_prompt(user_message, memories, conversation_history)
    try:
        if settings.llm_provider == "deepseek" and settings.deepseek_api_key:
            return _call_deepseek(settings, prompt)
        if settings.llm_provider == "ollama":
            return _call_ollama(settings, prompt)
    except Exception:
        return _fallback_answer(user_message, memories, conversation_history)
    return _fallback_answer(user_message, memories, conversation_history)


def _call_deepseek(settings: AppSettings, prompt: str) -> str:
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": settings.deepseek_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.2,
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
            },
        )
        response.raise_for_status()
        return response.json()["message"]["content"]
