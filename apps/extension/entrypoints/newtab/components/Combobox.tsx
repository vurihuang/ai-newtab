import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboOption {
  value: string;
  label?: string;
  /** Short right-aligned note, e.g. a model family. */
  hint?: string;
}

/**
 * A styled dropdown that still accepts free text.
 *
 * The input is the source of truth — typing raises `onChange` on every
 * keystroke, so a value the list does not offer (a custom model ID, a cron
 * expression) is saved as typed. Picking a row only writes that value back.
 */
export function Combobox({
  value,
  onChange,
  options,
  id,
  placeholder,
  ariaLabel,
  disabled = false,
  invalid = false,
  emptyText = "No matches — your text is used as typed",
}: {
  value: string;
  onChange: (next: string) => void;
  options: ComboOption[];
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  emptyText?: string;
}) {
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const query = value.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return options;
    const matches = options.filter(
      (option) => option.value.toLowerCase().includes(query) || (option.label ?? "").toLowerCase().includes(query),
    );
    return matches.length ? matches : [];
  }, [options, query]);

  // Keep the list anchored on the selected row whenever it opens.
  useEffect(() => {
    if (!open) return;
    const index = visible.findIndex((option) => option.value === value);
    setActive(index === -1 ? 0 : index);
  }, [open, value, visible]);

  useEffect(() => {
    if (!open) return;
    list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!visible.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + visible.length) % visible.length);
      return;
    }
    if (event.key === "Enter") {
      if (open && visible[active]) {
        event.preventDefault();
        pick(visible[active].value);
      } else {
        setOpen(false);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") setOpen(false);
  };

  return (
    <div className={`combo${invalid ? " is-invalid" : ""}${disabled ? " is-disabled" : ""}`} ref={root}>
      <div className="combo-control">
        <input
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-label={ariaLabel}
          aria-invalid={invalid}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          disabled={disabled}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          aria-label={open ? "Hide options" : "Show options"}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16">
            <path d="M5.5 8l4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <ul className="combo-list" id={listId} role="listbox" ref={list}>
          {visible.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              data-value={option.value}
              aria-selected={option.value === value}
              className={`combo-option${index === active ? " is-active" : ""}${option.value === value ? " is-selected" : ""}`}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(option.value);
              }}
            >
              <span className="combo-check" aria-hidden="true">
                {option.value === value ? (
                  <svg viewBox="0 0 20 20" width="14" height="14">
                    <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </span>
              <span className="combo-label">{option.label ?? option.value}</span>
              {option.hint && <span className="combo-hint">{option.hint}</span>}
            </li>
          ))}
          {!visible.length && <li className="combo-empty">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}
