import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Emoji flag, or `"kurdish"` for the custom yellow/green/red flag. */
  flag?: string;
}

/** Render an emoji flag or the custom Kurdish tricolor. */
function FlagMark({ flag }: { flag?: string }) {
  if (!flag) return null;
  if (flag === "kurdish") {
    return <span className="flag-kurdish" aria-hidden="true" />;
  }
  return (
    <span className="acorn-select-flag" aria-hidden="true">
      {flag}
    </span>
  );
}

/** Label row with optional leading flag. */
function OptionLabel({ flag, label }: { flag?: string; label: ReactNode }) {
  return (
    <span className="acorn-select-option-main">
      <FlagMark flag={flag} />
      <span>{label}</span>
    </span>
  );
}

/** Custom dropdown with fully styled open menu (no native select). */
export function Select({
  id,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const autoId = useId();
  const selectId = id || autoId;
  const listId = `${selectId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() =>
    Math.max(
      0,
      options.findIndex((opt) => opt.value === value),
    ),
  );

  const selected = options.find((opt) => opt.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;

    /** Close when clicking outside the select. */
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    menuRef.current?.focus();
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  useEffect(() => {
    const index = options.findIndex((opt) => opt.value === value);
    if (index >= 0) setActiveIndex(index);
  }, [value, options]);

  /** Open/close and keyboard navigation for the listbox. */
  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
    }
  }

  /** Move highlight and commit selection while the menu is open. */
  function handleListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const next = options[activeIndex];
      if (next) {
        onChange(next.value);
        setOpen(false);
      }
    }
  }

  /** Choose an option and close the menu. */
  function handleSelect(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div
      className={`acorn-select ${open ? "is-open" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        id={selectId}
        className="acorn-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="acorn-select-value">
          <OptionLabel flag={selected?.flag} label={selected?.label ?? ""} />
        </span>
        <span className="acorn-select-chevron material-symbols-rounded" aria-hidden="true">
          expand_more
        </span>
      </button>

      {open ? (
        <div
          className="acorn-select-menu"
          ref={menuRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-labelledby={selectId}
          onKeyDown={handleListKeyDown}
        >
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === activeIndex;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={`acorn-select-option ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => handleSelect(opt.value)}
              >
                <OptionLabel flag={opt.flag} label={opt.label} />
                {isSelected ? (
                  <span className="material-symbols-rounded filled" aria-hidden="true">
                    check
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
