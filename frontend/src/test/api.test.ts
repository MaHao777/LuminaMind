import { afterEach, describe, expect, it, vi } from "vitest";

import { generateSuggestions, listConversations, sendChat } from "../services/api";

describe("API error messages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
