export type IndexActivityState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; indexedChunks: number }
  | { status: "error"; message: string };

type IndexResult = {
  indexed_chunks: number;
};

const SUCCESS_DISMISS_DELAY_MS = 4_000;

let state: IndexActivityState = { status: "idle" };
let activeOperations = 0;
let latestResult: IndexResult | null = null;
let pendingError = "";
let dismissTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function clearDismissTimer() {
  if (dismissTimer === null) return;
  clearTimeout(dismissTimer);
  dismissTimer = null;
}

function setState(nextState: IndexActivityState) {
  state = nextState;
  emit();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown index build error.";
}

function finishOperation() {
  activeOperations -= 1;
  if (activeOperations > 0) return;

  if (pendingError) {
    setState({ status: "error", message: pendingError });
    return;
  }

  const indexedChunks = latestResult?.indexed_chunks ?? 0;
  setState({ status: "success", indexedChunks });
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    setState({ status: "idle" });
  }, SUCCESS_DISMISS_DELAY_MS);
}

export function subscribeIndexActivity(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getIndexActivityState(): IndexActivityState {
  return state;
}

export function trackIndexActivity<T extends IndexResult>(operation: Promise<T>): Promise<T> {
  if (activeOperations === 0) {
    clearDismissTimer();
    latestResult = null;
    pendingError = "";
    setState({ status: "running" });
  }
  activeOperations += 1;

  return operation.then(
    (result) => {
      latestResult = result;
      finishOperation();
      return result;
    },
    (error: unknown) => {
      pendingError ||= errorMessage(error);
      finishOperation();
      throw error;
    },
  );
}

export function dismissIndexActivity() {
  if (state.status === "running") return;
  clearDismissTimer();
  latestResult = null;
  pendingError = "";
  setState({ status: "idle" });
}
