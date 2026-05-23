import { Send } from "lucide-react";
import { FormEvent, useState } from "react";

import { sendChat, type UsedMemory } from "../services/api";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export function ChatPage() {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [usedMemories, setUsedMemories] = useState<UsedMemory[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chat failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page-grid chat-grid">
      <div className="panel conversation-list">
        <h1>Chat</h1>
        <div className="conversation-row active">Current conversation</div>
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
