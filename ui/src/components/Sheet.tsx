// A side sheet over the page (bulk actions, adding a site). Esc closes it.
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), select, button:not([disabled]), [href]";

type Props = {
  title: string;
  intro?: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  children: ReactNode;
};

export function Sheet({ title, intro, footer, onClose, children }: Props) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => opener?.focus?.();
  }, []);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab") {
            // Keep Tab inside the sheet while it is open.
            const all = [...ref.current!.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent);
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
          <h2>{title}</h2>
          {intro && <p>{intro}</p>}
        </header>
        <div className="content">{children}</div>
        <footer>{footer}</footer>
      </aside>
    </>
  );
}
