// Content (list, editor with block-safe body, terms, featured image, trash) and Media.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Content } from "./Content";
import { blockLabel, toBlocks } from "./Editor";
import { Media } from "./Media";
import { site } from "../test-fixtures";
import { contentBlocked, type Post, type PostType } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
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
const PAGE_TYPE: PostType = { ...BOOK, name: "page", label: "Pages", singular: "Page", taxonomies: [] };

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
};

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
        return [{ id: 9, title: "shop", url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", mime: "image/jpeg", alt: "The shop", date: "" }];
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
  expect(screen.getByText("Page 1 of 2, 21 entries")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  await waitFor(() => expect(calls.at(-1)).toEqual(["content_list", { id: 1, query: { post_type: "page", page: 2 } }]));
  fireEvent.click(await screen.findByRole("button", { name: "Books" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Show" }), { target: { value: "trash" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Search books" }), { target: { value: " blue " } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(calls.at(-1)).toEqual(["content_list", { id: 1, query: { post_type: "cm_book", status: "trash", search: "blue", page: 1 } }]));
  fireEvent.change(screen.getByRole("combobox", { name: "Site" }), { target: { value: "2" } });
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
  fireEvent.change(screen.getByRole("combobox", { name: "Site" }), { target: { value: "3" } });
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
  const sheet = await screen.findByRole("dialog", { name: "Edit page on Alpha" });
  const blocks = await within(sheet).findByRole("list", { name: "Blocks" });
  expect(within(blocks).getByText("Kept as is")).toBeInTheDocument();
  expect(within(blocks).getAllByRole("textbox")).toHaveLength(2);
  const save = within(sheet).getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  fireEvent.change(within(blocks).getByRole("textbox", { name: "Paragraph 3" }), { target: { value: "Bread at 7." } });
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Title" }), { target: { value: "Our menu" } });
  fireEvent.click(save);
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_edit")?.[1]).toEqual({
      id: 1,
      postType: "page",
      postId: 7,
      draft: { title: "Our menu", edits: [{ index: 2, html: "Bread at 7." }], seen_modified: "2026-10-28 09:05:00" },
    }),
  );
  expect(await screen.findByText('Saved "Our menu" on Alpha.')).toBeInTheDocument();
});

test("a builder page keeps its body; errors from the site are shown", async () => {
  core({
    content_get: () => ({ ...POST, builder: "elementor", blocks: [], locked: "This page is built with Elementor, so its body lives in Elementor." }),
    content_edit: () => Promise.reject("This changed on the site after you opened it."),
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  expect(await within(sheet).findByText(/built with Elementor/)).toBeInTheDocument();
  expect(within(sheet).queryByRole("list", { name: "Blocks" })).toBeNull();
  fireEvent.change(within(sheet).getByRole("combobox", { name: "Status" }), { target: { value: "publish" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Save changes" }));
  expect(await within(sheet).findByRole("alert")).toHaveTextContent("changed on the site");
});

test("a new entry gets paragraph blocks, terms by name and a featured image", async () => {
  const calls = core({ content_create: () => ({ ...POST, title: "Kind of Blue", status: "draft" }) });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Books" }));
  fireEvent.click(await screen.findByRole("button", { name: "New book" }));
  const sheet = await screen.findByRole("dialog", { name: "New book on Alpha" });
  const add = within(sheet).getByRole("button", { name: "Add the book" });
  expect(add).toBeDisabled();
  fireEvent.change(within(sheet).getByRole("textbox", { name: "Title" }), { target: { value: "Kind of Blue" } });
  fireEvent.change(within(sheet).getByRole("textbox", { name: /^Text/ }), { target: { value: "Modal jazz." } });
  const genre = within(sheet).getByRole("combobox", { name: "Add to Genres" });
  for (const name of ["jazz", "Cool"]) {
    fireEvent.change(genre, { target: { value: name } });
    fireEvent.keyDown(genre, { key: "Enter" });
  }
  await waitFor(() => expect(within(sheet).getByText("(new)", { exact: false })).toBeInTheDocument());
  fireEvent.click(within(sheet).getByRole("button", { name: "Choose an image" }));
  fireEvent.click(await within(sheet).findByRole("button", { name: "Use shop" }));
  expect(within(sheet).getByRole("img", { name: "The featured image" })).toBeInTheDocument();
  fireEvent.click(add);
  await waitFor(() =>
    expect(calls.find((c) => c[0] === "content_create")?.[1]).toEqual({
      id: 1,
      postType: "cm_book",
      draft: { title: "Kind of Blue", status: "draft", body: "<!-- wp:paragraph -->\n<p>Modal jazz.</p>\n<!-- /wp:paragraph -->", featured_image: 9, terms: { cm_genre: [3, "Cool"] } },
    }),
  );
  expect(await screen.findByText('Added "Kind of Blue" to Alpha as draft.')).toBeInTheDocument();
});

test("existing terms only, when new ones can't be added; trash asks first", async () => {
  const calls = core({ content_types: () => [{ ...BOOK, taxonomies: [{ ...BOOK.taxonomies[0], can_add: false }] }], content_get: () => ({ ...POST, post_type: "cm_book", terms: { cm_genre: [{ id: 3, name: "Jazz" }] } }) });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Menu" }));
  const sheet = await screen.findByRole("dialog");
  const genre = await within(sheet).findByRole("combobox", { name: "Add to Genres" });
  fireEvent.change(genre, { target: { value: "Polka" } });
  fireEvent.click(within(sheet).getByRole("button", { name: "Add" }));
  expect(within(sheet).getByText("Pick one of the existing genres.")).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Remove Jazz" }));
  expect(within(sheet).getByRole("button", { name: "Save changes" })).toBeEnabled();
  fireEvent.click(within(sheet).getByRole("button", { name: "Move to the trash" }));
  expect(within(sheet).getByText(/WordPress keeps it there for 30 days/)).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole("button", { name: "Move it to the trash" }));
  await waitFor(() => expect(calls.some((c) => c[0] === "content_trash")).toBe(true));
  expect(await screen.findByText('Moved "Menu" to the trash on Alpha.')).toBeInTheDocument();
});

test("Media lists images with their alt text and imports one from a link", async () => {
  const calls = core({ media_import: (a) => (String(a.url).includes("bad") ? Promise.reject("That link isn't an image.") : { id: 10, title: "dot", url: "", mime: "image/png", alt: "", date: "" }) });
  render(<Media sites={[CM]} />);
  expect(await screen.findByText("The shop")).toBeInTheDocument();
  const link = screen.getByRole("textbox", { name: "Image link" });
  fireEvent.change(link, { target: { value: "https://x.test/bad.html" } });
  fireEvent.click(screen.getByRole("button", { name: "Import the image" }));
  expect(await screen.findByText("That link isn't an image.")).toBeInTheDocument();
  fireEvent.change(link, { target: { value: "https://x.test/dot.png" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Alt text" }), { target: { value: "A dot" } });
  fireEvent.click(screen.getByRole("button", { name: "Import the image" }));
  expect(await screen.findByText("Added dot to Alpha's media library.")).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_import" && c[1].alt === "A dot")).toBeTruthy();
});
