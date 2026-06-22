import { FolderOpen, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import { useI18n, type LanguageId } from "../i18n";
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
  deepseek_base_url: "https://api.deepseek.com",
  ollama_base_url: "http://127.0.0.1:11434",
  openrouter_base_url: "https://openrouter.ai/api/v1",
  configured_models: [
    { id: "deepseek_chat", name: "DeepSeek Chat", provider: "deepseek", capability: "chat", model: "deepseek-chat", api_key: "" },
    { id: "local_hash_embedding", name: "Local Hash", provider: "local_hash", capability: "embedding", model: "local-hash-384", api_key: "" },
  ],
  chat_model_id: "deepseek_chat",
  embedding_model_id: "local_hash_embedding",
  chat_context_window_tokens: null,
  chat_max_output_tokens: 8192,
};

type SettingsSection = "vault" | "review" | "models" | "appearance";

const capabilities: ModelCapability[] = ["chat", "embedding"];

function modelRequiresApiKey(model: ConfiguredModel | undefined): boolean {
  return model?.provider === "deepseek" || model?.provider === "openrouter";
}

function providerLabel(provider: ModelProvider): string {
  if (provider === "local_hash") return "Local Hash";
  if (provider === "deepseek") return "DeepSeek";
  if (provider === "openrouter") return "OpenRouter";
  return "Ollama";
}

type Props = {
  settings: AppSettings | null;
  language: LanguageId;
  theme: ThemeId;
  showScrollbars: boolean;
  onSettingsChange: (settings: AppSettings) => void;
  onLanguageChange: (language: LanguageId) => void;
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
  language,
  theme,
  showScrollbars,
  onSettingsChange,
  onLanguageChange,
  onThemeChange,
  onShowScrollbarsChange,
}: Props) {
  const { t } = useI18n();
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
  const sections: Array<{ id: SettingsSection; label: string; description: string }> = [
    { id: "vault", label: t("settings.vault"), description: t("settings.vaultDescription") },
    { id: "review", label: t("settings.review"), description: t("settings.reviewDescription") },
    { id: "models", label: t("settings.models"), description: t("settings.modelsDescription") },
    { id: "appearance", label: t("settings.appearance"), description: t("settings.appearanceDescription") },
  ];

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
          api_key: "",
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
            api_key: "",
          },
        ],
      };
    });
  }

  function deleteConfiguredModel(model: ConfiguredModel) {
    if (model.id === form.chat_model_id || model.id === form.embedding_model_id) {
      setError(t("settings.deleteAssignedModel"));
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
      setError(err instanceof Error ? err.message : t("settings.failedLoadOpenRouter"));
    } finally {
      setCatalogLoading(null);
    }
  }

  function validateAssignments(): string {
    const chat = form.configured_models.find((model) => model.id === form.chat_model_id);
    const embedding = form.configured_models.find((model) => model.id === form.embedding_model_id);
    if (!chat || chat.capability !== "chat") return t("settings.selectConfiguredChat");
    if (!embedding || embedding.capability !== "embedding") return t("settings.selectConfiguredEmbedding");
    if (form.configured_models.some((model) => !model.name.trim() || !model.model.trim())) {
      return t("settings.modelIdRequired");
    }
    if (modelRequiresApiKey(chat) && !chat.api_key.trim()) {
      return t("settings.apiKeyRequiredChat");
    }
    if (modelRequiresApiKey(embedding) && !embedding.api_key.trim()) {
      return t("settings.apiKeyRequiredEmbedding");
    }
    return "";
  }

  async function refreshIndexAfterSave() {
    setRetryIndexRefresh(false);
    setStatus(t("settings.settingsSavedRebuilding"));
    try {
      const index = await updateIndexDeduped();
      setStatus(t("settings.settingsSavedIndexRebuilt", { chunks: index.indexed_chunks }));
    } catch (err) {
      setRetryIndexRefresh(true);
      setError(err instanceof Error
        ? t("settings.indexRebuildFailed", { message: err.message })
        : t("settings.indexRebuildFailedGeneric"));
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
        setStatus(t("settings.settingsSaved"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.failedSave"));
    }
  }

  async function initializeVault() {
    setError("");
    const chooseVaultDirectory = window.luminaDesktop?.chooseVaultDirectory;
    if (!chooseVaultDirectory) {
      setError(t("settings.vaultDesktopOnly"));
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
      setStatus(t("settings.vaultReady", {
        path: selected.path,
        notes: scan.indexed_notes,
        chunks: index.indexed_chunks,
      }));
      onSettingsChange(nextForm);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.failedInitializeVault"));
    }
  }

  function providerOptions(capability: ModelCapability): ModelProvider[] {
    return capability === "chat" ? ["deepseek", "ollama", "openrouter"] : ["local_hash", "ollama", "openrouter"];
  }

  const chatModels = form.configured_models.filter((model) => model.capability === "chat");
  const embeddingModels = form.configured_models.filter((model) => model.capability === "embedding");
  const selectedChat = chatModels.find((model) => model.id === form.chat_model_id);
  const selectedEmbedding = embeddingModels.find((model) => model.id === form.embedding_model_id);

  function renderAssignedModelCard(model: ConfiguredModel | undefined, title: string) {
    if (!model) return <div className="banner error">{t("settings.selectConfiguredTitle", { title })}</div>;
    return (
      <div className="model-choice-card">
        <div className="model-choice-header">
          <div>
            <span>{t("common.selected")}</span>
            <strong>{model.name}</strong>
          </div>
          <span className="status-pill">{providerLabel(model.provider)}</span>
        </div>
        <div className="model-card-fields">
          <label>
            {t("settings.modelName")}
            <input
              aria-label={t("settings.modelNameFor", { name: model.name })}
              value={model.name}
              onChange={(event) => updateConfiguredModel(model.id, { name: event.target.value })}
            />
          </label>
          <label>
            {t("settings.modelId")}
            <input
              aria-label={t("settings.modelIdFor", { name: model.name })}
              value={model.model}
              disabled={model.provider === "local_hash"}
              onChange={(event) => updateConfiguredModel(model.id, { model: event.target.value })}
            />
          </label>
          {modelRequiresApiKey(model) ? (
            <label className="model-api-key-field">
              {t("settings.apiKey")}
              <input
                type="password"
                aria-label={t("settings.apiKeyFor", { name: model.name })}
                value={model.api_key}
                onChange={(event) => updateConfiguredModel(model.id, { api_key: event.target.value })}
              />
            </label>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="page-grid settings-grid">
      <aside className="panel settings-browser">
        <h1>{t("nav.settings")}</h1>
        <div className="settings-category-list" aria-label={t("settings.settingsCategories")}>
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
            <h2>{t("settings.vault")}</h2>
            <label>
              {t("settings.vaultPath")}
              <input value={form.vault_path} readOnly placeholder={t("settings.noVaultSelected")} />
            </label>
            <button type="button" className="icon-text-button" onClick={initializeVault}>
              <FolderOpen size={16} aria-hidden />
              {t("settings.selectVault")}
            </button>
          </div>
        ) : null}

        {section === "review" ? (
          <div className="form-panel">
            <h2>{t("settings.review")}</h2>
            <label>
              {t("settings.reviewBehavior")}
              <select value={form.review_mode} onChange={updateText("review_mode")}>
                <option value="manual">{t("settings.manualAcceptance")}</option>
                <option value="auto">{t("settings.automaticAcceptance")}</option>
              </select>
            </label>
          </div>
        ) : null}

        {section === "models" ? (
          <div className="form-panel model-settings">
            <h2>{t("settings.models")}</h2>
            <section className="model-settings-section">
              <h3>{t("settings.chatModel")}</h3>
              <label>
                {t("settings.defaultChatModel")}
                <select value={form.chat_model_id} onChange={updateText("chat_model_id")}>
                  {chatModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </label>
              {renderAssignedModelCard(selectedChat, t("settings.chatModel"))}
            </section>

            <section className="model-settings-section">
              <h3>{t("settings.memorySearchModel")}</h3>
              <label>
                {t("settings.embeddingModel")}
                <select value={form.embedding_model_id} onChange={updateText("embedding_model_id")}>
                  {embeddingModels.map((model) => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
              </label>
              {renderAssignedModelCard(selectedEmbedding, t("settings.memorySearchModel"))}
            </section>

            <details className="model-settings-section model-advanced-section">
              <summary>{t("settings.advanced")}</summary>
              <label>
                {t("settings.deepSeekBaseUrl")}
                <input value={form.deepseek_base_url} onChange={updateText("deepseek_base_url")} />
              </label>
              <label>
                {t("settings.ollamaBaseUrl")}
                <input value={form.ollama_base_url} onChange={updateText("ollama_base_url")} />
              </label>
              <label>
                {t("settings.openRouterBaseUrl")}
                <input value={form.openrouter_base_url} onChange={updateText("openrouter_base_url")} />
              </label>
              <label>
                {t("settings.chatContextWindow")}
                <input
                  type="number"
                  min={16384}
                  value={form.chat_context_window_tokens ?? ""}
                  onChange={updateContextWindow}
                  placeholder="Automatic"
                />
              </label>
              <label>
                {t("settings.maxResponseTokens")}
                <input type="number" min={1} value={form.chat_max_output_tokens} onChange={updateMaxOutputTokens} />
              </label>
              {capabilities.map((capability) => (
                <div className="configured-model-group" key={capability}>
                  <div className="model-group-header">
                    <strong>{capability === "chat" ? t("settings.chatModels") : t("settings.embeddingModels")}</strong>
                    <div className="model-group-actions">
                      <button
                        type="button"
                        className="icon-text-button"
                        aria-label={t("settings.fetchOpenRouterModels", { capability })}
                        onClick={() => void fetchCatalog(capability)}
                        disabled={catalogLoading === capability}
                      >
                        <RefreshCw size={14} aria-hidden />
                        {t("settings.catalog")}
                      </button>
                      <button
                        type="button"
                        className="icon-text-button"
                        aria-label={t("settings.addManualModel", { capability })}
                        onClick={() => addManualModel(capability)}
                      >
                        <Plus size={14} aria-hidden />
                        {t("settings.manual")}
                      </button>
                    </div>
                  </div>
                  {catalogs[capability].map((candidate) => (
                    <button
                      type="button"
                      className="model-catalog-candidate"
                      key={candidate.id}
                      aria-label={t("settings.addCatalogModel", { name: candidate.name, capability })}
                      onClick={() => addCatalogModel(capability, candidate)}
                    >
                      <Plus size={14} aria-hidden />
                      {candidate.name}
                    </button>
                  ))}
                  {form.configured_models.filter((model) => model.capability === capability).map((model) => (
                    <div className="configured-model-row" key={model.id}>
                      <input
                        aria-label={t("settings.modelNameForId", { id: model.id })}
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
                        aria-label={t("settings.deleteModel", { name: model.name })}
                        disabled={model.id === form.chat_model_id || model.id === form.embedding_model_id}
                        onClick={() => deleteConfiguredModel(model)}
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </details>
          </div>
        ) : null}

        {section === "appearance" ? (
          <div className="form-panel">
            <h2>{t("settings.appearance")}</h2>
            <label>
              {t("settings.language")}
              <select value={language} onChange={(event) => onLanguageChange(event.target.value as LanguageId)}>
                <option value="en">{t("settings.languageEnglish")}</option>
                <option value="zh">{t("settings.languageChinese")}</option>
              </select>
            </label>
            <label>
              {t("settings.themeColor")}
              <select value={theme} onChange={(event) => onThemeChange(event.target.value as ThemeId)}>
                <option value="default">{t("settings.themeDefault")}</option>
                <option value="dark">{t("settings.themeDark")}</option>
                <option value="warm">{t("settings.themeWarm")}</option>
              </select>
            </label>
            <label className="switch-setting">
              <span className="switch-setting-copy">
                <strong>{t("settings.scrollbars")}</strong>
                <span>{showScrollbars ? t("common.visible") : t("common.hidden")}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label={t("settings.showScrollbars")}
                checked={showScrollbars}
                onChange={(event) => onShowScrollbarsChange(event.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span />
              </span>
            </label>
            <p className="setting-help">{t("settings.appearanceStored")}</p>
          </div>
        ) : null}

        <div className="settings-footer">
          <button type="button" onClick={save}>
            <Save size={16} aria-hidden />
            {t("settings.saveSettings")}
          </button>
          {retryIndexRefresh ? (
            <button type="button" className="icon-text-button" onClick={() => void refreshIndexAfterSave()}>
              <RefreshCw size={16} aria-hidden />
              {t("settings.retryIndexRebuild")}
            </button>
          ) : null}
          {status ? <div className="banner success">{status}</div> : null}
          {error ? <div className="banner error">{error}</div> : null}
        </div>
      </article>
    </section>
  );
}
