import { RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { MarkdownContent } from "../components/MarkdownContent";

import { deleteMemory, listMemories, rebuildIndex, scanVault, type MemoryNote } from "../services/api";

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryNote[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const response = await listMemories();
      setMemories(response.memories);
      setSelectedId((current) => current || response.memories[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredMemories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return memories;
    return memories.filter((memory) =>
      [
        memory.title,
        memory.type,
        memory.path,
        memory.content,
        memory.tags.join(" "),
      ].join("\n").toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [memories, query]);

  useEffect(() => {
    setSelectedId((current) =>
      filteredMemories.some((memory) => memory.id === current)
        ? current
        : filteredMemories[0]?.id || "",
    );
  }, [filteredMemories]);

  const selected = filteredMemories.find((memory) => memory.id === selectedId) ?? filteredMemories[0];

  async function removeSelectedMemory() {
    if (!selected || deleting) return;
    if (!window.confirm(`Delete memory "${selected.title}"?`)) return;
    setDeleting(true);
    setError("");
    try {
      await deleteMemory(selected.id);
      const response = await listMemories();
      setMemories(response.memories);
      setSelectedId(response.memories[0]?.id || "");
      setStatus("Memory deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete memory");
    } finally {
      setDeleting(false);
    }
  }

  async function refreshVault() {
    setError("");
    const scan = await scanVault();
    const index = await rebuildIndex();
    setStatus(`Scanned ${scan.indexed_notes} notes, indexed ${index.indexed_chunks} chunks`);
    await load();
  }

  return (
    <section className="page-grid memory-grid">
      <aside className="panel file-tree">
        <div className="panel-header">
          <h1>Memory</h1>
          <button type="button" className="icon-text-button" onClick={refreshVault}>
            <RefreshCw size={16} aria-hidden />
            Reindex
          </button>
        </div>
        <label className="search-field">
          <Search size={15} aria-hidden />
          <input
            aria-label="Search memories"
            placeholder="Search memories"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {filteredMemories.length === 0 ? (
          <div className="empty-state">
            {query.trim() && memories.length > 0 ? "No memories match your search." : "No Markdown memories loaded."}
          </div>
        ) : (
          <div className="memory-list">
            {filteredMemories.map((memory) => (
              <button
                key={memory.id}
                className={selected?.id === memory.id ? "memory-row active" : "memory-row"}
                type="button"
                onClick={() => setSelectedId(memory.id)}
              >
                <strong>{memory.title}</strong>
                <span>{memory.type} · {memory.tags.join(", ") || "untagged"}</span>
              </button>
            ))}
          </div>
        )}
        {status ? <div className="banner success">{status}</div> : null}
        {error ? <div className="banner error">{error}</div> : null}
      </aside>

      <article className="panel markdown-reader">
        {selected ? (
          <>
            <div className="memory-meta">
              <div className="memory-meta-header">
                <h2>{selected.title}</h2>
                <button
                  type="button"
                  className="icon-text-button danger-button"
                  aria-label={`Delete ${selected.title}`}
                  onClick={removeSelectedMemory}
                  disabled={deleting}
                >
                  <Trash2 size={16} aria-hidden />
                  Delete
                </button>
              </div>
              <span>{selected.path}</span>
            </div>
            <div className="tag-row">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <MarkdownContent>{selected.content}</MarkdownContent>
          </>
        ) : (
          <div className="empty-state">Select a memory to inspect its Markdown content.</div>
        )}
      </article>
    </section>
  );
}
