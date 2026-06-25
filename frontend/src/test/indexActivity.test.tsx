import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndexActivityToast } from "../components/IndexActivityToast";
import { I18nProvider } from "../i18n";
import {
  dismissIndexActivity,
  getIndexActivityState,
  trackIndexActivity,
} from "../services/indexActivity";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (error: Error) => void;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderToast(language: "en" | "zh" = "en") {
  return render(
    <I18nProvider language={language}>
      <IndexActivityToast />
    </I18nProvider>,
  );
}

afterEach(() => {
  dismissIndexActivity();
  vi.useRealTimers();
});

describe("global index activity", () => {
  it("shows one running toast until all concurrent index operations finish", async () => {
    const first = deferred<{ indexed_chunks: number }>();
    const second = deferred<{ indexed_chunks: number }>();
    renderToast();

    let firstTracked!: Promise<{ indexed_chunks: number }>;
    let secondTracked!: Promise<{ indexed_chunks: number }>;
    act(() => {
      firstTracked = trackIndexActivity(first.promise);
      secondTracked = trackIndexActivity(second.promise);
    });

    expect(screen.getAllByRole("status", { name: "Building memory index" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Dismiss index notification" })).not.toBeInTheDocument();

    await act(async () => {
      first.resolve({ indexed_chunks: 3 });
      await firstTracked;
    });
    expect(getIndexActivityState().status).toBe("running");

    await act(async () => {
      second.resolve({ indexed_chunks: 7 });
      await secondTracked;
    });
    expect(screen.getByText("Index ready: 7 chunks")).toBeInTheDocument();
  });

  it("auto-dismisses a successful build after four seconds and allows manual dismissal", async () => {
    vi.useFakeTimers();
    renderToast();

    await act(async () => {
      await trackIndexActivity(Promise.resolve({ indexed_chunks: 12 }));
    });

    expect(screen.getByText("Index ready: 12 chunks")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss index notification" }));
    expect(screen.queryByText("Index ready: 12 chunks")).not.toBeInTheDocument();

    await act(async () => {
      await trackIndexActivity(Promise.resolve({ indexed_chunks: 15 }));
    });
    await act(async () => {
      vi.advanceTimersByTime(3_999);
    });
    expect(screen.getByText("Index ready: 15 chunks")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Index ready: 15 chunks")).not.toBeInTheDocument();
  });

  it("keeps provider errors visible and replaces them when a new build starts", async () => {
    vi.useFakeTimers();
    renderToast();

    await act(async () => {
      await expect(
        trackIndexActivity(Promise.reject(new Error("OpenRouter HTTP 429: Rate limit exceeded"))),
      ).rejects.toThrow("Rate limit exceeded");
    });

    expect(screen.getByRole("alert", { name: "Index build failed" })).toHaveTextContent(
      "OpenRouter HTTP 429: Rate limit exceeded",
    );
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.getByRole("alert", { name: "Index build failed" })).toBeInTheDocument();

    const retry = deferred<{ indexed_chunks: number }>();
    let retryTracked!: Promise<{ indexed_chunks: number }>;
    act(() => {
      retryTracked = trackIndexActivity(retry.promise);
    });
    expect(screen.queryByRole("alert", { name: "Index build failed" })).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Building memory index" })).toBeInTheDocument();

    await act(async () => {
      retry.resolve({ indexed_chunks: 4 });
      await retryTracked;
    });
  });
});
