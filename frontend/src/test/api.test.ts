import { afterEach, describe, expect, it, vi } from "vitest";

import { sendChat } from "../services/api";

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
});
