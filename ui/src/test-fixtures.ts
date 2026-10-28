import { fireEvent } from "@testing-library/react";
import type { Site } from "./api";

export function site(over: Partial<Site> = {}): Site {
  return {
    id: 1,
    url: "https://mc-a.local",
    name: "MC A",
    mode: "classic_monks",
    api_url: "https://mc-a.local/wp-json/classic-monks/v1/mcp",
    username: null,
    wp_version: "7.1.3",
    php_version: "8.4.26",
    cm_version: "2.6.0-dev",
    capabilities: { operator: true, abilities: ["get-hq-status"], approvals: true, degraded: false },
    sign_in_again: false,
    health: "ok",
    health_detail: "Answered in 0.4 s.",
    checked_at: Math.floor(Date.now() / 1000) - 120,
    group: null,
    tags: [],
    notes: [],
    added_at: 0,
    agent_access: false,
    client_id: null,
    client: null,
    ...over,
  };
}

/** Picks the option with this value in a custom Select (components/controls.tsx). */
export function choose(select: HTMLElement, value: string) {
  fireEvent.click(select);
  const option = document.querySelector<HTMLElement>(`[role="option"][data-value="${CSS.escape(value)}"]`);
  if (!option) throw new Error(`no option ${value} in ${select.getAttribute("aria-label")}`);
  fireEvent.click(option);
}
