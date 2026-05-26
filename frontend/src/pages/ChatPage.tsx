import { Pin, Plus, Search, Send, Trash2, X } from "lucide-react";
import { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";

import { MarkdownContent } from "../components/MarkdownContent";
import {
  createConversation,
  deleteConversation,
  generateSuggestions,
  getConversationMessages,
  listConversations,
  sendChat,
  updateIndex,
  updateConversation,
  type ConversationSummary,
  type UsedMemory,
} from "../services/api";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type ConversationMenu = {
  conversation: ConversationSummary;
  left: number;
  top: number;
};

type PendingChat = {
  requestId: number;
  conversationId?: string;
  vaultPath?: string;
  messages: Message[];
  usedMemories: UsedMemory[];
};

type PostprocessTask = {
  conversationId: string;
  refreshIndex: boolean;
  vaultPath?: string;
};

type Props = {
  hidden?: boolean;
  vaultPath?: string;
  pendingSuggestionCount: number;
  onSuggestionsChanged?: () => void | Promise<void>;
};

function sortConversations(conversations: ConversationSummary[]) {
  return [...conversations].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned)
      || right.updated_at.localeCompare(left.updated_at)
      || right.created_at.localeCompare(left.created_at),
  );
}

function mostRecentlyUpdatedConversation(conversations: ConversationSummary[]) {
  return [...conversations].sort(
    (left, right) =>
      right.updated_at.localeCompare(left.updated_at)
      || right.created_at.localeCompare(left.created_at),
  )[0];
}

function toMessages(messages: Array<{ role: string; content: string }>): Message[] {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}

export function ChatPage({ hidden = false, vaultPath, pendingSuggestionCount, onSuggestionsChanged }: Props) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationQuery, setConversationQuery] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [usedMemories, setUsedMemories] = useState<UsedMemory[]>([]);
  const [input, setInput] = useState("");
  const [pendingChat, setPendingChat] = useState<PendingChat | null>(null);
  const [error, setError] = useState("");
  const [chatError, setChatError] = useState("");
  const [postprocessError, setPostprocessError] = useState("");
  const [retryPostprocess, setRetryPostprocess] = useState<PostprocessTask | null>(null);
  const [conversationMenu, setConversationMenu] = useState<ConversationMenu | null>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const vaultPathRef = useRef(vaultPath);
  const conversationIdRef = useRef(conversationId);
  const conversationQueryRef = useRef(conversationQuery);
  const pendingChatRef = useRef<PendingChat | null>(null);
  const requestIdRef = useRef(0);
  const listRequestIdRef = useRef(0);
  const searchEditedRef = useRef(false);
  const initializedVaultRef = useRef(false);
  const displayRevisionRef = useRef(0);
  const postprocessQueueRef = useRef<Promise<void>>(Promise.resolve());
  const refreshedIndexVaultRef = useRef<string | null>(null);
  const onSuggestionsChangedRef = useRef(onSuggestionsChanged);
  vaultPathRef.current = vaultPath;
  conversationIdRef.current = conversationId;
  conversationQueryRef.current = conversationQuery;
  onSuggestionsChangedRef.current = onSuggestionsChanged;
  const loading = Boolean(
    pendingChat
    && pendingChat.conversationId === conversationId
    && (pendingChat.vaultPath === undefined || pendingChat.vaultPath === vaultPath),
  );
  const requestInFlight = pendingChat !== null;

  function selectConversation(nextId?: string) {
    conversationIdRef.current = nextId;
    setConversationId(nextId);
  }

  function updatePendingChat(nextPendingChat: PendingChat | null) {
    pendingChatRef.current = nextPendingChat;
    setPendingChat(nextPendingChat);
  }

  function isPendingRequest(requestId: number) {
    return pendingChatRef.current?.requestId === requestId;
  }

  function enqueuePostprocess(task: PostprocessTask) {
    setPostprocessError("");
    setRetryPostprocess(null);
    postprocessQueueRef.current = postprocessQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const belongsToCurrentVault = () =>
          task.vaultPath === undefined || task.vaultPath === vaultPathRef.current;
        if (!belongsToCurrentVault()) return;
        const vaultKey = task.vaultPath ?? vaultPathRef.current ?? "__default__";
        if (task.refreshIndex && refreshedIndexVaultRef.current !== vaultKey) {
          await updateIndex();
          if (!belongsToCurrentVault()) return;
          refreshedIndexVaultRef.current = vaultKey;
        }
        await generateSuggestions(task.conversationId);
        if (!belongsToCurrentVault()) return;
        await onSuggestionsChangedRef.current?.();
      })
      .catch((err: unknown) => {
        if (task.vaultPath !== undefined && task.vaultPath !== vaultPathRef.current) return;
        const detail = err instanceof Error ? err.message : "Unknown error";
        setPostprocessError(`Memory update failed: ${detail}`);
        setRetryPostprocess(task);
      });
  }

  useEffect(() => {
    messageEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, loading, chatError]);

  useEffect(() => {
    if (!conversationMenu) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setConversationMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setConversationMenu(null);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [conversationMenu]);

  async function refreshConversations(query = conversationQueryRef.current) {
    const listRequestId = ++listRequestIdRef.current;
    const activeVaultPath = vaultPathRef.current;
    try {
      const response = await listConversations(query);
      if (
        listRequestId !== listRequestIdRef.current
        || activeVaultPath !== vaultPathRef.current
        || query !== conversationQueryRef.current
      ) return;
      setConversations(sortConversations(response.conversations));
    } catch (err) {
      if (
        listRequestId !== listRequestIdRef.current
        || activeVaultPath !== vaultPathRef.current
        || query !== conversationQueryRef.current
      ) return;
      throw err;
    }
  }

  async function loadConversation(nextId: string) {
    const revision = ++displayRevisionRef.current;
    const activeVaultPath = vaultPathRef.current;
    setError("");
    setChatError("");
    selectConversation(nextId);
    const activeRequest = pendingChatRef.current;
    if (
      activeRequest?.conversationId === nextId
      && (activeRequest.vaultPath === undefined || activeRequest.vaultPath === activeVaultPath)
    ) {
      setMessages(activeRequest.messages);
      setUsedMemories(activeRequest.usedMemories);
      return;
    }
    setUsedMemories([]);
    try {
      const response = await getConversationMessages(nextId);
      if (revision !== displayRevisionRef.current || activeVaultPath !== vaultPathRef.current) return;
      setMessages(toMessages(response.messages));
      setUsedMemories(response.used_memories);
    } catch (err) {
      if (revision !== displayRevisionRef.current || activeVaultPath !== vaultPathRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }

  async function startNewConversation() {
    if (pendingChatRef.current) return;
    setError("");
    setChatError("");
    try {
      const created = await createConversation();
      ++displayRevisionRef.current;
      if (conversationQueryRef.current.trim()) {
        searchEditedRef.current = false;
        conversationQueryRef.current = "";
        setConversationQuery("");
        await refreshConversations("");
      } else {
        setConversations((current) => sortConversations([created, ...current.filter((item) => item.id !== created.id)]));
      }
      selectConversation(created.id);
      setMessages([]);
      setUsedMemories([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create conversation");
    }
  }

  async function removeConversation(conversation: ConversationSummary) {
    setConversationMenu(null);
    const title = conversation.title || "Untitled";
    if (!window.confirm(`Delete conversation "${title}"?`)) return;
    setError("");
    try {
      await deleteConversation(conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      if (conversationId === conversation.id) {
        const nextConversation = mostRecentlyUpdatedConversation(remaining);
        if (nextConversation) {
          await loadConversation(nextConversation.id);
        } else {
          ++displayRevisionRef.current;
          selectConversation(undefined);
          setMessages([]);
          setUsedMemories([]);
          setChatError("");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete conversation");
    }
  }

  async function togglePinned(conversation: ConversationSummary) {
    setConversationMenu(null);
    setError("");
    try {
      const updated = await updateConversation(conversation.id, !conversation.pinned);
      setConversations((current) =>
        sortConversations(current.map((item) => (item.id === updated.id ? updated : item))),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update conversation");
    }
  }

  function openConversationMenu(conversation: ConversationSummary, clientX: number, clientY: number) {
    const menuWidth = 180;
    const menuHeight = 92;
    const viewportPadding = 8;
    const left = Math.max(viewportPadding, Math.min(clientX, window.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, Math.min(clientY, window.innerHeight - menuHeight - viewportPadding));
    setConversationMenu({ conversation, left, top });
  }

  function handleConversationContextMenu(event: ReactMouseEvent, conversation: ConversationSummary) {
    event.preventDefault();
    openConversationMenu(conversation, event.clientX, event.clientY);
  }

  function handleConversationKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, conversation: ConversationSummary) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openConversationMenu(conversation, bounds.left + 12, bounds.bottom);
  }

  useEffect(() => {
    if (vaultPath === undefined) return;
    const initialHydration = !initializedVaultRef.current;
    initializedVaultRef.current = true;
    if (initialHydration && (pendingChatRef.current || messages.length > 0 || input.length > 0)) return;

    const revision = ++displayRevisionRef.current;
    ++listRequestIdRef.current;
    selectConversation(undefined);
    setConversations([]);
    searchEditedRef.current = false;
    conversationQueryRef.current = "";
    setConversationQuery("");
    setMessages([]);
    setUsedMemories([]);
    setInput("");
    updatePendingChat(null);
    setError("");
    setChatError("");
    setPostprocessError("");
    setRetryPostprocess(null);
    refreshedIndexVaultRef.current = null;
    setConversationMenu(null);
    if (!vaultPath) return;

    listConversations()
      .then(async (response) => {
        if (
          revision !== displayRevisionRef.current
          || vaultPath !== vaultPathRef.current
          || conversationQueryRef.current !== ""
        ) return;
        setConversations(sortConversations(response.conversations));
        const recent = mostRecentlyUpdatedConversation(response.conversations);
        if (!recent) return;
        const messageResponse = await getConversationMessages(recent.id);
        if (revision !== displayRevisionRef.current || vaultPath !== vaultPathRef.current) return;
        selectConversation(recent.id);
        setMessages(toMessages(messageResponse.messages));
        setUsedMemories(messageResponse.used_memories);
      })
      .catch((err: Error) => {
        if (revision === displayRevisionRef.current && vaultPath === vaultPathRef.current) setError(err.message);
      });
  }, [vaultPath]);

  useEffect(() => {
    if (!searchEditedRef.current || !vaultPath) return undefined;
    const timeout = window.setTimeout(() => {
      refreshConversations(conversationQuery).catch((err: Error) => setError(err.message));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [conversationQuery, vaultPath]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || pendingChatRef.current) return;
    const requestId = ++requestIdRef.current;
    const submittedConversationId = conversationIdRef.current;
    const activeVaultPath = vaultPathRef.current;
    const submittedMessages = [...messages, { role: "user", content: text } as Message];
    const request: PendingChat = {
      requestId,
      conversationId: submittedConversationId,
      vaultPath: activeVaultPath,
      messages: submittedMessages,
      usedMemories,
    };

    setInput("");
    setMessages(submittedMessages);
    updatePendingChat(request);
    setError("");
    setChatError("");

    try {
      const response = await sendChat(text, submittedConversationId);
      if (!isPendingRequest(requestId)) return;
      if (activeVaultPath !== undefined && activeVaultPath !== vaultPathRef.current) return;
      updatePendingChat(null);
      if (conversationIdRef.current === submittedConversationId) {
        selectConversation(response.conversation_id);
        setMessages([...submittedMessages, { role: "assistant", content: response.answer }]);
        setUsedMemories(response.used_memories);
      }
      if (response.conversation_id) {
        enqueuePostprocess({
          conversationId: response.conversation_id,
          refreshIndex: Boolean(response.memory_index_refresh_required),
          vaultPath: activeVaultPath ?? vaultPathRef.current,
        });
      }
      try {
        await refreshConversations();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh conversations");
      }
    } catch (err) {
      if (!isPendingRequest(requestId)) return;
      if (activeVaultPath !== undefined && activeVaultPath !== vaultPathRef.current) return;
      updatePendingChat(null);
      if (conversationIdRef.current === submittedConversationId) {
        setChatError(err instanceof Error ? err.message : "Chat failed");
      }
    }
  }

  return (
    <section className="page-grid chat-grid" hidden={hidden}>
      <div className="panel conversation-list">
        <div className="panel-header">
          <h1>Chat</h1>
          <button type="button" className="icon-button" aria-label="New chat" disabled={requestInFlight} onClick={startNewConversation}>
            <Plus size={16} aria-hidden />
          </button>
        </div>
        <label className="search-field">
          <Search size={15} aria-hidden />
          <input
            aria-label="Search conversations"
            placeholder="Search chats"
            value={conversationQuery}
            onChange={(event) => {
              searchEditedRef.current = true;
              setError("");
              setConversationQuery(event.target.value);
            }}
          />
          {conversationQuery ? (
            <button
              type="button"
              className="clear-search-button"
              aria-label="Clear conversation search"
              onClick={() => {
                searchEditedRef.current = true;
                setError("");
                setConversationQuery("");
              }}
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </label>
        {conversations.length === 0 ? (
          <div className="empty-state">
            {conversationQuery.trim() ? "No chats match your search." : "No saved conversations."}
          </div>
        ) : (
          <div className="conversation-stack">
            {conversations.map((conversation) => (
              <div className="conversation-item" key={conversation.id}>
                <button
                  type="button"
                  aria-label={conversation.title || "Untitled"}
                  className={conversation.id === conversationId ? "conversation-row active" : "conversation-row"}
                  onClick={() => loadConversation(conversation.id)}
                  onContextMenu={(event) => handleConversationContextMenu(event, conversation)}
                  onKeyDown={(event) => handleConversationKeyDown(event, conversation)}
                >
                  <strong>{conversation.title || "Untitled"}</strong>
                  {conversation.pinned ? (
                    <Pin
                      className="conversation-pin"
                      size={14}
                      aria-label={`Pinned ${conversation.title || "Untitled"}`}
                    />
                  ) : null}
                  <span>{conversation.message_count} messages</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {conversationMenu ? (
          <div
            ref={menuRef}
            role="menu"
            className="conversation-menu"
            aria-label="Conversation actions"
            style={{ left: conversationMenu.left, top: conversationMenu.top }}
          >
            <button
              type="button"
              role="menuitem"
              aria-label={`${conversationMenu.conversation.pinned ? "Unpin" : "Pin"} ${conversationMenu.conversation.title || "Untitled"}`}
              onClick={() => togglePinned(conversationMenu.conversation)}
            >
              <Pin size={15} aria-hidden />
              {conversationMenu.conversation.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger-menu-item"
              aria-label={`Delete ${conversationMenu.conversation.title || "Untitled"}`}
              onClick={() => removeConversation(conversationMenu.conversation)}
            >
              <Trash2 size={15} aria-hidden />
              Delete
            </button>
          </div>
        ) : null}
      </div>

      <section className="panel chat-panel" aria-label="Agent conversation">
        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">Start with a question about your long-term memory.</div>
          ) : (
            messages.map((message, index) => (
              <article key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <span className="message-author">{message.role === "user" ? "You" : "Agent"}</span>
                <MarkdownContent className="message-content">{message.content}</MarkdownContent>
              </article>
            ))
          )}
          {loading ? (
            <article className="message assistant message-pending" role="status" aria-label="Generating response...">
              <span className="message-author">Agent</span>
              <p className="typing-status">
                Generating response
                <span className="typing-dots" aria-hidden="true">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            </article>
          ) : null}
          {chatError ? (
            <article className="message assistant message-error" role="alert">
              <span className="message-author">Agent</span>
              <p>{chatError}</p>
            </article>
          ) : null}
          <div ref={messageEndRef} className="message-end" aria-hidden="true" />
        </div>

        {error ? <div className="banner error">{error}</div> : null}
        {postprocessError ? (
          <div className="banner error postprocess-banner">
            <span>{postprocessError}</span>
            {retryPostprocess ? (
              <button type="button" className="icon-text-button" aria-label="Retry memory update" onClick={() => enqueuePostprocess(retryPostprocess)}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
        {pendingSuggestionCount > 0 ? (
          <div className="banner success">
            {pendingSuggestionCount} memory suggestion{pendingSuggestionCount === 1 ? "" : "s"} ready for review.
          </div>
        ) : null}

        <form className="composer" onSubmit={handleSubmit}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask LuminaMind..."
            aria-label="Chat message"
          />
          <button type="submit" disabled={requestInFlight || !input.trim()}>
            <Send size={16} aria-hidden />
            Send
          </button>
        </form>
      </section>

      <aside className="panel memory-source-panel">
        <h2>Used memories</h2>
        <div className="memory-source-list">
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
        </div>
      </aside>
    </section>
  );
}
