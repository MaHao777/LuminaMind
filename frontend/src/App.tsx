import { BookOpenText, CheckCheck, MessageSquareText, Search, Settings, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSettings, type AppSettings } from "./services/api";

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
  const [error, setError] = useState<string>("");

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err: Error) => setError(err.message));
  }, []);

  const content = useMemo(() => {
    if (page === "memory") return <MemoryPage />;
    if (page === "review") return <ReviewPage />;
    if (page === "settings") return <SettingsPage settings={settings} onSettingsChange={setSettings} />;
    return <ChatPage />;
  }, [page, settings]);

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
                className={page === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setPage(item.id)}
              >
                <Icon size={18} aria-hidden />
                {item.label}
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
