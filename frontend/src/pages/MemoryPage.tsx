import { Pin, RefreshCw, Search, Trash2 } from "lucide-react";
import {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AnimatedSelect } from "../components/AnimatedSelect";
import { MarkdownContent } from "../components/MarkdownContent";
import { ResizableSplitter } from "../components/ResizableSplitter";
import { useRetainedPresence } from "../components/useAnimatedPresence";
import { useI18n } from "../i18n";
import { deleteMemory, listMemories, rebuildIndex, scanVault, updateMemoryPin, type MemoryNote } from "../services/api";
import { loadLayoutNumber, saveLayoutNumber } from "../services/uiPreferences";

type MemoryTypeFilter = "all" | "profile" | "project" | "concept" | "task" | "log";
type MemoryMenu = {
  memory: MemoryNote;
  left: number;
  top: number;
};

const MEMORY_LEFT_WIDTH = {
  default: 320,
  min: 240,
  max: 520,
};

function sortMemories(memories: MemoryNote[]) {
  return [...memories].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned)
      || right.updated.localeCompare(left.updated)
      || left.title.localeCompare(right.title),
  );
}

export function MemoryPage() {
  const { t } = useI18n();
  const [memories, setMemories] = useState<MemoryNote[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<MemoryTypeFilter>("all");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [memoryMenu, setMemoryMenu] = useState<MemoryMenu | null>(null);
  const [memoryLeftWidth, setMemoryLeftWidth] = useState(() =>
    loadLayoutNumber("memoryLeftWidth", MEMORY_LEFT_WIDTH.default, MEMORY_LEFT_WIDTH.min, MEMORY_LEFT_WIDTH.max),
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const memoryMenuPresence = useRetainedPresence(memoryMenu);

  async function load() {
    try {
      const response = await listMemories();
      setMemories(sortMemories(response.memories));
      setSelectedId((current) => current || response.memories[0]?.id || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.failedLoad"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!memoryMenu) return undefined;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();

    function closeOnOutsideClick(event: globalThis.MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMemoryMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setMemoryMenu(null);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [memoryMenu]);

  const filteredMemories = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      if (typeFilter !== "all" && memory.type !== typeFilter) return false;
      if (!normalizedQuery) return true;
      return [
        memory.title,
        memory.type,
        memory.path,
        memory.content,
        memory.tags.join(" "),
      ].join("\n").toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [memories, query, typeFilter]);

  useEffect(() => {
    setSelectedId((current) =>
      filteredMemories.some((memory) => memory.id === current)
        ? current
        : filteredMemories[0]?.id || "",
    );
  }, [filteredMemories]);

  const selected = filteredMemories.find((memory) => memory.id === selectedId) ?? filteredMemories[0];

  async function removeMemory(memory: MemoryNote) {
    if (deleting) return;
    setMemoryMenu(null);
    if (!window.confirm(t("memory.deleteConfirm", { title: memory.title }))) return;
    setDeleting(true);
    setError("");
    try {
      await deleteMemory(memory.id);
      const response = await listMemories();
      const remaining = sortMemories(response.memories);
      setMemories(remaining);
      if (selectedId === memory.id) setSelectedId(remaining[0]?.id || "");
      setStatus(t("memory.deleted"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.failedDelete"));
    } finally {
      setDeleting(false);
    }
  }

  async function togglePinned(memory: MemoryNote) {
    setMemoryMenu(null);
    setError("");
    try {
      const updated = await updateMemoryPin(memory.id, !memory.pinned);
      setMemories((current) =>
        sortMemories(current.map((item) => (item.id === updated.id ? updated : item))),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.failedUpdate"));
    }
  }

  function openMemoryMenu(memory: MemoryNote, clientX: number, clientY: number) {
    const menuWidth = 180;
    const menuHeight = 92;
    const viewportPadding = 8;
    const left = Math.max(viewportPadding, Math.min(clientX, window.innerWidth - menuWidth - viewportPadding));
    const top = Math.max(viewportPadding, Math.min(clientY, window.innerHeight - menuHeight - viewportPadding));
    setMemoryMenu({ memory, left, top });
  }

  function handleMemoryContextMenu(event: ReactMouseEvent, memory: MemoryNote) {
    event.preventDefault();
    openMemoryMenu(memory, event.clientX, event.clientY);
  }

  function handleMemoryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, memory: MemoryNote) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    openMemoryMenu(memory, bounds.left + 12, bounds.bottom);
  }

  async function refreshVault() {
    setError("");
    const scan = await scanVault();
    const index = await rebuildIndex();
    setStatus(t("memory.scanStatus", { notes: scan.indexed_notes, chunks: index.indexed_chunks }));
    await load();
  }

  function resizeMemoryLeft(width: number) {
    setMemoryLeftWidth(width);
    saveLayoutNumber("memoryLeftWidth", width, MEMORY_LEFT_WIDTH.min, MEMORY_LEFT_WIDTH.max);
  }

  const gridStyle = {
    "--split-left-width": `${memoryLeftWidth}px`,
  } as CSSProperties;

  return (
    <section className="page-grid memory-grid split-grid" style={gridStyle}>
      <aside className="panel file-tree">
        <div className="panel-header">
          <h1>{t("nav.memory")}</h1>
          <button type="button" className="icon-text-button" onClick={refreshVault}>
            <RefreshCw size={16} aria-hidden />
            {t("memory.reindex")}
          </button>
        </div>
        <div className="memory-toolbar">
          <label className="search-field">
            <Search size={15} aria-hidden />
            <input
              aria-label={t("memory.search")}
              placeholder={t("memory.search")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <AnimatedSelect
            label={t("memory.filterByType")}
            value={typeFilter}
            onChange={(nextValue) => setTypeFilter(nextValue as MemoryTypeFilter)}
            hideLabel
            options={[
              { value: "all", label: t("memory.allTypes") },
              { value: "profile", label: t("memory.profile") },
              { value: "project", label: t("memory.project") },
              { value: "concept", label: t("memory.concept") },
              { value: "task", label: t("memory.task") },
              { value: "log", label: t("memory.log") },
            ]}
          />
        </div>

        {filteredMemories.length === 0 ? (
          <div className="empty-state">
            {typeFilter !== "all" && memories.length > 0
              ? t("memory.noMatchFilters")
              : query.trim() && memories.length > 0
                ? t("memory.noMatchSearch")
                : t("memory.noMarkdownLoaded")}
          </div>
        ) : (
          <div className="memory-list">
            {filteredMemories.map((memory) => (
              <button
                key={memory.id}
                aria-label={memory.title}
                className={selected?.id === memory.id ? "memory-row active" : "memory-row"}
                type="button"
                onClick={() => setSelectedId(memory.id)}
                onContextMenu={(event) => handleMemoryContextMenu(event, memory)}
                onKeyDown={(event) => handleMemoryKeyDown(event, memory)}
              >
                <strong>{memory.title}</strong>
                {memory.pinned ? (
                  <Pin className="memory-pin" size={14} aria-label={t("memory.pinnedLabel", { title: memory.title })} />
                ) : null}
                <span>{t("memory.pathTags", { type: memory.type, tags: memory.tags.join(", ") || t("common.untagged") })}</span>
              </button>
            ))}
          </div>
        )}
        {memoryMenuPresence.rendered && memoryMenuPresence.value ? (
          <div
            ref={menuRef}
            role="menu"
            className="conversation-menu"
            aria-label={t("memory.actions")}
            data-state={memoryMenuPresence.state}
            style={{ left: memoryMenuPresence.value.left, top: memoryMenuPresence.value.top }}
          >
            <button
              type="button"
              role="menuitem"
              aria-label={memoryMenuPresence.value.memory.pinned
                ? t("memory.unpinLabel", { title: memoryMenuPresence.value.memory.title })
                : t("memory.pinLabel", { title: memoryMenuPresence.value.memory.title })}
              onClick={() => togglePinned(memoryMenuPresence.value!.memory)}
            >
              <Pin size={15} aria-hidden />
              {memoryMenuPresence.value.memory.pinned ? t("common.unpin") : t("common.pin")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="danger-menu-item"
              aria-label={t("memory.deleteLabel", { title: memoryMenuPresence.value.memory.title })}
              onClick={() => removeMemory(memoryMenuPresence.value!.memory)}
              disabled={deleting}
            >
              <Trash2 size={15} aria-hidden />
              {t("common.delete")}
            </button>
          </div>
        ) : null}
        {status ? <div className="banner success">{status}</div> : null}
        {error ? <div className="banner error">{error}</div> : null}
      </aside>

      <ResizableSplitter
        label={t("app.resizeListDetail")}
        value={memoryLeftWidth}
        min={MEMORY_LEFT_WIDTH.min}
        max={MEMORY_LEFT_WIDTH.max}
        defaultValue={MEMORY_LEFT_WIDTH.default}
        onChange={resizeMemoryLeft}
      />

      <article className="panel markdown-reader">
        {selected ? (
          <>
            <div className="memory-meta">
              <div className="memory-meta-header">
                <h2>{selected.title}</h2>
              </div>
              <span>{selected.path}</span>
            </div>
            <div className="tag-row">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <MarkdownContent>{selected.content}</MarkdownContent>
          </>
        ) : (
          <div className="empty-state">{t("memory.selectPrompt")}</div>
        )}
      </article>
    </section>
  );
}
