import { Check, ChevronDown } from "lucide-react";
import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

import { useAnimatedPresence } from "./useAnimatedPresence";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  hideLabel?: boolean;
};

function nextEnabledIndex(options: SelectOption[], startIndex: number, direction: 1 | -1) {
  if (options.length === 0) return -1;
  for (let offset = 0; offset < options.length; offset += 1) {
    const index = (startIndex + offset * direction + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}

export function AnimatedSelect({ label, value, options, onChange, className, hideLabel = false }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const presence = useAnimatedPresence(open);
  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  );

  useEffect(() => {
    if (open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function chooseOption(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((current) => nextEnabledIndex(options, current + direction, direction));
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const option = options[activeIndex];
      if (option) chooseOption(option);
    }
  }

  return (
    <div className={className ? `animated-select-field ${className}` : "animated-select-field"} ref={rootRef}>
      <span id={`${id}-label`} className={hideLabel ? "visually-hidden" : "animated-select-label"}>{label}</span>
      <button
        type="button"
        role="combobox"
        className="animated-select-trigger"
        aria-labelledby={`${id}-label`}
        aria-controls={`${id}-listbox`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span>{selectedOption?.label ?? ""}</span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {presence.rendered ? (
        <div
          id={`${id}-listbox`}
          role="listbox"
          className="animated-select-listbox"
          aria-labelledby={`${id}-label`}
          data-state={presence.state}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseOption(option)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} aria-hidden /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
