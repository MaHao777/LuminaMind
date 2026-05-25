import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    review_mode: "manual",
    chat_context_window_tokens: null,
    chat_max_output_tokens: 8192,
  })),
  saveSettings: vi.fn(async (payload) => payload),
  selectVault: vi.fn(async (path: string) => ({ path })),
  scanVault: vi.fn(async () => ({ scanned_files: 1, indexed_notes: 1, skipped_files: 0 })),
  rebuildIndex: vi.fn(async () => ({ indexed_chunks: 1 })),
  listMemories: vi.fn(async () => ({ memories: [sampleMemory] })),
  deleteMemory: vi.fn(async () => ({ deleted: true })),
  listConversations: vi.fn(async () => ({
    conversations: [
      {
        id: "conv_saved",
        title: "Project planning",
        created_at: "2026-05-23T10:00:00",
        updated_at: "2026-05-23T10:01:00",
        message_count: 2,
        pinned: false,
      },
    ],
  })),
  createConversation: vi.fn(async () => ({
    id: "conv_new",
    title: "New conversation",
    created_at: "2026-05-23T10:02:00",
    updated_at: "2026-05-23T10:02:00",
    message_count: 0,
    pinned: false,
  })),
  updateConversation: vi.fn(async (id: string, pinned: boolean) => ({
    id,
    title: "Project planning",
    created_at: "2026-05-23T10:00:00",
    updated_at: "2026-05-23T10:01:00",
    message_count: 2,
    pinned,
  })),
  deleteConversation: vi.fn(async () => ({ deleted: true })),
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
    memory_suggestions: [
      {
        id: "sug_auto",
        conversation_id: "conv_saved",
        action: "create",
        title: "自动候选记忆",
        content: "用户正在推进 LuminaMind。",
        type: "project",
        tags: ["LuminaMind"],
        importance: 4,
        confidence: 0.8,
        target_note_id: null,
        reason: "对后续回答有帮助",
        status: "pending",
      },
    ],
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
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "luminaDesktop", { configurable: true, value: undefined });
  });

  it("renders settings and saves provider configuration", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByDisplayValue("D:/memory")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("LLM Provider"), { target: { value: "ollama" } });
    fireEvent.change(screen.getByLabelText("Chat context window tokens (blank for automatic)"), {
      target: { value: "65536" },
    });
    fireEvent.change(screen.getByLabelText("Max response tokens"), { target: { value: "4096" } });
    fireEvent.change(screen.getByLabelText("Review behavior"), { target: { value: "auto" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          llm_provider: "ollama",
          chat_context_window_tokens: 65536,
          chat_max_output_tokens: 4096,
          review_mode: "auto",
        }),
      ),
    );
  });

  it("selects a vault through the Electron directory chooser", async () => {
    const chooseVaultDirectory = vi.fn(async () => "D:/picked-vault");
    Object.defineProperty(window, "luminaDesktop", {
      configurable: true,
      value: { chooseVaultDirectory },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select vault" }));

    await waitFor(() => expect(chooseVaultDirectory).toHaveBeenCalled());
    expect(api.selectVault).toHaveBeenCalledWith("D:/picked-vault");
    expect(api.scanVault).toHaveBeenCalled();
    expect(api.rebuildIndex).toHaveBeenCalled();
  });

  it("requires the desktop app for vault directory selection", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select vault" }));

    expect(await screen.findByText("Vault folder selection is available in the desktop app only.")).toBeInTheDocument();
    expect(api.selectVault).not.toHaveBeenCalled();
  });

  it("does not initialize a vault when directory selection is cancelled", async () => {
    const chooseVaultDirectory = vi.fn(async () => null);
    Object.defineProperty(window, "luminaDesktop", {
      configurable: true,
      value: { chooseVaultDirectory },
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select vault" }));

    await waitFor(() => expect(chooseVaultDirectory).toHaveBeenCalled());
    expect(api.selectVault).not.toHaveBeenCalled();
    expect(api.scanVault).not.toHaveBeenCalled();
    expect(api.rebuildIndex).not.toHaveBeenCalled();
  });

  it("loads memories and renders selected markdown content safely", async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      memories: [{
        ...sampleMemory,
        content: "# Stored Memory\n\n**Markdown** body\n\n| Format | State |\n| --- | --- |\n| GFM | Enabled |\n\n<span data-testid=\"memory-html\">Unsafe</span>",
      }],
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    expect(await screen.findAllByText("LuminaMind 技术路线")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1, name: "Stored Memory" })).toBeInTheDocument();
    expect(screen.getByText("Markdown").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("memory-html")).not.toBeInTheDocument();
  });

  it("confirms and deletes the selected memory", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({ memories: [sampleMemory] })
      .mockResolvedValueOnce({ memories: [] });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    await screen.findByText("Markdown + Embedding + 双链检索。");
    fireEvent.click(screen.getByRole("button", { name: `Delete ${sampleMemory.title}` }));

    await waitFor(() => expect(api.deleteMemory).toHaveBeenCalledWith("mem_1"));
    expect(confirm).toHaveBeenCalled();
    expect(await screen.findByText("No Markdown memories loaded.")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("sends chat messages and displays used memories", async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "第一版先做什么？" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("第一版先完成 Markdown 记忆库和混合检索闭环。")).toBeInTheDocument();
    expect(screen.getByText("LuminaMind 技术路线")).toBeInTheDocument();
    expect(screen.getByText("1 memory suggestion ready for review.")).toBeInTheDocument();
  });

  it("does not prompt for review when chat suggestions were automatically accepted", async () => {
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "自动保存完成。",
      used_memories: [],
      memory_suggestions: [{
        id: "sug_accepted",
        conversation_id: "conv_saved",
        action: "create",
        title: "自动记录",
        content: "自动接受内容。",
        type: "log",
        tags: [],
        importance: 3,
        confidence: 0.8,
        target_note_id: null,
        reason: "自动模式",
        status: "accepted",
      }],
    });
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "自动记录这个信息" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("自动保存完成。")).toBeInTheDocument();
    expect(screen.queryByText(/memory suggestion.*ready for review/)).not.toBeInTheDocument();
  });

  it("shows a pending agent message until the chat response arrives", async () => {
    let resolveChat!: (value: Awaited<ReturnType<typeof api.sendChat>>) => void;
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.mocked(api.sendChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    render(<App />);

    await screen.findByText("Project planning");
    scrollIntoView.mockClear();
    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Wait for a reply" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const pending = await screen.findByRole("status", { name: "Generating response..." });
    expect(pending).toBeInTheDocument();
    expect(pending.closest(".messages")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    resolveChat({
      conversation_id: "conv_saved",
      answer: "**Arrived**",
      used_memories: [],
      memory_suggestions: [],
    });

    expect((await screen.findByText("Arrived")).tagName).toBe("STRONG");
    await waitFor(() => expect(screen.queryByRole("status", { name: "Generating response..." })).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Next question" },
    });
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("shows chat failures inline and clears them when retrying", async () => {
    let rejectChat!: (reason: unknown) => void;
    vi.mocked(api.sendChat)
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => {
          rejectChat = reject;
        }),
      )
      .mockImplementationOnce(() => new Promise(() => undefined));
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "This request fails" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    rejectChat(new Error("Model request failed"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Model request failed");
    expect(alert.closest(".messages")).toBeInTheDocument();
    expect(screen.queryByText("Generating response...")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Retry request" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(await screen.findByRole("status", { name: "Generating response..." })).toBeInTheDocument();
  });

  it("renders assistant responses as GitHub Flavored Markdown", async () => {
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "# Delivery\n\n**Ready**\n\n- First item\n- Second item\n\n| Format | State |\n| --- | --- |\n| Markdown | Enabled |",
      used_memories: [],
      memory_suggestions: [],
    });
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Show formatted output" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Delivery" })).toBeInTheDocument();
    expect(screen.getByText("Ready").tagName).toBe("STRONG");
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("does not mount raw HTML returned inside assistant markdown", async () => {
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "**Formatted**\n\n<script data-testid=\"injected-script\">window.injection = true</script><span data-testid=\"injected-html\">Unsafe</span>",
      used_memories: [],
      memory_suggestions: [],
    });
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Keep output safe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect((await screen.findByText("Formatted")).tagName).toBe("STRONG");
    expect(screen.queryByTestId("injected-script")).not.toBeInTheDocument();
    expect(screen.queryByTestId("injected-html")).not.toBeInTheDocument();
  });

  it("exposes bounded scroll regions for the chat workspace panels", async () => {
    const { container } = render(<App />);

    expect(await screen.findByText("Project planning")).toBeInTheDocument();
    expect(container.querySelector("main.chat-main-panel")).toBeInTheDocument();
    expect(container.querySelector(".chat-panel .messages")).toBeInTheDocument();
    expect(container.querySelector(".chat-panel .messages .message-end")).toBeInTheDocument();
    expect(container.querySelector(".conversation-list .conversation-stack")).toBeInTheDocument();
    expect(container.querySelector(".memory-source-panel .memory-source-list")).toBeInTheDocument();
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

  it("opens the keyboard conversation menu, pins a chat, and dismisses the menu", async () => {
    vi.mocked(api.listConversations).mockResolvedValueOnce({
      conversations: [
        {
          id: "conv_recent",
          title: "Most recent",
          created_at: "2026-05-23T10:03:00",
          updated_at: "2026-05-23T10:03:00",
          message_count: 1,
          pinned: false,
        },
        {
          id: "conv_saved",
          title: "Project planning",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:01:00",
          message_count: 2,
          pinned: false,
        },
      ],
    });
    vi.mocked(api.updateConversation).mockResolvedValueOnce({
      id: "conv_saved",
      title: "Project planning",
      created_at: "2026-05-23T10:00:00",
      updated_at: "2026-05-23T10:01:00",
      message_count: 2,
      pinned: true,
    });
    const { container } = render(<App />);

    const conversation = await screen.findByRole("button", { name: "Project planning" });
    fireEvent.keyDown(conversation, { key: "F10", shiftKey: true });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Pin Project planning" }));

    await waitFor(() => expect(api.updateConversation).toHaveBeenCalledWith("conv_saved", true));
    expect(screen.getByLabelText("Pinned Project planning")).toBeInTheDocument();
    expect(container.querySelector(".conversation-row strong")?.textContent).toBe("Project planning");

    fireEvent.contextMenu(screen.getByRole("button", { name: "Project planning" }), { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("menuitem", { name: "Unpin Project planning" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Project planning" }), { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("confirms and deletes the current saved conversation from its context menu", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Project planning" }));
    expect(await screen.findByText("之前讨论过 LuminaMind")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Project planning" })).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Project planning" }), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete Project planning" }));

    await waitFor(() => expect(api.deleteConversation).toHaveBeenCalledWith("conv_saved"));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText("之前讨论过 LuminaMind")).not.toBeInTheDocument();
    confirm.mockRestore();
  });

  it("shows a review badge and clears it when pending suggestions are accepted", async () => {
    vi.mocked(api.listSuggestions)
      .mockResolvedValueOnce({ suggestions: [{
        id: "sug_1", conversation_id: "conv_1", action: "create", title: "新的长期偏好",
        content: "用户偏好端到端切片。", type: "profile", tags: ["偏好"], importance: 4,
        confidence: 0.8, target_note_id: null, reason: "对未来回答有帮助", status: "pending",
      }] })
      .mockResolvedValueOnce({ suggestions: [{
        id: "sug_1", conversation_id: "conv_1", action: "create", title: "新的长期偏好",
        content: "用户偏好端到端切片。", type: "profile", tags: ["偏好"], importance: 4,
        confidence: 0.8, target_note_id: null, reason: "对未来回答有帮助", status: "pending",
      }] })
      .mockResolvedValueOnce({ suggestions: [] });
    render(<App />);

    const reviewNavigation = await screen.findByRole("button", { name: "Review, 1 pending" });
    fireEvent.click(reviewNavigation);
    expect(await screen.findByText("新的长期偏好")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept 新的长期偏好" }));
    await waitFor(() => expect(api.acceptSuggestion).toHaveBeenCalledWith("sug_1"));
    expect(await screen.findByRole("button", { name: "Review" })).toBeInTheDocument();
  });

  it("renders accepted review history as non-actionable records", async () => {
    const acceptedHistory: Awaited<ReturnType<typeof api.listSuggestions>> = {
      suggestions: [{
        id: "sug_done", conversation_id: "conv_1", action: "create", title: "已自动记录",
        content: "无需手动处理。", type: "log", tags: [], importance: 3,
        confidence: 0.8, target_note_id: null, reason: "自动模式", status: "accepted",
      }],
    };
    vi.mocked(api.listSuggestions)
      .mockResolvedValueOnce(acceptedHistory)
      .mockResolvedValueOnce(acceptedHistory);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));

    expect(await screen.findByText("accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept 已自动记录" })).toBeDisabled();
  });

  it("locks only the suggestion being accepted while processing", async () => {
    let resolveAccept!: (value: Awaited<ReturnType<typeof api.acceptSuggestion>>) => void;
    vi.mocked(api.acceptSuggestion).mockClear();
    vi.mocked(api.acceptSuggestion).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveAccept = resolve;
      }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    const accept = await screen.findByRole("button", { name: "Accept 新的长期偏好" });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(await screen.findByText("Processing...")).toBeInTheDocument();
    expect(accept).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject 新的长期偏好" })).toBeDisabled();
    expect(api.acceptSuggestion).toHaveBeenCalledTimes(1);

    resolveAccept({ id: "sug_1", status: "accepted" } as Awaited<ReturnType<typeof api.acceptSuggestion>>);
    await waitFor(() => expect(screen.queryByText("Processing...")).not.toBeInTheDocument());
  });

  it("locks a suggestion while rejecting and restores controls after a failed action", async () => {
    let rejectRequest!: (value: Awaited<ReturnType<typeof api.rejectSuggestion>>) => void;
    vi.mocked(api.rejectSuggestion).mockImplementationOnce(
      () => new Promise((resolve) => {
        rejectRequest = resolve;
      }),
    );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Review/ }));
    const reject = await screen.findByRole("button", { name: "Reject 新的长期偏好" });
    fireEvent.click(reject);

    expect(await screen.findByText("Processing...")).toBeInTheDocument();
    expect(reject).toBeDisabled();
    rejectRequest({ id: "sug_1", status: "rejected" } as Awaited<ReturnType<typeof api.rejectSuggestion>>);
    await waitFor(() => expect(screen.queryByText("Processing...")).not.toBeInTheDocument());

    vi.mocked(api.acceptSuggestion).mockRejectedValueOnce(new Error("Accept failed"));
    const accept = screen.getByRole("button", { name: "Accept 新的长期偏好" });
    fireEvent.click(accept);

    expect(await screen.findByText("Accept failed")).toBeInTheDocument();
    expect(accept).not.toBeDisabled();
  });
});
