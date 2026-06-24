import { Pencil, Pin, Plus, RefreshCw, Save, Search, Trash2, X } from "lucide-react";
import {
  CSSProperties,
  FormEvent,
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
import {
  createMemory,
  deleteMemory,
  listMemories,
  rebuildIndex,
  scanVault,
  updateIndexDeduped,
  updateMemory,
  updateMemoryPin,
  type MemoryNote,
  type MemoryType,
  type MemoryWritePayload,
} from "../services/api";
import { loadLayoutNumber, saveLayoutNumber } from "../services/uiPreferences";

type MemoryTypeFilter = "all" | MemoryType;
type EditorMode = "create" | "edit" | null;
type MemoryDraft = {
  title: string;
  type: MemoryType;
  tags: string;
  content: string;
};
type MemoryMenu = {
  memory: MemoryNote;
  left: number;
  top: number;
};
type Props = {
  onDirtyChange?: (dirty: boolean) => void;
};

const MEMORY_LEFT_WIDTH = {
  default: 320,
  min: 240,
  max: 520,
};

const MEMORY_TYPES: MemoryType[] = ["profile", "project", "concept", "task", "log"];

function emptyDraft(): MemoryDraft {
  return {
    title: "",
    type: "concept",
    tags: "",
    content: "",
  };
}

function memoryDraft(memory: MemoryNote): MemoryDraft {
  return {
    title: memory.title,
    type: memory.type,
    tags: memory.tags.join(", "),
    content: memory.content,
  };
}

function draftsMatch(left: MemoryDraft, right: MemoryDraft) {
  return (
    left.title === right.title
    && left.type === right.type
    && left.tags === right.tags
    && left.content === right.content
  );
}

function normalizeTags(value: string) {
  return Array.from(new Set(
    value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  ));
}

function sortMemories(memories: MemoryNote[]) {
  return [...memories].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned)
      || right.updated.localeCompare(left.updated)
      || left.title.localeCompare(right.title),
  );
}

export function MemoryPage({ onDirtyChange }: Props) {
  const { t } = useI18n();
  const [memories, setMemories] = useState<MemoryNote[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<MemoryTypeFilter>("all");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [retryIndexRefresh, setRetryIndexRefresh] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(null);
  const [editorSource, setEditorSource] = useState<MemoryNote | null>(null);
  const [draft, setDraft] = useState<MemoryDraft>(() => emptyDraft());
  const [initialDraft, setInitialDraft] = useState<MemoryDraft>(() => emptyDraft());
  const [memoryMenu, setMemoryMenu] = useState<MemoryMenu | null>(null);
  const [memoryLeftWidth, setMemoryLeftWidth] = useState(() =>
    loadLayoutNumber("memoryLeftWidth", MEMORY_LEFT_WIDTH.default, MEMORY_LEFT_WIDTH.min, MEMORY_LEFT_WIDTH.max),
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const saveInFlight = useRef(false);
  const memoryMenuPresence = useRetainedPresence(memoryMenu);
  const editorDirty = editorMode !== null && !draftsMatch(draft, initialDraft);

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
    onDirtyChange?.(editorDirty);
  }, [editorDirty, onDirtyChange]);

  useEffect(() => {
    if (!editorDirty) return undefined;
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [editorDirty]);

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
    if (editorMode) return;
    setSelectedId((current) =>
      filteredMemories.some((memory) => memory.id === current)
        ? current
        : filteredMemories[0]?.id || "",
    );
  }, [editorMode, filteredMemories]);

  const selected = filteredMemories.find((memory) => memory.id === selectedId) ?? filteredMemories[0];

  function confirmDiscardChanges() {
    return !editorDirty || window.confirm(t("memory.unsavedConfirm"));
  }

  function stopEditing() {
    setEditorMode(null);
    setEditorSource(null);
    const reset = emptyDraft();
    setDraft(reset);
    setInitialDraft(reset);
  }

  function beginCreate() {
    if (!confirmDiscardChanges()) return;
    const nextDraft = emptyDraft();
    setEditorMode("create");
    setEditorSource(null);
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setStatus("");
    setError("");
    setRetryIndexRefresh(false);
  }

  function beginEdit(memory: MemoryNote) {
    if (!confirmDiscardChanges()) return;
    const nextDraft = memoryDraft(memory);
    setSelectedId(memory.id);
    setEditorMode("edit");
    setEditorSource(memory);
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setStatus("");
    setError("");
    setRetryIndexRefresh(false);
  }

  function chooseMemory(memory: MemoryNote) {
    if (editorMode === "edit" && editorSource?.id === memory.id) return;
    if (!confirmDiscardChanges()) return;
    stopEditing();
    setSelectedId(memory.id);
  }

  async function refreshSavedIndex() {
    setRetryIndexRefresh(false);
    setError("");
    setStatus(t("memory.savedReindexing"));
    try {
      await updateIndexDeduped();
      setStatus(t("memory.savedIndexed"));
    } catch (err) {
      setRetryIndexRefresh(true);
      setError(t("memory.savedIndexFailed", {
        message: err instanceof Error ? err.message : t("memory.failedUpdateIndex"),
      }));
    }
  }

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInFlight.current) return;

    const title = draft.title.trim();
    if (!title) {
      setError(t("memory.titleRequired"));
      return;
    }

    const payload: MemoryWritePayload = {
      title,
      type: draft.type,
      content: draft.content,
      tags: normalizeTags(draft.tags),
      importance: editorSource?.importance ?? 3,
      confidence: editorSource?.confidence ?? 0.9,
      source: editorSource?.source ?? "manual",
      status: editorSource?.status ?? "active",
      links: editorSource?.links ?? [],
    };

    saveInFlight.current = true;
    setSaving(true);
    setError("");
    setStatus("");
    try {
      const saved = editorMode === "edit" && editorSource
        ? await updateMemory(editorSource.id, payload)
        : await createMemory(payload);
      setMemories((current) => sortMemories(
        current.some((memory) => memory.id === saved.id)
          ? current.map((memory) => (memory.id === saved.id ? saved : memory))
          : [...current, saved],
      ));
      setSelectedId(saved.id);
      if (editorMode === "create") {
        setQuery("");
        setTypeFilter("all");
      }
      stopEditing();
      await refreshSavedIndex();
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : editorMode === "create"
          ? t("memory.failedCreate")
          : t("memory.failedUpdate"));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

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
      if (editorSource?.id === memory.id) stopEditing();
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
      if (editorSource?.id === updated.id) setEditorSource(updated);
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
    if (!confirmDiscardChanges()) return;
    stopEditing();
    setError("");
    try {
      const scan = await scanVault();
      const index = await rebuildIndex();
      setStatus(t("memory.scanStatus", { notes: scan.indexed_notes, chunks: index.indexed_chunks }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("memory.failedUpdateIndex"));
    }
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
          <div className="panel-actions">
            <button type="button" className="icon-text-button" onClick={beginCreate}>
              <Plus size={16} aria-hidden />
              {t("memory.new")}
            </button>
            <button type="button" className="icon-text-button" onClick={() => void refreshVault()}>
              <RefreshCw size={16} aria-hidden />
              {t("memory.reindex")}
            </button>
          </div>
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
              ...MEMORY_TYPES.map((type) => ({ value: type, label: t(`memory.${type}`) })),
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
                onClick={() => chooseMemory(memory)}
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
        {retryIndexRefresh ? (
          <button type="button" className="icon-text-button" onClick={() => void refreshSavedIndex()}>
            <RefreshCw size={16} aria-hidden />
            {t("memory.retryIndexUpdate")}
          </button>
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

      <article className="panel markdown-reader memory-detail">
        {editorMode ? (
          <form className="memory-editor" onSubmit={saveMemory}>
            <div className="memory-editor-header">
              <h2>{editorMode === "create" ? t("memory.new") : t("memory.edit")}</h2>
              <div className="card-actions">
                <button
                  type="button"
                  className="secondary"
                  aria-label={t("memory.cancelEditing")}
                  onClick={stopEditing}
                  disabled={saving}
                >
                  <X size={16} aria-hidden />
                  {t("memory.cancel")}
                </button>
                <button type="submit" aria-label={t("memory.save")} disabled={saving}>
                  <Save size={16} aria-hidden />
                  {saving ? t("memory.saving") : t("memory.save")}
                </button>
              </div>
            </div>
            <div className="memory-editor-fields">
              <label>
                <span>{t("memory.title")}</span>
                <input
                  aria-label={t("memory.title")}
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  autoFocus
                />
              </label>
              <AnimatedSelect
                label={t("memory.type")}
                value={draft.type}
                onChange={(value) => setDraft((current) => ({ ...current, type: value as MemoryType }))}
                options={MEMORY_TYPES.map((type) => ({ value: type, label: t(`memory.${type}`) }))}
              />
              <label>
                <span>{t("memory.tags")}</span>
                <input
                  aria-label={t("memory.tags")}
                  value={draft.tags}
                  placeholder={t("memory.tagsPlaceholder")}
                  onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
                />
              </label>
              <label className="memory-content-field">
                <span>{t("memory.content")}</span>
                <textarea
                  aria-label={t("memory.content")}
                  value={draft.content}
                  onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))}
                />
              </label>
            </div>
          </form>
        ) : selected ? (
          <>
            <div className="memory-meta">
              <div className="memory-meta-header">
                <h2>{selected.title}</h2>
                <button type="button" className="icon-text-button" onClick={() => beginEdit(selected)}>
                  <Pencil size={16} aria-hidden />
                  {t("memory.edit")}
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
          <div className="empty-state">{t("memory.selectPrompt")}</div>
        )}
      </article>
    </section>
  );
}
