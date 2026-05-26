import { FolderOpen, Save } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";

import { rebuildIndex, saveSettings, scanVault, selectVault, type AppSettings } from "../services/api";
import type { ThemeId } from "../services/uiPreferences";

const emptySettings: AppSettings = {
  vault_path: "",
  review_mode: "manual",
  llm_provider: "deepseek",
  deepseek_base_url: "https://api.deepseek.com",
  deepseek_model: "deepseek-chat",
  deepseek_api_key: "",
  ollama_base_url: "http://127.0.0.1:11434",
  ollama_chat_model: "qwen2.5:7b",
  ollama_embedding_model: "bge-m3",
  embedding_fallback_to_local: true,
  chat_context_window_tokens: null,
  chat_max_output_tokens: 8192,
};

type SettingsSection = "vault" | "review" | "models" | "appearance";

const sections: Array<{ id: SettingsSection; label: string; description: string }> = [
  { id: "vault", label: "Vault", description: "Workspace storage and indexing" },
  { id: "review", label: "Review", description: "Memory approval behavior" },
  { id: "models", label: "Models", description: "Chat and embedding providers" },
  { id: "appearance", label: "Appearance", description: "Theme and interface colors" },
];

type Props = {
  settings: AppSettings | null;
  theme: ThemeId;
  onSettingsChange: (settings: AppSettings) => void;
  onThemeChange: (theme: ThemeId) => void;
};

export function SettingsPage({ settings, theme, onSettingsChange, onThemeChange }: Props) {
  const [form, setForm] = useState<AppSettings>(settings ?? emptySettings);
  const [section, setSection] = useState<SettingsSection>("vault");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateText(key: keyof AppSettings) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(key, event.target.value as never);
  }

  function updateContextWindow(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value.trim();
    update("chat_context_window_tokens", value ? Number(value) : null);
  }

  function updateMaxOutputTokens(event: ChangeEvent<HTMLInputElement>) {
    update("chat_max_output_tokens", Number(event.target.value));
  }

  async function save() {
    setError("");
    try {
      const saved = await saveSettings(form);
      onSettingsChange(saved);
      setStatus("Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    }
  }

  async function initializeVault() {
    setError("");
    const chooseVaultDirectory = window.luminaDesktop?.chooseVaultDirectory;
    if (!chooseVaultDirectory) {
      setError("Vault folder selection is available in the desktop app only.");
      return;
    }
    try {
      const chosenPath = await chooseVaultDirectory();
      if (!chosenPath) return;
      const selected = await selectVault(chosenPath);
      const scan = await scanVault();
      const index = await rebuildIndex();
      const nextForm = { ...form, vault_path: selected.path };
      setForm(nextForm);
      setStatus(`Vault ${selected.path} ready. ${scan.indexed_notes} notes, ${index.indexed_chunks} chunks.`);
      onSettingsChange(nextForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize vault");
    }
  }

  return (
    <section className="page-grid settings-grid">
      <aside className="panel settings-browser">
        <h1>Settings</h1>
        <div className="settings-category-list" aria-label="Settings categories">
          {sections.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-label={item.label}
              className={section === item.id ? "settings-category active" : "settings-category"}
              onClick={() => setSection(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </aside>

      <article className="panel settings-detail">
        {section === "vault" ? (
          <div className="form-panel">
            <h2>Vault</h2>
            <label>
              Vault path
              <input value={form.vault_path} readOnly placeholder="No vault selected" />
            </label>
            <button type="button" className="icon-text-button" onClick={initializeVault}>
              <FolderOpen size={16} aria-hidden />
              Select vault
            </button>
          </div>
        ) : null}

        {section === "review" ? (
          <div className="form-panel">
            <h2>Review</h2>
            <label>
              Review behavior
              <select value={form.review_mode} onChange={updateText("review_mode")}>
                <option value="manual">Manual acceptance</option>
                <option value="auto">Automatic acceptance</option>
              </select>
            </label>
          </div>
        ) : null}

        {section === "models" ? (
          <div className="form-panel">
            <h2>Models</h2>
            <label>
              LLM Provider
              <select value={form.llm_provider} onChange={updateText("llm_provider")}>
                <option value="deepseek">deepseek</option>
                <option value="ollama">ollama</option>
              </select>
            </label>
            <label>
              DeepSeek base URL
              <input value={form.deepseek_base_url} onChange={updateText("deepseek_base_url")} />
            </label>
            <label>
              DeepSeek model
              <input value={form.deepseek_model} onChange={updateText("deepseek_model")} />
            </label>
            <label>
              DeepSeek API key
              <input type="password" value={form.deepseek_api_key} onChange={updateText("deepseek_api_key")} />
            </label>
            <label>
              Ollama base URL
              <input value={form.ollama_base_url} onChange={updateText("ollama_base_url")} />
            </label>
            <label>
              Ollama chat model
              <input value={form.ollama_chat_model} onChange={updateText("ollama_chat_model")} />
            </label>
            <label>
              Ollama embedding model
              <input value={form.ollama_embedding_model} onChange={updateText("ollama_embedding_model")} />
            </label>
            <label>
              Chat context window tokens (blank for automatic)
              <input
                type="number"
                min={16384}
                value={form.chat_context_window_tokens ?? ""}
                onChange={updateContextWindow}
                placeholder="Automatic"
              />
            </label>
            <label>
              Max response tokens
              <input type="number" min={1} value={form.chat_max_output_tokens} onChange={updateMaxOutputTokens} />
            </label>
          </div>
        ) : null}

        {section === "appearance" ? (
          <div className="form-panel">
            <h2>Appearance</h2>
            <label>
              Theme color
              <select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeId)}>
                <option value="default">Default light</option>
                <option value="dark">Dark</option>
                <option value="warm">Warm yellow</option>
              </select>
            </label>
            <p className="setting-help">Appearance preferences are stored on this device and apply across vaults.</p>
          </div>
        ) : null}

        <div className="settings-footer">
          <button type="button" onClick={save}>
            <Save size={16} aria-hidden />
            Save settings
          </button>
          {status ? <div className="banner success">{status}</div> : null}
          {error ? <div className="banner error">{error}</div> : null}
        </div>
      </article>
    </section>
  );
}
