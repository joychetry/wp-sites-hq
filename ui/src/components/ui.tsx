// SPDX-License-Identifier: GPL-3.0-or-later
// Small pieces of the Console design system.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Tone } from "../api";
import { ICONS } from "./icons";
export { CmLogo, Lockup, Logo } from "./brand";

/** Raw text from a site or a feed, behind "Show the details"; the plain summary sits before it. */
export function Details({ children }: { children: ReactNode }) {
  return (
    <details className="more">
      <summary>
        Show the details
        <Glyph name="chevron-down" />
      </summary>
      <div>{children}</div>
    </details>
  );
}

/** The design's line icons (components/icons.ts), drawn in currentColor. */
export type GlyphName = keyof typeof ICONS | "arrow";

export function Glyph({ name }: { name: GlyphName }) {
  const [width, body] = ICONS[name === "arrow" ? "arrow-right" : name];
  return (
    <svg
      className="glyph"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill={width ? "none" : "currentColor"}
      stroke={width ? "currentColor" : "none"}
      strokeWidth={width || undefined}
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

const SHAPES: Record<Tone | "info", ReactNode> = {
  ok: <path d="M3 8.5l3.2 3.2L13 4.8" />,
  warning: (
    <>
      <path d="M8 2.2 14.3 13.5H1.7z" />
      <path d="M8 6.8v2.9M8 11.6v.1" />
    </>
  ),
  danger: <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />,
  unknown: <circle cx="8" cy="8" r="5" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v4M8 4.9v.1" />
    </>
  ),
};

/** A shape per status (tick, warning sign, cross, empty ring, i), so it never rests on colour alone. */
export function Icon({ tone }: { tone: Tone | "info" }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" aria-hidden="true">
      {SHAPES[tone]}
    </svg>
  );
}

/** A state: an icon and a word, never colour alone. `pill` puts it on its tinted ground (every state in a list or table). */
export function Status({ tone, pill, children }: { tone: Tone | "info"; pill?: boolean; children: ReactNode }) {
  return (
    <span className={`st ${pill ? "pill " : ""}${tone}`}>
      <Icon tone={tone} />
      {children}
    </span>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "danger" | "soft";
  small?: boolean;
  keys?: string;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Button({ kind, small, keys, className, children, ...rest }: BtnProps) {
  const cls = ["btn", kind, small && "sm", className].filter(Boolean).join(" ");
  return (
    <button type="button" className={cls} {...rest}>
      {children}
      {keys && <Kbd>{keys}</Kbd>}
    </button>
  );
}

/** The one "Add a site" button: primary, the A key, and the plus disc, wherever it appears. */
export function AddSiteButton({ onClick }: { onClick: () => void }) {
  return (
    <Button kind="primary" className="disc" aria-keyshortcuts="A" onClick={onClick}>
      Add a site
      <Kbd>A</Kbd>
      <span className="btn-disc">
        <Glyph name="plus" />
      </span>
    </Button>
  );
}

/** The page head's action area (App.tsx); a screen puts its main actions there with <HeadActions>. */
export const HeadSlot = createContext<HTMLElement | null>(null);

export function HeadActions({ children }: { children: ReactNode }) {
  const slot = useContext(HeadSlot);
  return slot ? createPortal(children, slot) : null;
}
