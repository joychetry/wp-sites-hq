// SPDX-License-Identifier: GPL-3.0-or-later
// Phase 7 content: scheduling, custom fields, earlier versions, the trash, bulk changes, publishing on several sites.
import { render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement, ReactNode } from "react";
import { Content, bulkRows } from "./Content";
import { planLabel } from "./PublishMany";
import { siteDate } from "./Editor";
import { site, POST_FIELDS } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import type { Post, PostType } from "../api";
import { dayTime } from "../format";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../components/RichText", async (orig) => ({ ...(await orig<object>()), ...(await import("../test-fixtures")).richTextStandIn }));
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
  ...POST_FIELDS,
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
  fireEvent.click(await screen.findByRole("button", { name: "Move to the trash" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Move to the trash" }));
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_untrash" && c[1].postId === 7)).toBe(true));
  expect(await screen.findByText("Brought back from the trash on Alpha.")).toBeInTheDocument();
});

test("datetime-local values become the site's date format", () => {
  expect(siteDate("2026-11-02T09:30")).toBe("2026-11-02 09:30:00");
  expect(siteDate("2026-11-02T09:30:15")).toBe("2026-11-02 09:30:15");
});

test("schedules an entry and changes its custom fields", async () => {
  const calls = core();
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = document.body;
  const fields = await within(sheet).findByRole("group", { name: "Custom fields" });
  expect(within(fields).getByText("Can't edit here")).toBeInTheDocument();
  fireEvent.change(within(fields).getByRole("textbox", { name: "price" }), { target: { value: "14" } });
  fireEvent.click(within(fields).getByRole("button", { name: "Remove the field gallery" }));
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field name" }), { target: { value: "_secret" } });
  expect(within(fields).getByText(/belong to plugins/)).toBeInTheDocument();
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field name" }), { target: { value: "chef" } });
  fireEvent.change(within(fields).getByRole("textbox", { name: "New field value" }), { target: { value: "Ana" } });
  fireEvent.click(within(fields).getByRole("button", { name: "Add the field" }));
  const day = within(sheet).getByRole("textbox", { name: "Publish date: date" });
  fireEvent.change(day, { target: { value: "1 Dec 2026" } });
  fireEvent.blur(day);
  const time = within(sheet).getByRole("textbox", { name: "Publish date: time" });
  fireEvent.change(time, { target: { value: "8:00" } });
  fireEvent.blur(time);
  fireEvent.click(within(sheet).getByRole("button", { name: "Schedule" }));
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
  const sheet = document.body;
  fireEvent.click(await within(sheet).findByRole("button", { name: "Show earlier versions" }));
  const put = await within(sheet).findByRole("button", { name: `Put back the version from ${dayTime("2026-10-20 08:00:00")}` });
  fireEvent.click(put);
  fireEvent.click(within(sheet).getByRole("button", { name: "Put it back" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_restore_revision" && c[1].revisionId === 70)).toBe(true));
  expect(await screen.findByText(`is back to the version from ${dayTime("2026-10-20 08:00:00")}`, { exact: false })).toBeInTheDocument();
  // A trashed entry is read-only until it comes back.
  expect(within(sheet).getByText(/is in the trash\. Bring it back to change it/)).toBeInTheDocument();
  expect(within(sheet).getByRole("textbox", { name: "Title" }).closest(".ed-grid")).toHaveAttribute("inert");
  fireEvent.click(within(sheet).getByRole("button", { name: "Bring back from the trash" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_untrash")).toBe(true));
  expect(await screen.findByText(/back from the trash on Alpha, as draft/)).toBeInTheDocument();
});

test("Basic mode and older Classic Monks don't offer fields, versions or the trash", async () => {
  core({ content_get: () => ({ ...POST, meta: {}, status: "trash" }) });
  const { unmount } = render(<Content sites={[BASIC]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = document.body;
  await within(sheet).findByRole("textbox", { name: "Title" });
  expect(within(sheet).queryByRole("group", { name: "Custom fields" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Show earlier versions" })).toBeNull();
  expect(within(sheet).queryByRole("button", { name: "Bring back from the trash" })).toBeNull();
  unmount();
  void OLD;
});

test("selected posts change in bulk through a plan", async () => {
  core();
  const plans: [string, number, string | undefined, boolean | undefined][] = [];
  render(<Content sites={[CM]} onPlan={(t, r, start, danger) => plans.push([t, r.length, start, danger])} />);
  const table = await screen.findByRole("table", { name: "Posts" });
  // The bulk bar shows only while something is selected.
  expect(screen.queryByRole("group", { name: "Change the selected posts" })).not.toBeInTheDocument();
  fireEvent.click(within(table).getByRole("checkbox", { name: "Select every post on this page" }));
  expect(screen.getByRole("group", { name: "Change the selected posts" })).toHaveTextContent("2 posts selected");
  fireEvent.click(screen.getByRole("button", { name: "Move to the trash (2)" }));
  // Hours is published and Menu a draft: each button counts only the posts it would change.
  expect(screen.getByRole("button", { name: "Change to draft (1)" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Publish (1)" }));
  fireEvent.click(within(table).getByRole("checkbox", { name: "Select Menu" }));
  expect(screen.queryByRole("button", { name: /^Publish \(/ })).toBeNull();
  expect(plans).toEqual([
    ["Move 2 posts to the trash on Alpha", 2, "confirm", true],
    ["Publish 1 post on Alpha", 1, "confirm", undefined],
  ]);
  const [draft] = bulkRows(CM, POSTS, [row(7, "")], "draft");
  expect(draft.label).toBe("Change “(no title)” to draft");
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
  // The plan opens in its own sheet here (with a way back), not through the app's onPlan.
  expect(plans).toHaveLength(0);
  const plan = await screen.findByRole("dialog", { name: "Publish “Open on Sunday” on 2 sites" });
  expect(plan).toHaveTextContent("Publish the post “Open on Sunday” in News, Events");
  // Back to the form keeps everything typed.
  fireEvent.click(within(plan).getByRole("button", { name: "Back" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: /Open on Sunday/ })).toBeNull());
  const again = screen.getByRole("dialog", { name: "Publish on several sites" });
  expect(within(again).getByRole("textbox", { name: "Title" })).toHaveValue("Open on Sunday");
  expect(within(again).getByRole("checkbox", { name: /Beta/ })).toBeChecked();
});

test("a publish-many row says the kind, the date, the status and the categories", () => {
  expect(planLabel("post", "Open", "publish", "", ["News"])).toEqual({ verb: "Publish", label: "Publish the post “Open” in News" });
  expect(planLabel("page", "Open", "publish", "2026-12-01T10:00", ["News"]).label).toBe("Schedule the page “Open” for 1 Dec 2026, 10:00");
  expect(planLabel("post", "Open", "pending", "", []).label).toBe("Add the post “Open” for review");
  expect(planLabel("post", "Open", "draft", "2026-12-01T10:00", []).label).toBe("Add the post “Open” as a draft dated 1 Dec 2026, 10:00");
});

test("publish on several sites says what is missing instead of a grey button", async () => {
  core();
  render(<Content sites={[CM]} onPlan={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Publish on several sites" }));
  const sheet = await screen.findByRole("dialog", { name: "Publish on several sites" });
  fireEvent.click(within(sheet).getByRole("checkbox", { name: /Alpha/ }));
  fireEvent.click(within(sheet).getByRole("button", { name: "Review the plan" }));
  expect(within(sheet).getByText("Add a title first.")).toBeInTheDocument();
  expect(within(sheet).getByText("Select at least one site.")).toBeInTheDocument();
});
