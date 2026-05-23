import { Plus, Send } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import {
  createConversation,
  getConversationMessages,
  listConversations,
  sendChat,
  type ConversationSummary,
  type UsedMemory,
} from "../services/api";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatPage() {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [usedMemories, setUsedMemories] = useState<UsedMemory[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshConversations(preferredId?: string) {
    const response = await listConversations();
    setConversations((current) => {
      const byId = new Map(current.map((conversation) => [conversation.id, conversation]));
      response.conversations.forEach((conversation) => byId.set(conversation.id, conversation));
      return Array.from(byId.values()).sort((left, right) => right.updated_at.localeCompare(left.updated_at));
    });
    if (preferredId) {
      setConversationId(preferredId);
    }
  }

  async function loadConversation(nextId: string) {
    setError("");
    setConversationId(nextId);
    setUsedMemories([]);
    try {
      const response = await getConversationMessages(nextId);
      setMessages(
        response.messages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }

  async function startNewConversation() {
    setError("");
    try {
      const created = await createConversation();
      setConversations((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setConversationId(created.id);
      setMessages([]);
      setUsedMemories([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create conversation");
    }
  }

  useEffect(() => {
    listConversations()
      .then((response) => setConversations(response.conversations))
      .catch((err: Error) => setError(err.message));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((current) => [...current, { role: "user", content: text }]);
    setLoading(true);
    setError("");

    try {
      const response = await sendChat(text, conversationId);
      setConversationId(response.conversation_id);
      setMessages((current) => [...current, { role: "assistant", content: response.answer }]);
      setUsedMemories(response.used_memories);
      await refreshConversations(response.conversation_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-grid chat-grid">
      <div className="panel conversation-list">
        <div className="panel-header">
          <h1>Chat</h1>
          <button type="button" className="icon-button" aria-label="New chat" onClick={startNewConversation}>
            <Plus size={16} aria-hidden />
          </button>
        </div>
        {conversations.length === 0 ? (
          <div className="empty-state">No saved conversations.</div>
        ) : (
          <div className="conversation-stack">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                aria-label={conversation.title || "Untitled"}
                className={conversation.id === conversationId ? "conversation-row active" : "conversation-row"}
                onClick={() => loadConversation(conversation.id)}
              >
                <strong>{conversation.title || "Untitled"}</strong>
                <span>{conversation.message_count} messages</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <section className="panel chat-panel" aria-label="Agent conversation">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">Start with a question about your long-term memory.</div>
          ) : (
            messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <span>{message.role === "user" ? "You" : "Agent"}</span>
                <p>{message.content}</p>
              </article>
            ))
          )}
        </div>

        {error ? <div className="banner error">{error}</div> : null}

        <form className="composer" onSubmit={handleSubmit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask LuminaMind..."
            aria-label="Chat message"
          />
          <button type="submit" disabled={loading || !input.trim()}>
            <Send size={16} aria-hidden />
            Send
          </button>
        </form>
      </section>

      <aside className="panel memory-source-panel">
        <h2>Used memories</h2>
        {usedMemories.length === 0 ? (
          <div className="empty-state">No memories used yet.</div>
        ) : (
          usedMemories.map((memory) => (
            <article className="source-row" key={memory.memory_id}>
              <strong>{memory.title}</strong>
              <span>{memory.score.toFixed(2)}</span>
            </article>
          ))
        )}
      </aside>
    </section>
  );
}
