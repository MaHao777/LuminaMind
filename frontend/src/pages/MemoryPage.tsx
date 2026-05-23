import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { listMemories, rebuildIndex, scanVault, type MemoryNote } from "../services/api";

export function MemoryPage() {
  const [memories, setMemories] = useState<MemoryNote[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

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

  const selected = memories.find((memory) => memory.id === selectedId) ?? memories[0];

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

        {memories.length === 0 ? (
          <div className="empty-state">No Markdown memories loaded.</div>
        ) : (
          <div className="memory-list">
            {memories.map((memory) => (
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
              <h2>{selected.title}</h2>
              <span>{selected.path}</span>
            </div>
            <div className="tag-row">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <pre>{selected.content}</pre>
          </>
        ) : (
          <div className="empty-state">Select a memory to inspect its Markdown content.</div>
        )}
      </article>
    </section>
  );
}
