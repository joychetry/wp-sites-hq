// SPDX-License-Identifier: GPL-3.0-or-later
// Small pieces of the Console design system.
import type { ReactNode } from "react";
import type { Tone } from "../api";

/** The Classic Monks mark, coloured by CSS. */
export function Logo() {
  return (
    <svg className="mark" viewBox="0 0 65 64" aria-hidden="true">
      <path
        className="mark-body"
        d="M0 31.63c.002-.353.01-.705.025-1.06C.976 7.459 29.57-6.45 49.447 2.995c20.86 9.913 19.047 37.3 4.514 52.014C34.353 74.861-.144 59.515.001 31.63Z"
      />
      <path
        className="mark-face"
        d="M32.434 21.865c2.58 0 4.67-2.093 4.67-4.675a4.673 4.673 0 0 0-4.67-4.674 4.673 4.673 0 0 0-4.67 4.674 4.673 4.673 0 0 0 4.67 4.675ZM42.014 25.193c-.75 0-1.497.324-2.068.974a9.906 9.906 0 0 1-14.897 0c-1.141-1.302-2.996-1.302-4.137 0-1.145 1.293-1.145 3.395 0 4.688 6.382 7.24 16.79 7.24 23.171 0 1.145-1.294 1.145-3.395 0-4.688-.57-.65-1.317-.974-2.068-.974ZM32.434 34.18c-7.058 0-14.114 2.691-19.486 8.07a2.925 2.925 0 0 0 0 4.14 2.912 2.912 0 0 0 4.137 0c8.463-8.463 22.235-8.463 30.698 0a2.912 2.912 0 0 0 4.138 0 2.925 2.925 0 0 0 0-4.14c-5.373-5.378-12.428-8.07-19.487-8.07Z"
      />
    </svg>
  );
}

/** Line drawings on a 16px grid, round caps, drawn in currentColor (the design's icon set). */
const GLYPHS = {
  refresh: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3.5H10",
  search: "M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM10.3 10.3 14 14",
  clock: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM8 4.5V8l2.5 1.5",
  monitor: "M2 3h12v8H2zM5.5 14h5M8 11v3",
  sun: "M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z",
  plus: "M8 3v10M3 8h10",
  arrow: "M3 8h10M9 4l4 4-4 4",
  sparkle: "M8 1.5l1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5z",
  download: "M8 2v8.5M4.5 7 8 10.5 11.5 7M2.5 13.5h11",
  shield: "M8 1.5l5.5 2v4c0 3.5-2.4 6-5.5 7-3.1-1-5.5-3.5-5.5-7v-4z",
  unplug: "M2 2l12 12M6 1.5v3M10 1.5v2M4 4.5h1.5M12 4.5v3a4 4 0 0 1-1 2.6M4.3 6.5A4 4 0 0 0 8 11.5c.6 0 1.1-.1 1.6-.3M8 11.5v3",
  login: "M9.5 2.5h3v11h-3M2 8h8M7 5l3 3-3 3",
  globe: "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM1.5 8h13M8 1.5c2.2 2.2 2.2 10.8 0 13M8 1.5c-2.2 2.2-2.2 10.8 0 13",
  message: "M2 3h12v8H6.5L3.5 14v-3H2z",
  alert: "M8 2.2 14.3 13.5H1.7zM8 6.8v2.9M8 11.6v.1",
};
export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d={GLYPHS[name]} />
    </svg>
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

export function Status({ tone, children }: { tone: Tone | "info"; children: ReactNode }) {
  return (
    <span className={`st ${tone}`}>
      <Icon tone={tone} />
      {children}
    </span>
  );
}

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "danger" | "soft";
  small?: boolean;
  keys?: string;
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
