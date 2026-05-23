import { FolderOpen, Save } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";

import { rebuildIndex, saveSettings, scanVault, selectVault, type AppSettings } from "../services/api";

const emptySettings: AppSettings = {
  vault_path: "",
  llm_provider: "deepseek",
  deepseek_base_url: "https://api.deepseek.com",
  deepseek_model: "deepseek-chat",
  deepseek_api_key: "",
  ollama_base_url: "http://127.0.0.1:11434",
  ollama_chat_model: "qwen2.5:7b",
  ollama_embedding_model: "bge-m3",
  embedding_fallback_to_local: true,
};

type Props = {
  settings: AppSettings | null;
  onSettingsChange: (settings: AppSettings) => void;
};

export function SettingsPage({ settings, onSettingsChange }: Props) {
  const [form, setForm] = useState<AppSettings>(settings ?? emptySettings);
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
    try {
      const selected = await selectVault(form.vault_path);
      const scan = await scanVault();
      const index = await rebuildIndex();
      setStatus(`Vault ${selected.path} ready. ${scan.indexed_notes} notes, ${index.indexed_chunks} chunks.`);
      onSettingsChange({ ...form, vault_path: selected.path });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize vault");
    }
  }

  return (
    <section className="settings-page">
      <div className="page-title">
        <h1>Settings</h1>
      </div>

      <div className="settings-layout">
        <section className="panel form-panel">
          <label>
            Vault path
            <input value={form.vault_path} onChange={updateText("vault_path")} placeholder="D:/MyAgentMemory" />
          </label>
          <button type="button" className="icon-text-button" onClick={initializeVault}>
            <FolderOpen size={16} aria-hidden />
            Select vault
          </button>
        </section>

        <section className="panel form-panel">
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
          <button type="button" onClick={save}>
            <Save size={16} aria-hidden />
            Save settings
          </button>
        </section>
      </div>

      {status ? <div className="banner success">{status}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
    </section>
  );
}
