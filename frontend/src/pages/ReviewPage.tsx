import { Check, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MarkdownContent } from "../components/MarkdownContent";
import { acceptSuggestion, rejectSuggestion, type MemorySuggestion } from "../services/api";

type Props = {
  suggestions: MemorySuggestion[];
  onSuggestionsChanged?: () => void | Promise<void>;
};

type ReviewFilter = "all" | "pending" | "accepted" | "rejected";

const reviewFilters: Array<{ id: ReviewFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "accepted", label: "Accepted" },
  { id: "rejected", label: "Rejected" },
];

export function ReviewPage({ suggestions, onSuggestionsChanged }: Props) {
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => filter === "all" || suggestion.status === filter),
    [filter, suggestions],
  );
  const selected = visibleSuggestions.find((suggestion) => suggestion.id === selectedId) ?? visibleSuggestions[0];

  useEffect(() => {
    setSelectedId((current) =>
      visibleSuggestions.some((suggestion) => suggestion.id === current)
        ? current
        : visibleSuggestions[0]?.id ?? "",
    );
  }, [visibleSuggestions]);

  async function processSuggestion(
    id: string,
    request: (suggestionId: string) => Promise<MemorySuggestion>,
  ) {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setProcessingIds(new Set(inFlight.current));
    setError("");
    try {
      await request(id);
      await onSuggestionsChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process suggestion");
    } finally {
      inFlight.current.delete(id);
      setProcessingIds(new Set(inFlight.current));
    }
  }

  return (
    <section className="page-grid review-grid">
      <aside className="panel suggestion-browser">
        <div className="panel-header">
          <h1>Review</h1>
        </div>
        <div className="review-filters" aria-label="Suggestion status filters">
          {reviewFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? "filter-button active" : "filter-button"}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {visibleSuggestions.length === 0 ? (
          <div className="empty-state">
            {suggestions.length === 0 ? "No memory suggestions." : "No suggestions in this category."}
          </div>
        ) : (
          <div className="suggestion-list">
            {visibleSuggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion.id}
                className={selected?.id === suggestion.id ? "suggestion-row active" : "suggestion-row"}
                onClick={() => setSelectedId(suggestion.id)}
              >
                <strong>{suggestion.title}</strong>
                <span>{suggestion.type} / {suggestion.status}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <article className="panel suggestion-detail">
        {error ? <div className="banner error">{error}</div> : null}
        {selected ? (
          <>
            <span className={`status-pill ${processingIds.has(selected.id) ? "processing" : selected.status}`}>
              {processingIds.has(selected.id) || selected.status === "processing"
                ? "Processing..."
                : selected.status}
            </span>
            <h2>{selected.title}</h2>
            <div className="suggestion-meta">
              <span>{selected.type}</span>
              <span>Importance {selected.importance}</span>
              <span>Confidence {selected.confidence.toFixed(2)}</span>
            </div>
            <div className="tag-row">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <MarkdownContent className="suggestion-content">{selected.content}</MarkdownContent>
            <MarkdownContent className="suggestion-reason">{selected.reason}</MarkdownContent>
            <div className="card-actions">
              <button
                type="button"
                aria-label={`Accept ${selected.title}`}
                onClick={() => processSuggestion(selected.id, acceptSuggestion)}
                disabled={processingIds.has(selected.id) || selected.status !== "pending"}
              >
                <Check size={16} aria-hidden />
                Accept
              </button>
              <button
                type="button"
                aria-label={`Reject ${selected.title}`}
                className="secondary"
                onClick={() => processSuggestion(selected.id, rejectSuggestion)}
                disabled={processingIds.has(selected.id) || selected.status !== "pending"}
              >
                <X size={16} aria-hidden />
                Reject
              </button>
            </div>
          </>
        ) : (
          <div className="empty-state">Select a suggestion to inspect its details.</div>
        )}
      </article>
    </section>
  );
}
