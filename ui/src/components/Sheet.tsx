// A side sheet over the page (bulk actions, adding a site). Esc closes it.
import { useEffect, useRef, type ReactNode } from "react";

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
