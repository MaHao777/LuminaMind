import { FolderOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import {
  listOpenRouterModels,
  rebuildIndex,
  saveSettings,
  scanVault,
  selectVault,
  updateIndexDeduped,
  type AppSettings,
  type ConfiguredModel,
  type ModelCapability,
  type ModelProvider,
  type ProviderModelCandidate,
} from "../services/api";
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
  openrouter_base_url: "https://openrouter.ai/api/v1",
  openrouter_api_key: "",
  configured_models: [
    { id: "deepseek_chat", name: "DeepSeek Chat", provider: "deepseek", capability: "chat", model: "deepseek-chat" },
    { id: "local_hash_embedding", name: "Local Hash", provider: "local_hash", capability: "embedding", model: "local-hash-384" },
  ],
  chat_model_id: "deepseek_chat",
  embedding_model_id: "local_hash_embedding",
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

const capabilities: ModelCapability[] = ["chat", "embedding"];

type Props = {
  settings: AppSettings | null;
  theme: ThemeId;
  showScrollbars: boolean;
  onSettingsChange: (settings: AppSettings) => void;
  onThemeChange: (theme: ThemeId) => void;
  onShowScrollbarsChange: (show: boolean) => void;
};

function embeddingAssignmentSignature(settings: AppSettings | null): string {
  if (!settings) return "";
  const model = settings.configured_models.find((item) => item.id === settings.embedding_model_id);
  if (!model) return "";
  const baseUrl = model.provider === "ollama"
    ? settings.ollama_base_url
    : model.provider === "openrouter"
      ? settings.openrouter_base_url
      : "";
  return `${model.provider}|${baseUrl.replace(/\/+$/, "")}|${model.model}`;
}

function modelIdForCatalog(capability: ModelCapability, model: string): string {
  return `openrouter-${capability}-${model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function SettingsPage({
  settings,
  theme,
  showScrollbars,
  onSettingsChange,
  onThemeChange,
  onShowScrollbarsChange,
}: Props) {
  const [form, setForm] = useState<AppSettings>(settings ?? emptySettings);
  const [section, setSection] = useState<SettingsSection>("vault");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [retryIndexRefresh, setRetryIndexRefresh] = useState(false);
  const [catalogs, setCatalogs] = useState<Record<ModelCapability, ProviderModelCandidate[]>>({
    chat: [],
    embedding: [],
  });
  const [catalogLoading, setCatalogLoading] = useState<ModelCapability | null>(null);
  const manualIdRef = useRef(0);

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

  function updateConfiguredModel(id: string, changes: Partial<ConfiguredModel>) {
    setForm((current) => ({
      ...current,
      configured_models: current.configured_models.map((model) => {
        if (model.id !== id) return model;
        const next = { ...model, ...changes };
        if (next.provider === "local_hash") next.model = "local-hash-384";
        return next;
      }),
    }));
  }

  function addManualModel(capability: ModelCapability) {
    manualIdRef.current += 1;
    setForm((current) => ({
      ...current,
      configured_models: [
        ...current.configured_models,
        {
          id: `manual-${capability}-${manualIdRef.current}`,
          name: `New ${capability} model`,
          provider: "openrouter",
          capability,
          model: "",
        },
      ],
    }));
  }

  function addCatalogModel(capability: ModelCapability, candidate: ProviderModelCandidate) {
    const id = modelIdForCatalog(capability, candidate.id);
    setForm((current) => {
      if (current.configured_models.some((model) => model.id === id)) return current;
      return {
        ...current,
        configured_models: [
          ...current.configured_models,
          {
            id,
            name: candidate.name,
            provider: "openrouter",
            capability,
            model: candidate.id,
          },
        ],
      };
    });
  }

  function deleteConfiguredModel(model: ConfiguredModel) {
    if (model.id === form.chat_model_id || model.id === form.embedding_model_id) {
      setError("Change the assigned model before deleting it.");
      return;
    }
    setForm((current) => ({
      ...current,
      configured_models: current.configured_models.filter((item) => item.id !== model.id),
    }));
  }

  async function fetchCatalog(capability: ModelCapability) {
    setError("");
    setCatalogLoading(capability);
    try {
      const response = await listOpenRouterModels(capability);
      setCatalogs((current) => ({ ...current, [capability]: response.models }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load OpenRouter models");
    } finally {
      setCatalogLoading(null);
    }
  }

  function validateAssignments(): string {
    const chat = form.configured_models.find((model) => model.id === form.chat_model_id);
    const embedding = form.configured_models.find((model) => model.id === form.embedding_model_id);
    if (!chat || chat.capability !== "chat") return "Select a configured Chat model.";
    if (!embedding || embedding.capability !== "embedding") return "Select a configured Embedding model.";
    if (form.configured_models.some((model) => !model.name.trim() || !model.model.trim())) {
      return "Configured model names and model IDs are required.";
    }
    if (
      (chat.provider === "openrouter" || embedding.provider === "openrouter")
      && !form.openrouter_api_key.trim()
    ) {
      return "OpenRouter API key is required for an assigned OpenRouter model.";
    }
    return "";
  }

  async function refreshIndexAfterSave() {
    setRetryIndexRefresh(false);
    setStatus("Settings saved. Rebuilding index...");
    try {
      const index = await updateIndexDeduped();
      setStatus(`Settings saved. Index rebuilt: ${index.indexed_chunks} chunks.`);
    } catch (err) {
      setRetryIndexRefresh(true);
      setError(err instanceof Error ? `Index rebuild failed: ${err.message}` : "Index rebuild failed.");
    }
  }

  async function save() {
    setError("");
    const validationError = validateAssignments();
    if (validationError) {
      setError(validationError);
      return;
    }
    const previousEmbedding = embeddingAssignmentSignature(settings);
    try {
      const saved = await saveSettings(form);
      setForm(saved);
      onSettingsChange(saved);
      if (saved.vault_path && previousEmbedding !== embeddingAssignmentSignature(saved)) {
        void refreshIndexAfterSave();
      } else {
        setStatus("Settings saved");
      }
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

  function providerOptions(capability: ModelCapability): ModelProvider[] {
    return capability === "chat" ? ["deepseek", "ollama", "openrouter"] : ["local_hash", "ollama", "openrouter"];
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
          <div className="form-panel model-settings">
            <h2>Models</h2>
            <section className="model-settings-section">
              <h3>Provider connections</h3>
              <label>
                DeepSeek base URL
                <input value={form.deepseek_base_url} onChange={updateText("deepseek_base_url")} />
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
                OpenRouter base URL
                <input value={form.openrouter_base_url} onChange={updateText("openrouter_base_url")} />
              </label>
              <label>
                OpenRouter API key
                <input type="password" value={form.openrouter_api_key} onChange={updateText("openrouter_api_key")} />
              </label>
            </section>

            <section className="model-settings-section">
              <h3>Configured models</h3>
              {capabilities.map((capability) => (
                <div className="configured-model-group" key={capability}>
                  <div className="model-group-header">
                    <strong>{capability === "chat" ? "Chat" : "Embedding"}</strong>
                    <div className="model-group-actions">
                      <button
                        type="button"
                        className="icon-text-button"
                        aria-label={`Fetch OpenRouter ${capability} models`}
                        onClick={() => void fetchCatalog(capability)}
                        disabled={catalogLoading === capability}
                      >
                        <RefreshCw size={14} aria-hidden />
                        From catalog
                      </button>
                      <button
                        type="button"
                        className="icon-text-button"
                        aria-label={`Add manual ${capability} model`}
                        onClick={() => addManualModel(capability)}
                      >
                        <Plus size={14} aria-hidden />
                        Manual
                      </button>
                    </div>
                  </div>
                  {catalogs[capability].map((candidate) => (
                    <button
                      type="button"
                      className="model-catalog-candidate"
                      key={candidate.id}
                      aria-label={`Add ${candidate.name} as ${capability} model`}
                      onClick={() => addCatalogModel(capability, candidate)}
                    >
                      <Plus size={14} aria-hidden />
                      {candidate.name}
                    </button>
                  ))}
                  {form.configured_models.filter((model) => model.capability === capability).map((model) => (
                    <div className="configured-model-row" key={model.id}>
                      <input
                        aria-label={`Name for ${model.id}`}
                        value={model.name}
                        onChange={(event) => updateConfiguredModel(model.id, { name: event.target.value })}
                      />
                      <select
                        aria-label={`Provider for ${model.id}`}
                        value={model.provider}
                        onChange={(event) => updateConfiguredModel(model.id, { provider: event.target.value as ModelProvider })}
                      >
                        {providerOptions(capability).map((provider) => (
                          <option key={provider} value={provider}>{provider}</option>
                        ))}
                      </select>
                      <input
                        aria-label={`Model ID for ${model.id}`}
                        value={model.model}
                        disabled={model.provider === "local_hash"}
                        onChange={(event) => updateConfiguredModel(model.id, { model: event.target.value })}
                      />
                      <button
                        type="button"
                        className="icon-button danger-button"
                        aria-label={`Delete model ${model.name}`}
                        disabled={model.id === form.chat_model_id || model.id === form.embedding_model_id}
                        onClick={() => deleteConfiguredModel(model)}
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </section>

            <section className="model-settings-section">
              <h3>Assignments</h3>
              <label>
                Default Chat model
                <select value={form.chat_model_id} onChange={updateText("chat_model_id")}>
                  {form.configured_models.filter((model) => model.capability === "chat").map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </label>
              <p className="setting-help">The default Chat model preselects the chat composer. Changing it in Chat applies to responses and memory suggestion extraction without changing this default.</p>
              <label>
                Embedding model
                <select value={form.embedding_model_id} onChange={updateText("embedding_model_id")}>
                  {form.configured_models.filter((model) => model.capability === "embedding").map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
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
            </section>
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
            <label className="switch-setting">
              <span className="switch-setting-copy">
                <strong>Scrollbars</strong>
                <span>{showScrollbars ? "Visible" : "Hidden"}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Show scrollbars"
                checked={showScrollbars}
                onChange={(event) => onShowScrollbarsChange(event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span />
              </span>
            </label>
            <p className="setting-help">Appearance preferences are stored on this device and apply across vaults.</p>
          </div>
        ) : null}

        <div className="settings-footer">
          <button type="button" onClick={save}>
            <Save size={16} aria-hidden />
            Save settings
          </button>
          {retryIndexRefresh ? (
            <button type="button" className="icon-text-button" onClick={() => void refreshIndexAfterSave()}>
              <RefreshCw size={16} aria-hidden />
              Retry index rebuild
            </button>
          ) : null}
          {status ? <div className="banner success">{status}</div> : null}
          {error ? <div className="banner error">{error}</div> : null}
        </div>
      </article>
    </section>
  );
}
