// SPDX-License-Identifier: GPL-3.0-or-later
// ACF in the editor: a control from the kit for every field type, ACF's rules before saving, its
// messages under the fields they name, and Undo for a save.
import { render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useState, type ReactElement, type ReactNode } from "react";
import { AcfGroups, acfErrors, fromYmd, invalid, toYmd, type Acf, type AcfField } from "./AcfFields";
import { Content } from "./Content";
import { ACF_FIELDS } from "../../e2e/acf-fixture";
import { site, POST_FIELDS } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import type { Post, PostType } from "../api";

const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("../components/RichText", async (orig) => ({ ...(await orig<object>()), ...(await import("../test-fixtures")).richTextStandIn }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());
// The pickers' lookups: no users or terms beyond the ones the fields hold.
const lookups = (cmd: string) => (cmd === "users_list" ? { users: [], total: 0, page: 1, pages: 1 } : cmd === "content_terms" || cmd === "content_list" ? [] : null);

const FIELDS = ACF_FIELDS as unknown as AcfField[];
const ACF: Acf = { post_id: 7, groups: [{ key: "group_t", title: "Monks test fields", fields: FIELDS }], refs: { media: {}, posts: {}, terms: {}, users: {} } };
const field = (type: string) => FIELDS.find((f) => f.type === type)!;
const CM = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: ["list-post-types", "get-post-meta", "get-acf-fields", "update-acf-fields"] } });
const POSTS: PostType = { name: "post", label: "Posts", singular: "Post", hierarchical: false, supports: ["title", "editor"], can_publish: true, can_delete: true, taxonomies: [], rest_base: "" };
const POST: Post = { id: 7, post_type: "post", title: "Fields", status: "publish", date: "2026-10-28 09:00:00", modified: "2026-10-28 09:05:00", link: "", featured_image: 0, featured_url: null, terms: {}, meta: { [field("email").name]: "a@b.co", chef: "Ana", tags: 'a:1:{i:0;s:1:"x";}' }, builder: null, blocks: [], locked: null, ...POST_FIELDS };

test("ACF's dates, rules and messages", () => {
  expect(fromYmd("20261028")).toBe("2026-10-28");
  expect(fromYmd("")).toBe("");
  expect(toYmd("2026-10-28")).toBe("20261028");
  expect(invalid(field("text"), "")).toBe("Text is required.");
  expect(invalid(field("email"), "a@")).toContain("is not an email address");
  expect(invalid(field("email"), "a@b.co")).toBeNull();
  expect(invalid(field("url"), "example.com")).toContain("https://");
  expect(invalid(field("number"), "11")).toBe("Number must be 10 or less.");
  expect(invalid(field("number"), "0")).toBe("Number must be 1 or more.");
  expect(invalid(field("flexible_content"), "")).toBeNull();
  const { byKey, rest } = acfErrors(ACF, "Email: 'a@' is not a valid email address\nSomething else went wrong.");
  expect(byKey).toEqual({ [field("email").key]: "Email: 'a@' is not a valid email address" });
  expect(rest).toEqual(["Something else went wrong."]);
});

test("every editable field has a labelled control from the kit, and the others say where to edit them", () => {
  mockInvoke.mockImplementation(async (cmd: string) => lookups(cmd));
  const { container } = render(<AcfGroups acf={ACF} values={{}} errors={{ [field("email").key]: "Email: wrong." }} site={CM} editUrl="https://a.test/wp-admin/post.php?post=7&action=edit" onChange={() => {}} />);
  const card = screen.getByRole("region", { name: "Monks test fields" });
  for (const f of FIELDS.filter((f) => f.editable && !["checkbox", "radio", "button_group", "group", "repeater", "link", "image", "file", "gallery"].includes(f.type))) {
    expect(within(card).getAllByLabelText(f.label, { exact: false }).length, f.type).toBeGreaterThan(0);
  }
  expect(within(card).getAllByRole("button", { name: /Edit in WordPress/ }).length).toBe(FIELDS.filter((f) => !f.editable).length);
  expect(within(card).getByRole("alert")).toHaveTextContent("Email: wrong.");
  expect(within(card).getByRole("textbox", { name: "Email" })).toHaveAttribute("aria-invalid", "true");
  // No native pickers: dates, colours and lists come from the control kit.
  expect(container.querySelector('select, input[type="date"], input[type="datetime-local"], input[type="time"], input[type="color"], input[type="number"], datalist')).toBeNull();
});

test("the editor checks ACF's rules first, saves the fields, and Undo puts them back", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (cmd === "content_types") return [POSTS];
    if (cmd === "users_list" || cmd === "content_terms") return lookups(cmd);
    if (cmd === "content_list") return { posts: [{ id: 7, title: "Fields", status: "publish", date: "", modified: "", author: "", link: "" }], total: 1, page: 1, pages: 1 };
    if (cmd === "content_get") return POST;
    if (cmd === "content_acf") return ACF;
    if (cmd === "content_acf_save") return String((a.fields as Record<string, unknown>)[field("email").key]).endsWith(".bad") ? Promise.reject("Email: 'x@y.bad' is not allowed") : { values: a.fields, undo: 77 };
    return null;
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Fields" }));
  const mail = await screen.findByRole("textbox", { name: "Email" });
  // The ACF group owns its keys, and a serialized value is never offered as text.
  const fields = screen.getByRole("group", { name: "Custom fields" });
  expect(within(fields).getByRole("textbox", { name: "chef" })).toHaveValue("Ana");
  expect(within(fields).queryByText(field("email").name)).toBeNull();
  expect(within(fields).getByText("kept as is (not plain text)")).toBeInTheDocument();
  fireEvent.change(mail, { target: { value: "x@" } });
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(await screen.findByText(/Nothing was saved. Fix the ACF field marked in red/)).toBeInTheDocument();
  expect(calls.some((c) => c[0] === "content_acf_save")).toBe(false);
  fireEvent.change(mail, { target: { value: "x@y.bad" } });
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(await screen.findByText("Email: 'x@y.bad' is not allowed", { selector: "small" })).toBeInTheDocument();
  fireEvent.change(mail, { target: { value: "x@y.co" } });
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  await waitFor(() => expect(calls.find((c) => c[0] === "content_acf_save" && c[1].fields && (c[1].fields as Record<string, unknown>)[field("email").key] === "x@y.co")?.[1]).toEqual({ id: 1, postId: 7, fields: { [field("email").key]: "x@y.co" } }));
  expect(calls.some((c) => c[0] === "content_edit")).toBe(false);
  // After Undo every ACF editor shows the site's values again, a wysiwyg (which reads its text once) too.
  const words = screen.getByRole("textbox", { name: "Wysiwyg" });
  fireEvent.change(words, { target: { value: "typed after the save" } });
  fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
  await waitFor(() => expect(calls.find((c) => c[0] === "cm_undo")?.[1]).toEqual({ id: 1, row: 77 }));
  expect(await screen.findByText("The ACF fields are back as they were.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Wysiwyg" })).toHaveValue(String(field("wysiwyg").value)));
});

test("a repeater row's editors move with the row, and Remove takes that row's text away", async () => {
  const sub = (key: string, type: string, label: string): AcfField => ({ key, name: key, label, type, instructions: "", required: false, editable: true, settings: {} });
  const rep: AcfField = { ...sub("field_r", "repeater", "Notes"), sub_fields: [sub("field_w", "wysiwyg", "Words")] };
  const acf: Acf = { post_id: 7, groups: [{ key: "g", title: "Rows", fields: [{ ...rep, value: [{ field_w: "First" }, { field_w: "Second" }] }] }], refs: { media: {}, posts: {}, terms: {}, users: {} } };
  let last: unknown = null;
  const Host = () => {
    const [values, setValues] = useState<Record<string, unknown>>({});
    return <AcfGroups acf={acf} values={values} errors={{}} site={CM} editUrl="" onChange={(k, v) => (setValues({ ...values, [k]: v }), (last = v))} />;
  };
  render(<Host />);
  const words = () => screen.getAllByRole("textbox", { name: "Words" }).map((t) => (t as HTMLTextAreaElement).value);
  expect(words()).toEqual(["First", "Second"]);
  fireEvent.click(screen.getAllByRole("button", { name: "Move down" })[0]);
  expect(words()).toEqual(["Second", "First"]);
  fireEvent.change(screen.getAllByRole("textbox", { name: "Words" })[0], { target: { value: "Second, edited" } });
  expect(last).toEqual([{ field_w: "Second, edited" }, { field_w: "First" }]);
  fireEvent.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(words()).toEqual(["First"]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Add a row" })).toHaveFocus());
});

test("an ACF field changed on the site since it opened is not overwritten", async () => {
  const calls: string[] = [];
  let reads = 0;
  const changed: Acf = { ...ACF, groups: [{ ...ACF.groups[0], fields: FIELDS.map((f) => (f.type === "email" ? { ...f, value: "someone@else.co" } : f)) }] };
  mockInvoke.mockImplementation(async (cmd: string) => {
    calls.push(cmd);
    if (cmd === "content_types") return [POSTS];
    if (cmd === "content_list") return { posts: [{ id: 7, title: "Fields", status: "publish", date: "", modified: "", author: "", link: "" }], total: 1, page: 1, pages: 1 };
    if (cmd === "content_get") return POST;
    if (cmd === "content_acf") return reads++ ? changed : ACF;
    return lookups(cmd);
  });
  render(<Content sites={[CM]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Fields" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), { target: { value: "me@here.co" } });
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(await screen.findByText("An ACF field was changed on the site after you opened it, so the ACF fields were not saved.")).toBeInTheDocument();
  expect(calls).not.toContain("content_acf_save");
  fireEvent.click(screen.getByRole("button", { name: "Open the site's version" }));
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("someone@else.co"));
});
