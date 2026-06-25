import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createMemory,
  generateSuggestions,
  listConversations,
  patchSuggestionLinks,
  rebuildIndex,
  sendChat,
  updateIndexDeduped,
  updateMemory,
  type MemoryWritePayload,
} from "../services/api";
import { dismissIndexActivity, getIndexActivityState } from "../services/indexActivity";

describe("API error messages", () => {
  afterEach(() => {
    dismissIndexActivity();
    vi.unstubAllGlobals();
    window.luminaDesktop = undefined;
  });

  it("uses a FastAPI detail message for failed chat requests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Vault is not selected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(sendChat("hello")).rejects.toMatchObject({ message: "Vault is not selected" });
  });

  it("falls back to response text and propagated network errors", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("Service unavailable", { status: 503 }))
      .mockRejectedValueOnce(new Error("Network offline"));
    vi.stubGlobal("fetch", fetch);

    await expect(sendChat("first attempt")).rejects.toThrow("Service unavailable");
    await expect(sendChat("second attempt")).rejects.toThrow("Network offline");
  });

  it("encodes keyword searches when requesting conversations", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await listConversations("100% plan");

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/conversations?query=100%25%20plan");
  });

  it("uses the Electron-provided API base URL when packaged", async () => {
    window.luminaDesktop = {
      chooseVaultDirectory: vi.fn(),
      getApiBaseUrl: () => "http://127.0.0.1:8765",
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await listConversations();

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8765/api/conversations");
  });

  it("sends an optional chat model override for responses and suggestion generation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ answer: "ok", used_memories: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ suggestions: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await sendChat("hello", "conv_1", "ollama-chat");
    await generateSuggestions("conv_1", "ollama-chat");

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      message: "hello",
      conversation_id: "conv_1",
      chat_model_id: "ollama-chat",
    });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      conversation_id: "conv_1",
      chat_model_id: "ollama-chat",
    });
  });

  it("creates and updates memories with the shared write payload", async () => {
    const payload: MemoryWritePayload = {
      title: "Editable memory",
      type: "project",
      content: "Markdown body",
      tags: ["alpha"],
      importance: 4,
      confidence: 0.8,
      source: "manual",
      status: "active",
      links: ["Related note"],
    };
    const memory = {
      id: "mem_1",
      ...payload,
      pinned: false,
      created: "2026-06-24",
      updated: "2026-06-24",
      path: "D:/memory/Memories/Projects/editable-memory.md",
    };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(memory), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(memory), { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await createMemory(payload);
    await updateMemory("mem_1", payload);

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/memories");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(payload),
    });
    expect(fetch.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/memories/mem_1");
    expect(fetch.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify(payload),
    });
  });

  it("patches pending suggestion links", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "sug_1", links: ["Target"], status: "pending" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);

    await patchSuggestionLinks("sug_1", ["Target"]);

    expect(fetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/memory-suggestions/sug_1");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ links: ["Target"] }),
    });
  });

  it("tracks rebuild requests and deduplicated update requests as global index activity", async () => {
    let resolveRebuild!: (response: Response) => void;
    let resolveUpdate!: (response: Response) => void;
    const fetch = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveRebuild = resolve;
      }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveUpdate = resolve;
      }));
    vi.stubGlobal("fetch", fetch);

    const rebuild = rebuildIndex();
    expect(getIndexActivityState()).toEqual({ status: "running" });
    resolveRebuild(new Response(JSON.stringify({ indexed_chunks: 8 }), { status: 200 }));
    await expect(rebuild).resolves.toEqual({ indexed_chunks: 8 });
    expect(getIndexActivityState()).toEqual({ status: "success", indexedChunks: 8 });

    const firstUpdate = updateIndexDeduped();
    const secondUpdate = updateIndexDeduped();
    expect(firstUpdate).toBe(secondUpdate);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(getIndexActivityState()).toEqual({ status: "running" });

    resolveUpdate(new Response(JSON.stringify({ indexed_chunks: 11 }), { status: 200 }));
    await expect(firstUpdate).resolves.toEqual({ indexed_chunks: 11 });
    expect(getIndexActivityState()).toEqual({ status: "success", indexedChunks: 11 });
  });
});
