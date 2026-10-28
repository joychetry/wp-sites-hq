// AI: agents' plans you confirm or decline, agent access per site, and the activity log.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { Ai } from "./Ai";
import { site } from "../test-fixtures";
import type { Entry, Job } from "../api";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
const mockInvoke = vi.mocked(invoke);
afterEach(() => mockInvoke.mockReset());

const PLAN: Job = {
  id: 7,
  title: "Update WooCommerce on 2 sites",
  created_at: Math.floor(Date.now() / 1000) - 120,
  finished_at: null,
  proposed_by: "agent",
  confirmed_at: null,
  declined_at: null,
  items: [
    { id: 1, site_id: 1, site_name: "Alpha", action: { do: "update_plugin", plugin: "woocommerce/woocommerce.php" }, label: "Update WooCommerce", from_version: "10.2.0", to_version: "10.3.0", state: "waiting", message: "" },
    { id: 2, site_id: 2, site_name: "Beta", action: { do: "update_plugin", plugin: "woocommerce/woocommerce.php" }, label: "Update WooCommerce", from_version: "10.1.0", to_version: "10.3.0", state: "waiting", message: "" },
  ],
};
const ALPHA = site({ id: 1, name: "Alpha" });
const BETA = site({ id: 2, name: "Beta", agent_access: true });
const BASIC = site({ id: 3, name: "Gamma", mode: "basic", capabilities: {} });

function core(over: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const calls: [string, Record<string, unknown>][] = [];
  mockInvoke.mockImplementation(async (cmd: string, args?: unknown) => {
    const a = (args ?? {}) as Record<string, unknown>;
    calls.push([cmd, a]);
    if (over[cmd]) return over[cmd](a);
    switch (cmd) {
      case "plan_confirm":
        return { ...PLAN, confirmed_at: 1 };
      case "plan_decline":
        return { ...PLAN, declined_at: 1 };
      case "agent_access_on":
        return { ...ALPHA, agent_access: true };
      case "agent_access_off":
        return { ...BETA, agent_access: false };
      default:
        return null;
    }
  });
  return calls;
}

test("a plan shows every change and runs only when you confirm it", async () => {
  const calls = core();
  const onWatch = vi.fn();
  render(<Ai sites={[ALPHA, BETA]} plans={[PLAN]} onWatch={onWatch} />);
  expect(screen.getByRole("tab", { name: "Plans to confirm (1)" })).toHaveAttribute("aria-selected", "true");
  const card = screen.getByRole("region", { name: PLAN.title });
  expect(within(card).getByText(/Proposed by an AI agent 2 min ago\. 2 changes on 2 sites\./)).toBeInTheDocument();
  expect(within(card).getAllByRole("listitem")).toHaveLength(2);
  expect(within(card).getAllByRole("listitem")[1]).toHaveTextContent("Beta, Update WooCommerce10.1.0 →to 10.3.0");
  expect(calls.some(([c]) => c === "plan_confirm")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: `Confirm and run 2 changes: ${PLAN.title}` }));
  await waitFor(() => expect(onWatch).toHaveBeenCalledWith(expect.objectContaining({ id: 7, confirmed_at: 1 })));
  expect(calls).toContainEqual(["plan_confirm", { id: 7 }]);
});

test("declining says nothing changed, and an error is shown in words", async () => {
  const calls = core();
  render(<Ai sites={[]} plans={[PLAN]} onWatch={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: `Decline ${PLAN.title}` }));
  expect(await screen.findByText(`Declined "${PLAN.title}". Nothing changed.`)).toBeInTheDocument();
  expect(calls).toContainEqual(["plan_decline", { id: 7 }]);

  core({ plan_confirm: () => Promise.reject("This plan isn't waiting any more: it was confirmed or declined already.") });
  fireEvent.click(screen.getByRole("button", { name: `Confirm and run 2 changes: ${PLAN.title}` }));
  expect(await screen.findByText(/isn't waiting any more/)).toBeInTheDocument();
});

test("no plans says nothing runs without you", () => {
  core();
  render(<Ai sites={[]} plans={[]} onWatch={() => {}} />);
  expect(screen.getByRole("heading", { name: "No plans are waiting." })).toBeInTheDocument();
  expect(screen.getByText(/no AI app can confirm it for you/)).toBeInTheDocument();
});

test("agent access per site: read only, on with approval, Basic mode needs Classic Monks", async () => {
  const calls = core();
  render(<Ai sites={[ALPHA, BETA, BASIC]} plans={[]} onWatch={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Agent access" }));
  const rows = within(screen.getByRole("table", { name: "Agent access" })).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("AlphaCan read only");
  expect(rows[2]).toHaveTextContent("BetaCan change, with your approval on the site");
  expect(rows[3]).toHaveTextContent("GammaNeeds Classic Monks");
  expect(within(rows[3]).queryByRole("button")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Turn on access for Alpha" }));
  expect(screen.getByText(/leave "This is my Monks Central app \(operator\)" unticked/)).toBeInTheDocument();
  expect(await screen.findByText("AI agents can change Alpha now. The site asks you to approve each change.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Turn off access for Beta" }));
  expect(await screen.findByText("AI agents can only read Beta now.")).toBeInTheDocument();
  expect(calls.map(([c]) => c)).toEqual(["agent_access_on", "agent_access_off"]);
});

test("the activity log says who did what, and loads older entries", async () => {
  const at = Math.floor(Date.now() / 1000) - 30;
  const row = (id: number, actor: Entry["actor"], outcome: Entry["outcome"], site_name = "Alpha"): Entry => ({ id, at, actor, site_id: 1, site_name, what: `thing ${id}`, outcome, detail: "" });
  const first = [row(60, "human", "done"), row(59, "agent", "waiting"), row(58, "agent_confirmed", "failed", ""), ...Array.from({ length: 47 }, (_, i) => row(57 - i, "agent", "refused"))];
  const calls = core({ activity_list: (a) => (a.before ? [row(1, "human", "done")] : first) });
  render(<Ai sites={[]} plans={[]} onWatch={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Activity" }));
  const table = await screen.findByRole("table", { name: "Activity" });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("just nowYouAlphathing 60Done");
  expect(rows[2]).toHaveTextContent("AI agentAlphathing 59Waiting for you");
  expect(rows[3]).toHaveTextContent("AI agent, confirmed by youSeveral sitesthing 58Failed");
  fireEvent.click(screen.getByRole("button", { name: "Show older entries" }));
  await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(52));
  expect(calls).toContainEqual(["activity_list", { before: 11 }]);
  expect(screen.queryByRole("button", { name: "Show older entries" })).toBeNull();
});

test("connect shows the command to add Monks Central to an AI app", async () => {
  core();
  const writeText = vi.fn(() => Promise.resolve());
  Object.assign(navigator, { clipboard: { writeText } });
  render(<Ai sites={[]} plans={[]} onWatch={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Connect an AI app" }));
  expect(screen.getByText("claude mcp add monks-central -- monks mcp")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
  expect(await screen.findByText("Copied the Claude Code command.")).toBeInTheDocument();
  expect(writeText).toHaveBeenCalledWith("claude mcp add monks-central -- monks mcp");
});
