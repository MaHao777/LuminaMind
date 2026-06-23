// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import config from "../../vite.config";

describe("Vite packaged build config", () => {
  it("emits relative asset paths for file-loaded Electron pages", () => {
    expect(config).toMatchObject({ base: "./" });
  });

  it("declares an inline favicon so dev verification does not request /favicon.ico", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");

    expect(html).toContain('rel="icon"');
    expect(html).toContain("data:image/svg+xml");
  });
});
