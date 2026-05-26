export type ThemeId = "default" | "dark" | "warm";

const THEME_KEY = "luminamind.ui.theme";
const SIDEBAR_COLLAPSED_KEY = "luminamind.ui.sidebarCollapsed";

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
