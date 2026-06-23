import { KeyboardEvent, PointerEvent, useRef } from "react";

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
  step?: number;
  invertDrag?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function ResizableSplitter({
  label,
  value,
  min,
  max,
  defaultValue,
  onChange,
  className,
  disabled = false,
  step = 16,
  invertDrag = false,
}: Props) {
  const dragStartRef = useRef<{ x: number; value: number } | null>(null);

  function commit(nextValue: number) {
    onChange(clamp(nextValue, min, max));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    dragStartRef.current = { x: event.clientX, value };

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      if (!dragStartRef.current) return;
      const delta = moveEvent.clientX - dragStartRef.current.x;
      commit(dragStartRef.current.value + (invertDrag ? -delta : delta));
    }

    function handlePointerUp() {
      dragStartRef.current = null;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commit(value - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commit(value + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commit(min);
    } else if (event.key === "End") {
      event.preventDefault();
      commit(max);
    }
  }

  const classes = ["resizable-splitter", className, disabled ? "disabled" : ""].filter(Boolean).join(" ");

  return (
    <div
      role={disabled ? undefined : "separator"}
      aria-hidden={disabled ? "true" : undefined}
      aria-label={disabled ? undefined : label}
      aria-orientation={disabled ? undefined : "vertical"}
      aria-valuemin={disabled ? undefined : min}
      aria-valuemax={disabled ? undefined : max}
      aria-valuenow={disabled ? undefined : value}
      tabIndex={disabled ? -1 : 0}
      className={classes}
      onDoubleClick={() => commit(defaultValue)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}
