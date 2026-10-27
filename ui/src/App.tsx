import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export const SECTIONS = [
  "Overview",
  "Sites",
  "Updates",
  "Plugins",
  "Themes",
  "Content",
  "Media",
  "Users",
  "Comments",
  "Security",
  "Reports",
  "AI",
  "Settings",
] as const;

type Section = (typeof SECTIONS)[number];

export type CoreStatus = {
  version: string;
  pid: number;
  role: "operator" | "agent";
  home: string;
};

export default function App() {
  const [section, setSection] = useState<Section>("Overview");
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<CoreStatus>("core_status").then(setStatus, (e) => setError(String(e)));
  }, []);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <p className="brand">Monks Central</p>
        <ul>
          {SECTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                aria-current={s === section ? "page" : undefined}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main>
        <h1>{section}</h1>
        {section === "Overview" ? (
          <section aria-label="Core status" className="card">
            {error ? (
              <p role="alert">{error}</p>
            ) : status ? (
              <dl>
                <dt>Version</dt>
                <dd>{status.version}</dd>
                <dt>Role</dt>
                <dd>{status.role}</dd>
                <dt>Data folder</dt>
                <dd>{status.home}</dd>
              </dl>
            ) : (
              <p>Starting…</p>
            )}
          </section>
        ) : (
          <p>{section} arrives in a later phase.</p>
        )}
      </main>
    </div>
  );
}
