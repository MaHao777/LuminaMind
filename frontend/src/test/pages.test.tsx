import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import App from "../App";
import * as api from "../services/api";

const sampleMemory = {
  id: "mem_1",
  title: "LuminaMind 技术路线",
  type: "project",
  content: "Markdown + Embedding + 双链检索。",
  tags: ["Agent"],
  importance: 5,
  confidence: 0.9,
  status: "active",
  source: "manual",
  created: "2026-05-23",
  updated: "2026-05-23",
  links: ["白盒化记忆系统"],
  path: "Memories/Projects/luminamind.md",
};

vi.mock("../services/api", () => ({
  getSettings: vi.fn(async () => ({
    vault_path: "D:/memory",
    llm_provider: "deepseek",
    deepseek_base_url: "https://api.deepseek.com",
    deepseek_model: "deepseek-chat",
    deepseek_api_key: "",
    ollama_base_url: "http://127.0.0.1:11434",
    ollama_chat_model: "qwen2.5:7b",
    ollama_embedding_model: "bge-m3",
  })),
  saveSettings: vi.fn(async (payload) => payload),
  selectVault: vi.fn(async (path: string) => ({ path })),
  scanVault: vi.fn(async () => ({ scanned_files: 1, indexed_notes: 1, skipped_files: 0 })),
  rebuildIndex: vi.fn(async () => ({ indexed_chunks: 1 })),
  listMemories: vi.fn(async () => ({ memories: [sampleMemory] })),
  listConversations: vi.fn(async () => ({
    conversations: [
      {
        id: "conv_saved",
        title: "Project planning",
        created_at: "2026-05-23T10:00:00",
        updated_at: "2026-05-23T10:01:00",
        message_count: 2,
      },
    ],
  })),
  createConversation: vi.fn(async () => ({
    id: "conv_new",
    title: "New conversation",
    created_at: "2026-05-23T10:02:00",
    updated_at: "2026-05-23T10:02:00",
    message_count: 0,
  })),
  getConversationMessages: vi.fn(async () => ({
    messages: [
      {
        id: "msg_1",
        conversation_id: "conv_saved",
        role: "user",
        content: "之前讨论过 LuminaMind",
        created_at: "2026-05-23T10:00:00",
      },
      {
        id: "msg_2",
        conversation_id: "conv_saved",
        role: "assistant",
        content: "是的，之前讨论过 Markdown 记忆。",
        created_at: "2026-05-23T10:01:00",
      },
    ],
  })),
  sendChat: vi.fn(async () => ({
    conversation_id: "conv_saved",
    answer: "第一版先完成 Markdown 记忆库和混合检索闭环。",
    used_memories: [{ memory_id: "mem_1", title: "LuminaMind 技术路线", score: 0.91 }],
  })),
  listSuggestions: vi.fn(async () => ({
    suggestions: [
      {
        id: "sug_1",
        conversation_id: "conv_1",
        action: "create",
        title: "新的长期偏好",
        content: "用户偏好端到端切片。",
        type: "profile",
        tags: ["偏好"],
        importance: 4,
        confidence: 0.8,
        target_note_id: null,
        reason: "对未来回答有帮助",
        status: "pending",
      },
    ],
  })),
  acceptSuggestion: vi.fn(async (id: string) => ({ id, status: "accepted" })),
  rejectSuggestion: vi.fn(async (id: string) => ({ id, status: "rejected" })),
}));

describe("LuminaMind MVP frontend", () => {
  it("renders settings and saves provider configuration", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByDisplayValue("D:/memory")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("LLM Provider"), { target: { value: "ollama" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ llm_provider: "ollama" })));
  });

  it("loads memories and shows selected markdown content", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    expect(await screen.findAllByText("LuminaMind 技术路线")).toHaveLength(2);
    expect(screen.getByText("Markdown + Embedding + 双链检索。")).toBeInTheDocument();
  });

  it("sends chat messages and displays used memories", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "第一版先做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("第一版先完成 Markdown 记忆库和混合检索闭环。")).toBeInTheDocument();
    expect(screen.getByText("LuminaMind 技术路线")).toBeInTheDocument();
  });

  it("loads saved conversations and can start a new chat", async () => {
    render(<App />);

    expect(await screen.findByText("Project planning")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Project planning" }));

    expect(await screen.findByText("之前讨论过 LuminaMind")).toBeInTheDocument();
    expect(screen.getByText("是的，之前讨论过 Markdown 记忆。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() => expect(api.createConversation).toHaveBeenCalled());
    expect(screen.queryByText("之前讨论过 LuminaMind")).not.toBeInTheDocument();
  });

  it("reviews and accepts pending memory suggestions", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByText("新的长期偏好")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept 新的长期偏好" }));
    await waitFor(() => expect(api.acceptSuggestion).toHaveBeenCalledWith("sug_1"));
  });
});
