import { beforeEach, describe, expect, it } from "vitest";

import { loadLanguage, saveLanguage } from "../services/uiPreferences";

function setNavigatorLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

describe("ui preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setNavigatorLanguage("en-US");
  });

  it("defaults to Chinese when the browser language starts with zh", () => {
    setNavigatorLanguage("zh-CN");

    expect(loadLanguage()).toBe("zh");
  });

  it("uses a saved language preference before the browser language", () => {
    setNavigatorLanguage("zh-CN");
    saveLanguage("en");

    expect(loadLanguage()).toBe("en");
    expect(window.localStorage.getItem("luminamind.ui.language")).toBe("en");
  });

  it("ignores invalid saved language values", () => {
    window.localStorage.setItem("luminamind.ui.language", "fr");

    expect(loadLanguage()).toBe("en");
  });
});
