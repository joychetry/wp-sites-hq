// SPDX-License-Identifier: GPL-3.0-or-later
// The one page structure every screen uses under the page head (App.tsx): a scrolling column of a
// toolbar, cards and sections at one gap, and, where a screen has one, a right panel that is always there.
import type { ReactNode } from "react";
import { Empty } from "./feedback";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ") || undefined;

/** A screen's body. `side` adds the right panel (a <SidePanel>); `narrow` caps the width for reading. */
export function Page({ side, narrow, className, children }: { side?: ReactNode; narrow?: boolean; className?: string; children: ReactNode }) {
  if (!side) return <div className={cx("page", narrow && "narrow", className)}>{children}</div>;
  return (
    <div className={cx("page with-side", className)}>
      <div className="page-main">{children}</div>
      {side}
    </div>
  );
}

/** The row of search, filters and buttons above a page's cards: one height, one line, `.end` items at the right. */
export function Toolbar({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx("toolbar", className)} role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}

/**
 * The right panel: the details of what is picked, or a calm line saying what to pick. It never goes away,
 * so the page beside it doesn't move when something is picked or closed.
 */
export function SidePanel({ label, empty, className, children }: { label: string; empty: string; className?: string; children?: ReactNode }) {
  return (
    <aside className={cx("insp", className)} aria-label={label}>
      {children || <Empty small title={empty} />}
    </aside>
  );
}
