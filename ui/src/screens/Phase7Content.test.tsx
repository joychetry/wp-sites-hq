// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7 content: scheduling, custom fields, earlier versions, the trash, bulk changes, publishing on several sites.
import { render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement, ReactNode } from "react";
import { Content, bulkRows } from "./Content";
import { siteDate } from "./Editor";
import { site, choose } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import type { Post, PostType } from "../api";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const TOOLS = ["list-post-types", "get-post-meta", "list-revisions", "untrash-post"];
const CM = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: TOOLS } });
const BASIC = site({ id: 2, name: "Beta", mode: "basic", capabilities: {} });
const OLD = site({ id: 3, name: "Gamma", capabilities: { operator: true, abilities: ["get-posts"] } });

const POSTS: PostType = {
  name: "post",
  label: "Posts",
  singular: "Post",
  hierarchical: false,
  supports: ["title", "editor"],
  can_publish: true,
  can_delete: true,
  taxonomies: [],
  rest_base: "",
};
const POST: Post = {
  id: 7,
  post_type: "post",
  title: "Menu",
  status: "draft",
  date: "2026-10-28 09:00:00",
  modified: "2026-10-28 09:05:00",
  link: "",
  featured_image: 0,
  featured_url: null,
  terms: {},
  meta: { price: "12", gallery: ["1", "2"] },
  builder: null,
  blocks: [],
  locked: null,
};
const row = (id: number, title: string, status = "draft") => ({ id, title, status, date: "", modified: "", author: "Joy", link: "" });

function core(over: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "content_types":
        return [POSTS];
      case "content_list":
        return { posts: [row(7, "Menu"), row(8, "Hours", "publish")], total: 2, page: 1, pages: 1 };
      case "content_get":
        return POST;
      case "content_edit":
        return POST;
      case "content_revisions":
        return [{ id: 70, date: "2026-10-20 08:00:00", author: "Sam", title: "Old menu" }];
      case "content_restore_revision":
        return "Restored the revision.";
      case "content_untrash":
        return "draft";
      default:
        return null;
    }
  });
  return calls;
}

test("an entry moved to the trash comes back with Undo on the message", async () => {
  const calls = core();
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(await within(sheet).findByRole("button", { name: "Move to the trash" }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Move it to the trash" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_untrash" && c[1].postId === 7)).toBe(true));
  expect(await screen.findByText("Brought it back from the trash on Alpha.")).toBeInTheDocument();
});

test("datetime-local values become the site's date format", () => {
  expect(siteDate("2026-11-02T09:30")).toBe("2026-11-02 09:30:00");
  expect(siteDate("2026-11-02T09:30:15")).toBe("2026-11-02 09:30:15");
});

test("schedules an entry and changes its custom fields", async () => {
  const calls = core();
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  const fields = await within(sheet).findByRole("group", { name: "Custom fields" });
  expect(within(fields).getByText("kept as is (not plain text)")).toBeInTheDocument();
  fireEvent.change(within(fields).getByRole("textbox", { name: "price" }), { target: { value: "14" } });
  fireEvent.click(within(fields).getByRole("button", { name: "Remove the field gallery" }));
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field name" }), { target: { value: "_secret" } });
  expect(within(fields).getByText(/belong to plugins/)).toBeInTheDocument();
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field name" }), { target: { value: "chef" } });
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field value" }), { target: { value: "Ana" } });
  fireEvent.click(within(fields).getByRole("button", { name: "Add the field" }));
  choose(within(sheet).getByRole("combobox", { name: "Status" }), "publish");
  const day = within(sheet).getByRole("textbox", { name: "Publish date: date" });
  fireEvent.change(day, { target: { value: "1 Dec 2026" } });
  fireEvent.blur(day);
  const time = within(sheet).getByRole("textbox", { name: "Publish date: time" });
  fireEvent.change(time, { target: { value: "8:00" } });
  fireEvent.blur(time);
  fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_edit")?.[1].draft).toEqual({
      status: "publish",
      date: "2026-12-01 08:00:00",
      meta: { price: "14", gallery: null, chef: "Ana" },
      seen_modified: "2026-10-28 09:05:00",
    }),
  );
});

test("puts an earlier version back after asking, and brings an entry back from the trash", async () => {
  const calls = core({ content_get: () => ({ ...POST, status: "trash" }) });

  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  fireEvent.click(await within(sheet).findByRole("button", { name: "Show earlier versions" }));
  const put = await within(sheet).findByRole("button", { name: "Put this version back, from 2026-10-20 08:00:00" });
  fireEvent.click(put);
  fireEvent.click(within(sheet).getByRole("button", { name: "Put it back" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_restore_revision" && c[1].revisionId === 70)).toBe(true));
  expect(await screen.findByText(/is back to the version from 2026-10-20 08:00:00/)).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Bring it back from the trash" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_untrash")).toBe(true));
  expect(await screen.findByText(/back from the trash on Alpha, as draft/)).toBeInTheDocument();
});

test("Basic mode and older Classic Monks don't offer fields, versions or the trash", async () => {
  core({ content_get: () => ({ ...POST, meta: {}, status: "trash" }) });
  const { unmount } = render(<Content sites={[BASIC]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  await within(sheet).findByRole("textbox", { name: "Title" });
  expect(within(sheet).queryByRole("group", { name: "Custom fields" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Show earlier versions" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Bring it back from the trash" })).toBeNull();
  unmount();
  void OLD;
});

test("ticked entries change in bulk through a plan", async () => {
  core();
  const plans: [string, number, string | undefined, boolean | undefined][] = [];
  render(<Content sites={[CM]} onPlan={(t, r, start, danger) => plans.push([t, r.length, start, danger])} />);
  const table = await screen.findByRole("table", { name: "Posts" });
  const trash = screen.getByRole("button", { name: "Move to the trash" });
  expect(trash).toBeDisabled();
  fireEvent.click(within(table).getByRole("checkbox", { name: "Tick every entry on this page" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to the trash (2)" }));
  fireEvent.click(within(table).getByRole("checkbox", { name: "Tick Hours" }));
  fireEvent.click(screen.getByRole("button", { name: "Publish (1)" }));
  expect(plans).toEqual([
    ["Move to the trash 2 entries on Alpha", 2, "confirm", true],
    ["Publish 1 entry on Alpha", 1, "confirm", undefined],
  ]);
  const [draft] = bulkRows(CM, POSTS, [row(7, "")], "draft");
  expect(draft.label).toBe("Make “(no title)” a draft");
  expect(draft.change.action).toEqual({ do: "set_post_status", post_type: "post", post_id: 7, title: "(no title)", status: "draft" });
  expect(bulkRows(CM, POSTS, [row(7, "A")], "untrash")[0].change.action.do).toBe("untrash_post");
});

test("publishes one entry on several sites as one plan", async () => {
  core();
  const plans: [string, unknown[], string | undefined][] = [];
  render(<Content sites={[CM, BASIC, OLD]} onPlan={(t, r, start) => plans.push([t, r, start])} />);
  fireEvent.click(await screen.findByRole("button", { name: "Publish on several sites" }));
  const sheet = await screen.findByRole("dialog", { name: "Publish on several sites" });
  expect(within(sheet).getByRole("checkbox", { name: /Gamma/ })).toBeDisabled();
  expect(within(sheet).getByRole("checkbox", { name: /Alpha/ })).toBeChecked();
  fireEvent.click(within(sheet).getByRole("checkbox", { name: /Beta/ }));
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Title" }), { target: { value: "Open on Sunday" } });
  fireEvent.change(within(sheet).getByRole("textbox", { name: /^Text/ }), { target: { value: "From 9." } });
  fireEvent.change(within(sheet).getByRole("textbox", { name: /^Categories/ }), { target: { value: "News, , Events " } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Review the plan" }));
  expect(plans).toHaveLength(1);
  const [title, rows, start] = plans[0];
  expect([title, start]).toEqual(["Publish “Open on Sunday” on 2 sites", "confirm"]);
  expect(rows).toEqual(
    [CM, BASIC].map((s) => ({
      change: {
        site_id: s.id,
        action: { do: "publish_post", post_type: "post", title: "Open on Sunday", body: "<!-- wp:paragraph -->\n<p>From 9.</p>\n<!-- /wp:paragraph -->", status: "publish", terms: { category: ["News", "Events"] } },
      },
      site: s.name,
      label: "Publish “Open on Sunday”",
    })),
  );
});
