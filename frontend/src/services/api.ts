export type LlmProvider = "deepseek" | "ollama";

export type AppSettings = {
  vault_path: string;
  llm_provider: LlmProvider;
  deepseek_base_url: string;
  deepseek_model: string;
  deepseek_api_key: string;
  ollama_base_url: string;
  ollama_chat_model: string;
  ollama_embedding_model: string;
  embedding_fallback_to_local?: boolean;
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
};

export type ConversationSummary = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
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
  status: string;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
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

export function listMemories() {
  return request<{ memories: MemoryNote[] }>("/api/memories");
}

export function sendChat(message: string, conversationId?: string) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, conversation_id: conversationId }),
  });
}

export function listConversations() {
  return request<{ conversations: ConversationSummary[] }>("/api/conversations");
}

export function createConversation(title = "New conversation") {
  return request<ConversationSummary>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

export function getConversationMessages(conversationId: string) {
  return request<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`);
}

export function listSuggestions() {
  return request<{ suggestions: MemorySuggestion[] }>("/api/memory-suggestions");
}

export function generateSuggestions(conversationId?: string) {
  return request<{ suggestions: MemorySuggestion[] }>("/api/memory-suggestions/generate", {
    method: "POST",
    body: JSON.stringify({ conversation_id: conversationId }),
  });
}

export function acceptSuggestion(id: string) {
  return request<MemorySuggestion>(`/api/memory-suggestions/${id}/accept`, { method: "POST" });
}

export function rejectSuggestion(id: string) {
  return request<MemorySuggestion>(`/api/memory-suggestions/${id}/reject`, { method: "POST" });
}
