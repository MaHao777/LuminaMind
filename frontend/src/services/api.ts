export type LlmProvider = "deepseek" | "ollama";
export type ReviewMode = "manual" | "auto";
export type ModelProvider = "deepseek" | "ollama" | "openrouter" | "local_hash";
export type ModelCapability = "chat" | "embedding";

export type ConfiguredModel = {
  id: string;
  name: string;
  provider: ModelProvider;
  capability: ModelCapability;
  model: string;
  api_key: string;
};

export type ProviderModelCandidate = {
  id: string;
  name: string;
};

export type AppSettings = {
  vault_path: string;
  review_mode: ReviewMode;
  deepseek_base_url: string;
  ollama_base_url: string;
  openrouter_base_url: string;
  configured_models: ConfiguredModel[];
  chat_model_id: string;
  embedding_model_id: string;
  chat_context_window_tokens: number | null;
  chat_max_output_tokens: number;
};

export type MemoryNote = {
  id: string;
  title: string;
  type: string;
  content: string;
  tags: string[];
  importance: number;
  confidence: number;
  status: string;
  pinned: boolean;
  source: string;
  created: string;
  updated: string;
  links: string[];
  path: string;
};

export type ScanSummary = {
  scanned_files: number;
  indexed_notes: number;
  skipped_files: number;
};

export type IndexSummary = {
  indexed_notes?: number;
  indexed_chunks: number;
  vector_store?: string;
  embedding_index_stale?: boolean;
};

export type UsedMemory = {
  memory_id: string;
  title: string;
  score: number;
};

export type ChatResponse = {
  conversation_id?: string;
  answer: string;
  used_memories: UsedMemory[];
  memory_suggestions: MemorySuggestion[];
  memory_index_refresh_required?: boolean;
};

export type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  pinned: boolean;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | string;
  content: string;
  created_at: string;
};

export type MemorySuggestion = {
  id: string;
  conversation_id: string | null;
  action: string;
  title: string;
  content: string;
  type: string;
  tags: string[];
  importance: number;
  confidence: number;
  target_note_id: string | null;
  reason: string;
  status: "pending" | "processing" | "accepted" | "rejected";
};

export function getApiBaseUrl(): string {
  const desktopApiBase = window.luminaDesktop?.getApiBaseUrl?.();
  const configuredApiBase = desktopApiBase || import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
  return configuredApiBase.replace(/\/$/, "");
}

function getErrorMessage(text: string, status: number): string {
  if (!text) return `Request failed: ${status}`;
  try {
    const payload: unknown = JSON.parse(text);
    if (
      typeof payload === "object"
      && payload !== null
      && "detail" in payload
      && typeof payload.detail === "string"
    ) {
      return payload.detail;
    }
  } catch {
    return text;
  }
  return text;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(getErrorMessage(text, response.status));
  }
  return response.json() as Promise<T>;
}

export function getSettings() {
  return request<AppSettings>("/api/settings");
}

export function saveSettings(payload: AppSettings) {
  return request<AppSettings>("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function selectVault(path: string) {
  return request<{ path: string }>("/api/vault/select", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
}

export function scanVault() {
  return request<ScanSummary>("/api/vault/scan", { method: "POST" });
}

export function rebuildIndex() {
  return request<IndexSummary>("/api/index/rebuild", { method: "POST" });
}

export function listOpenRouterModels(capability: ModelCapability) {
  return request<{ models: ProviderModelCandidate[] }>(
    `/api/provider-models/openrouter?capability=${encodeURIComponent(capability)}`,
  );
}

export function updateIndex() {
  return request<IndexSummary>("/api/index/update", { method: "POST" });
}

let pendingIndexUpdate: Promise<IndexSummary> | null = null;

export function updateIndexDeduped() {
  if (!pendingIndexUpdate) {
    pendingIndexUpdate = updateIndex().finally(() => {
      pendingIndexUpdate = null;
    });
  }
  return pendingIndexUpdate;
}

export function listMemories() {
  return request<{ memories: MemoryNote[] }>("/api/memories");
}

export function deleteMemory(id: string) {
  return request<{ deleted: boolean }>(`/api/memories/${id}`, { method: "DELETE" });
}

export function updateMemoryPin(id: string, pinned: boolean) {
  return request<MemoryNote>(`/api/memories/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
}

export function sendChat(message: string, conversationId?: string, chatModelId?: string) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, conversation_id: conversationId, chat_model_id: chatModelId }),
  });
}

export function listConversations(query = "") {
  const trimmedQuery = query.trim();
  const search = trimmedQuery ? `?query=${encodeURIComponent(trimmedQuery)}` : "";
  return request<{ conversations: ConversationSummary[] }>(`/api/conversations${search}`);
}

export function createConversation(title = "New conversation") {
  return request<ConversationSummary>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: string) {
  return request<{ deleted: boolean }>(`/api/conversations/${id}`, { method: "DELETE" });
}

export function updateConversation(id: string, pinned: boolean) {
  return request<ConversationSummary>(`/api/conversations/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ pinned }),
  });
}

export function getConversationMessages(conversationId: string) {
  return request<{ messages: ChatMessage[]; used_memories: UsedMemory[] }>(`/api/conversations/${conversationId}/messages`);
}

export function listSuggestions() {
  return request<{ suggestions: MemorySuggestion[] }>("/api/memory-suggestions");
}

export function generateSuggestions(conversationId?: string, chatModelId?: string) {
  return request<{ suggestions: MemorySuggestion[] }>("/api/memory-suggestions/generate", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId, chat_model_id: chatModelId }),
  });
}

export function acceptSuggestion(id: string) {
  return request<MemorySuggestion>(`/api/memory-suggestions/${id}/accept`, { method: "POST" });
}

export function rejectSuggestion(id: string) {
  return request<MemorySuggestion>(`/api/memory-suggestions/${id}/reject`, { method: "POST" });
}
