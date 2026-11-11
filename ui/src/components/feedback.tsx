// SPDX-License-Identifier: GPL-3.0-or-later
// Feedback pieces: toasts (with Undo), tooltips, loading skeletons, a progress bar and empty states.
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Details, Glyph, Icon, type GlyphName } from "./ui";
import type { Site, Tone } from "../api";

type Action = { label: string; icon?: GlyphName; run: () => unknown };
type Toast = { id: number; text: string; tone: Tone | "info"; undo?: () => unknown; action?: Action; stay?: boolean };
let toasts: Toast[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const dismiss = (id: number) => {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
};

/** Closes every message (tests start clean with it). */
export const dismissAll = () => {
  toasts = [];
  emit();
};

/**
 * Shows a short message at the bottom of the window. With `undo`, it offers an Undo button; with `action`, another
 * button (like Show in folder); with `stay`, it waits to be closed.
 */
export function toast(text: string, opts: { tone?: Tone | "info"; undo?: () => unknown; action?: Action; stay?: boolean } = {}) {
  const t = { id: nextId++, text, tone: opts.tone ?? "ok", undo: opts.undo, action: opts.action, stay: opts.stay };
  toasts = [...toasts.slice(-2), t];
  emit();
  return t.id;
}

// A focused button goes with its toast, so focus goes back to the open sheet or the content, not to the page.
const close = (id: number) => {
  if (document.activeElement?.closest(".toasts")) {
    const sheet = document.querySelector<HTMLElement>('[aria-modal="true"]');
    (sheet?.querySelector<HTMLElement>("input, textarea, button") ?? document.getElementById("content"))?.focus();
  }
  dismiss(id);
};

function ToastItem({ t }: { t: Toast }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    // Errors, Undo and news you act on later stay until closed (or pushed out by newer ones), so there is time to read and reach them.
    if (t.tone === "danger" || t.undo || t.action || t.stay) return;
    const timer = setTimeout(() => dismiss(t.id), 5000);
    return () => clearTimeout(timer);
  }, [paused, t]);
  return (
    <li className={`toast ${t.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <Icon tone={t.tone} />
      <span className="grow">{t.text}</span>
      {t.undo && (
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            close(t.id);
            t.undo!();
          }}
        >
          Undo
        </button>
      )}
      {t.action && (
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            close(t.id);
            t.action!.run();
          }}
        >
          {t.action.label}
          {t.action.icon && <Glyph name={t.action.icon} />}
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Close the message" onClick={() => close(t.id)}>
        <Glyph name="x" />
      </button>
    </li>
  );
}

/** Where toasts appear. A live region that exists before anything is said in it. */
export function Toaster() {
  const list = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => toasts,
  );
  return (
    <section className="toasts" aria-label="Messages">
      <div role="status" aria-live="polite">
        <ol>
          {list.map((t) => (
            <ToastItem key={t.id} t={t} />
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Tooltips for anything with `data-tip`: on hover after a short wait, at once on keyboard focus,
 * gone on Escape. The tip is tied to its element with aria-describedby while it shows.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; up: boolean } | null>(null);
  const owner = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let timer = 0;
    const hide = () => {
      clearTimeout(timer);
      owner.current?.removeAttribute("aria-describedby");
      owner.current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const up = r.bottom + 40 > innerHeight;
      owner.current = el;
      if (!el.hasAttribute("aria-describedby")) el.setAttribute("aria-describedby", "mc-tip");
      setTip({ text: el.dataset.tip!, x: Math.min(Math.max(r.left + r.width / 2, 120), innerWidth - 120), y: up ? r.top - 6 : r.bottom + 6, up });
    };
    const over = (e: Event) => {
      const el = (e.target as Element).closest?.<HTMLElement>("[data-tip]");
      if (el === owner.current) return;
      hide();
      if (!el?.dataset.tip) return;
      if (e.type === "focusin") {
        if (el.matches(":focus-visible")) show(el);
      } else timer = window.setTimeout(() => show(el), 450);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && owner.current && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", key);
    addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", key);
      removeEventListener("scroll", hide, true);
    };
  }, []);
  return createPortal(
    <div id="mc-tip" role="tooltip" className={`tip${tip ? " on" : ""}${tip?.up ? " up" : ""}`} style={tip ? { left: tip.x, top: tip.y } : undefined}>
      {tip?.text}
    </div>,
    document.body,
  );
}

/** A loading placeholder shaped like the rows that will come, with words for screen readers. */
export function Skeleton({ label, rows = 6 }: { label: string; rows?: number }) {
  return (
    <div className="skel" role="status">
      <span className="sr-only">{label}</span>
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="skel-row" aria-hidden="true">
          <i style={{ width: `${28 + ((i * 37) % 30)}%` }} />
          <i style={{ width: `${12 + ((i * 17) % 10)}%` }} />
          <i style={{ width: "10%" }} />
        </div>
      ))}
    </div>
  );
}

/** A determinate progress bar. */
export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-valuetext={`${value} of ${max}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

const PICTURES: Record<string, ReactNode> = {
  sites: <path d="M4 7h24v16H4zM4 11h24M10 27h12M16 23v4" />,
  done: <path d="M9 16.5l4.5 4.5L23 11.5M16 4a12 12 0 1 0 0 24 12 12 0 0 0 0-24z" />,
  search: <path d="M14 6a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM20 20l6 6" />,
  inbox: <path d="M4 18l4-12h16l4 12v8H4zM4 18h7l2 3h6l2-3h7" />,
  plug: <path d="M12 4v6M20 4v6M8 10h16v4a8 8 0 0 1-16 0zM16 22v6" />,
  lock: <path d="M8 14h16v13H8zM11 14v-4a5 5 0 0 1 10 0v4M16 19v3" />,
  alert: <path d="M16 5 3.5 26h25zM16 13v6M16 22.5v.5" />,
  pulse: <path d="M3 17h6l3-8 5 15 4-11 2 4h6" />,
  shield: <path d="M16 4l10 4v7c0 7-4.5 11-10 13-5.5-2-10-6-10-13V8zM11.5 16l3 3 6-6" />,
};

/** An empty or error state: a picture, a heading, plain words and the next step. */
/** `small`: inside a card or the side panel, a quieter size. */
export function Empty({ picture, title, children, action, alert, small }: { picture?: keyof typeof PICTURES; title: string; children?: ReactNode; action?: ReactNode; alert?: boolean; small?: boolean }) {
  return (
    <div className={small ? "empty sm" : "empty"} role={alert ? "alert" : undefined}>
      {/* One shape for every empty state: a picture in a tinted disc, a title without a full stop, words, one action. */}
      <svg className="empty-pic" viewBox="0 0 32 32" aria-hidden="true">
        {PICTURES[picture ?? (alert ? "alert" : "inbox")]}
      </svg>
      <h2>{title.replace(/\.$/, "")}</h2>
      {children}
      {action && <div className="row">{action}</div>}
    </div>
  );
}

/** Ask the app shell to open the Sign in again sheet, or open a site in Sites (App.tsx listens). */
export const askSignIn = (siteId: number) => window.dispatchEvent(new CustomEvent("wpshq:sign-in-again", { detail: siteId }));

const ONE_EACH = 3;
/** Sites that can't show a page's list until you sign in again: a note each, or past three one note that opens into them. */
export function SignInNotes({ sites, reason, what }: { sites: Site[]; reason: (s: Site) => string | null; what: string }) {
  const [each, setEach] = useState(false);
  if (sites.length > ONE_EACH && !each) {
    const names = sites.slice(0, ONE_EACH).map((s) => s.name).join(", ");
    return (
      <li className="callout go">
        <Glyph name="lock" />
        <span>
          {sites.length} sites can't show their {what} until you sign in again: {names} and {sites.length - ONE_EACH} more.
        </span>
        <Button small onClick={() => setEach(true)}>
          Show each site
        </Button>
      </li>
    );
  }
  return sites.map((s) => (
    <li key={s.id} className="callout go">
      <Glyph name="lock" />
      <span>
        {s.name}: {reason(s)}
      </span>
      <Button small onClick={() => askSignIn(s.id)}>
        Sign in again
      </Button>
    </li>
  ));
}
export const askOpenSite = (siteId: number) => window.dispatchEvent(new CustomEvent("wpshq:open-site", { detail: siteId }));

/**
 * A site this page can't work with yet, and the one step that fixes it: never a sentence alone.
 * Sign in again when the sign-in expired or allows too little; otherwise open the site in Sites
 * (Basic mode, where the WP Sites HQ plugin is got, or an older plugin to update). `extra` is a second action.
 */
export function Blocked({ site, reason, title, extra, small }: { site: { id: number; sign_in_again?: boolean; mode: string }; reason: string; title?: string; extra?: ReactNode; small?: boolean }) {
  const signIn = site.sign_in_again || /sign in again/i.test(reason);
  const action = signIn ? (
    <Button kind="primary" onClick={() => askSignIn(site.id)}>
      Sign in again
    </Button>
  ) : (
    <Button kind="primary" onClick={() => askOpenSite(site.id)}>
      {site.mode === "basic" ? "Get the WP Sites HQ plugin" : "Open in Sites"}
    </Button>
  );
  return (
    <Empty picture="lock" title={title ?? (site.sign_in_again ? "Sign-in expired" : "Not available on this site")} small={small} action={<>{action}{extra}</>}>
      <p>{reason}</p>
    </Empty>
  );
}

/**
 * Catches a screen's render error so the sidebar and top bar stay usable. App.tsx keys it by page, so going to
 * another page clears it; Reload this page draws the screen again.
 */
export class PageError extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("A page hit an error:", error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const text = String(error.stack ?? error);
    return (
      <div className="empty" role="alert">
        <span className="danger-disc" aria-hidden="true">
          <Glyph name="alert" />
        </span>
        <h2>This page hit an error</h2>
        <p>
          <b>Nothing was changed.</b> The rest of the app still works: reload this page, or open another one.
        </p>
        <div className="row">
          <Button onClick={() => this.setState({ error: null })}>
            Reload this page
            <Glyph name="refresh" />
          </Button>
          <Button
            onClick={() =>
              navigator.clipboard.writeText(text).then(
                () => toast("Copied the error details."),
                () => toast("Couldn't copy the details. Select them and copy instead.", { tone: "danger" }),
              )
            }
          >
            Copy details
            <Glyph name="copy" />
          </Button>
        </div>
        <Details>
          <p className="jobraw">{text}</p>
        </Details>
      </div>
    );
  }
}
