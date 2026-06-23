import { Check, X } from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownContent } from "../components/MarkdownContent";
import { ResizableSplitter } from "../components/ResizableSplitter";
import { useI18n } from "../i18n";
import { acceptSuggestion, rejectSuggestion, type MemorySuggestion } from "../services/api";
import { loadLayoutNumber, saveLayoutNumber } from "../services/uiPreferences";

type Props = {
  suggestions: MemorySuggestion[];
  onSuggestionsChanged?: () => void | Promise<void>;
};

type ReviewFilter = "all" | "pending" | "accepted" | "rejected";

const REVIEW_LEFT_WIDTH = {
  default: 320,
  min: 240,
  max: 520,
};

export function ReviewPage({ suggestions, onSuggestionsChanged }: Props) {
  const { t } = useI18n();
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState("");
  const [reviewLeftWidth, setReviewLeftWidth] = useState(() =>
    loadLayoutNumber("reviewLeftWidth", REVIEW_LEFT_WIDTH.default, REVIEW_LEFT_WIDTH.min, REVIEW_LEFT_WIDTH.max),
  );
  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => filter === "all" || suggestion.status === filter),
    [filter, suggestions],
  );
  const selected = visibleSuggestions.find((suggestion) => suggestion.id === selectedId) ?? visibleSuggestions[0];
  const reviewFilters: Array<{ id: ReviewFilter; label: string }> = [
    { id: "all", label: t("common.all") },
    { id: "pending", label: t("common.pending") },
    { id: "accepted", label: t("common.accepted") },
    { id: "rejected", label: t("common.rejected") },
  ];

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
      setError(err instanceof Error ? err.message : t("review.failedProcess"));
    } finally {
      inFlight.current.delete(id);
      setProcessingIds(new Set(inFlight.current));
    }
  }

  function resizeReviewLeft(width: number) {
    setReviewLeftWidth(width);
    saveLayoutNumber("reviewLeftWidth", width, REVIEW_LEFT_WIDTH.min, REVIEW_LEFT_WIDTH.max);
  }

  const gridStyle = {
    "--split-left-width": `${reviewLeftWidth}px`,
  } as CSSProperties;

  return (
    <section className="page-grid review-grid split-grid" style={gridStyle}>
      <aside className="panel suggestion-browser">
        <div className="panel-header">
          <h1>{t("nav.review")}</h1>
        </div>
        <div className="review-filters" aria-label={t("review.filters")}>
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
            {suggestions.length === 0 ? t("review.emptySuggestions") : t("review.emptyCategory")}
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

      <ResizableSplitter
        label={t("app.resizeListDetail")}
        value={reviewLeftWidth}
        min={REVIEW_LEFT_WIDTH.min}
        max={REVIEW_LEFT_WIDTH.max}
        defaultValue={REVIEW_LEFT_WIDTH.default}
        onChange={resizeReviewLeft}
      />

      <article className="panel suggestion-detail">
        {selected ? (
          <>
            <div className="suggestion-detail-header">
              <div className="suggestion-detail-heading">
                <span className={`status-pill ${processingIds.has(selected.id) ? "processing" : selected.status}`}>
                  {processingIds.has(selected.id) || selected.status === "processing"
                    ? t("common.processing")
                    : selected.status}
                </span>
                <h2>{selected.title}</h2>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  aria-label={t("review.acceptLabel", { title: selected.title })}
                  onClick={() => processSuggestion(selected.id, acceptSuggestion)}
                  disabled={processingIds.has(selected.id) || selected.status !== "pending"}
                >
                  <Check size={16} aria-hidden />
                  {t("common.accept")}
                </button>
                <button
                  type="button"
                  aria-label={t("review.rejectLabel", { title: selected.title })}
                  className="secondary"
                  onClick={() => processSuggestion(selected.id, rejectSuggestion)}
                  disabled={processingIds.has(selected.id) || selected.status !== "pending"}
                >
                  <X size={16} aria-hidden />
                  {t("common.reject")}
                </button>
              </div>
            </div>
            {error ? <div className="banner error">{error}</div> : null}
            <div className="suggestion-meta">
              <span>{selected.type}</span>
              <span>{t("review.importance", { value: selected.importance })}</span>
              <span>{t("review.confidence", { value: selected.confidence.toFixed(2) })}</span>
            </div>
            <div className="tag-row">
              {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
            </div>
            <MarkdownContent className="suggestion-content">{selected.content}</MarkdownContent>
            <MarkdownContent className="suggestion-reason">{selected.reason}</MarkdownContent>
          </>
        ) : (
          <>
            {error ? <div className="banner error">{error}</div> : null}
            <div className="empty-state">{t("review.selectPrompt")}</div>
          </>
        )}
      </article>
    </section>
  );
}
