// SPDX-License-Identifier: GPL-3.0-or-later
// Every change goes the same way (plan 5.7): choose what changes on which site,
// review it, then watch it run, site by site.
import { useMemo, useState } from "react";
import { api, useJob, type Change, type JobItem } from "../api";
import { Button, Glyph, type GlyphName } from "./ui";
import { Sheet } from "./Sheet";
import { SiteTile } from "./SiteTile";

/** One change as the plan shows it, before the core has it. Name, icon and note are for the pick list. */
export type PlanRow = {
  change: Change;
  site: string;
  label: string;
  from?: string | null;
  to?: string | null;
  name?: string;
  icon?: string | null;
  note?: string;
};

export type SheetState =
  | { title: string; rows: PlanRow[]; start: "plan" | "confirm"; danger?: boolean }
  | { title: string; jobId: number };

type Step = "plan" | "confirm" | "progress";
const STEPS: [Step, string][] = [
  ["plan", "Pick"],
  ["confirm", "Review"],
  ["progress", "Run"],
];

const STATE_ICON: Record<JobItem["state"], GlyphName> = { waiting: "clock", running: "loader", done: "check-circle", failed: "x-circle", rolled_back: "undo" };
const STATE_WORD: Record<JobItem["state"], string> = { waiting: "Waiting", running: "Running", done: "Done", failed: "Failed", rolled_back: "Rolled back" };
const STATE_TONE: Record<JobItem["state"], string> = { waiting: "", running: "", done: "ok", failed: "danger", rolled_back: "warning" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Indexes of rows, by site, in the order the sites first appear. */
function bySiteOf(rows: PlanRow[], keep: (i: number) => boolean = () => true): [string, number[]][] {
  const m = new Map<string, number[]>();
  rows.forEach((r, i) => keep(i) && m.set(r.site, [...(m.get(r.site) ?? []), i]));
  return [...m];
}

export function Versions({ from, to }: { from?: string | null; to?: string | null }) {
  if (!from && !to) return null;
  return (
    <span className="mono vers">
      {from ?? "not known"}
      {to && (
        <>
          {" "}
          <span aria-hidden="true">→</span>
          <span className="sr-only">to</span> {to}
        </>
      )}
    </span>
  );
}

export function JobSheet({ state, onClose }: { state: SheetState; onClose: () => void }) {
  const fromPlan = "rows" in state;
  const rows = fromPlan ? state.rows : [];
  const [step, setStep] = useState<Step>(fromPlan ? state.start : "progress");
  const [picked, setPicked] = useState<Set<number>>(() => new Set(rows.map((_, i) => i)));
  const [jobId, setJobId] = useState<number | null>(fromPlan ? null : state.jobId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((_, i) => picked.has(i));
  const bySite = useMemo(() => bySiteOf(rows), [rows]);
  const siteCount = new Set(chosen.map((r) => r.change.site_id)).size;
  const danger = fromPlan && state.danger;

  const toggle = (ids: number[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      ids.forEach((i) => (on ? next.add(i) : next.delete(i)));
      return next;
    });

  const start = async (changes: Change[], title: string) => {
    setBusy(true);
    setError(null);
    try {
      const job = await api.startJob(title, changes);
      setJobId(job.id);
      setStep("progress");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // The design's stepper: numbered rings joined by hairlines; done ones carry a tick.
  const at = STEPS.findIndex(([s]) => s === step);
  const steps = (
    <ol className="jobsteps" aria-label="Steps">
      {STEPS.map(([s, label], n) => (
        <li key={s} className={n < at ? "done" : undefined} aria-current={s === step ? "step" : undefined}>
          <i aria-hidden="true">{n < at ? <Glyph name="check" /> : n + 1}</i>
          <span>{label}</span>
          {n < at && <span className="sr-only">, done</span>}
        </li>
      ))}
    </ol>
  );

  if (step === "progress" && jobId != null) {
    // A new job (a retry) mounts a new sheet, so focus moves into it and Esc still works.
    return <Progress key={jobId} jobId={jobId} title={state.title} steps={steps} onClose={onClose} onRetry={start} />;
  }

  const confirmLabel = chosen.length === 1 ? chosen[0].label : `Make these ${chosen.length} changes`;
  return (
    <Sheet
      title={state.title}
      steps={steps}
      intro={
        step === "plan"
          ? "Untick anything that should stay as it is. Nothing changes until you confirm."
          : chosen.length === 1
            ? "This runs on the site as soon as you confirm."
            : `${plural(chosen.length, "change")} on ${plural(siteCount, "site")}. Each site's changes run one after another; sites run side by side.`
      }
      onClose={onClose}
      footer={
        <>
          <span className="grow" role="status">
            {step === "plan" && `${chosen.length} selected`}
          </span>
          {step === "confirm" && fromPlan && state.start === "plan" && (
            <Button onClick={() => setStep("plan")}>Back</Button>
          )}
          <Button onClick={onClose}>Close without changes</Button>
          {step === "plan" ? (
            <Button kind="primary" className="disc" disabled={chosen.length === 0} onClick={() => setStep("confirm")}>
              Review {plural(chosen.length, "change")}
              <span className="btn-disc">
                <Glyph name="arrow" />
              </span>
            </Button>
          ) : (
            <Button
              kind={danger ? "danger" : "primary"}
              className={danger ? undefined : "disc"}
              disabled={busy || chosen.length === 0}
              onClick={() => start(chosen.map((r) => r.change), state.title)}
            >
              {busy ? "Starting…" : confirmLabel}
              {!danger && (
                <span className="btn-disc">
                  <Glyph name="check" />
                </span>
              )}
            </Button>
          )}
        </>
      }
    >
      {error && (
        <p className="callout danger" role="alert">
          <Glyph name="alert" />
          <span>{error}</span>
        </p>
      )}
      {step === "plan" ? (
        <div className="jobpick">
          {bySite.map(([site, ids]) => {
            const all = ids.every((i) => picked.has(i));
            const first = rows[ids[0]];
            return (
              <section key={site} aria-label={site}>
                {/* The whole line toggles, like a label; the box is the keyboard's way in. */}
                <div className="jobpick-site" onClick={() => toggle(ids, !all)}>
                  <button
                    type="button"
                    className="box"
                    role="checkbox"
                    aria-checked={all ? true : ids.some((i) => picked.has(i)) ? "mixed" : false}
                    aria-label={`Every change on ${site}`}
                  />
                  <SiteTile site={{ id: first.change.site_id, name: site, icon: first.icon }} size="sm" />
                  <b>Every change on {site}</b>
                  <small>{ids.length}</small>
                </div>
                <ul>
                  {ids.map((i) => {
                    const r = rows[i];
                    return (
                      <li key={i} onClick={() => toggle([i], !picked.has(i))}>
                        <button type="button" className="box" role="checkbox" aria-checked={picked.has(i)} aria-label={`${r.label} on ${site}`} />
                        <span>{r.name ?? r.label}</span>
                        <small>{[r.from && r.to && `${r.from} → ${r.to}`, r.note].filter(Boolean).join(" · ")}</small>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="jobreview">
          {bySiteOf(rows, (i) => picked.has(i)).map(([site, ids]) => (
            <section key={site} aria-label={`On ${site}`}>
              <h3 className="label">On {site}</h3>
              <ul>
                {ids.map((i) => (
                  <li key={i}>
                    <span>{rows[i].label}</span>
                    <Versions from={rows[i].from} to={rows[i].to} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Sheet>
  );
}

type ProgressProps = {
  jobId: number;
  title: string;
  steps: React.ReactNode;
  onClose: () => void;
  onRetry: (changes: Change[], title: string) => void;
};

function Progress({ jobId, title, steps, onClose, onRetry }: ProgressProps) {
  const job = useJob(jobId);
  const items = job?.items ?? [];
  const finished = items.filter((i) => i.state !== "waiting" && i.state !== "running").length;
  const failed = items.filter((i) => i.state === "failed");
  // Not offered again: trying would break the site again.
  const back = items.filter((i) => i.state === "rolled_back").length;
  const notDone = [failed.length && `${failed.length} failed`, back && `${back} rolled back`].filter(Boolean).join(", ");
  const over = job?.finished_at != null;
  const retry = over && failed.length > 0;
  const summary = !job
    ? "Starting…"
    : over
      ? notDone
        ? `Finished. ${plural(items.length - failed.length - back, "change")} done, ${notDone}.`
        : items.length === 1
          ? "Finished. The change is done."
          : `Finished. All ${items.length} changes done.`
      : `${finished} of ${items.length} finished${notDone ? `, ${notDone}` : ""}. You can close this panel; it keeps running.`;
  return (
    <Sheet
      title={over ? title : `${title}: running`}
      intro={<span role="status">{summary}</span>}
      steps={steps}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          <Button kind={over && !retry ? "primary" : undefined} onClick={onClose}>
            {over ? "Close" : "Hide this panel"}
          </Button>
          {retry && (
            <Button
              kind="primary"
              onClick={() =>
                onRetry(
                  failed.filter((i) => i.site_id != null).map((i) => ({ site_id: i.site_id!, action: i.action })),
                  `Try again: ${title}`,
                )
              }
            >
              <Glyph name="refresh" />
              Try the {plural(failed.length, "failed change")} again
            </Button>
          )}
        </>
      }
    >
      <div className="jobmeter-head" aria-hidden="true">
        <b>
          {finished} of {items.length} finished
        </b>
        {notDone && <span>{notDone}</span>}
      </div>
      <div
        className="jobmeter"
        role="progressbar"
        aria-label="Changes finished"
        aria-valuemin={0}
        aria-valuemax={items.length || 1}
        aria-valuenow={finished}
      >
        <i style={{ width: `${items.length ? (finished / items.length) * 100 : 0}%` }} />
      </div>
      <ul className="jobprog">
        {items.map((i) => {
          const say =
            i.state === "done"
              ? [i.to_version && `now ${i.to_version}`, i.message !== "Done." && i.message]
              : i.state === "failed" || i.state === "rolled_back"
                ? [i.message]
                : [i.from_version && i.to_version && `${i.from_version} → ${i.to_version}`];
          return (
            <li key={i.id} className={i.state}>
              <Glyph name={STATE_ICON[i.state]} />
              <span>
                <b>{i.label}</b>
                <small>
                  {[i.site_name, ...say].filter(Boolean).map((t, k) => (
                    <span key={k}>{t}</span>
                  ))}
                </small>
              </span>
              <span className={`meta ${STATE_TONE[i.state]}`}>{STATE_WORD[i.state]}</span>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
