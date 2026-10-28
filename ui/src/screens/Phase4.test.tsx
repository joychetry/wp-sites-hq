// Users, the comment inbox and Classic Monks (features, settings, activity, approvals).
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Users } from "./Users";
import { Comments, plainText } from "./Comments";
import { ClassicMonks, toolLabel } from "./ClassicMonks";
import { site, choose } from "../test-fixtures";
import { cmBlocked, peopleBlocked, type Comment, type User } from "../api";

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
      case "cm_features":
        return [
          { key: "perf", label: "Performance", toggles: [{ name: "enable_svg", label: "SVG Support", description: "", section: "Media", on: false, locked: false }] },
          { key: "sec", label: "Security", toggles: [{ name: "enable_lock", label: "Login Lockdown", description: "Blocks bad logins.", section: "", on: true, locked: true }] },
        ];
      case "cm_set_feature":
        return 42;
      case "cm_settings":
        return [{ name: "auto_q", label: "Image Quality", description: "", tab: "Performance", section: "Media", control: "number", options: [], min: 1, max: 100, step: 1, value: 82 }];
      case "cm_set_setting":
        return null;
      case "cm_activity":
        return { rows: [{ id: 9, time: "2026-10-28 10:00:00", who: "Monks Central", tool: "update-features", status: "ok", summary: "", can_undo: true }], total: 1, page: 1, pages: 1 };
      case "cm_approvals":
        return [{ id: 31, tool: "delete-post", who: "Claude", time: "2026-10-28 09:00:00", expires_in: 300 }];
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
    expect(screen.getByText(/^Older: This connection can't do this/)).toBeInTheDocument();
    // Only Classic Monks with M7 can email a reset.
    expect(screen.getAllByRole("button", { name: /^Send password reset/ })).toHaveLength(2);
  });

  it("searches, sends a reset and changes a role", async () => {
    const calls = core();
    render(<Users sites={[CM]} />);
    await screen.findByRole("table", { name: "Users" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users" }), { target: { value: "sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(calls).toContainEqual(["users_list", { id: 1, search: "sam", page: 1 }]));
    fireEvent.click(await screen.findByRole("button", { name: "Send password reset to SAM on Alpha" }));
    expect(await screen.findByText("Sent sam a link to set a new password (sam@x.test).")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change role for SAM on Alpha" }));
    const sheet = screen.getByRole("dialog", { name: "Change SAM's role" });
    expect(within(sheet).getByRole("button", { name: "Make them Editor" })).toBeDisabled();
    choose(within(sheet).getByRole("combobox", { name: "New role" }), "administrator");
    expect(within(sheet).getByText(/An administrator can change everything/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Make them Administrator" }));
    expect(await screen.findByText("SAM is now Administrator on Alpha.")).toBeInTheDocument();
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
    await within(sheet).findByRole("checkbox", { name: "Email them a link to set their password" });
    fireEvent.change(within(sheet).getByRole("textbox", { name: /^Username/ }), { target: { value: "lee" } });
    fireEvent.change(within(sheet).getByRole("textbox", { name: "Email address" }), { target: { value: "lee@x.test" } });
    choose(within(sheet).getByRole("combobox", { name: "Role" }), "editor");
    fireEvent.click(within(sheet).getByRole("button", { name: "Add the user" }));
    expect(await screen.findByText("Added lee to Alpha as Editor. They were emailed a link to set their password.")).toBeInTheDocument();
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
    expect(await screen.findByText("Added lee to Alpha as Editor. The password email didn't go out: Error: The email could not be sent.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add a user" })).not.toBeInTheDocument();
  });

  it("says plainly when a site's users fail to load, and when there are no sites", async () => {
    core({ users_list: () => Promise.reject("The site answered 500.") });
    const { unmount } = render(<Users sites={[CM]} />);
    expect(await screen.findByText("Alpha: the users didn't load. The site answered 500.")).toBeInTheDocument();
    unmount();
    render(<Users sites={[]} />);
    expect(screen.getByText("No sites yet.")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Send the reply" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: "Send the reply" }));
    expect(await screen.findByText("Replied to Ana on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["comment_reply", { id: 1, commentId: 5, postId: 4, text: "Thanks!" }]);

    fireEvent.click(screen.getByRole("button", { name: "Spam" }));
    await waitFor(() => expect(calls).toContainEqual(["comments_list", { id: 1, status: "spam" }]));
    expect(await screen.findByRole("button", { name: "Approve Ana's comment on Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /as spam$/ })).toBeNull();
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
    expect(await screen.findByText("No comments are waiting.")).toBeInTheDocument();
    unmount();
    core({ comment_moderate: () => Promise.reject("Comment not found.") });
    render(<Comments sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Move Ana's comment on Alpha to the trash" }));
    expect(await screen.findByText("Comment not found.")).toBeInTheDocument();
  });

  it("strips a site's HTML to words", () => {
    expect(plainText("<p>Hi &lt;there&gt; &quot;you&quot; &#039;all&#39;&nbsp;</p>")).toBe("Hi <there> \"you\" 'all'");
  });
});

describe("Classic Monks", () => {
  it("turns a feature on and undoes it", async () => {
    const calls = core();
    render(<ClassicMonks sites={[CM]} />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on SVG Support" }));
    expect(await screen.findByText("Turned on SVG Support on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_set_feature", { id: 1, name: "enable_svg", on: true }]);
    expect(screen.getByRole("button", { name: "Turn off SVG Support" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Undone: Turned on SVG Support on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_undo", { id: 1, row: 42 }]);
    // The list reads the site again, so it shows what the undo put back.
    expect(await screen.findByRole("button", { name: "Turn on SVG Support" })).toBeInTheDocument();
  });

  it("finds features in every section and shows locked ones as locked", async () => {
    core();
    render(<ClassicMonks sites={[CM]} />);
    await screen.findByRole("button", { name: "Turn on SVG Support" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a feature" }), { target: { value: "bad logins" } });
    const list = screen.getByRole("list", { name: "Matching features" });
    expect(within(list).getByText("Login Lockdown")).toBeInTheDocument();
    expect(within(list).getByText("Locked")).toBeInTheDocument();
    expect(within(list).queryByRole("button")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a feature" }), { target: { value: "zzz" } });
    expect(screen.getByText("No feature matches.")).toBeInTheDocument();
  });

  it("saves a setting, undoes from the log and opens an approval on the site", async () => {
    const calls = core();
    render(<ClassicMonks sites={[CM]} />);
    await screen.findByRole("button", { name: "Turn on SVG Support" });
    const tabs = screen.getByRole("tablist", { name: "Show" });
    fireEvent.click(within(tabs).getByRole("tab", { name: "Settings" }));
    const q = await screen.findByRole("spinbutton", { name: "Image Quality" });
    expect(screen.getByRole("button", { name: "Save Image Quality" })).toBeDisabled();
    fireEvent.change(q, { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Image Quality" }));
    expect(await screen.findByText("Set Image Quality to 70 on Alpha.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_set_setting", { id: 1, name: "auto_q", value: 70 }]);

    fireEvent.click(within(tabs).getByRole("tab", { name: "Activity" }));
    const table = await screen.findByRole("table", { name: "Activity" });
    expect(within(table).getByText("Update features")).toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: /^Undo/ }));
    expect(await screen.findByText("Undone: Update features on Alpha.")).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole("tab", { name: "Waiting for approval" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Approve or decline on the site/ }));
    expect(await screen.findByText("Opened the approval page for Delete post on Alpha in your browser.")).toBeInTheDocument();
    expect(calls).toContainEqual(["cm_approval_open", { id: 1, op: 31 }]);
  });

  it("explains sites without Classic Monks, and tabs the site lacks are hidden", async () => {
    core();
    const released = site({ id: 4, name: "Released", capabilities: { abilities: ["get-features", "update-features"] } });
    render(<ClassicMonks sites={[BASIC, released]} />);
    expect(await screen.findByRole("button", { name: "Turn on SVG Support" })).toBeInTheDocument();
    expect(within(screen.getByRole("tablist", { name: "Show" })).getAllByRole("tab").map((b) => b.textContent)).toEqual(["Features"]);
    choose(screen.getByRole("combobox", { name: "Site" }), "2");
    expect(screen.getByText("This site doesn't have Classic Monks. It's connected in Basic mode.")).toBeInTheDocument();
  });

  it("names tools and blocks plainly", () => {
    expect(toolLabel("classic-monks/update-features")).toBe("Update features");
    expect(cmBlocked(OLD)).toMatch(/can't change Classic Monks/);
    expect(cmBlocked(site({ sign_in_again: true }))).toBe("Sign in again first.");
    expect(peopleBlocked(BASIC, "get-users")).toBeNull();
    expect(peopleBlocked(CM, "get-users")).toBeNull();
    expect(peopleBlocked(OLD, "get-users")).toMatch(/tick the user and comment tool groups/);
  });
});
