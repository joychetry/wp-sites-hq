// SPDX-License-Identifier: GPL-3.0-or-later
// A side sheet over the page (bulk actions, editing), or a centred dialog (adding a site). Esc closes it.
import { useEffect, useRef, type ReactNode } from "react";
import { Glyph } from "./ui";

const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), select, button:not([disabled]), [href]";
const FIRST = "input, textarea, select, button:not(.sheet-x)";
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent);

type Props = {
  title: string;
  intro?: ReactNode;
  /** Under the title and intro, in the head: a stepper (components/JobSheet.tsx). */
  steps?: ReactNode;
  /** A tile before the title, like the design's dialogs. */
  icon?: ReactNode;
  /** A centred dialog instead of the side sheet. */
  dialog?: boolean;
  /** The foot's buttons; a dialog that only shows something may have none. */
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

export function Sheet({ title, intro, steps, icon, dialog, footer, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // The head's close button is last in line, so focus lands on the sheet's first real control.
    ref.current?.querySelector<HTMLElement>(FIRST)?.focus();
    const top = () => [...document.querySelectorAll('[aria-modal="true"]')].pop() === ref.current;
    // A step that replaces the focused button drops focus to the page: put it back on the new step's first control.
    const lost = new MutationObserver(() => {
      if (top() && !ref.current?.contains(document.activeElement)) ref.current?.querySelector<HTMLElement>(`.content :is(${FIRST})`)?.focus();
    });
    lost.observe(ref.current!, { childList: true, subtree: true });
    // And Tab from anywhere outside (the page behind the scrim) comes back into the sheet.
    const tab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !top() || ref.current?.contains(document.activeElement)) return;
      e.preventDefault();
      const all = focusables(ref.current!);
      (e.shiftKey ? all[all.length - 1] : all[0])?.focus();
    };
    document.addEventListener("keydown", tab, true);
    return () => {
      lost.disconnect();
      document.removeEventListener("keydown", tab, true);
      opener?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        ref={ref}
        className={dialog ? "sheet dialog" : "sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab") {
            // Keep Tab inside the sheet while it is open.
            const all = focusables(ref.current!);
            const [first, last] = [all[0], all[all.length - 1]];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          {icon}
          <div>
            <h2>{title}</h2>
            {intro && <p>{intro}</p>}
            {steps}
          </div>
          <button type="button" className="icon-btn sheet-x" aria-label="Close" data-tip="Close (Esc)" onClick={onClose}>
            <Glyph name="x" />
          </button>
        </header>
        <div className="content">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </>
  );
}
