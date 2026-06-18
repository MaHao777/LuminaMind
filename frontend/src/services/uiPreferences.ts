export type ThemeId = "default" | "dark" | "warm";

const THEME_KEY = "luminamind.ui.theme";
const SIDEBAR_COLLAPSED_KEY = "luminamind.ui.sidebarCollapsed";
const MEMORY_SOURCE_COLLAPSED_KEY = "luminamind.ui.memorySourceCollapsed";
const SHOW_SCROLLBARS_KEY = "luminamind.ui.showScrollbars";

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
