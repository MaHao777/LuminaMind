import { BookOpenText, CheckCheck, MessageSquareText, PanelLeftClose, PanelLeftOpen, Search, Settings, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSettings, listSuggestions, type AppSettings, type MemorySuggestion } from "./services/api";
import {
  loadShowScrollbars,
  loadSidebarCollapsed,
  loadTheme,
  saveShowScrollbars,
  saveSidebarCollapsed,
  saveTheme,
  type ThemeId,
} from "./services/uiPreferences";

type Page = "chat" | "memory" | "review" | "settings";

const navItems: Array<{ id: Page; label: string; icon: typeof MessageSquareText }> = [
  { id: "chat", label: "Chat", icon: MessageSquareText },
  { id: "memory", label: "Memory", icon: BookOpenText },
  { id: "review", label: "Review", icon: CheckCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function App() {
  const [page, setPage] = useState<Page>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [error, setError] = useState<string>("");
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [showScrollbars, setShowScrollbars] = useState(() => loadShowScrollbars());
  const pendingSuggestionCount = suggestions.filter((suggestion) => suggestion.status === "pending").length;

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err: Error) => setError(err.message));
  }, []);

  const refreshPendingSuggestions = useCallback(async () => {
    if (!settings?.vault_path) {
      setSuggestions([]);
      return;
    }
    try {
      const response = await listSuggestions();
      setSuggestions(response.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending reviews");
    }
  }, [settings?.vault_path]);

  useEffect(() => {
    void refreshPendingSuggestions();
  }, [refreshPendingSuggestions]);

  function changeTheme(nextTheme: ThemeId) {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      saveSidebarCollapsed(next);
      return next;
    });
  }

  function changeShowScrollbars(show: boolean) {
    setShowScrollbars(show);
    saveShowScrollbars(show);
  }

  return (
    <div
      className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}
      data-theme={theme}
      data-scrollbars={showScrollbars ? "visible" : "hidden"}
    >
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-identity">
            <Sparkles size={22} aria-hidden />
            <div className="brand-copy">
              <strong>LuminaMind</strong>
              <span>Local memory agent</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
          </button>
        </div>

        <nav className="nav-list" aria-label="Main">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.id === "review" && pendingSuggestionCount > 0
                  ? `Review, ${pendingSuggestionCount} pending`
                  : item.label}
                className={page === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} aria-hidden />
                <span className="nav-label">{item.label}</span>
                {item.id === "review" && pendingSuggestionCount > 0 ? (
                  <span className="nav-badge" aria-hidden="true">{pendingSuggestionCount}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status" title={settings?.vault_path || "No vault selected"}>
          <Search size={16} aria-hidden />
          <span>{settings?.vault_path || "No vault selected"}</span>
        </div>
      </aside>

      <main className={page === "chat" ? "main-panel chat-main-panel" : "main-panel"}>
        {error ? <div className="banner error">{error}</div> : null}
        <ChatPage
          hidden={page !== "chat"}
          vaultPath={settings?.vault_path}
          chatModels={settings?.configured_models.filter((model) => model.capability === "chat")}
          defaultChatModelId={settings?.chat_model_id}
          pendingSuggestionCount={pendingSuggestionCount}
          onSuggestionsChanged={refreshPendingSuggestions}
        />
        {page === "memory" ? <MemoryPage /> : null}
        {page === "review" ? (
          <ReviewPage suggestions={suggestions} onSuggestionsChanged={refreshPendingSuggestions} />
        ) : null}
        {page === "settings" ? (
          <SettingsPage
            settings={settings}
            theme={theme}
            showScrollbars={showScrollbars}
            onSettingsChange={setSettings}
            onThemeChange={changeTheme}
            onShowScrollbarsChange={changeShowScrollbars}
          />
        ) : null}
      </main>
    </div>
  );
}
