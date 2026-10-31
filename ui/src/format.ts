// SPDX-License-Identifier: GPL-3.0-or-later
// Dates and times, drawn one way on every screen. The locale is the computer's own, so the day order
// and the 12 or 24-hour clock follow its settings.

type When = number | string | Date;

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });

/** Unix seconds, a Date, or a site's "2026-10-28", "2026-10-28 09:30:12", "2026-10-28T09:30" or
 * "2026-10". Site strings are read as they are written (the site's clock), never shifted. */
export function toDate(v: When | null | undefined): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "number") return new Date(v * 1000);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  return m ? new Date(+m[1], +m[2] - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : null;
}

/** "28 Oct 2026" (or the locale's order); "" when it is not a date. */
export const day = (v: When | null | undefined) => {
  const d = toDate(v);
  return d ? DAY.format(d) : "";
};

/** "09:30" or "9:30 AM", by the computer's clock. */
export const time = (v: When | null | undefined) => {
  const d = toDate(v);
  return d ? TIME.format(d) : "";
};

/** "October 2026". */
export const month = (v: When | null | undefined) => {
  const d = toDate(v);
  return d ? MONTH.format(d) : "";
};

/** "Today, 10:42", "Yesterday, 17:20" or "26 Oct 2026, 11:15"; "" when it is not a date. */
export function dayTime(v: When | null | undefined, now = new Date()): string {
  const d = toDate(v);
  if (!d) return "";
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  return `${days === 0 ? "Today" : days === 1 ? "Yesterday" : DAY.format(d)}, ${TIME.format(d)}`;
}

/** "28 Sept 2026 to 28 Oct 2026". */
export const range = (from: When, to: When) => `${day(from)} to ${day(to)}`;

/** "just now", "3 min ago", "2 hr ago", "yesterday", "4 days ago"; "never" for no time. */
export function ago(unix: number | null, now = Date.now() / 1000): string {
  if (unix == null) return "never";
  const s = Math.max(0, now - unix);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
