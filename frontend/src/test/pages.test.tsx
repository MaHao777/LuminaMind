import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import * as api from "../services/api";

const stylesCss = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf-8");

const sampleMemory: api.MemoryNote = {
  id: "mem_1",
  title: "LuminaMind 技术路线",
  type: "project",
  content: "Markdown + Embedding + 双链检索。",
  tags: ["Agent"],
  importance: 5,
  confidence: 0.9,
  status: "active",
  pinned: false,
  source: "manual",
  created: "2026-05-23",
  updated: "2026-05-23",
  links: ["白盒化记忆系统"],
  path: "Memories/Projects/luminamind.md",
};

async function chooseSelectOption(label: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

vi.mock("../services/api", () => ({
  getSettings: vi.fn(async () => ({
    vault_path: "D:/memory",
    deepseek_base_url: "https://api.deepseek.com",
    ollama_base_url: "http://127.0.0.1:11434",
    openrouter_base_url: "https://openrouter.ai/api/v1",
    configured_models: [
      { id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek", capability: "chat", model: "deepseek-chat", api_key: "" },
      { id: "ollama-chat", name: "Ollama Chat", provider: "ollama", capability: "chat", model: "qwen2.5:7b", api_key: "" },
      { id: "local-embedding", name: "Local Hash", provider: "local_hash", capability: "embedding", model: "local-hash-384", api_key: "" },
    ],
    chat_model_id: "deepseek-chat",
    embedding_model_id: "local-embedding",
    review_mode: "manual",
    chat_context_window_tokens: null,
    chat_max_output_tokens: 8192,
  })),
  saveSettings: vi.fn(async (payload) => payload),
  selectVault: vi.fn(async (path: string) => ({ path })),
  scanVault: vi.fn(async () => ({ scanned_files: 1, indexed_notes: 1, skipped_files: 0 })),
  rebuildIndex: vi.fn(async () => ({ indexed_chunks: 1 })),
  updateIndex: vi.fn(async () => ({ indexed_chunks: 1 })),
  updateIndexDeduped: vi.fn(async () => ({ indexed_chunks: 1 })),
  listOpenRouterModels: vi.fn(async () => ({ models: [{ id: "openai/gpt-4.1-mini", name: "GPT 4.1 Mini" }] })),
  listMemories: vi.fn(async () => ({ memories: [sampleMemory] })),
  createMemory: vi.fn(async (payload) => ({
    ...sampleMemory,
    ...payload,
    id: "mem_created",
    path: "Memories/Concepts/created.md",
  })),
  updateMemory: vi.fn(async (id: string, payload) => ({
    ...sampleMemory,
    ...payload,
    id,
  })),
  deleteMemory: vi.fn(async () => ({ deleted: true })),
  updateMemoryPin: vi.fn(async (id: string, pinned: boolean) => ({ ...sampleMemory, id, pinned })),
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
    used_memories: [],
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
    memory_index_refresh_required: false,
  })),
  generateSuggestions: vi.fn(async () => ({ suggestions: [] })),
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
    window.localStorage.clear();
    Object.defineProperty(window, "luminaDesktop", { configurable: true, value: undefined });
  });

  it("renders beginner model cards and saves model API keys", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByDisplayValue("D:/memory")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Models" }));
    expect(screen.getByText("Chat model")).toBeInTheDocument();
    expect(screen.getByText("Memory search model")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("API key for DeepSeek Chat"), { target: { value: "deepseek-model-key" } });
    await chooseSelectOption("Default Chat model", "Ollama Chat");
    fireEvent.change(screen.getByLabelText("Chat context window tokens (blank for automatic)"), {
      target: { value: "65536" },
    });
    fireEvent.change(screen.getByLabelText("Max response tokens"), { target: { value: "4096" } });
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await chooseSelectOption("Review behavior", "Automatic acceptance");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          chat_model_id: "ollama-chat",
          embedding_model_id: "local-embedding",
          configured_models: expect.arrayContaining([
            expect.objectContaining({ id: "deepseek-chat", api_key: "deepseek-model-key" }),
          ]),
          chat_context_window_tokens: 65536,
          chat_max_output_tokens: 4096,
          review_mode: "auto",
        }),
      ),
    );
  });

  it("adds OpenRouter catalog models and rebuilds after changing the embedding assignment", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Models" }));
    fireEvent.click(screen.getByRole("button", { name: "Fetch OpenRouter embedding models" }));
    await waitFor(() => expect(api.listOpenRouterModels).toHaveBeenCalledWith("embedding"));
    fireEvent.click(await screen.findByRole("button", { name: "Add GPT 4.1 Mini as embedding model" }));
    fireEvent.change(screen.getByLabelText("API key for DeepSeek Chat"), { target: { value: "deepseek-key" } });
    await chooseSelectOption("Embedding model", "GPT 4.1 Mini");
    fireEvent.change(screen.getByLabelText("API key for GPT 4.1 Mini"), { target: { value: "router-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          configured_models: expect.arrayContaining([
            expect.objectContaining({ id: "openrouter-embedding-openai-gpt-4-1-mini", api_key: "router-key" }),
          ]),
        }),
      ),
    );
    await waitFor(() => expect(api.updateIndexDeduped).toHaveBeenCalled());
    expect(await screen.findByText(/Index rebuilt/)).toBeInTheDocument();
  });

  it("blocks saving a selected cloud model without its model API key", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Models" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText("API key is required for the selected Chat model.")).toBeInTheDocument();
    expect(api.saveSettings).not.toHaveBeenCalled();
  });

  it("uses theme variables for model settings cards and advanced controls", () => {
    expect(stylesCss).toMatch(/\.model-choice-card\s*\{[^}]*background:\s*var\(--ui-subtle\)/s);
    expect(stylesCss).toMatch(/\.model-choice-header strong\s*\{[^}]*color:\s*var\(--ui-text\)/s);
    expect(stylesCss).toMatch(/\.model-advanced-section\s*\{[^}]*background:\s*var\(--ui-panel\)/s);
    expect(stylesCss).toMatch(/\.model-advanced-section summary\s*\{[^}]*color:\s*var\(--ui-text\)/s);
  });

  it("keeps the memory type filter compact and inside the source panel", () => {
    expect(stylesCss).toMatch(
      /\.memory-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(112px,\s*1fr\)\s+minmax\(88px,\s*104px\)[^}]*gap:\s*6px/s,
    );
    expect(stylesCss).toMatch(
      /\.memory-toolbar \.search-field,\s*\.memory-toolbar \.animated-select-trigger\s*\{[^}]*min-width:\s*0/s,
    );
    expect(stylesCss).toMatch(
      /\.memory-toolbar \.animated-select-listbox\s*\{[^}]*right:\s*0;[^}]*left:\s*auto;[^}]*min-width:\s*0;[^}]*width:\s*min\(132px,\s*max\(100%,\s*112px\)\)/s,
    );
    expect(stylesCss).toMatch(
      /\.memory-toolbar \.animated-select-listbox button span\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis/s,
    );
  });

  it("renders compact titlebar menus and sends theme changes to the desktop shell", async () => {
    const setTitlebarTheme = vi.fn(async () => undefined);
    Object.defineProperty(window, "luminaDesktop", {
      configurable: true,
      value: {
        chooseVaultDirectory: vi.fn(async () => null),
        getApiBaseUrl: vi.fn(() => null),
        setTitlebarTheme,
      },
    });
    window.localStorage.setItem("luminamind.ui.theme", "warm");
    const { container } = render(<App />);

    const titlebar = screen.getByRole("banner", { name: "LuminaMind title bar" });
    expect(titlebar).toHaveTextContent("LuminaMind");
    expect(titlebar.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector(".brand-identity svg")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    await waitFor(() => expect(setTitlebarTheme).toHaveBeenCalledWith("warm"));

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    await chooseSelectOption("Theme color", "Dark");

    await waitFor(() => expect(setTitlebarTheme).toHaveBeenCalledWith("dark"));
  });

  it("opens custom selects with an animated listbox and closes them after selection", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Theme color" }));

    const listbox = await screen.findByRole("listbox", { name: "Theme color" });
    expect(listbox).toHaveAttribute("data-state", "open");
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    expect(listbox).toHaveAttribute("data-state", "closing");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Theme color" })).not.toBeInTheDocument());
  });

  it("persists desktop splitter sizes from keyboard resizing", async () => {
    render(<App />);
    await screen.findByText("Project planning");

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize navigation" }), { key: "ArrowRight" });
    expect(window.localStorage.getItem("luminamind.ui.layout.sidebarWidth")).toBe("252");

    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize conversations and chat" }), { key: "ArrowRight" });
    expect(window.localStorage.getItem("luminamind.ui.layout.chatLeftWidth")).toBe("296");
  });

  it("applies and persists appearance preferences from settings and the app shell", async () => {
    window.localStorage.setItem("luminamind.ui.theme", "warm");
    window.localStorage.setItem("luminamind.ui.sidebarCollapsed", "true");
    window.localStorage.setItem("luminamind.ui.showScrollbars", "false");
    const { container } = render(<App />);

    const shell = container.querySelector(".app-shell");
    expect(shell).toHaveAttribute("data-theme", "warm");
    expect(shell).toHaveAttribute("data-scrollbars", "hidden");
    expect(shell).toHaveClass("sidebar-collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(window.localStorage.getItem("luminamind.ui.sidebarCollapsed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    await chooseSelectOption("Theme color", "Dark");
    const scrollbarSwitch = screen.getByRole("switch", { name: "Show scrollbars" });
    expect(scrollbarSwitch).not.toBeChecked();
    fireEvent.click(scrollbarSwitch);

    expect(shell).toHaveAttribute("data-theme", "dark");
    expect(shell).toHaveAttribute("data-scrollbars", "visible");
    expect(window.localStorage.getItem("luminamind.ui.theme")).toBe("dark");
    expect(window.localStorage.getItem("luminamind.ui.showScrollbars")).toBe("true");
  });

  it("switches the interface language from appearance settings without a reload", async () => {
    render(<App />);

    await screen.findByRole("button", { name: "Project planning" });
    await screen.findByRole("button", { name: "Review, 1 pending" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Appearance" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Language" }));
    const chineseOption = await screen.findByRole("option", { name: "中文" });
    await act(async () => {
      fireEvent.click(chineseOption);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "聊天" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记忆" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "审查" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "设置" })).toBeInTheDocument();
    expect(window.localStorage.getItem("luminamind.ui.language")).toBe("zh");

    fireEvent.click(screen.getByRole("button", { name: "聊天" }));
    expect(screen.getByPlaceholderText("询问 LuminaMind...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "外观" }));
    fireEvent.click(screen.getByRole("combobox", { name: "语言" }));
    const englishOption = await screen.findByRole("option", { name: "English" });
    await act(async () => {
      fireEvent.click(englishOption);
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Memory" })).toBeInTheDocument();
    expect(window.localStorage.getItem("luminamind.ui.language")).toBe("en");
  });

  it("keeps API-provided content unchanged when the interface is Chinese", async () => {
    window.localStorage.setItem("luminamind.ui.language", "zh");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "记忆" }));

    expect(await screen.findAllByText(sampleMemory.title)).toHaveLength(2);
    expect(screen.getByText(sampleMemory.content)).toBeInTheDocument();
    expect(screen.getByText("D:/memory")).toBeInTheDocument();
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

  it("keeps the selected vault visible when index rebuild fails", async () => {
    const chooseVaultDirectory = vi.fn(async () => "D:/picked-vault");
    Object.defineProperty(window, "luminaDesktop", {
      configurable: true,
      value: { chooseVaultDirectory },
    });
    vi.mocked(api.rebuildIndex).mockRejectedValueOnce(new Error("Embedding provider is unavailable."));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select vault" }));

    expect(await screen.findByDisplayValue("D:/picked-vault")).toBeInTheDocument();
    expect(await screen.findByText("Index rebuild failed: Embedding provider is unavailable.")).toBeInTheDocument();
    expect(api.scanVault).toHaveBeenCalled();
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

  it("filters loaded memories by keyword across note content and reports no results", async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      memories: [
        sampleMemory,
        {
          ...sampleMemory,
          id: "mem_2",
          title: "Search target",
          path: "Memories/Projects/search.md",
          tags: ["needle-tag"],
          content: "A hidden searchable phrase.",
        },
      ],
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.change(await screen.findByLabelText("Search memories"), { target: { value: "hidden searchable" } });
    expect(await screen.findByRole("heading", { level: 2, name: "Search target" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "does-not-exist" } });
    expect(await screen.findByText("No memories match your search.")).toBeInTheDocument();
  });

  it("filters memories by type together with keyword search and resets the selected note", async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      memories: [
        { ...sampleMemory, title: "Project record", content: "shared phrase" },
        {
          ...sampleMemory,
          id: "mem_profile",
          title: "Profile record",
          type: "profile",
          path: "Memories/Profile/preference.md",
          content: "shared phrase",
        },
      ],
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Project record" })).toBeInTheDocument();

    await chooseSelectOption("Filter memories by type", "profile");
    expect(await screen.findByRole("heading", { level: 2, name: "Profile record" })).toBeInTheDocument();
    expect(screen.queryByText("Project record")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "project" } });
    expect(await screen.findByText("No memories match your filters.")).toBeInTheDocument();
  });

  it("creates a memory from the detail editor and normalizes comma-separated tags", async () => {
    const createdMemory: api.MemoryNote = {
      ...sampleMemory,
      id: "mem_created",
      title: "New editable memory",
      type: "task",
      content: "# New body",
      tags: ["alpha", "beta", "gamma"],
      importance: 3,
      path: "Memories/Tasks/new-editable-memory.md",
    };
    vi.mocked(api.createMemory).mockResolvedValueOnce(createdMemory);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    await chooseSelectOption("Filter memories by type", "profile");
    fireEvent.change(screen.getByLabelText("Search memories"), { target: { value: "hidden-by-filter" } });
    fireEvent.click(await screen.findByRole("button", { name: "New memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "New editable memory" } });
    await chooseSelectOption("Memory type", "task");
    fireEvent.change(screen.getByLabelText("Memory tags"), {
      target: { value: " alpha，beta, alpha, ,gamma " },
    });
    fireEvent.change(screen.getByLabelText("Markdown content"), { target: { value: "# New body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => expect(api.createMemory).toHaveBeenCalledWith({
      title: "New editable memory",
      type: "task",
      content: "# New body",
      tags: ["alpha", "beta", "gamma"],
      importance: 3,
      confidence: 0.9,
      source: "manual",
      status: "active",
      links: [],
    }));
    expect(await screen.findByRole("heading", { level: 2, name: "New editable memory" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New editable memory" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search memories")).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "Filter memories by type" })).toHaveTextContent("All types");
    expect(api.updateIndexDeduped).toHaveBeenCalledTimes(1);
  });

  it("requires a title before creating a memory", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "New memory" }));
    fireEvent.change(screen.getByLabelText("Markdown content"), { target: { value: "Body without title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(await screen.findByText("Memory title is required.")).toBeInTheDocument();
    expect(api.createMemory).not.toHaveBeenCalled();
  });

  it("prefills the editor and preserves hidden metadata when updating a memory", async () => {
    const updatedMemory: api.MemoryNote = {
      ...sampleMemory,
      title: "Edited title",
      type: "concept",
      content: "Edited body",
      tags: ["updated"],
    };
    vi.mocked(api.updateMemory).mockResolvedValueOnce(updatedMemory);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    expect(screen.getByLabelText("Memory title")).toHaveValue(sampleMemory.title);
    expect(screen.getByLabelText("Memory tags")).toHaveValue("Agent");
    expect(screen.getByLabelText("Markdown content")).toHaveValue(sampleMemory.content);

    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Edited title" } });
    await chooseSelectOption("Memory type", "concept");
    fireEvent.change(screen.getByLabelText("Memory tags"), { target: { value: "updated" } });
    fireEvent.change(screen.getByLabelText("Markdown content"), { target: { value: "Edited body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    await waitFor(() => expect(api.updateMemory).toHaveBeenCalledWith("mem_1", {
      title: "Edited title",
      type: "concept",
      content: "Edited body",
      tags: ["updated"],
      importance: 5,
      confidence: 0.9,
      source: "manual",
      status: "active",
      links: sampleMemory.links,
    }));
    expect(await screen.findByRole("heading", { level: 2, name: "Edited title" })).toBeInTheDocument();
  });

  it("cancels memory editing without saving changes", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Discarded title" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));

    expect(await screen.findByRole("heading", { level: 2, name: sampleMemory.title })).toBeInTheDocument();
    expect(api.updateMemory).not.toHaveBeenCalled();
  });

  it("protects unsaved edits when selecting another memory or leaving the memory page", async () => {
    const otherMemory = {
      ...sampleMemory,
      id: "mem_2",
      title: "Other memory",
      path: "Memories/Projects/other.md",
    };
    vi.mocked(api.listMemories).mockResolvedValueOnce({ memories: [sampleMemory, otherMemory] });
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Unsaved title" } });
    fireEvent.click(screen.getByRole("button", { name: "Other memory" }));

    expect(screen.getByLabelText("Memory title")).toHaveValue("Unsaved title");
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(await screen.findByPlaceholderText("Ask LuminaMind...")).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("keeps unsaved protection active when the current memory navigation is clicked again", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Still unsaved" } });
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(screen.getByLabelText("Memory title")).toHaveValue("Still unsaved");
    expect(confirm).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  it("prevents duplicate saves while a memory write is in progress", async () => {
    let resolveUpdate: ((memory: typeof sampleMemory) => void) | undefined;
    vi.mocked(api.updateMemory).mockImplementationOnce(() => new Promise((resolve) => {
      resolveUpdate = resolve;
    }));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Saving title" } });
    const saveButton = screen.getByRole("button", { name: "Save memory" });
    fireEvent.click(saveButton);

    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(api.updateMemory).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUpdate?.({ ...sampleMemory, title: "Saving title" });
      await Promise.resolve();
    });
  });

  it("keeps saved memory visible when index refresh fails and allows retrying it", async () => {
    const updatedMemory = { ...sampleMemory, title: "Saved before index failure" };
    vi.mocked(api.updateMemory).mockResolvedValueOnce(updatedMemory);
    vi.mocked(api.updateIndexDeduped)
      .mockRejectedValueOnce(new Error("Embedding offline"))
      .mockResolvedValueOnce({ indexed_chunks: 2 });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(await screen.findByRole("button", { name: "Edit memory" }));
    fireEvent.change(screen.getByLabelText("Memory title"), { target: { value: "Saved before index failure" } });
    fireEvent.click(screen.getByRole("button", { name: "Save memory" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Saved before index failure" })).toBeInTheDocument();
    expect(await screen.findByText("Memory saved, but index update failed: Embedding offline")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry index update" }));

    await waitFor(() => expect(api.updateIndexDeduped).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Memory saved and index updated.")).toBeInTheDocument();
  });

  it("opens the memory context menu, pins a note, and displays its pinned state", async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({ memories: [sampleMemory] });
    vi.mocked(api.updateMemoryPin).mockResolvedValueOnce({ ...sampleMemory, pinned: true });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    const row = await screen.findByRole("button", { name: sampleMemory.title });
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: `Pin ${sampleMemory.title}` }));

    await waitFor(() => expect(api.updateMemoryPin).toHaveBeenCalledWith("mem_1", true));
    expect(await screen.findByLabelText(`Pinned ${sampleMemory.title}`)).toBeInTheDocument();
  });

  it("confirms and deletes a memory from its context menu", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(api.listMemories)
      .mockResolvedValueOnce({ memories: [sampleMemory] })
      .mockResolvedValueOnce({ memories: [] });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    await screen.findByText("Markdown + Embedding + 双链检索。");
    fireEvent.contextMenu(screen.getByRole("button", { name: sampleMemory.title }), { clientX: 10, clientY: 10 });
    fireEvent.click(await screen.findByRole("menuitem", { name: `Delete ${sampleMemory.title}` }));

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
    await waitFor(() => expect(api.generateSuggestions).toHaveBeenCalledWith("conv_saved"));
    expect(await screen.findByText("1 memory suggestion ready for review.")).toBeInTheDocument();
  });

  it("shows replies while post-processing remains queued and serializes later extraction", async () => {
    let finishFirstExtraction!: () => void;
    vi.mocked(api.generateSuggestions)
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishFirstExtraction = () => resolve({ suggestions: [] });
      }))
      .mockResolvedValueOnce({ suggestions: [] });
    vi.mocked(api.listSuggestions)
      .mockResolvedValueOnce({ suggestions: [] })
      .mockResolvedValueOnce({ suggestions: [] })
      .mockResolvedValueOnce({ suggestions: [] });
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "First" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("第一版先完成 Markdown 记忆库和混合检索闭环。")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(api.sendChat).toHaveBeenCalledTimes(2));
    expect(api.generateSuggestions).toHaveBeenCalledTimes(1);

    finishFirstExtraction();
    await waitFor(() => expect(api.generateSuggestions).toHaveBeenCalledTimes(2));
  });

  it("refreshes the index before extraction and offers retry after post-processing failure", async () => {
    vi.mocked(api.listSuggestions)
      .mockResolvedValueOnce({ suggestions: [] })
      .mockResolvedValueOnce({ suggestions: [] });
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "Answer before indexing.",
      used_memories: [],
      memory_suggestions: [],
      memory_index_refresh_required: true,
    });
    vi.mocked(api.generateSuggestions)
      .mockRejectedValueOnce(new Error("Extraction unavailable"))
      .mockResolvedValueOnce({ suggestions: [] });
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "Needs index" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Answer before indexing.")).toBeInTheDocument();
    await waitFor(() => expect(api.updateIndexDeduped).toHaveBeenCalled());
    expect(vi.mocked(api.updateIndexDeduped).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(api.generateSuggestions).mock.invocationCallOrder[0],
    );

    expect(await screen.findByText("Memory update failed: Extraction unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry memory update" }));
    await waitFor(() => expect(api.generateSuggestions).toHaveBeenCalledTimes(2));
    expect(api.updateIndexDeduped).toHaveBeenCalledTimes(1);
  });

  it("does not prompt for review when chat suggestions were automatically accepted", async () => {
    vi.mocked(api.listSuggestions)
      .mockResolvedValueOnce({ suggestions: [] })
      .mockResolvedValueOnce({ suggestions: [] });
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

  it("persists the Used memories panel collapse preference", async () => {
    const { container } = render(<App />);

    await screen.findByText("Project planning");
    fireEvent.click(screen.getByRole("button", { name: "Collapse used memories" }));
    expect(container.querySelector(".chat-grid")).toHaveClass("memory-source-collapsed");
    expect(window.localStorage.getItem("luminamind.ui.memorySourceCollapsed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Expand used memories" }));
    expect(container.querySelector(".chat-grid")).not.toHaveClass("memory-source-collapsed");
    expect(window.localStorage.getItem("luminamind.ui.memorySourceCollapsed")).toBe("false");
  });

  it("opens a compact composer model picker and forwards its selected override to postprocessing", async () => {
    render(<App />);

    const modelTrigger = await screen.findByRole("button", { name: "Response model" });
    expect(modelTrigger).toHaveTextContent("DeepSeek Chat");
    expect(screen.queryByRole("menu", { name: "Response models" })).not.toBeInTheDocument();
    fireEvent.click(modelTrigger);
    const modelMenu = await screen.findByRole("menu", { name: "Response models" });
    expect(modelMenu).toHaveAttribute("data-state", "open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(modelMenu).toHaveAttribute("data-state", "closing");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Response models" })).not.toBeInTheDocument());

    fireEvent.click(modelTrigger);
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Use Ollama Chat" }));
    expect(modelTrigger).toHaveTextContent("Ollama Chat");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Response models" })).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Chat message"), { target: { value: "Use local chat" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(api.sendChat).toHaveBeenCalledWith("Use local chat", "conv_saved", "ollama-chat"));
    await waitFor(() => expect(api.generateSuggestions).toHaveBeenCalledWith("conv_saved", "ollama-chat"));
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

  it("searches saved conversations through the API and clears the query", async () => {
    render(<App />);
    await screen.findByText("Project planning");

    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "needle" } });
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledWith("needle"));

    fireEvent.click(screen.getByRole("button", { name: "Clear conversation search" }));
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledWith(""));
  });

  it("ignores failures from stale conversation search requests", async () => {
    let rejectStaleSearch!: (reason: Error) => void;
    vi.mocked(api.listConversations)
      .mockResolvedValueOnce({
        conversations: [{
          id: "conv_saved",
          title: "Project planning",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:01:00",
          message_count: 2,
          pinned: false,
        }],
      })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectStaleSearch = reject;
      }))
      .mockResolvedValueOnce({ conversations: [] });
    render(<App />);
    await screen.findByText("Project planning");

    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "older" } });
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledWith("older"));
    fireEvent.change(screen.getByLabelText("Search conversations"), { target: { value: "newer" } });
    await waitFor(() => expect(api.listConversations).toHaveBeenCalledWith("newer"));

    await act(async () => {
      rejectStaleSearch(new Error("Stale search failed"));
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale search failed")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());

    fireEvent.contextMenu(screen.getByRole("button", { name: "Project planning" }), { clientX: 10, clientY: 10 });
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
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
      .mockResolvedValueOnce({ suggestions: [] });
    render(<App />);

    const reviewNavigation = await screen.findByRole("button", { name: "Review, 1 pending" });
    fireEvent.click(reviewNavigation);
    expect(await screen.findByRole("heading", { level: 2, name: "新的长期偏好" })).toBeInTheDocument();

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
      .mockResolvedValueOnce(acceptedHistory);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Review" }));

    expect(await screen.findByText("accepted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept 已自动记录" })).toBeDisabled();
  });

  it("filters review records by status and shows the selected detail panel", async () => {
    vi.mocked(api.listSuggestions).mockResolvedValueOnce({
      suggestions: [
        {
          id: "sug_pending", conversation_id: "conv_1", action: "create", title: "Pending record",
          content: "Pending content", type: "project", tags: [], importance: 3,
          confidence: 0.8, target_note_id: null, reason: "Needs review", status: "pending",
        },
        {
          id: "sug_accepted", conversation_id: "conv_1", action: "create", title: "Accepted record",
          content: "Accepted content", type: "log", tags: [], importance: 3,
          confidence: 0.8, target_note_id: null, reason: "Already saved", status: "accepted",
        },
      ],
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Review, 1 pending" }));
    fireEvent.click(screen.getByRole("button", { name: "Accepted" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Accepted record" })).toBeInTheDocument();
    expect(screen.queryByText("Pending record")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Accepted record" })).toBeDisabled();
  });

  it("places pending review actions in the detail header before suggestion content", async () => {
    vi.mocked(api.listSuggestions).mockResolvedValueOnce({
      suggestions: [{
        id: "sug_header", conversation_id: "conv_1", action: "create", title: "Header action record",
        content: "Content below the actions.", type: "project", tags: [], importance: 3,
        confidence: 0.8, target_note_id: null, reason: "Needs review", status: "pending",
      }],
    });
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Review, 1 pending" }));

    const detail = container.querySelector(".suggestion-detail");
    const header = detail?.querySelector(".suggestion-detail-header");
    const content = detail?.querySelector(".suggestion-content");
    expect(header).not.toBeNull();
    expect(content).not.toBeNull();
    expect(header).toContainElement(screen.getByRole("button", { name: "Accept Header action record" }));
    expect(header).toContainElement(screen.getByRole("button", { name: "Reject Header action record" }));
    expect(header!.compareDocumentPosition(content!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("renders math and highlighted code in stored memories", async () => {
    vi.mocked(api.listMemories).mockResolvedValueOnce({
      memories: [{
        ...sampleMemory,
        content: "Inline $x^2$.\n\n$$\nE = mc^2\n$$\n\n```ts\nconst energy = 1;\n```",
      }],
    });
    const { container } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    await screen.findAllByText(sampleMemory.title);
    expect(container.querySelector(".markdown-content .katex")).toBeInTheDocument();
    expect(container.querySelector(".markdown-content .katex-display")).toBeInTheDocument();
    expect(container.querySelector(".markdown-content code.hljs.language-ts")).toBeInTheDocument();
  });

  it("renders formulas and highlighted code in chat messages", async () => {
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "Inline $x^2$.\n\n$$\nE = mc^2\n$$\n\n```ts\nconst energy = 1;\n```",
      used_memories: [],
      memory_suggestions: [],
    });
    const { container } = render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "Render output" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(container.querySelector(".message-content .katex")).toBeInTheDocument());
    expect(container.querySelector(".message-content .katex-display")).toBeInTheDocument();
    expect(container.querySelector(".message-content code.hljs.language-ts")).toBeInTheDocument();
  });

  it("renders LaTeX bracket and parenthesis delimiters returned by the model", async () => {
    vi.mocked(api.sendChat).mockResolvedValueOnce({
      conversation_id: "conv_saved",
      answer: "Display equation:\n\n\\[\n\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}\n\\]\n\nInline \\(E = mc^2\\).",
      used_memories: [],
      memory_suggestions: [],
    });
    const { container } = render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "Render LaTeX" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(container.querySelector(".message-content .katex-display")).toBeInTheDocument());
    expect(container.querySelectorAll(".message-content .katex")).toHaveLength(2);
  });

  it("renders Review suggestion Markdown with math and highlighted code safely", async () => {
    vi.mocked(api.listSuggestions).mockResolvedValue({
      suggestions: [{
        id: "sug_markdown",
        conversation_id: "conv_1",
        action: "create",
        title: "Rendered suggestion",
        content: "Formula $x^2$.\n\n```ts\nconst value = 1;\n```\n\n<span data-testid=\"review-html\">Unsafe</span>",
        type: "concept",
        tags: [],
        importance: 3,
        confidence: 0.8,
        target_note_id: null,
        reason: "**Useful** reason.",
        status: "pending",
      }],
    });
    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Review, 1 pending" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Rendered suggestion" })).toBeInTheDocument();
    expect(container.querySelector(".suggestion-content .katex")).toBeInTheDocument();
    expect(container.querySelector(".suggestion-content code.hljs.language-ts")).toBeInTheDocument();
    expect(screen.getByText("Useful").tagName).toBe("STRONG");
    expect(screen.queryByTestId("review-html")).not.toBeInTheDocument();
  });

  it("keeps the generating response visible while navigating away and back", async () => {
    vi.mocked(api.sendChat).mockImplementationOnce(() => new Promise(() => undefined));
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Wait while browsing elsewhere" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("status", { name: "Generating response..." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(screen.getByRole("status", { name: "Generating response..." })).toBeInTheDocument();
    expect(screen.getByText("Wait while browsing elsewhere")).toBeInTheDocument();
  });

  it("keeps an in-flight response visible after switching conversations and returning", async () => {
    vi.mocked(api.listConversations).mockResolvedValue({
      conversations: [
        {
          id: "conv_active",
          title: "Active request",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:02:00",
          message_count: 1,
          pinned: false,
        },
        {
          id: "conv_other",
          title: "Other chat",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:01:00",
          message_count: 1,
          pinned: false,
        },
      ],
    });
    vi.mocked(api.getConversationMessages).mockImplementation(async (id) => ({
      messages: [{
        id: `msg_${id}`,
        conversation_id: id,
        role: "assistant",
        content: `Stored message from ${id}`,
        created_at: "2026-05-23T10:01:00",
      }],
      used_memories: [],
    }));
    let resolveChat!: (value: Awaited<ReturnType<typeof api.sendChat>>) => void;
    vi.mocked(api.sendChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    render(<App />);

    expect(await screen.findByText("Stored message from conv_active")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), {
      target: { value: "Keep this generation" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("status", { name: "Generating response..." })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Other chat" }));
    expect(await screen.findByText("Stored message from conv_other")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Active request" }));

    expect(screen.getByRole("status", { name: "Generating response..." })).toBeInTheDocument();
    expect(screen.getByText("Keep this generation")).toBeInTheDocument();

    resolveChat({
      conversation_id: "conv_active",
      answer: "Completed after returning.",
      used_memories: [],
      memory_suggestions: [],
    });
    expect(await screen.findByText("Completed after returning.")).toBeInTheDocument();
  });

  it("restores the latest used memories when reloading and reselecting a saved conversation", async () => {
    vi.mocked(api.listConversations).mockResolvedValue({
      conversations: [
        {
          id: "conv_source",
          title: "Sourced chat",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:02:00",
          message_count: 2,
          pinned: false,
        },
        {
          id: "conv_empty",
          title: "No source chat",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:01:00",
          message_count: 2,
          pinned: false,
        },
      ],
    });
    vi.mocked(api.getConversationMessages).mockImplementation(async (id) => ({
      messages: [{
        id: `msg_${id}`,
        conversation_id: id,
        role: "assistant",
        content: `Loaded ${id}`,
        created_at: "2026-05-23T10:01:00",
      }],
      used_memories: id === "conv_source"
        ? [{ memory_id: "mem_source", title: "Reloaded retrieval source", score: 0.93 }]
        : [],
    }));
    render(<App />);

    expect(await screen.findByText("Reloaded retrieval source")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "No source chat" }));
    await screen.findByText("Loaded conv_empty");
    expect(screen.queryByText("Reloaded retrieval source")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sourced chat" }));
    expect(await screen.findByText("Reloaded retrieval source")).toBeInTheDocument();
  });

  it("updates an already open Review page when a chat response creates a suggestion", async () => {
    const liveSuggestion = {
      id: "sug_live",
      conversation_id: "conv_saved",
      action: "create",
      title: "Live review suggestion",
      content: "Remember $x^2$.",
      type: "concept",
      tags: ["live"],
      importance: 3,
      confidence: 0.8,
      target_note_id: null,
      reason: "Created after the response.",
      status: "pending" as const,
    };
    let suggestionReady = false;
    let resolveChat!: (value: Awaited<ReturnType<typeof api.sendChat>>) => void;
    vi.mocked(api.listSuggestions).mockImplementation(async () => ({
      suggestions: suggestionReady ? [liveSuggestion] : [],
    }));
    vi.mocked(api.sendChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveChat = resolve;
      }),
    );
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText("Ask LuminaMind..."), { target: { value: "Generate review" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(screen.queryByText("Live review suggestion")).not.toBeInTheDocument();

    suggestionReady = true;
    resolveChat({
      conversation_id: "conv_saved",
      answer: "Reply complete.",
      used_memories: [],
      memory_suggestions: [liveSuggestion],
    });

    expect(await screen.findByRole("heading", { level: 2, name: "Live review suggestion" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Review, 1 pending" })).toBeInTheDocument();
  });

  it("opens the most recently updated chat first and preserves an explicit selection across pages", async () => {
    vi.mocked(api.listConversations).mockResolvedValue({
      conversations: [
        {
          id: "conv_pinned_old",
          title: "Pinned old",
          created_at: "2026-05-22T10:00:00",
          updated_at: "2026-05-22T10:01:00",
          message_count: 1,
          pinned: true,
        },
        {
          id: "conv_recent",
          title: "Recent chat",
          created_at: "2026-05-23T10:00:00",
          updated_at: "2026-05-23T10:01:00",
          message_count: 1,
          pinned: false,
        },
      ],
    });
    vi.mocked(api.getConversationMessages).mockImplementation(async (id) => ({
      messages: [{
        id: `msg_${id}`,
        conversation_id: id,
        role: "assistant",
        content: `Message from ${id}`,
        created_at: "2026-05-23T10:01:00",
      }],
      used_memories: [],
    }));
    render(<App />);

    expect(await screen.findByText("Message from conv_recent")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pinned old" }));
    expect(await screen.findByText("Message from conv_pinned_old")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText("Message from conv_pinned_old")).toBeInTheDocument();
  });

  it("clears the previous chat and loads the latest conversation after switching vaults", async () => {
    const chooseVaultDirectory = vi.fn(async () => "D:/second-vault");
    let secondVaultSelected = false;
    Object.defineProperty(window, "luminaDesktop", {
      configurable: true,
      value: { chooseVaultDirectory },
    });
    vi.mocked(api.selectVault).mockImplementationOnce(async (path: string) => {
      secondVaultSelected = true;
      return { path };
    });
    vi.mocked(api.listConversations).mockImplementation(async () => ({
      conversations: [{
        id: secondVaultSelected ? "conv_second" : "conv_first",
        title: secondVaultSelected ? "Second vault chat" : "First vault chat",
        created_at: "2026-05-23T10:00:00",
        updated_at: "2026-05-23T10:01:00",
        message_count: 1,
        pinned: false,
      }],
    }));
    vi.mocked(api.getConversationMessages).mockImplementation(async (id) => ({
      messages: [{
        id: `msg_${id}`,
        conversation_id: id,
        role: "assistant",
        content: `Loaded ${id}`,
        created_at: "2026-05-23T10:01:00",
      }],
      used_memories: [],
    }));
    render(<App />);

    expect(await screen.findByText("Loaded conv_first")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(await screen.findByRole("button", { name: "Select vault" }));
    await waitFor(() => expect(api.selectVault).toHaveBeenCalledWith("D:/second-vault"));
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));

    expect(await screen.findByText("Loaded conv_second")).toBeInTheDocument();
    expect(screen.queryByText("Loaded conv_first")).not.toBeInTheDocument();
  });

  it("shows a reused empty conversation only once after repeated New chat clicks", async () => {
    const reusedDraft = {
      id: "conv_blank",
      title: "New conversation",
      created_at: "2026-05-23T10:02:00",
      updated_at: "2026-05-23T10:02:00",
      message_count: 0,
      pinned: false,
    };
    vi.mocked(api.listConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(api.createConversation).mockResolvedValue(reusedDraft);
    render(<App />);
    await waitFor(() => expect(api.listConversations).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    await waitFor(() => expect(api.createConversation).toHaveBeenCalledTimes(2));
    expect(screen.getAllByRole("button", { name: "New conversation" })).toHaveLength(1);
  });
});
