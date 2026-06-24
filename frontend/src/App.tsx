import { BookOpenText, CheckCheck, MessageSquareText, PanelLeftClose, PanelLeftOpen, Search, Settings } from "lucide-react";
import { CSSProperties, useCallback, useEffect, useState } from "react";

import { AppTitlebar } from "./components/AppTitlebar";
import { ResizableSplitter } from "./components/ResizableSplitter";
import { I18nProvider, useI18n, type LanguageId } from "./i18n";
import { ChatPage } from "./pages/ChatPage";
import { MemoryPage } from "./pages/MemoryPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { getSettings, listSuggestions, type AppSettings, type MemorySuggestion } from "./services/api";
import {
  loadLanguage,
  loadLayoutNumber,
  loadShowScrollbars,
  loadSidebarCollapsed,
  loadTheme,
  saveLanguage,
  saveLayoutNumber,
  saveShowScrollbars,
  saveSidebarCollapsed,
  saveTheme,
  type ThemeId,
} from "./services/uiPreferences";

type Page = "chat" | "memory" | "review" | "settings";

const navItems = [
  { id: "chat", labelKey: "nav.chat", icon: MessageSquareText },
  { id: "memory", labelKey: "nav.memory", icon: BookOpenText },
  { id: "review", labelKey: "nav.review", icon: CheckCheck },
  { id: "settings", labelKey: "nav.settings", icon: Settings },
] as const satisfies Array<{ id: Page; labelKey: "nav.chat" | "nav.memory" | "nav.review" | "nav.settings"; icon: typeof MessageSquareText }>;

const SIDEBAR_WIDTH = {
  default: 236,
  min: 184,
  max: 360,
};

export default function App() {
  const [language, setLanguage] = useState<LanguageId>(() => loadLanguage());

  function changeLanguage(nextLanguage: LanguageId) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  return (
    <I18nProvider language={language}>
      <AppShell language={language} onLanguageChange={changeLanguage} />
    </I18nProvider>
  );
}

type AppShellProps = {
  language: LanguageId;
  onLanguageChange: (language: LanguageId) => void;
};

function AppShell({ language, onLanguageChange }: AppShellProps) {
  const { t } = useI18n();
  const [page, setPage] = useState<Page>("chat");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [error, setError] = useState<string>("");
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const [showScrollbars, setShowScrollbars] = useState(() => loadShowScrollbars());
  const [memoryEditorDirty, setMemoryEditorDirty] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    loadLayoutNumber("sidebarWidth", SIDEBAR_WIDTH.default, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
  );
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
      setError(err instanceof Error ? err.message : t("app.pendingReviewsLoadFailed"));
    }
  }, [settings?.vault_path, t]);

  useEffect(() => {
    void refreshPendingSuggestions();
  }, [refreshPendingSuggestions]);

  useEffect(() => {
    window.luminaDesktop?.setTitlebarTheme?.(theme).catch(() => undefined);
  }, [theme]);

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

  function resizeSidebar(width: number) {
    setSidebarWidth(width);
    saveLayoutNumber("sidebarWidth", width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max);
  }

  function navigateToPage(nextPage: Page) {
    if (nextPage === page) return;
    if (
      page === "memory"
      && memoryEditorDirty
      && !window.confirm(t("memory.unsavedConfirm"))
    ) {
      return;
    }
    setMemoryEditorDirty(false);
    setPage(nextPage);
  }

  const shellStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  } as CSSProperties;

  return (
    <div
      className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}
      data-theme={theme}
      data-scrollbars={showScrollbars ? "visible" : "hidden"}
      lang={language === "zh" ? "zh-CN" : "en"}
      style={shellStyle}
    >
      <AppTitlebar />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-identity">
            <div className="brand-copy">
              <strong>LuminaMind</strong>
              <span>{t("app.brandSubtitle")}</span>
            </div>
          </div>
          <button
            type="button"
            className="icon-button sidebar-toggle"
            aria-label={sidebarCollapsed ? t("app.expandNavigation") : t("app.collapseNavigation")}
            onClick={toggleSidebar}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={17} aria-hidden /> : <PanelLeftClose size={17} aria-hidden />}
          </button>
        </div>

        <nav className="nav-list" aria-label={t("app.mainNavigation")}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                aria-label={item.id === "review" && pendingSuggestionCount > 0
                  ? t("app.pendingReviewNav", { count: pendingSuggestionCount })
                  : label}
                className={page === item.id ? "nav-item active" : "nav-item"}
                onClick={() => navigateToPage(item.id)}
              >
                <Icon size={18} aria-hidden />
                <span className="nav-label">{label}</span>
                {item.id === "review" && pendingSuggestionCount > 0 ? (
                  <span className="nav-badge" aria-hidden="true">{pendingSuggestionCount}</span>
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status" title={settings?.vault_path || t("app.noVaultSelected")}>
          <Search size={16} aria-hidden />
          <span>{settings?.vault_path || t("app.noVaultSelected")}</span>
        </div>
      </aside>

      <ResizableSplitter
        label={t("app.resizeNavigation")}
        value={sidebarWidth}
        min={SIDEBAR_WIDTH.min}
        max={SIDEBAR_WIDTH.max}
        defaultValue={SIDEBAR_WIDTH.default}
        onChange={resizeSidebar}
        className="app-sidebar-resizer"
        disabled={sidebarCollapsed}
      />

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
        {page === "memory" ? <MemoryPage onDirtyChange={setMemoryEditorDirty} /> : null}
        {page === "review" ? (
          <ReviewPage suggestions={suggestions} onSuggestionsChanged={refreshPendingSuggestions} />
        ) : null}
        {page === "settings" ? (
          <SettingsPage
            settings={settings}
            language={language}
            theme={theme}
            showScrollbars={showScrollbars}
            onSettingsChange={setSettings}
            onLanguageChange={onLanguageChange}
            onThemeChange={changeTheme}
            onShowScrollbarsChange={changeShowScrollbars}
          />
        ) : null}
      </main>
    </div>
  );
}
