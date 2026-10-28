// SPDX-License-Identifier: GPL-3.0-or-later
// Content (list, editor with block-safe body, terms, featured image, trash) and Media.
import { render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ReactElement, ReactNode } from "react";
import { Content } from "./Content";
import { blockLabel, toBlocks } from "./Editor";
import { Media } from "./Media";
import { site, choose, POST_FIELDS } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import { contentBlocked, type Post, type PostType } from "../api";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../components/RichText", async (orig) => ({ ...(await orig<object>()), ...(await import("../test-fixtures")).richTextStandIn }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const CM = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: ["list-post-types"] } });
const OLD = site({ id: 2, name: "Older", capabilities: { operator: true, abilities: ["get-posts"] } });

const BOOK: PostType = {
  name: "cm_book",
  label: "Books",
  singular: "Book",
  hierarchical: false,
  supports: ["title", "editor", "thumbnail"],
  can_publish: true,
  can_delete: true,
  taxonomies: [{ name: "cm_genre", label: "Genres", hierarchical: false, can_add: true, rest_base: "" }],
  rest_base: "",
};
const PAGE_TYPE: PostType = { ...BOOK, name: "page", label: "Pages", singular: "Page", hierarchical: true, supports: [...BOOK.supports, "excerpt", "page-attributes"], taxonomies: [] };

const POST: Post = {
  id: 7,
  post_type: "page",
  title: "Menu",
  status: "draft",
  date: "2026-10-28 09:00:00",
  modified: "2026-10-28 09:05:00",
  link: "https://a.local/menu/",
  featured_image: 0,
  featured_url: null,
  terms: {},
  meta: {},
  builder: null,
  blocks: [
    { index: 0, name: "core/heading", depth: 0, editable: true, html: "Menu" },
    { index: 1, name: "core/image", depth: 0, editable: false, html: "The shop" },
    { index: 2, name: "core/paragraph", depth: 0, editable: true, html: "Bread daily." },
  ],
  locked: null,
  ...POST_FIELDS,
};

export const SHOP = { id: 9, title: "shop", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", mime: "image/jpeg", alt: "The shop", date: "", caption: "", description: "", file_name: "shop.jpg", author: "Joy", width: 0, height: 0, size: 0, thumb: "", usage: null };

function core(over: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "content_types":
        return [PAGE_TYPE, BOOK];
      case "content_list":
        return { posts: [{ id: 7, title: "Menu", status: "draft", date: "2026-10-28 09:00:00", modified: "2026-10-28 09:05:00", author: "Joy", link: "" }], total: 21, page: 1, pages: 2 };
      case "content_get":
        return POST;
      case "content_terms":
        return [{ id: 3, name: "Jazz" }];
      case "content_edit":
        return { ...POST, title: "Our menu" };
      case "media_list":
        return { items: [SHOP], total: 1, allowed: {}, limit: 0 };
      case "media_get":
        return { ...SHOP, usage: 2 };
      default:
        return null;
    }
  });
  return calls;
}

test("block labels, plain text to blocks, and which sites have content tools", () => {
  expect(blockLabel("core/list-item")).toBe("List item");
  expect(blockLabel("acme/map")).toBe("Map (acme)");
  expect(blockLabel("")).toBe("Text");
  expect(toBlocks("One <b>\n\n  Two\nlines  \n\n")).toBe(
    "<!-- wp:paragraph -->\n<p>One &lt;b&gt;</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Two<br>lines</p>\n<!-- /wp:paragraph -->",
  );
  expect(contentBlocked(CM)).toBeNull();
  expect(contentBlocked(OLD)).toContain("Update it");
  expect(contentBlocked(site({ mode: "basic", capabilities: {} }))).toBeNull();
  expect(contentBlocked(site({ sign_in_again: true }))).toBe("Sign in again first.");
});

test("lists a site's entries, pages through them, and says why an older site can't", async () => {
  const calls = core();
  render(<Content sites={[OLD, CM]} />);
  const table = await screen.findByRole("table", { name: "Pages" });
  expect(within(table).getByRole("button", { name: "Menu" })).toBeInTheDocument();
  expect(within(table).getByText("Draft")).toBeInTheDocument();
  expect(screen.getByText("1–1 of 21 pages")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(calls.at(-1)).toEqual(["content_list", { id: 1, query: { post_type: "page", page: 2 } }]));
  fireEvent.click(await screen.findByRole("button", { name: "Books" }));
  choose(screen.getByRole("combobox", { name: "Show" }), "trash");
  const box = screen.getByRole("searchbox", { name: "Search books" });
  fireEvent.change(box, { target: { value: " blue " } });
  // Enter in the box submits its form.
  fireEvent.submit(box.closest("form")!);
  await waitFor(() => expect(calls.at(-1)).toEqual(["content_list", { id: 1, query: { post_type: "cm_book", status: "trash", search: "blue", page: 1 } }]));
  choose(screen.getByRole("combobox", { name: "Site" }), "2");
  expect(await screen.findByText(/Classic Monks on this site is older/)).toBeInTheDocument();
});

test("a slow site's list never shows under the site picked after it", async () => {
  const GAMMA = site({ id: 3, name: "Gamma", capabilities: { operator: true, abilities: ["list-post-types"] } });
  let slow: (v: unknown) => void = () => {};
  const row = (title: string) => ({ posts: [{ id: 7, title, status: "draft", date: "", modified: "", author: "", link: "" }], total: 1, page: 1, pages: 1 });
  core({
    content_list: (a) => (a.id === 1 ? new Promise((r) => (slow = r)) : row("Gamma page")),
  });
  render(<Content sites={[CM, GAMMA]} />);
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("content_list", expect.objectContaining({ id: 1 })));
  choose(screen.getByRole("combobox", { name: "Site" }), "3");
  expect(await screen.findByRole("button", { name: "Gamma page" })).toBeInTheDocument();
  slow(row("Alpha page"));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("button", { name: "Alpha page" })).toBeNull();
  expect(screen.getByRole("button", { name: "Gamma page" })).toBeInTheDocument();
});

test("the editor changes only edited text blocks and keeps the others", async () => {
  const calls = core();
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  expect(await screen.findByRole("heading", { name: "Edit page on Alpha" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).toBeNull();
  const blocks = await screen.findByRole("list", { name: "Blocks" });
  expect(within(blocks).getByText("Kept as is")).toBeInTheDocument();
  expect(within(blocks).getAllByRole("textbox")).toHaveLength(2);
  const save = screen.getByRole("button", { name: "Save draft" });
  expect(save).toBeDisabled();
  fireEvent.change(within(blocks).getByRole("textbox", { name: "Paragraph 3" }), { target: { value: "Bread at <b>7</b>." } });
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Our menu" } });
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  fireEvent.click(save);
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_edit")?.[1]).toEqual({
      id: 1,
      postType: "page",
      postId: 7,
      draft: { title: "Our menu", status: "draft", edits: [{ index: 2, html: "Bread at <b>7</b>." }], seen_modified: "2026-10-28 09:05:00" },
    }),
  );
  expect(await screen.findByText('Saved "Our menu" on Alpha.')).toBeInTheDocument();
});

test("a classic body is edited whole; Ctrl+S saves and a changed entry offers the site's version", async () => {
  let n = 0;
  const calls = core({
    content_get: () => ({ ...POST, status: "publish", blocks: [{ index: 0, name: "", depth: 0, editable: true, html: "<p>Old</p>" }] }),
    content_edit: () => (n++ ? { ...POST, status: "publish" } : Promise.reject("This changed on the site after you opened it.")),
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const body = await screen.findByRole("textbox", { name: "Body" });
  expect(screen.queryByRole("list", { name: "Blocks" })).toBeNull();
  expect(screen.getByRole("button", { name: "Update" })).toBeDisabled();
  fireEvent.change(body, { target: { value: "<p>New</p>" } });
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  await waitFor(() => expect(calls.find((c) => c[0] === "content_edit")?.[1].draft).toEqual({ edits: [{ index: 0, html: "<p>New</p>" }], seen_modified: "2026-10-28 09:05:00" }));
  expect(await screen.findByText("This changed on the site after you opened it.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open the site's version" }));
  await waitFor(() => expect(calls.filter((c) => c[0] === "content_get")).toHaveLength(2));
});

test("nothing can be typed while a save is on its way, and focus comes back after", async () => {
  let done: (v: unknown) => void = () => {};
  core({ content_edit: () => new Promise((r) => (done = r)) });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  fireEvent.change(title, { target: { value: "Our menu" } });
  title.focus();
  fireEvent.keyDown(window, { key: "s", ctrlKey: true });
  const grid = title.closest(".ed-grid")!;
  await waitFor(() => expect(grid).toHaveAttribute("inert"));
  expect(grid).toHaveAttribute("aria-busy", "true");
  done({ ...POST, title: "Our menu" });
  await waitFor(() => expect(grid).not.toHaveAttribute("inert"));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus());
});

test("an open editor closes when its site leaves the list, and never opens the same id on the next site", async () => {
  const GAMMA = site({ id: 3, name: "Gamma", capabilities: { operator: true, abilities: ["list-post-types"] } });
  const calls = core();
  const view = render(<Content sites={[CM, GAMMA]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  expect(await screen.findByRole("heading", { name: "Edit page on Alpha" })).toBeInTheDocument();
  view.rerender(<Content sites={[GAMMA]} />);
  expect(await screen.findByRole("table", { name: "Pages" })).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("heading", { name: /^Edit page/ })).toBeNull();
  expect(calls.filter((c) => c[0] === "content_get").map((c) => c[1].id)).toEqual([1]);
});

test("leaving with unsaved changes asks first", async () => {
  core();
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "Our menu" } });
  fireEvent.click(screen.getByRole("button", { name: "Back to pages" }));
  const ask = screen.getByRole("dialog", { name: "Leave without saving?" });
  fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("Our menu");
  fireEvent.click(screen.getByRole("button", { name: "Back to pages" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave without saving" }));
  expect(await screen.findByRole("table", { name: "Pages" })).toBeInTheDocument();
});

test("slug, excerpt, author and page attributes go to the site only when changed", async () => {
  const calls = core({
    content_get: () => ({ ...POST, choices: { authors: [{ id: 1, name: "Joy" }, { id: 2, name: "Sam" }], parents: [{ id: 4, title: "Shop" }], templates: { "page-wide.php": "Wide" } } }),
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Slug" }), { target: { value: "our-menu" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Excerpt" }), { target: { value: "Bread." } });
  choose(screen.getByRole("combobox", { name: "Author" }), "2");
  choose(screen.getByRole("combobox", { name: "Parent" }), "4");
  choose(screen.getByRole("combobox", { name: "Template" }), "page-wide.php");
  fireEvent.click(screen.getByRole("radio", { name: "Password protected" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Password" }), { target: { value: "bread" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_edit")?.[1].draft).toEqual({
      status: "draft",
      excerpt: "Bread.",
      slug: "our-menu",
      password: "bread",
      author: 2,
      parent: 4,
      template: "page-wide.php",
      seen_modified: "2026-10-28 09:05:00",
    }),
  );
});

test("a builder page keeps its body; errors from the site are shown", async () => {
  core({
    content_get: () => ({ ...POST, builder: "elementor", blocks: [], locked: "This page is built with Elementor, so its body lives in Elementor." }),
    content_edit: () => Promise.reject("The site said no."),
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  expect(await screen.findByText(/built with Elementor/)).toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Blocks" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Body" })).toBeNull();
  choose(screen.getByRole("combobox", { name: "Status" }), "pending");
  fireEvent.click(screen.getByRole("button", { name: "Save as pending" }));
  expect(await screen.findByText("The site said no.")).toBeInTheDocument();
});

test("a new entry gets its body, terms by name and a featured image", async () => {
  const calls = core({ content_create: () => ({ ...POST, title: "Kind of Blue", status: "draft" }) });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Books" }));
  fireEvent.click(await screen.findByRole("button", { name: "New book" }));
  expect(await screen.findByRole("heading", { name: "New book on Alpha" })).toBeInTheDocument();
  const add = screen.getByRole("button", { name: "Save draft" });
  fireEvent.click(add);
  expect(await screen.findByText("Give it a title first.")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Kind of Blue" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Body" }), { target: { value: "<p>Modal jazz.</p>" } });
  const genre = screen.getByRole("combobox", { name: "Add to Genres" });
  for (const name of ["jazz", "Cool"]) {
    fireEvent.change(genre, { target: { value: name } });
    fireEvent.keyDown(genre, { key: "Enter" });
  }
  await waitFor(() => expect(screen.getByText("(new)", { exact: false })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Choose an image" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use shop" }));
  expect(screen.getByRole("img", { name: "The featured image" })).toBeInTheDocument();
  fireEvent.click(add);
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_create")?.[1]).toEqual({
      id: 1,
      postType: "cm_book",
      draft: { title: "Kind of Blue", status: "draft", body: "<p>Modal jazz.</p>", featured_image: 9, terms: { cm_genre: [3, "Cool"] } },
    }),
  );
  expect(await screen.findByText('Added "Kind of Blue" to Alpha as draft.')).toBeInTheDocument();
});

test("existing terms only, when new ones can't be added; trash asks first", async () => {
  const calls = core({ content_types: () => [{ ...BOOK, taxonomies: [{ ...BOOK.taxonomies[0], can_add: false }] }], content_get: () => ({ ...POST, post_type: "cm_book", terms: { cm_genre: [{ id: 3, name: "Jazz" }] } }) });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const genre = await screen.findByRole("combobox", { name: "Add to Genres" });
  fireEvent.change(genre, { target: { value: "Polka" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByText("Pick one of the existing genres.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove Jazz" }));
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Move to the trash" }));
  const ask = screen.getByRole("dialog");
  expect(within(ask).getByText(/WordPress keeps it there for 30 days/)).toBeInTheDocument();
  fireEvent.click(within(ask).getByRole("button", { name: "Move it to the trash" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_trash")).toBe(true));
  expect(await screen.findByText('Moved "Menu" to the trash on Alpha.')).toBeInTheDocument();
});

test("Media lists images with their alt text and imports one from a link", async () => {
  const calls = core({ media_import: (a) => (String(a.url).includes("bad") ? Promise.reject("That link isn't an image.") : { ...SHOP, id: 10, title: "dot", alt: "" }) });
  render(<Media sites={[CM]} />);
  const details = await screen.findByRole("form", { name: "Details of shop" });
  expect(within(details).getByRole("textbox", { name: "Alt text" })).toHaveValue("The shop");
  fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
  const form = within(screen.getByRole("form", { name: "Import an image" }));
  const link = form.getByRole("textbox", { name: "Image link" });
  fireEvent.change(link, { target: { value: "https://x.test/bad.html" } });
  fireEvent.click(form.getByRole("button", { name: "Import the image" }));
  expect(await screen.findByText("That link isn't an image.")).toBeInTheDocument();
  fireEvent.change(link, { target: { value: "https://x.test/dot.png" } });
  fireEvent.change(form.getByRole("textbox", { name: "Alt text" }), { target: { value: "A dot" } });
  fireEvent.click(form.getByRole("button", { name: "Import the image" }));
  expect(await screen.findByText("Added dot to Alpha's media library.")).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_import" && c[1].alt === "A dot")).toBeTruthy();
});
