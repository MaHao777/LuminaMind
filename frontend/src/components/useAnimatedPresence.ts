import { useEffect, useState } from "react";

export type PresenceState = "open" | "closing";

export function useAnimatedPresence(open: boolean, durationMs = 140) {
  const [rendered, setRendered] = useState(open);
  const [state, setState] = useState<PresenceState>("open");

  useEffect(() => {
    if (open) {
      setRendered(true);
      setState("open");
      return undefined;
    }

    if (!rendered) return undefined;

    setState("closing");
    const timeout = window.setTimeout(() => setRendered(false), durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, open, rendered]);

  return { rendered, state };
}

export function useRetainedPresence<T>(value: T | null | undefined, durationMs = 140) {
  const [retainedValue, setRetainedValue] = useState<T | null>(value ?? null);
  const open = value !== null && value !== undefined;
  const presence = useAnimatedPresence(open, durationMs);

  useEffect(() => {
    if (open) setRetainedValue(value);
  }, [open, value]);

  useEffect(() => {
    if (!presence.rendered && !open) setRetainedValue(null);
  }, [open, presence.rendered]);

  return {
    rendered: presence.rendered && retainedValue !== null,
    state: presence.state,
    value: retainedValue,
  };
}
