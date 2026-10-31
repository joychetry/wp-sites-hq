// SPDX-License-Identifier: GPL-3.0-or-later
import { ago, day, dayTime, month, range, time, toDate } from "./format";

// Local dates, so the asserts hold in any timezone; the expected text comes from the same locale.
const at = new Date(2026, 9, 28, 9, 30);
const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, o).format(d);

test("reads unix seconds, Dates and a site's own time strings as local time", () => {
  expect(toDate("2026-10-28 09:30:12")).toEqual(new Date(2026, 9, 28, 9, 30, 12));
  expect(toDate("2026-10-28T09:30")).toEqual(at);
  expect(toDate("2026-10-28")).toEqual(new Date(2026, 9, 28));
  expect(toDate(at.getTime() / 1000)).toEqual(at);
  expect(toDate("not a date")).toBeNull();
  expect(day("")).toBe("");
});

test("one day format, the computer's clock, and spans in words", () => {
  const d = fmt(at, { day: "numeric", month: "short", year: "numeric" });
  expect(day("2026-10-28")).toBe(d);
  expect(d).toMatch(/28/);
  expect(d).toMatch(/2026/);
  expect(time(at)).toBe(fmt(at, { hour: "numeric", minute: "2-digit" }));
  expect(month("2026-10")).toBe(fmt(at, { month: "long", year: "numeric" }));
  expect(range("2026-09-28", "2026-10-28")).toBe(`${day("2026-09-28")} to ${d}`);
});

test("day and time say today and yesterday, then the day", () => {
  const noon = new Date(2026, 9, 28, 12);
  expect(dayTime("2026-10-28 09:30:12", noon)).toBe(`Today, ${time(at)}`);
  expect(dayTime("2026-10-27 09:30:00", noon)).toBe(`Yesterday, ${time(at)}`);
  expect(dayTime("2026-10-24 09:30:00", noon)).toBe(`${day("2026-10-24")}, ${time(at)}`);
});

test("relative time: just now, minutes, hours, yesterday, then days", () => {
  const now = 1_800_000_000;
  expect(ago(null, now)).toBe("never");
  expect(ago(now - 30, now)).toBe("just now");
  expect(ago(now - 300, now)).toBe("5 min ago");
  expect(ago(now - 3 * 3600, now)).toBe("3 hr ago");
  expect(ago(now - 30 * 3600, now)).toBe("yesterday");
  expect(ago(now - 5 * 86400, now)).toBe("5 days ago");
});
