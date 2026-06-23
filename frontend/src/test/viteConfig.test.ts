// @vitest-environment node

import { describe, expect, it } from "vitest";

import config from "../../vite.config";

describe("Vite packaged build config", () => {
  it("emits relative asset paths for file-loaded Electron pages", () => {
    expect(config).toMatchObject({ base: "./" });
  });
});
