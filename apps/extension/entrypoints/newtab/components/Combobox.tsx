import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  onOpen,
  onQuery,
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
  /** Opening the list: a chance to refresh the options first. */
  onOpen?: () => void;
  /** Every keystroke: a chance to refresh the options while searching. */
  onQuery?: () => void;
}) {
  const listId = `${useId()}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Viewport coordinates for the portaled list; null until measured. */
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number; maxHeight: number; above: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  /**
   * The list is portaled to the body, so a scrolling settings form cannot clip it.
   * It follows its input, and flips above when the room below is too small.
   */
  const place = useCallback(() => {
    const input = root.current?.querySelector("input");
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = below < 200 && rect.top > below;
    setAnchor({
      left: rect.left,
      width: rect.width,
      top: above ? rect.top - 6 : rect.bottom + 6,
      maxHeight: Math.max(140, Math.min(236, above ? rect.top - 18 : below)),
      above,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    // Capture phase: any scrolling ancestor moves the anchor, not just the window.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

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
      const target = event.target as Node;
      if (root.current?.contains(target) || list.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const openList = () => {
    setOpen(true);
    onOpen?.();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
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
            onQuery?.();
            onChange(event.target.value);
            setOpen(true);
          }}
          onClick={openList}
          onFocus={openList}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="combo-toggle"
          tabIndex={-1}
          aria-label={open ? "Hide options" : "Show options"}
          disabled={disabled}
          onClick={() => (open ? setOpen(false) : openList())}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16">
            <path d="M5.5 8l4.5 4.5L14.5 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && anchor && createPortal(
        <ul
          className={`combo-list${anchor.above ? " is-above" : ""}`}
          id={listId}
          role="listbox"
          ref={list}
          style={
            {
              left: anchor.left,
              top: anchor.top,
              width: anchor.width,
              maxHeight: anchor.maxHeight,
              // The entrance keyframe adds to this, so the flip and the motion coexist.
              "--combo-shift": anchor.above ? "-100%" : "0px",
            } as React.CSSProperties
          }
        >
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
        </ul>,
        document.body,
      )}
    </div>
  );
}
