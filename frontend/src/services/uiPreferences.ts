export type ThemeId = "default" | "dark" | "warm";
export type LanguageId = "en" | "zh";

const THEME_KEY = "luminamind.ui.theme";
const SIDEBAR_COLLAPSED_KEY = "luminamind.ui.sidebarCollapsed";
const MEMORY_SOURCE_COLLAPSED_KEY = "luminamind.ui.memorySourceCollapsed";
const SHOW_SCROLLBARS_KEY = "luminamind.ui.showScrollbars";
const LANGUAGE_KEY = "luminamind.ui.language";
const LAYOUT_KEY_PREFIX = "luminamind.ui.layout.";

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function loadTheme(): ThemeId {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "warm" ? stored : "default";
  } catch {
    return "default";
  }
}

export function saveTheme(theme: ThemeId) {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function loadSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveSidebarCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function loadMemorySourceCollapsed(): boolean {
  try {
    return window.localStorage.getItem(MEMORY_SOURCE_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveMemorySourceCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(MEMORY_SOURCE_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function loadShowScrollbars(): boolean {
  try {
    return window.localStorage.getItem(SHOW_SCROLLBARS_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveShowScrollbars(show: boolean) {
  try {
    window.localStorage.setItem(SHOW_SCROLLBARS_KEY, String(show));
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function loadLanguage(): LanguageId {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    if (stored === "en" || stored === "zh") return stored;
    return window.navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

export function saveLanguage(language: LanguageId) {
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function loadLayoutNumber(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = window.localStorage.getItem(`${LAYOUT_KEY_PREFIX}${key}`);
    if (raw === null) return fallback;
    const stored = Number(raw);
    return Number.isFinite(stored) ? clampNumber(stored, min, max) : fallback;
  } catch {
    return fallback;
  }
}

export function saveLayoutNumber(key: string, value: number, min: number, max: number) {
  try {
    window.localStorage.setItem(`${LAYOUT_KEY_PREFIX}${key}`, String(clampNumber(value, min, max)));
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}
