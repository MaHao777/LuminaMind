import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";

import { acceptSuggestion, listSuggestions, rejectSuggestion, type MemorySuggestion } from "../services/api";

export function ReviewPage() {
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
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

  async function accept(id: string) {
    await acceptSuggestion(id);
    await load();
  }

  async function reject(id: string) {
    await rejectSuggestion(id);
    await load();
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
                <span className={`status-pill ${suggestion.status}`}>{suggestion.action}</span>
                <h2>{suggestion.title}</h2>
                <p>{suggestion.content}</p>
                <small>{suggestion.reason}</small>
              </div>
              <div className="card-actions">
                <button
                  type="button"
                  aria-label={`Accept ${suggestion.title}`}
                  onClick={() => accept(suggestion.id)}
                  disabled={suggestion.status !== "pending"}
                >
                  <Check size={16} aria-hidden />
                  Accept
                </button>
                <button
                  type="button"
                  aria-label={`Reject ${suggestion.title}`}
                  className="secondary"
                  onClick={() => reject(suggestion.id)}
                  disabled={suggestion.status !== "pending"}
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
