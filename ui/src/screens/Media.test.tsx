// SPDX-License-Identifier: GPL-3.0-or-later
// The media manager: upload several files with their details, progress and Stop; change details with Undo;
// replace a file and undo it; filters and the list view; bulk trash with Undo; the picker's upload.
import { render as draw, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Media } from "./Media";
import { MediaPicker, refusal, fileSize } from "../components/MediaPicker";
import { site, choose } from "../test-fixtures";
import type { Library, Media as Item } from "../api";
import { HeadSlot } from "../components/ui";
import type { ReactElement, ReactNode } from "react";

// The page head's action slot, as App gives it: Upload files renders there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);
afterEach(() => mockInvoke.mockReset());

const TOOLS = ["list-post-types", "get-media", "upload-media", "update-media", "replace-media", "restore-replaced-media", "trash-media", "restore-media"];
const CM = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: TOOLS } });
const BASIC = site({ id: 2, name: "Beta", mode: "basic", capabilities: {} });

const item = (id: number, title: string, over: Partial<Item> = {}): Item => ({
  id,
  title,
  url: `https://a.test/wp-content/uploads/2026/10/${title}.jpg`,
  mime: "image/jpeg",
  alt: "",
  date: "2026-10-20 08:00:00",
  caption: "",
  description: "",
  file_name: `${title}.jpg`,
  author: "Joy",
  width: 800,
  height: 600,
  size: 120_000,
  thumb: "",
  usage: null,
  ...over,
});

function core(over: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  let items = [item(5, "door", { alt: "A red door" }), item(4, "menu", { mime: "application/pdf", width: 0, height: 0, file_name: "menu.pdf" })];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "media_list":
        return { items, total: items.length, allowed: { "jpg|jpeg|jpe": "image/jpeg", pdf: "application/pdf" }, limit: 1_000_000 } satisfies Library;
      case "media_get":
        return { ...items.find((m) => m.id === a.mediaId), usage: 3 };
      case "media_upload": {
        const m = item(10 + items.length, String(a.name).replace(/\..*/, ""), { alt: (a.details as { alt: string }).alt });
        items = [m, ...items];
        return m;
      }
      case "media_update":
        items = items.map((m) => (m.id === a.mediaId ? { ...m, ...(a.details as object) } : m));
        return items.find((m) => m.id === a.mediaId);
      case "media_replace":
      case "media_restore_file":
        return items.find((m) => m.id === a.mediaId);
      case "media_trash":
        return { done: a.ids, skipped: [] };
      default:
        return null;
    }
  });
  return calls;
}

const jpg = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: "image/jpeg" });

test("files are checked against the site's limit and types before they go", () => {
  const lib: Library = { items: [], total: 0, allowed: { "jpg|jpeg|jpe": "image/jpeg" }, limit: 100 };
  expect(refusal(jpg("a.JPG"), lib)).toBeNull();
  expect(refusal(jpg("a.jpg", 101), lib)).toBe("It's over the 100 bytes limit.");
  expect(refusal(new File(["x"], "a.exe"), lib)).toBe("This site doesn't take .exe files.");
  expect(refusal(new File([], "a.jpg"), lib)).toBe("This file is empty.");
  // Basic mode: no list of types, the core's own 256 MB cap.
  expect(refusal(new File(["x"], "a.exe"), null)).toBeNull();
  expect(fileSize(64 * 1024 * 1024)).toBe("64 MB");
  expect(fileSize(1536)).toBe("2 KB");
});

test("uploads several files one after another with their alt text, and Stop ends one", async () => {
  const heard: ((e: { payload: unknown }) => void)[] = [];
  mockListen.mockImplementation(async (ev, f) => {
    if (ev === "media-progress") heard.push(f as (typeof heard)[0]);
    return () => {};
  });
  let release: () => void = () => {};
  const calls = core({
    media_upload: (a) =>
      a.name === "slow.jpg"
        ? new Promise((_, no) => {
            release = () => no("Stopped. Nothing was added.");
          })
        : item(20, String(a.name).replace(/\..*/, ""), { alt: (a.details as { alt: string }).alt }),
  });
  render(<Media sites={[CM]} />);
  await screen.findByRole("form", { name: "Details of door" });
  fireEvent.click(screen.getByRole("button", { name: "Upload files" }));
  const list = () => within(screen.getByRole("list", { name: "Files to upload" }));
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [jpg("cake.jpg"), jpg("slow.jpg"), new File(["x"], "virus.exe")] } });
  expect(list().getByText("This site doesn't take .exe files.")).toBeInTheDocument();
  fireEvent.change(list().getAllByRole("textbox", { name: "Alt text" })[0], { target: { value: "A birthday cake" } });
  fireEvent.click(screen.getByRole("button", { name: "Upload 2 files" }));
  await waitFor(() => expect(list().getByText("Uploaded")).toBeInTheDocument());
  const sent = calls.find((c) => c[0] === "media_upload")![1];
  expect(sent).toMatchObject({ id: 1, name: "cake.jpg", details: { alt: "A birthday cake", title: "cake", caption: "" } });
  expect(typeof sent.data).toBe("string");
  // The second is under way: its bar follows the progress events, and Stop reaches the core.
  const key = await waitFor(() => calls.find((c) => c[0] === "media_upload" && c[1].name === "slow.jpg")![1].key as string);
  act(() => heard.forEach((f) => f({ payload: { key, sent: 5, total: 10 } })));
  expect(list().getByRole("progressbar", { name: "Uploading slow.jpg" })).toHaveAttribute("aria-valuenow", "5");
  fireEvent.click(list().getByRole("button", { name: "Stop" }));
  expect(calls.find((c) => c[0] === "media_stop")?.[1]).toEqual({ key });
  act(() => release());
  expect(await list().findByText("Stopped")).toBeInTheDocument();
  expect(await screen.findByText("Uploaded 1 file to Alpha.")).toBeInTheDocument();
  // Nothing left to send: no "Upload 0 files".
  expect(screen.queryByRole("button", { name: /^Upload \d/ })).not.toBeInTheDocument();
  mockListen.mockImplementation(() => Promise.resolve(() => {}));
});

test("details save only what changed, with an Undo that puts the earlier text back", async () => {
  const calls = core();
  render(<Media sites={[CM]} />);
  const form = await screen.findByRole("form", { name: "Details of door" });
  expect(await screen.findByText("3 posts and pages")).toBeInTheDocument();
  expect(screen.getByText("800 × 600 pixels")).toBeInTheDocument();
  const save = within(form).getByRole("button", { name: "Save" });
  expect(save).toBeDisabled();
  fireEvent.change(within(form).getByRole("textbox", { name: "Alt text" }), { target: { value: "A blue door" } });
  fireEvent.change(within(form).getByRole("textbox", { name: "Caption" }), { target: { value: "Our door" } });
  fireEvent.click(save);
  expect(await screen.findByText("Saved the details of door.")).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_update")?.[1]).toEqual({ id: 1, mediaId: 5, details: { alt: "A blue door", caption: "Our door" } });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Put the earlier details of door back.")).toBeInTheDocument();
  expect(calls.filter((c) => c[0] === "media_update")[1][1]).toEqual({ id: 1, mediaId: 5, details: { alt: "A red door", caption: "" } });
});

test("replace keeps the address unless asked, then Undo the replace puts the earlier file back", async () => {
  const calls = core();
  render(<Media sites={[CM]} />);
  await screen.findByRole("form", { name: "Details of door" });
  fireEvent.click(screen.getByRole("checkbox", { name: /Use the new file's name/ }));
  fireEvent.change(screen.getByLabelText("Choose the new file"), { target: { files: [jpg("door-2.jpg")] } });
  expect(await screen.findByText("Replaced the file of door. Its address stays the same.")).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_replace")?.[1]).toMatchObject({ id: 1, mediaId: 5, name: "door-2.jpg", keepName: true });
  // The preview asks for the new pixels at the same address.
  await waitFor(() => expect(screen.getByRole("img", { name: "A red door" }).getAttribute("src")).toMatch(/door\.jpg\?v=\d+$/));
  fireEvent.click(screen.getByRole("button", { name: "Undo the replace" }));
  expect(await screen.findByText("Put the earlier file of door back.")).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_restore_file")?.[1]).toEqual({ id: 1, mediaId: 5 });
  expect(screen.queryByRole("button", { name: "Undo the replace" })).toBeNull();
});

test("filters, the list view, and bulk trash with Undo", async () => {
  const calls = core();
  render(<Media sites={[CM]} />);
  await screen.findByRole("form", { name: "Details of door" });
  choose(screen.getByRole("combobox", { name: "Type" }), "application");
  await waitFor(() => expect(calls.some((c) => c[0] === "media_list" && (c[1].query as { kind: string }).kind === "application")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "List" }));
  const table = await screen.findByRole("table", { name: "Alpha media" });
  expect(within(table).getByText("menu.pdf")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Change the ticked items" })).not.toBeInTheDocument();
  fireEvent.click(within(table).getByRole("checkbox", { name: "Tick every item shown" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to the trash (2)" }));
  expect(await screen.findByText(/^Moved 2 items to the trash on Alpha/)).toBeInTheDocument();
  expect(calls.find((c) => c[0] === "media_trash")?.[1]).toEqual({ id: 1, ids: [5, 4], back: false });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Brought 2 items back from the trash.")).toBeInTheDocument();
  expect(calls.filter((c) => c[0] === "media_trash")[1][1]).toEqual({ id: 1, ids: [5, 4], back: true });
  localStorage.removeItem("mc-media-view");
});

test("Basic mode edits details but says why it can't replace or trash", async () => {
  core();
  render(<Media sites={[BASIC]} />);
  await screen.findByRole("form", { name: "Details of door" });
  expect(screen.getByText("Replacing files needs the WP Sites HQ plugin, Classic Monks or Classic Monks Pro on the site. This site is in Basic mode.")).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Change the ticked items" })).toBeNull();
  expect(screen.queryByText("Used in")).toBeNull();
});

test("a slow site's library never shows under the site picked after it", async () => {
  let slow: (v: unknown) => void = () => {};
  const lib = (items: Item[]) => ({ items, total: items.length, allowed: {}, limit: 1_000_000 });
  core({ media_list: (a) => (a.id === 1 ? new Promise((r) => (slow = r)) : lib([item(9, "beta-photo")])) });
  render(<Media sites={[CM, BASIC]} />);
  await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("media_list", expect.objectContaining({ id: 1 })));
  choose(screen.getByRole("combobox", { name: "Site" }), "2");
  expect(await screen.findByRole("form", { name: "Details of beta-photo" })).toBeInTheDocument();
  slow(lib([item(5, "door")]));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("form", { name: "Details of door" })).toBeNull();
  expect(screen.getByRole("form", { name: "Details of beta-photo" })).toBeInTheDocument();
});

test("Load more adds the next page and the count says so out loud", async () => {
  const page = (p: number) => ({ items: p === 1 ? [item(1, "first")] : [item(2, "second")], total: 2, allowed: {}, limit: 1_000_000 });
  core({ media_list: (a) => page((a.query as { page: number }).page ?? 1) });
  render(<Media sites={[CM]} />);
  const count = await screen.findByText("1 of 2 items");
  expect(count).toHaveAttribute("aria-live", "polite");
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("2 of 2 items")).toHaveAttribute("aria-live", "polite");
});

test("the picker keeps only the newest search's answer", async () => {
  let slow: (v: unknown) => void = () => {};
  const lib = (items: Item[]) => ({ items, total: items.length, allowed: {}, limit: 1_000_000 });
  core({ media_list: (a) => ((a.query as { search: string }).search === "" ? new Promise((r) => (slow = r)) : lib([item(9, "cake")])) });
  render(<MediaPicker site={CM} onPick={() => {}} onCancel={() => {}} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cake" } });
  fireEvent.submit(screen.getByRole("search"));
  expect(await screen.findByRole("button", { name: "Use cake" })).toBeInTheDocument();
  slow(lib([item(5, "door")]));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.queryByRole("button", { name: "Use door" })).toBeNull();
});

test("the picker uses a library image, or uploads a new one and uses it", async () => {
  const calls = core();
  const pick = vi.fn();
  render(<MediaPicker site={CM} onPick={pick} onCancel={() => {}} />);
  fireEvent.click(await screen.findByRole("button", { name: "Use door" }));
  expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ id: 5 }));
  await waitFor(() => expect(calls.find((c) => c[0] === "media_list")?.[1]).toEqual({ id: 1, query: { page: 1, search: "", kind: "image" } }));
  fireEvent.change(screen.getByLabelText("Upload a new image"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
  expect(screen.getByText("Choose an image file.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Upload a new image"), { target: { files: [jpg("cake.jpg")] } });
  fireEvent.change(screen.getByRole("textbox", { name: "Alt text" }), { target: { value: "A cake" } });
  fireEvent.click(screen.getByRole("button", { name: "Upload and use it" }));
  await waitFor(() => expect(pick).toHaveBeenLastCalledWith(expect.objectContaining({ title: "cake", alt: "A cake" })));
});

test("the picker says out loud when the library can't be read", async () => {
  core({ media_list: () => Promise.reject("The site didn't answer.") });
  render(<MediaPicker site={CM} onPick={() => {}} onCancel={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("The site didn't answer.");
});
