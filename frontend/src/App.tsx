import { BookOpenText, CheckCheck, MessageSquareText, Search, Settings, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSettings, listSuggestions, type AppSettings, type MemorySuggestion } from "./services/api";

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
  const [pendingSuggestionCount, setPendingSuggestionCount] = useState(0);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err: Error) => setError(err.message));
  }, []);

  function updatePendingCount(suggestions: MemorySuggestion[]) {
    setPendingSuggestionCount(suggestions.filter((suggestion) => suggestion.status === "pending").length);
  }

  async function refreshPendingSuggestions() {
    if (!settings?.vault_path) {
      setPendingSuggestionCount(0);
      return;
    }
    try {
      const response = await listSuggestions();
      updatePendingCount(response.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending reviews");
    }
  }

  useEffect(() => {
    void refreshPendingSuggestions();
  }, [settings?.vault_path]);

  let content;
  if (page === "memory") {
    content = <MemoryPage />;
  } else if (page === "review") {
    content = <ReviewPage onSuggestionsLoaded={updatePendingCount} />;
  } else if (page === "settings") {
    content = <SettingsPage settings={settings} onSettingsChange={setSettings} />;
  } else {
    content = <ChatPage onSuggestionsChanged={refreshPendingSuggestions} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Sparkles size={22} aria-hidden />
          <div>
            <strong>LuminaMind</strong>
            <span>Local memory agent</span>
          </div>
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
                {item.label}
                {item.id === "review" && pendingSuggestionCount > 0 ? (
                  <span className="nav-badge" aria-hidden="true">{pendingSuggestionCount}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <Search size={16} aria-hidden />
          <span>{settings?.vault_path || "No vault selected"}</span>
        </div>
      </aside>

      <main className={page === "chat" ? "main-panel chat-main-panel" : "main-panel"}>
        {error ? <div className="banner error">{error}</div> : null}
        {content}
      </main>
    </div>
  );
}
