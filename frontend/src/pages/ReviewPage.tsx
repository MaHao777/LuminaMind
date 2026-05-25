import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { acceptSuggestion, listSuggestions, rejectSuggestion, type MemorySuggestion } from "../services/api";

export function ReviewPage() {
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [processingIds, setProcessingIds] = useState<Set<string>>(() => new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const [error, setError] = useState("");

  async function load() {
    try {
      const response = await listSuggestions();
      setSuggestions(response.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load suggestions");
    }
  }

  useEffect(() => {
    void load();
  }, []);

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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process suggestion");
    } finally {
      inFlight.current.delete(id);
      setProcessingIds(new Set(inFlight.current));
    }
  }

  return (
    <section className="review-page">
      <div className="page-title">
        <h1>Review</h1>
      </div>
      {error ? <div className="banner error">{error}</div> : null}
      {suggestions.length === 0 ? (
        <div className="panel empty-state">No pending memory suggestions.</div>
      ) : (
        <div className="suggestion-list">
          {suggestions.map((suggestion) => (
            <article className="panel suggestion-card" key={suggestion.id}>
              <div>
                <span className={`status-pill ${processingIds.has(suggestion.id) ? "processing" : suggestion.status}`}>
                  {processingIds.has(suggestion.id) || suggestion.status === "processing"
                    ? "Processing..."
                    : suggestion.action}
                </span>
                <h2>{suggestion.title}</h2>
                <p>{suggestion.content}</p>
                <small>{suggestion.reason}</small>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  aria-label={`Accept ${suggestion.title}`}
                  onClick={() => processSuggestion(suggestion.id, acceptSuggestion)}
                  disabled={processingIds.has(suggestion.id) || suggestion.status !== "pending"}
                >
                  <Check size={16} aria-hidden />
                  Accept
                </button>
                <button
                  type="button"
                  aria-label={`Reject ${suggestion.title}`}
                  className="secondary"
                  onClick={() => processSuggestion(suggestion.id, rejectSuggestion)}
                  disabled={processingIds.has(suggestion.id) || suggestion.status !== "pending"}
                >
                  <X size={16} aria-hidden />
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
