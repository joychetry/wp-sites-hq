// Custom form controls, so nothing falls back to the OS look: a listbox select, a combobox with
// suggestions, a multi-select, date, time and month pickers, number, search, tags, colour, files,
// a menu, tabs and a slider. Each follows its WAI-ARIA pattern and works from the keyboard.
// Select, Combobox, DateInput and NumberInput take the same props as the native element they
// replace (value, onChange(e) with e.target.value), so screens swap one tag for another.
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type Change = { target: { value: string } };
const changed = (value: string): Change => ({ target: { value } });
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/** Where a popover goes: under its anchor, or above when there is no room below. */
function usePlace(anchor: RefObject<HTMLElement | null>, open: boolean, width?: number) {
  const [style, setStyle] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const below = innerHeight - r.bottom;
      const up = below < 260 && r.top > below;
      const w = Math.max(r.width, width ?? 0);
      setStyle({
        left: Math.max(8, Math.min(r.left, innerWidth - w - 8)),
        minWidth: r.width,
        width: width,
        maxHeight: Math.max(160, (up ? r.top : below) - 16),
        ...(up ? { bottom: innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [anchor, open, width]);
  return style;
}

type PopoverProps = {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  width?: number;
  className?: string;
  children: ReactNode;
};

/** A floating panel tied to an anchor. It closes on a click outside; Escape is the owner's job. */
export function Popover({ anchor, open, onClose, width, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const style = usePlace(anchor, open, width);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open, onClose, anchor]);
  if (!open) return null;
  return createPortal(
    <div ref={ref} className={cx("pop", className)} style={style}>
      {children}
    </div>,
    document.body,
  );
}

const Chevron = () => (
  <svg className="chev" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 6.5 8 10l3.5-3.5" />
  </svg>
);
const Tick = () => (
  <svg className="tick-ico" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-6.5" />
  </svg>
);

type Opt = { value: string; label: ReactNode; text: string; disabled: boolean };
const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : "";
function optionsOf(children: ReactNode): Opt[] {
  return Children.toArray(children).flatMap((c) => {
    if (!isValidElement(c) || c.type !== "option") return [];
    const p = (c as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>).props;
    const text = textOf(p.children);
    return [{ value: String(p.value ?? text), label: p.children, text, disabled: !!p.disabled }];
  });
}

/** Moves through enabled options; returns the next index or the same one. */
function step(opts: { disabled: boolean }[], from: number, by: number) {
  let i = from;
  for (let n = 0; n < opts.length; n++) {
    i = Math.max(0, Math.min(opts.length - 1, i + by));
    if (!opts[i]?.disabled) return i;
    if (i === 0 || i === opts.length - 1) break;
  }
  return opts[from]?.disabled ? -1 : from;
}

/** Typeahead: the first enabled option after `from` whose text starts with what was typed. */
function useTypeahead(opts: Opt[]) {
  const typed = useRef({ s: "", at: 0 });
  return (key: string, from: number) => {
    const now = Date.now();
    typed.current = { s: (now - typed.current.at < 700 ? typed.current.s : "") + key.toLowerCase(), at: now };
    const s = typed.current.s;
    const order = [...opts.keys()].map((k) => (from + 1 + k) % opts.length);
    return order.find((i) => !opts[i].disabled && opts[i].text.toLowerCase().startsWith(s)) ?? -1;
  };
}

type SelectProps = {
  value: string | number;
  onChange: (e: Change) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

/**
 * A select-only combobox (WAI-ARIA APG) that takes `<option>` children like a native select.
 * Arrows, Home, End, Page keys and typing move; Enter, Space or Tab choose; Escape closes.
 */
export function Select({ value, onChange, children, className, disabled, placeholder, ...aria }: SelectProps) {
  const opts = optionsOf(children);
  const cur = opts.findIndex((o) => o.value === String(value));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(cur);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useId();
  const ahead = useTypeahead(opts);
  const show = (at = cur) => {
    setActive(at < 0 ? step(opts, -1, 1) : at);
    setOpen(true);
  };
  const pick = (i: number) => {
    setOpen(false);
    if (i >= 0 && !opts[i].disabled && opts[i].value !== String(value)) onChange(changed(opts[i].value));
  };
  useEffect(() => {
    if (open) document.getElementById(`${list}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, list]);
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(k)) show();
      else if (k === "Home") show(step(opts, -1, 1));
      else if (k === "End") show(step(opts, opts.length, -1));
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const i = ahead(k, cur);
        if (i >= 0) pick(i);
      } else return;
      e.preventDefault();
      return;
    }
    if (k === "ArrowDown") setActive(step(opts, active, 1));
    else if (k === "ArrowUp" && e.altKey) pick(active);
    else if (k === "ArrowUp") setActive(step(opts, active, -1));
    else if (k === "Home") setActive(step(opts, -1, 1));
    else if (k === "End") setActive(step(opts, opts.length, -1));
    else if (k === "PageDown") setActive(step(opts, Math.min(opts.length - 1, active + 9), 1));
    else if (k === "PageUp") setActive(step(opts, Math.max(0, active - 9), -1));
    else if (k === "Enter" || k === " ") pick(active);
    else if (k === "Escape") {
      e.stopPropagation();
      setOpen(false);
    } else if (k === "Tab") return pick(active);
    else if (k.length === 1) {
      const i = ahead(k, active);
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={list}
        aria-activedescendant={open && active >= 0 ? `${list}-${active}` : undefined}
        className={cx("input select", className)}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        {...aria}
      >
        <span className="select-v">{cur >= 0 ? opts[cur].label : <span className="dim">{placeholder ?? "Choose"}</span>}</span>
        <Chevron />
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)}>
        <ul role="listbox" id={list} aria-label={aria["aria-label"]} aria-labelledby={aria["aria-labelledby"]} className="lb" tabIndex={-1}>
          {opts.map((o, i) => (
            <li
              key={o.value + i}
              id={`${list}-${i}`}
              role="option"
              data-value={o.value}
              aria-selected={i === active}
              aria-disabled={o.disabled || undefined}
              className={cx(i === active && "on", o.value === String(value) && "cur")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => !o.disabled && setActive(i)}
              onClick={() => !o.disabled && pick(i)}
            >
              <span>{o.label}</span>
              {o.value === String(value) && <Tick />}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement>;

/**
 * A text box with a list of suggestions (WAI-ARIA combobox with list autocomplete). It takes the
 * place of `<input list>` + `<datalist>`. Arrows move through the matches, Enter fills the box with
 * the one shown, Escape closes the list. Enter with no match highlighted reaches the caller.
 */
export function Combobox({ suggestions, onPick, onChange, onKeyDown, className, ...rest }: InputProps & { suggestions: string[]; onPick?: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const list = useId();
  const term = String(rest.value ?? "").trim().toLowerCase();
  const hits = suggestions.filter((s) => s.toLowerCase().includes(term) && s.toLowerCase() !== term).slice(0, 50);
  const shown = open && hits.length > 0;
  const fill = (s: string) => {
    if (onPick) onPick(s);
    else onChange?.(changed(s) as never);
    setOpen(false);
    setActive(-1);
  };
  return (
    <>
      <input
        ref={input}
        {...rest}
        className={cx("input", className)}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={list}
        aria-activedescendant={shown && active >= 0 ? `${list}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange?.(e);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={(e) => {
          rest.onFocus?.(e);
          setOpen(true);
        }}
        onBlur={(e) => {
          rest.onBlur?.(e);
          setOpen(false);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            const n = hits.length;
            if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
          } else if (e.key === "Enter" && shown && active >= 0) {
            e.preventDefault();
            fill(hits[active]);
          } else if (e.key === "Escape" && shown) {
            e.stopPropagation();
            setOpen(false);
          } else onKeyDown?.(e);
        }}
      />
      <Popover anchor={input} open={shown} onClose={() => setOpen(false)}>
        <ul role="listbox" id={list} aria-label={`${rest["aria-label"] ?? "Suggestions"}: suggestions`} className="lb">
          {hits.map((s, i) => (
            <li
              key={s}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === active}
              className={cx(i === active && "on")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => fill(s)}
            >
              {s}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

type MultiProps<T extends string | number> = {
  label: string;
  options: { value: T; label: string; disabled?: boolean }[];
  value: T[];
  onChange: (v: T[]) => void;
  placeholder?: string;
};

/**
 * Several choices from a long list: chips for what is chosen and a search box with a
 * multi-select listbox. Space or Enter ticks the highlighted option, Backspace in an empty box
 * removes the last chip, each chip has its own remove button.
 */
export function MultiSelect<T extends string | number>({ label, options, value, onChange, placeholder }: MultiProps<T>) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useId();
  const hits = options.filter((o) => o.label.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="multi" ref={box}>
      {value.length > 0 && (
        <ul className="chips" aria-label={`${label}: chosen`}>
          {value.map((v) => {
            const o = options.find((x) => x.value === v);
            return (
              <li key={String(v)} className="tag">
                {o?.label ?? String(v)}
                <button type="button" aria-label={`Remove ${o?.label ?? v}`} onClick={() => toggle(v)}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        className="input"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={list}
        aria-autocomplete="list"
        aria-activedescendant={open && hits[active] ? `${list}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder ?? "Type to find, Enter to tick"}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          const n = hits.length;
          if (e.key === "ArrowDown") {
            setOpen(true);
            if (n) setActive((a) => (a + 1) % n);
          } else if (e.key === "ArrowUp") {
            if (n) setActive((a) => (a - 1 + n) % n);
          } else if ((e.key === "Enter" || (e.key === " " && !q)) && open && hits[active]) {
            if (!hits[active].disabled) toggle(hits[active].value);
          } else if (e.key === "Backspace" && !q && value.length) {
            onChange(value.slice(0, -1));
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          } else return;
          e.preventDefault();
        }}
      />
      <Popover anchor={box} open={open} onClose={() => setOpen(false)}>
        <ul role="listbox" id={list} aria-label={label} aria-multiselectable="true" className="lb">
          {hits.length === 0 && <li className="lb-empty">No matches</li>}
          {hits.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${list}-${i}`}
              role="option"
              aria-selected={value.includes(o.value)}
              aria-disabled={o.disabled || undefined}
              className={cx(i === active && "on")}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setActive(i)}
              onClick={() => !o.disabled && toggle(o.value)}
            >
              <span className="mbox" aria-hidden="true" />
              <span>{o.label}</span>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

// ---- Dates ----------------------------------------------------------------------------------

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};
/** "28 Oct 2026" for a value like "2026-10-28". */
export const dayLabel = (s: string) => {
  const d = parseDay(s);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}` : "";
};
/** "October 2026" for "2026-10". */
export const monthLabel = (s: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return m ? `${MONTHS[+m[2] - 1]} ${m[1]}` : "";
};

/** A month grid (WAI-ARIA date picker dialog): arrows move a day or a week, Page keys a month. */
function Calendar({ value, max, onPick, onClose }: { value: string; max?: string; onPick: (d: string) => void; onClose: () => void }) {
  const today = new Date();
  const [focus, setFocus] = useState(() => parseDay(value) ?? today);
  const grid = useRef<HTMLTableElement>(null);
  const label = useId();
  const top = new Date(focus.getFullYear(), focus.getMonth(), 1);
  const start = new Date(top);
  start.setDate(1 - ((top.getDay() + 6) % 7));
  const weeks = [...Array(6)].map((_, w) => [...Array(7)].map((_, d) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d)));
  const over = (d: Date) => !!max && iso(d) > max.slice(0, 10);
  const move = (days: number, months = 0) => setFocus((f) => new Date(f.getFullYear(), f.getMonth() + months, f.getDate() + days));
  // Focus follows the day on open and on grid keys; the month buttons keep theirs.
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current) grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
    follow.current = false;
  }, [focus]);
  return (
    <div className="cal" role="dialog" aria-modal="true" aria-labelledby={label}>
      <div className="cal-head">
        <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => move(0, -1)}>
          ‹
        </button>
        <h2 id={label} aria-live="polite">
          {MONTHS[focus.getMonth()]} {focus.getFullYear()}
        </h2>
        <button type="button" className="icon-btn" aria-label="Next month" onClick={() => move(0, 1)}>
          ›
        </button>
      </div>
      <table
        ref={grid}
        role="grid"
        aria-labelledby={label}
        onKeyDown={(e) => {
          const map: Record<string, () => void> = {
            ArrowLeft: () => move(-1),
            ArrowRight: () => move(1),
            ArrowUp: () => move(-7),
            ArrowDown: () => move(7),
            PageUp: () => move(0, e.shiftKey ? -12 : -1),
            PageDown: () => move(0, e.shiftKey ? 12 : 1),
            Home: () => move(-((focus.getDay() + 6) % 7)),
            End: () => move(6 - ((focus.getDay() + 6) % 7)),
          };
          if (map[e.key]) {
            e.preventDefault();
            follow.current = true;
            map[e.key]();
          }
        }}
      >
        <thead>
          <tr>
            {DAYS.map((d) => (
              <th key={d} scope="col" abbr={d}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              {w.map((d) => {
                const s = iso(d);
                return (
                  <td key={s} role="gridcell" aria-selected={s === value.slice(0, 10) || undefined}>
                    <button
                      type="button"
                      tabIndex={s === iso(focus) ? 0 : -1}
                      disabled={over(d)}
                      className={cx("day", d.getMonth() !== focus.getMonth() && "out", s === iso(today) && "today", s === value.slice(0, 10) && "cur")}
                      aria-label={`${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`}
                      onClick={() => onPick(s)}
                    >
                      {d.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cal-foot">
        <button type="button" className="btn sm" disabled={over(today)} onClick={() => onPick(iso(today))}>
          Today
        </button>
        <button type="button" className="btn sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Twelve months a year, for a month value like "2026-10". */
function MonthGrid({ value, max, onPick, onClose }: { value: string; max?: string; onPick: (m: string) => void; onClose: () => void }) {
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  const label = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (box.current?.querySelector<HTMLElement>(".cur:not(:disabled)") ?? box.current?.querySelector<HTMLElement>(".day:not(:disabled)"))?.focus();
  }, []);
  return (
    <div className="cal" role="dialog" aria-modal="true" aria-labelledby={label} ref={box}>
      <div className="cal-head">
        <button type="button" className="icon-btn" aria-label="Previous year" onClick={() => setYear(year - 1)}>
          ‹
        </button>
        <h2 id={label} aria-live="polite">
          {year}
        </h2>
        <button type="button" className="icon-btn" aria-label="Next year" onClick={() => setYear(year + 1)}>
          ›
        </button>
      </div>
      <div className="months">
        {MONTHS.map((m, i) => {
          const v = `${year}-${pad(i + 1)}`;
          return (
            <button key={m} type="button" className={cx("day", v === value && "cur")} aria-label={`${m} ${year}`} aria-pressed={v === value} disabled={!!max && v > max} onClick={() => onPick(v)}>
              {m.slice(0, 3)}
            </button>
          );
        })}
      </div>
      <div className="cal-foot">
        <button type="button" className="btn sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

type DateProps = {
  type: "date" | "datetime-local" | "month";
  value: string;
  onChange: (e: Change) => void;
  max?: string;
  className?: string;
  disabled?: boolean;
  step?: number;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/**
 * Date, date and time, or month, with values in the native formats ("2026-10-28",
 * "2026-10-28T09:30", "2026-10"). A button opens a calendar; the time is a text box that takes
 * "9:30" or "21:30" and moves by a minute with the arrow keys (an hour with Shift).
 */
export function DateInput({ type, value, onChange, max, className, disabled, id, ...aria }: DateProps) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const name = aria["aria-label"] ?? "Date";
  const [day, time = ""] = value.split("T");
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  const set = (d: string, t = time) => onChange(changed(type === "datetime-local" ? (d ? `${d}T${t || "09:00"}` : "") : d));
  const shown = type === "month" ? monthLabel(value) : dayLabel(day);
  return (
    <span className={cx("dt", className?.includes("sm") && "sm")} id={id} role="group" aria-label={aria["aria-labelledby"] ? undefined : name} aria-labelledby={aria["aria-labelledby"]}>
      <button
        ref={btn}
        type="button"
        className="input dt-btn"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${type === "month" ? "Month" : "Date"}: ${shown || "not set"}. Choose`}
        onClick={() => setOpen(!open)}
      >
        <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" />
        </svg>
        <span className={shown ? "" : "dim"}>{shown || "Pick a date"}</span>
      </button>
      {type === "datetime-local" && (
        <TimeField value={time.slice(0, 5)} disabled={disabled || !day} label={`${name}: time`} onChange={(t) => set(day, t)} />
      )}
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={type === "month" ? 260 : 288}>
        <div
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Tab") {
              // Keep Tab inside the picker, like any dialog.
              const all = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)")].filter((b) => b.tabIndex >= 0);
              const i = all.indexOf(document.activeElement as HTMLElement);
              e.preventDefault();
              e.stopPropagation();
              all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
            }
          }}
        >
          {type === "month" ? (
            <MonthGrid value={value} max={max} onClose={close} onPick={(m) => (onChange(changed(m)), close())} />
          ) : (
            <Calendar value={day} max={max} onClose={close} onPick={(d) => (set(d), close())} />
          )}
        </div>
      </Popover>
    </span>
  );
}

/** "9:30", "0930" or "21:5" become "09:30", "21:05"; anything else is null. */
export function parseTime(s: string): string | null {
  const m = /^\s*(\d{1,2})(?::?(\d{1,2}))?\s*$/.exec(s);
  if (!m) return null;
  const [h, min] = [Number(m[1]), Number(m[2] ?? 0)];
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}

function TimeField({ value, onChange, label, disabled }: { value: string; onChange: (t: string) => void; label: string; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const by = (mins: number) => {
    const [h, m] = (parseTime(draft) ?? "09:00").split(":").map(Number);
    const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
    onChange(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`);
  };
  return (
    <input
      className="input dt-time"
      aria-label={label}
      aria-invalid={bad || undefined}
      inputMode="numeric"
      placeholder="09:00"
      disabled={disabled}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={() => {
        const t = parseTime(draft);
        setBad(!t);
        if (t) onChange(t);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          by((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 60 : 1));
        }
      }}
    />
  );
}

// ---- Number, search, tags, colour, files ----------------------------------------------------

/** A number box with minus and plus buttons; the arrow keys step it too. */
export function NumberInput({ value, onChange, min, max, step: by, className, type: _native, ...rest }: InputProps) {
  const inc = Number(by) || 1;
  const nudge = (dir: 1 | -1) => {
    let n = (Number(value) || 0) + dir * inc;
    if (min != null && min !== "") n = Math.max(Number(min), n);
    if (max != null && max !== "") n = Math.min(Number(max), n);
    onChange?.(changed(String(Number(n.toFixed(6)))) as never);
  };
  const name = rest["aria-label"] ?? "the number";
  return (
    <span className={cx("num-in", className?.includes("sm") && "sm")}>
      <button type="button" className="icon-btn" tabIndex={-1} aria-label={`Less ${name}`} disabled={rest.disabled} onClick={() => nudge(-1)}>
        −
      </button>
      <input
        {...rest}
        className={cx("input", className)}
        inputMode="decimal"
        role="spinbutton"
        aria-valuenow={value === "" || value == null || isNaN(Number(value)) ? undefined : Number(value)}
        aria-valuemin={min == null || min === "" ? undefined : Number(min)}
        aria-valuemax={max == null || max === "" ? undefined : Number(max)}
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            nudge(e.key === "ArrowUp" ? 1 : -1);
          }
          rest.onKeyDown?.(e);
        }}
      />
      <button type="button" className="icon-btn" tabIndex={-1} aria-label={`More ${name}`} disabled={rest.disabled} onClick={() => nudge(1)}>
        +
      </button>
    </span>
  );
}

/** A filter box with a magnifier and a clear button; Escape clears it. */
export function SearchInput({ value, onChange, className, ...rest }: InputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const clear = () => {
    onChange?.(changed("") as never);
    ref.current?.focus();
  };
  return (
    <span className={cx("srch", className)}>
      <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input
        ref={ref}
        {...rest}
        type="search"
        className="input"
        value={value}
        onChange={onChange}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            e.preventDefault();
            clear();
          }
          rest.onKeyDown?.(e);
        }}
      />
      {value ? (
        <button type="button" className="icon-btn" aria-label="Clear the filter" onClick={clear}>
          ×
        </button>
      ) : null}
    </span>
  );
}

/**
 * Tags as chips with a box to add more: Enter or comma adds, Backspace in an empty box removes the
 * last one. Suggestions come from tags used elsewhere.
 */
export function TagInput({ label, value, onChange, suggestions = [] }: { label: string; value: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const [draft, setDraft] = useState("");
  const add = (t: string) => {
    const tag = t.trim().replace(/,$/, "").trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div className="tagin">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" aria-label={`Remove the tag ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <Combobox
        aria-label={label}
        placeholder={value.length ? "Add another" : "Add a tag"}
        suggestions={suggestions.filter((s) => !value.includes(s))}
        value={draft}
        onPick={add}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}

const SWATCHES = ["#111111", "#3a3a3a", "#1f4e79", "#0b7343", "#8a5200", "#b42318", "#5b3cc4", "#a0306e"];

/** A colour as a hex code: a swatch, a box for the code (checked as you type) and preset swatches. */
export function ColorInput({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => setDraft(value), [value]);
  const ok = /^#[0-9a-f]{6}$/i.test(draft);
  return (
    <span className="color-in">
      <button
        ref={btn}
        type="button"
        className="swatch"
        style={{ background: /^#[0-9a-f]{6}$/i.test(value) ? value : "#111111" }}
        aria-label={`${label}: choose from preset colours`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      <input
        className="input mono"
        aria-label={`${label} as a hex code`}
        aria-invalid={!ok || undefined}
        value={draft}
        maxLength={7}
        onChange={(e) => {
          const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
          setDraft(v);
          if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
        }}
      />
      {!ok && <span className="err">Use six hex digits, like #111111</span>}
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={208}>
        <div
          className="swatches"
          role="dialog"
          aria-label={`${label}: preset colours`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              btn.current?.focus();
            }
          }}
        >
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c === value}
              autoFocus={c === value}
              onClick={() => {
                onChange(c);
                setOpen(false);
                btn.current?.focus();
              }}
            />
          ))}
        </div>
      </Popover>
    </span>
  );
}

/**
 * A file picker: a button that opens the system file dialog, a drop area, and the chosen file's
 * name. The native input is hidden and only used to open the dialog.
 */
export function FilePicker({ label, accept, disabled, busy, onFile }: { label: string; accept?: string; disabled?: boolean; busy?: string; onFile: (f: File | undefined) => unknown }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const take = async (f: File | undefined) => {
    setName(f?.name ?? "");
    await onFile(f);
  };
  return (
    <div
      className={cx("drop", over && "over", disabled && "off")}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files?.[0]);
      }}
    >
      <button type="button" className="btn" disabled={disabled} onClick={() => ref.current?.click()}>
        <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 10.5V2.5M4.5 6 8 2.5 11.5 6M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
        </svg>
        {busy ?? label}
      </button>
      <span className="dim">{name ? `Chosen: ${name}` : "or drop the file here"}</span>
      <input
        ref={ref}
        type="file"
        className="file-native"
        tabIndex={-1}
        aria-hidden="true"
        accept={accept}
        disabled={disabled}
        onChange={(e) => take(e.target.files?.[0]).then(() => (e.target.value = ""))}
      />
    </div>
  );
}

/** A range slider with the value written next to it. */
export function Slider({ label, value, min, max, step: by = 1, format = String, onChange }: { label: string; value: number; min: number; max: number; step?: number; format?: (n: number) => string; onChange: (n: number) => void }) {
  return (
    <span className="slider">
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(value)}
        min={min}
        max={max}
        step={by}
        value={value}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output aria-hidden="true">{format(value)}</output>
    </span>
  );
}

// ---- Menu and tabs --------------------------------------------------------------------------

export type MenuItem = { label: string; run: () => void; danger?: boolean; disabled?: boolean };

/** A menu button (WAI-ARIA): arrows move, Enter runs, Escape closes and gives focus back. */
export function Menu({ label, items, children, small }: { label: string; items: MenuItem[]; children?: ReactNode; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const focusAt = (i: number) => list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled])')[i]?.focus();
  useEffect(() => {
    if (open) focusAt(0);
  }, [open]);
  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={cx("btn", small && "sm")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={children ? undefined : label}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {children ?? (
          <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="3.5" cy="8" r=".9" />
            <circle cx="8" cy="8" r=".9" />
            <circle cx="12.5" cy="8" r=".9" />
          </svg>
        )}
        {children && <Chevron />}
      </button>
      <Popover anchor={btn} open={open} onClose={() => setOpen(false)} width={220}>
        <ul
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          className="lb menu"
          onKeyDown={(e) => {
            const all = [...list.current!.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled])')];
            const i = all.indexOf(document.activeElement as HTMLElement);
            const go: Record<string, number> = { ArrowDown: (i + 1) % all.length, ArrowUp: (i - 1 + all.length) % all.length, Home: 0, End: all.length - 1 };
            if (e.key in go) {
              e.preventDefault();
              all[go[e.key]]?.focus();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              close();
            } else if (e.key === "Tab") {
              e.preventDefault();
              close();
            }
          }}
        >
          {items.map((m) => (
            <li
              key={m.label}
              role="menuitem"
              tabIndex={-1}
              aria-disabled={m.disabled || undefined}
              className={cx(m.danger && "danger")}
              onClick={() => {
                if (m.disabled) return;
                close();
                m.run();
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && !m.disabled) {
                  e.preventDefault();
                  close();
                  m.run();
                }
              }}
            >
              {m.label}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}

/**
 * Tabs (WAI-ARIA, manual activation is not needed here: content is already loaded, so arrows
 * select as they move). Only the chosen tab is a Tab stop.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, idBase }: { label: string; tabs: { id: T; label: ReactNode }[]; value: T; onChange: (t: T) => void; idBase: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      className="tabs"
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.id === value);
        const go: Record<string, number> = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
        if (!(e.key in go)) return;
        e.preventDefault();
        onChange(tabs[go[e.key]].id);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
      }}
    >
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${t.id}`}
          aria-selected={t.id === value}
          aria-controls={`${idBase}-panel`}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
