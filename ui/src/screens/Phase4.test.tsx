// SPDX-License-Identifier: GPL-3.0-or-later
// Users, the comment inbox and Classic Monks (features, settings, activity, approvals).
import { act, render as draw, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Users } from "./Users";
import { Comments, plainText } from "./Comments";
import { ClassicMonks, targetOf, toolLabel, whoOf } from "./ClassicMonks";
import { site, choose } from "../test-fixtures";
import { HeadSlot } from "../components/ui";
import { cmBlocked, peopleBlocked, type Comment, type User } from "../api";
import { leaveGuard } from "../fleet";

// The page head's action slot, as App gives it: the screen's main actions render there.
const head = document.body.appendChild(document.createElement("div"));
const InHead = ({ children }: { children: ReactNode }) => <HeadSlot.Provider value={head}>{children}</HeadSlot.Provider>;
const render = (ui: ReactElement) => draw(ui, { wrapper: InHead });

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const TOOLS = ["get-users", "create-user", "update-user", "delete-user", "send-password-reset", "get-comments", "moderate-comment", "reply-to-comment", "get-features", "update-features", "get-settings-schema", "get-settings", "update-settings", "list-ai-activity", "undo-operation", "list-pending-approvals"];
const CM = site({ id: 1, name: "Alpha", capabilities: { operator: true, abilities: TOOLS } });
const BASIC = site({ id: 2, name: "Beta", mode: "basic", capabilities: {} });
const OLD = site({ id: 3, name: "Older", capabilities: { operator: true, abilities: ["get-posts"] } });

const user = (id: number, username: string, role: string): User => ({ id, username, email: `${username}@x.test`, name: username.toUpperCase(), role, registered: "" });
const comment = (id: number, author: string, date: string): Comment => ({ id, post_id: 4, post_title: "Bread", author, email: "", content: "Nice <b>loaf</b> &amp; jam", date, status: "pending", parent: 0 });
const ROLES = [
  { id: "administrator", name: "Administrator" },
  { id: "editor", name: "Editor" },
  { id: "subscriber", name: "Subscriber" },
];

function core(over: Record<string, (args: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "users_list":
        return a.id === 1
          ? { users: [user(1, "joy", "administrator"), user(2, "sam", "editor")], total: 60, roles: ROLES, can_reset: true }
          : { users: [user(1, "admin", "administrator")], total: 1, roles: ROLES, can_reset: false };
      case "comments_list":
        return a.id === 1 ? { comments: [comment(5, "Ana", "2026-10-27 10:00:00")], total: 1 } : { comments: [comment(6, "Bo", "2026-10-28 10:00:00")], total: 3 };
      case "cm_controls":
        return {
          on: 1,
          total: 3,
          tabs: [
            {
              key: "performance",
              label: "Performance",
              subtabs: [
                {
                  key: "m",
                  label: "Media",
                  description: "Uploads and image sizes.",
                  cards: [
                    {
                      title: "Media Enhancements",
                      toggles: [{ name: "enable_svg", label: "SVG Support", description: "", on: false, locked: false }],
                      settings: [{ name: "auto_q", label: "Image Quality", description: "", control: "number", options: [], min: 1, max: 100, step: 1, value: 82 }],
                      elsewhere: 2,
                    },
                  ],
                },
              ],
            },
            {
              key: "security",
              label: "Security",
              subtabs: [{ key: "p", label: "Protection", description: "", cards: [{ title: "Logins", toggles: [{ name: "enable_lock", label: "Login Lockdown", description: "Blocks bad logins.", on: true, locked: true }], settings: [], elsewhere: 0 }] }],
            },
          ],
        };
      case "cm_set_feature":
        return 42;
      case "cm_set_setting":
        return null;
      case "cm_activity":
        return { rows: [{ id: 9, time: "2026-10-28 10:00:00", who: "Monks Central", tool: "update-features", status: "ok", summary: "", can_undo: true }], total: 1, page: 1, pages: 1 };
      case "cm_approvals":
        return [{ id: 31, tool: "delete-post", who: "Claude", time: "2026-10-28 09:00:00", expires_in: 300, input: { post_id: 12 }, preview: { id: 12, title: "Hello world" } }];
      case "user_reset":
        return "sam@x.test";
      case "user_create":
        return user(7, "lee", "editor");
      default:
        return null;
    }
  });
  return calls;
}

describe("Users", () => {
  it("lists every site's users, notes the partial and the unavailable ones", async () => {
    core();
    render(<Users sites={[CM, BASIC, OLD]} />);
    const table = await screen.findByRole("table", { name: "Users" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getAllByText("Editor")).toHaveLength(1);
    expect(screen.getByText("Alpha: showing 2 of 60 users. Search to find the others.")).toBeInTheDocument();
    expect(screen.getByText(/^Older: WP Sites HQ isn't allowed/)).toBeInTheDocument();
    // Only Classic Monks with M7 can email a reset; elsewhere the slot stays, marked unavailable, so rows line up.
    const resets = screen.getAllByRole("button", { name: /^Send password reset/ });
    expect(resets).toHaveLength(3);
    expect(resets.filter((b) => b.getAttribute("aria-disabled") === "true")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  });

  it("searches, sends a reset and changes a role", async () => {
    const calls = core();
    render(<Users sites={[CM]} />);
    await screen.findByRole("table", { name: "Users" });
    // Searches as you type, once the typing pauses.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), { target: { value: "sam" } });
    await waitFor(() => expect(calls).toContainEqual(["users_list", { id: 1, search: "sam", page: 1 }]));
    fireEvent.click(await screen.findByRole("button", { name: "Send password reset to SAM on Alpha" }));
    expect(await screen.findByText("Sent SAM a link to set a new password (sam@x.test).")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change role for SAM on Alpha" }));
    const sheet = screen.getByRole("dialog", { name: "Change SAM's role" });
    expect(within(sheet).getByRole("button", { name: "Make them an editor" })).toBeDisabled();
    choose(within(sheet).getByRole("combobox", { name: "New role" }), "administrator");
    expect(within(sheet).getByText(/An administrator can change everything/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Make them an administrator" }));
    expect(await screen.findByText("SAM is now an administrator on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["user_set_role", { id: 1, userId: 2, role: "administrator" }]);
  });

  it("deletes a user and hands their content to someone from the whole site", async () => {
    const calls = core();
    render(<Users sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete SAM from Alpha" }));
    const sheet = screen.getByRole("dialog", { name: "Delete SAM" });
    const to = await within(sheet).findByRole("combobox", { name: "Give their posts and pages to" });
    fireEvent.click(to);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["JOY (joy)"]);
    fireEvent.keyDown(to, { key: "Escape" });
    // Nobody is picked for them until you choose.
    expect(within(sheet).getByRole("button", { name: "Delete SAM" })).toBeDisabled();
    choose(to, "1");
    fireEvent.click(within(sheet).getByRole("button", { name: "Delete SAM" }));
    expect(await screen.findByText("Deleted SAM from Alpha. Their posts and pages now belong to JOY.")).toBeInTheDocument();
    expect(calls).toContainEqual(["user_delete", { id: 1, userId: 2, reassign: 1 }]);
  });

  it("adds a user, with the reset email only where the site can send it", async () => {
    const calls = core();
    render(<Users sites={[CM, BASIC]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a user" }));
    const sheet = screen.getByRole("dialog", { name: "Add a user" });
    await within(sheet).findByRole("checkbox", { name: "Email them a link to set their password" });
    choose(within(sheet).getByRole("combobox", { name: "Site" }), "2");
    expect(await within(sheet).findByText(/Lost your password/)).toBeInTheDocument();
    choose(within(sheet).getByRole("combobox", { name: "Site" }), "1");
    const box = await within(sheet).findByRole("checkbox", { name: "Email them a link to set their password" });
    // The words toggle the box too.
    fireEvent.click(within(sheet).getByText("Email them a link to set their password"));
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    // Add says which field is missing instead of sitting disabled.
    fireEvent.click(within(sheet).getByRole("button", { name: "Add the user" }));
    expect(within(sheet).getByText("Fill in the username.")).toBeInTheDocument();
    expect(within(sheet).getByText("Fill in the email address.")).toBeInTheDocument();
    fireEvent.change(within(sheet).getByRole("textbox", { name: /^Username/ }), { target: { value: "lee" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: /^Email address/ }), { target: { value: "lee@x.test" } });
    choose(within(sheet).getByRole("combobox", { name: "Role" }), "editor");
    fireEvent.click(within(sheet).getByRole("button", { name: "Add the user" }));
    expect(await screen.findByText("Added lee to Alpha as an editor. They were emailed a link to set their password.")).toBeInTheDocument();
    expect(calls).toContainEqual(["user_create", { id: 1, user: { username: "lee", email: "lee@x.test", role: "editor" } }]);
    expect(calls).toContainEqual(["user_reset", { id: 1, userId: 7 }]);
  });

  it("closes the sheet when the user is added but the email fails", async () => {
    core({ user_reset: () => Promise.reject("Error: The email could not be sent.") });
    render(<Users sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a user" }));
    const sheet = screen.getByRole("dialog", { name: "Add a user" });
    await within(sheet).findByRole("checkbox", { name: "Email them a link to set their password" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: /^Username/ }), { target: { value: "lee" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Email address" }), { target: { value: "lee@x.test" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Add the user" }));
    expect(await screen.findByText("Added lee to Alpha as an editor. The password email didn't go out: Error: The email could not be sent.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add a user" })).not.toBeInTheDocument();
  });

  it("says plainly when a site's users fail to load, and when there are no sites", async () => {
    core({ users_list: () => Promise.reject("The site answered 500.") });
    const { unmount } = render(<Users sites={[CM]} />);
    expect(await screen.findByText("Alpha: the users didn't load. The site answered 500.")).toBeInTheDocument();
    unmount();
    render(<Users sites={[]} />);
    expect(screen.getByText("No sites yet")).toBeInTheDocument();
  });
});

describe("Comments", () => {
  it("shows every site's waiting comments, newest first, as plain words", async () => {
    core();
    render(<Comments sites={[CM, BASIC]} />);
    const inbox = await screen.findByRole("list", { name: "Comments, waiting for approval" });
    const items = within(inbox).getAllByRole("listitem");
    expect(items.map((i) => within(i).getByText(/^(Ana|Bo)$/).textContent)).toEqual(["Bo", "Ana"]);
    expect(within(items[0]).getByText("Nice loaf & jam")).toBeInTheDocument();
    expect(screen.getByText("Beta: showing the newest 1 of 3. Deal with these to see the rest.")).toBeInTheDocument();
  });

  it("approves, replies and switches lists", async () => {
    const calls = core();
    render(
      <Comments sites={[CM]} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve Ana's comment on Alpha" }));
    expect(screen.queryByRole("button", { name: "Approve Ana's comment on Alpha" })).toBeNull();
    expect(await screen.findByText("Approved: Ana's comment on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["comment_moderate", { id: 1, commentId: 5, action: "approve" }]);
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls).toContainEqual(["comment_moderate", { id: 1, commentId: 5, action: "unapprove" }]));

    fireEvent.click(await screen.findByRole("button", { name: "Reply to Ana on Alpha" }));
    const box = screen.getByRole("textbox", { name: /^Your reply to Ana/ });
    // A waiting comment is approved with the reply, so the reply never shows under a hidden comment.
    expect(screen.getByRole("button", { name: "Approve and reply" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "Thanks!" } });
    const approvals = calls.filter((c) => c[0] === "comment_moderate" && c[1].action === "approve").length;
    fireEvent.click(screen.getByRole("button", { name: "Approve and reply" }));
    expect(await screen.findByText("Approved and replied to Ana on Alpha.")).toBeInTheDocument();
    expect(calls.filter((c) => c[0] === "comment_moderate" && c[1].action === "approve")).toHaveLength(approvals + 1);
    expect(calls).toContainEqual(["comment_reply", { id: 1, commentId: 5, postId: 4, text: "Thanks!" }]);

    fireEvent.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(calls).toContainEqual(["comments_list", { id: 1, status: "spam" }]));
    expect(await screen.findByRole("button", { name: "Approve Ana's comment on Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Mark as spam/ })).toBeNull();
  });

  it("an action keeps the list on screen, and Undo after a tab change reads the tab that shows", async () => {
    let status: Record<number, string> = { 5: "pending", 7: "pending" };
    const calls = core({
      comments_list: (a) => ({
        comments: [comment(5, "Ana", "2026-10-27 10:00:00"), comment(7, "Cy", "2026-10-26 10:00:00")].filter((c) => status[c.id] === a.status).map((c) => ({ ...c, status: a.status as Comment["status"] })),
        total: 2,
      }),
      comment_moderate: (a) => {
        status = { ...status, [a.commentId as number]: a.action === "approve" ? "approved" : "pending" };
        return null;
      },
    });
    render(<Comments sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve Ana's comment on Alpha" }));
    // No loading placeholder in place of the rows: the next comment stays where the pointer is.
    expect(screen.queryByText(/Reading comments/)).toBeNull();
    expect(screen.getByRole("button", { name: "Approve Cy's comment on Alpha" })).toBeInTheDocument();
    await screen.findByText("Approved: Ana's comment on Alpha.");
    fireEvent.click(screen.getByRole("button", { name: "Approved" }));
    expect(await screen.findByRole("button", { name: "Unapprove Ana's comment on Alpha" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls).toContainEqual(["comment_moderate", { id: 1, commentId: 5, action: "unapprove" }]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Unapprove Ana's comment on Alpha" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Approve Cy's comment on Alpha" })).toBeNull();
  });

  it("says when nothing waits, and when a change fails", async () => {
    core({ comments_list: () => ({ comments: [], total: 0 }) });
    const { unmount } = render(<Comments sites={[CM]} />);
    expect(await screen.findByText("No comments are waiting")).toBeInTheDocument();
    unmount();
    core({ comment_moderate: () => Promise.reject("Comment not found.") });
    render(<Comments sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move to the trash: Ana's comment on Alpha" }));
    expect(await screen.findByText("Comment not found.")).toBeInTheDocument();
  });

  it("counts follow the Site filter, the waiting count shows on every list, and trash has Undo", async () => {
    const calls = core();
    render(<Comments sites={[CM, BASIC]} />);
    expect(await screen.findByRole("button", { name: /^Waiting for approval\s*4$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Site:/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "Alpha" }));
    expect(screen.getByRole("button", { name: /^Waiting for approval\s*1$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move to the trash: Ana's comment on Alpha" }));
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls).toContainEqual(["comment_moderate", { id: 1, commentId: 5, action: "unapprove" }]));
    fireEvent.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(calls).toContainEqual(["comments_list", { id: 1, status: "spam" }]));
    expect(screen.getByRole("button", { name: /^Waiting for approval\s*\d/ })).toBeInTheDocument();
  });

  it("strips a site's HTML to words", () => {
    expect(plainText("<p>Hi &lt;there&gt; &quot;you&quot; &#039;all&#39;&nbsp;</p>")).toBe("Hi <there> \"you\" 'all'");
  });
});

describe("Classic Monks", () => {
  const bar = () => screen.queryByRole("region", { name: "Unsaved changes" });

  it("collects changes, saves each on its own and undoes them together", async () => {
    const calls = core();
    render(<ClassicMonks sites={[CM]} />);
    const svg = await screen.findByRole("switch", { name: "SVG Support" });
    expect(screen.getByRole("heading", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByText("Uploads and image sizes.")).toBeInTheDocument();
    expect(screen.getByText("2 more settings here change only in the site's WordPress dashboard.")).toBeInTheDocument();
    // A switch flipped back is no change at all.
    fireEvent.click(svg);
    expect(bar()).toHaveTextContent("1 change not saved");
    fireEvent.click(svg);
    expect(bar()).toBeNull();
    fireEvent.click(svg);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Image Quality" }), { target: { value: "70" } });
    expect(bar()).toHaveTextContent("2 changes not saved");
    expect(calls.filter(([c]) => c.startsWith("cm_set"))).toEqual([]);
    fireEvent.click(within(bar()!).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved 2 changes on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_set_feature", { id: 1, name: "enable_svg", on: true, label: "SVG Support" }]);
    expect(calls).toContainEqual(["cm_set_setting", { id: 1, name: "auto_q", value: 70, label: "Image Quality" }]);
    expect(bar()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone: Saved 2 changes on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_undo", { id: 1, row: 42 }]);
  });

  it("keeps a change that failed, discards on request and asks before leaving", async () => {
    core({
      cm_set_feature: () => {
        throw "The site said no.";
      },
    });
    render(<ClassicMonks sites={[CM]} />);
    fireEvent.click(await screen.findByRole("switch", { name: "SVG Support" }));
    fireEvent.click(within(bar()!).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("SVG Support: The site said no.")).toBeInTheDocument();
    expect(bar()).toHaveTextContent("1 change not saved");
    expect(screen.getByRole("switch", { name: "SVG Support" })).toBeChecked();

    const go = vi.fn();
    act(() => leaveGuard.ask!(go));
    const ask = screen.getByRole("dialog", { name: "Leave without saving?" });
    expect(ask).toHaveTextContent("1 change to Classic Monks on Alpha isn't saved.");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(go).not.toHaveBeenCalled();

    fireEvent.click(within(bar()!).getByRole("button", { name: "Discard" }));
    expect(bar()).toBeNull();
    expect(screen.getByRole("switch", { name: "SVG Support" })).not.toBeChecked();
    expect(leaveGuard.ask).toBeNull();
  });

  it("searches every tab, keeps locked features locked and counts the whole site", async () => {
    core();
    render(<ClassicMonks sites={[CM]} />);
    await screen.findByRole("switch", { name: "SVG Support" });
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Performance", "Security 1 on"]);
    expect(screen.getByText(/features turned on/)).toHaveTextContent("1 of 3 features turned on.");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "bad logins" } });
    const card = screen.getByRole("region", { name: "Logins Security, Protection" });
    expect(within(card).getByRole("switch", { name: "Login Lockdown" })).toBeDisabled();
    expect(within(card).getByText("Locked")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "SVG Support" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("switch", { name: "SVG Support" })).toBeInTheDocument();
    // The rail moves between a tab's sections.
    fireEvent.click(screen.getByRole("tab", { name: "Security 1 on" }));
    expect(within(screen.getByRole("navigation", { name: "Security sections" })).getByRole("button", { name: /^Protection/ })).toHaveAttribute("aria-current", "true");
  });

  it("shows a control only while the switch it depends on is on, as the dashboard does", async () => {
    const svg = { name: "enable_svg", label: "SVG Support", description: "", on: false, locked: false };
    const card = {
      title: "Media",
      toggles: [svg, { ...svg, name: "svg_sanitize", label: "Sanitize SVG", depends_on: "enable_svg" }],
      settings: [{ name: "auto_q", label: "Image Quality", description: "", control: "number", options: [], min: 1, max: 100, step: 1, value: 82, depends_on: "svg_sanitize" }],
      elsewhere: 0,
    };
    core({ cm_controls: () => ({ on: 0, total: 2, tabs: [{ key: "performance", label: "Performance", subtabs: [{ key: "m", label: "Media", description: "", cards: [card] }] }] }) });
    render(<ClassicMonks sites={[CM]} />);
    fireEvent.click(await screen.findByRole("switch", { name: "SVG Support" }));
    fireEvent.click(screen.getByRole("switch", { name: "Sanitize SVG" }));
    expect(screen.getByRole("spinbutton", { name: "Image Quality" })).toBeInTheDocument();
    // Turning the top switch back off hides both: the chain follows unsaved changes too.
    fireEvent.click(screen.getByRole("switch", { name: "SVG Support" }));
    expect(screen.queryByRole("switch", { name: "Sanitize SVG" })).toBeNull();
    expect(screen.queryByRole("spinbutton", { name: "Image Quality" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search settings" }), { target: { value: "quality" } });
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("opens Activity and the waiting changes as sheets", async () => {
    const calls = core();
    render(<ClassicMonks sites={[CM]} />);
    await screen.findByRole("switch", { name: "SVG Support" });
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    const log = await screen.findByRole("list", { name: "Activity" });
    expect(within(log).getByText("Update features")).toBeInTheDocument();
    // Undo runs at once, as the toast's does; the undo is logged too.
    fireEvent.click(within(log).getByRole("button", { name: /^Undo Update features from / }));
    expect(await screen.findByText("Undone: Update features on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_undo", { id: 1, row: 9 }]);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(await screen.findByRole("button", { name: "Waiting for approval 1" }));
    const waiting = await screen.findByRole("list", { name: "Waiting for approval" });
    expect(within(waiting).getByText("Delete post “Hello world”")).toBeInTheDocument();
    fireEvent.click(within(waiting).getByRole("button", { name: "Approve or decline on the site: Delete post “Hello world”" }));
    expect(await screen.findByText("Opened the approval page for Delete post “Hello world” on Alpha in your browser.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_approval_open", { id: 1, op: 31 }]);
  });

  it("explains sites without Classic Monks, and buttons the site lacks are hidden", async () => {
    core();
    const released = site({ id: 4, name: "Released", capabilities: { abilities: ["get-features", "update-features", "get-404-report"] } });
    render(<ClassicMonks sites={[BASIC, released]} />);
    expect(await screen.findByRole("switch", { name: "SVG Support" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activity" })).toBeNull();
    // The reports get a Logs section when the dashboard has none.
    expect(within(screen.getByRole("navigation", { name: "Performance sections" })).getByRole("button", { name: /^Logs/ })).toBeInTheDocument();
    choose(screen.getByRole("combobox", { name: "Site" }), "2");
    expect(screen.getByText("This site doesn't have Classic Monks. It's connected in Basic mode.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Get the WP Sites HQ plugin" })).toBeInTheDocument();
  });

  it("names tools and blocks plainly", () => {
    expect(toolLabel("classic-monks/update-features")).toBe("Update features");
    const ask = { id: 1, tool: "update-user", who: "", time: "", expires_in: 60 };
    expect(targetOf({ ...ask, preview: { display_name: "Sam" } })).toBe("“Sam”");
    expect(targetOf({ ...ask, input: { user_id: 4 } })).toBe("user 4");
    expect(targetOf(ask)).toBe("");
    expect(cmBlocked(OLD)).toMatch(/allowed to change Classic Monks/);
    expect(cmBlocked(site({ sign_in_again: true }))).toBe("The sign-in for this site expired. Sign in again to work on it here.");
    expect(peopleBlocked(BASIC, "get-users")).toBeNull();
    expect(peopleBlocked(CM, "get-users")).toBeNull();
    expect(peopleBlocked(OLD, "get-users")).toMatch(/allowed to change users and comments/);
  });
});

test("log rows from this app read as You, under its old and new name", () => {
  expect(whoOf("WP Sites HQ")).toBe("You");
  expect(whoOf("Monks Central")).toBe("You");
  expect(whoOf("Claude")).toBe("Claude");
});
