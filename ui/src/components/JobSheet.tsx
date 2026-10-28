// Every change goes the same way (plan 5.7): choose what changes on which site,
// review it, then watch it run, site by site.
import { useMemo, useState } from "react";
import { api, useJob, type Change, type JobItem } from "../api";
import { Button } from "./ui";
import { Sheet } from "./Sheet";

/** One change as the plan shows it, before the core has it. */
export type PlanRow = { change: Change; site: string; label: string; from?: string | null; to?: string | null };

export type SheetState =
  | { title: string; rows: PlanRow[]; start: "plan" | "confirm"; danger?: boolean }
  | { title: string; jobId: number };

type Step = "plan" | "confirm" | "progress";
const STEPS: [Step, string][] = [
  ["plan", "1. Plan"],
  ["confirm", "2. Confirm"],
  ["progress", "3. Progress"],
];

const STATE_WORD: Record<JobItem["state"], string> = { waiting: "Waiting", running: "Running", done: "Done", failed: "Failed" };
const STATE_TONE: Record<JobItem["state"], string> = { waiting: "", running: "", done: "ok", failed: "danger" };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
  const bySite = useMemo(() => {
    const m = new Map<string, number[]>();
    rows.forEach((r, i) => m.set(r.site, [...(m.get(r.site) ?? []), i]));
    return [...m];
  }, [rows]);
  const siteCount = new Set(chosen.map((r) => r.change.site_id)).size;

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

  const steps = (
    <ol className="jobsteps">
      {STEPS.map(([s, label]) => (
        <li key={s} aria-current={s === step ? "step" : undefined}>
          {label}
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
            <Button kind="primary" disabled={chosen.length === 0} onClick={() => setStep("confirm")}>
              Review {plural(chosen.length, "change")}
            </Button>
          ) : (
            <Button
              kind={fromPlan && state.danger ? "danger" : "primary"}
              disabled={busy || chosen.length === 0}
              onClick={() => start(chosen.map((r) => r.change), state.title)}
            >
              {busy ? "Starting…" : confirmLabel}
            </Button>
          )}
        </>
      }
    >
      {steps}
      {error && (
        <p className="alert danger" role="alert">
          {error}
        </p>
      )}
      {step === "plan" ? (
        bySite.map(([site, ids]) => {
          const all = ids.every((i) => picked.has(i));
          return (
            <section key={site} className="plan-site">
              <h3>
                <button
                  type="button"
                  className="box"
                  role="checkbox"
                  aria-checked={all ? true : ids.some((i) => picked.has(i)) ? "mixed" : false}
                  aria-label={`Every change on ${site}`}
                  onClick={() => toggle(ids, !all)}
                />
                {site}
              </h3>
              <ul className="plan-list">
                {ids.map((i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className="box"
                      role="checkbox"
                      aria-checked={picked.has(i)}
                      aria-label={`${rows[i].label} on ${site}`}
                      onClick={() => toggle([i], !picked.has(i))}
                    />
                    <span className="grow">{rows[i].label}</span>
                    <Versions from={rows[i].from} to={rows[i].to} />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <ul className="plan-list confirm">
          {chosen.map((r, i) => (
            <li key={i}>
              <span className="grow">
                <b>{r.site}</b>, {r.label}
              </span>
              <Versions from={r.from} to={r.to} />
            </li>
          ))}
        </ul>
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
  const finished = items.filter((i) => i.state === "done" || i.state === "failed").length;
  const failed = items.filter((i) => i.state === "failed");
  const over = job?.finished_at != null;
  const summary = !job
    ? "Starting…"
    : over
      ? failed.length
        ? `Finished. ${plural(items.length - failed.length, "change")} done, ${failed.length} failed.`
        : items.length === 1
          ? "Finished. The change is done."
          : `Finished. All ${items.length} changes done.`
      : `${finished} of ${items.length} finished${failed.length ? `, ${failed.length} failed` : ""}. You can close this panel; it keeps running.`;
  return (
    <Sheet
      title={over ? title : `${title}: running`}
      intro={<span role="status">{summary}</span>}
      onClose={onClose}
      footer={
        <>
          <span className="grow" />
          {over && failed.length > 0 && (
            <Button
              onClick={() =>
                onRetry(
                  failed.filter((i) => i.site_id != null).map((i) => ({ site_id: i.site_id!, action: i.action })),
                  `Try again: ${title}`,
                )
              }
            >
              Try the {plural(failed.length, "failed change")} again
            </Button>
          )}
          <Button kind={over ? "primary" : undefined} onClick={onClose}>
            {over ? "Close" : "Hide this panel"}
          </Button>
        </>
      }
    >
      {steps}
      <div
        className="bar-progress"
        role="progressbar"
        aria-label="Changes finished"
        aria-valuemin={0}
        aria-valuemax={items.length || 1}
        aria-valuenow={finished}
      >
        <span style={{ width: `${items.length ? (finished / items.length) * 100 : 0}%` }} />
      </div>
      <ul className="plan-list progress">
        {items.map((i) => (
          <li key={i.id}>
            <span className={`tag state ${STATE_TONE[i.state]}`}>{STATE_WORD[i.state]}</span>
            <span className="grow">
              {i.site_name}, {i.label}
              {i.state === "failed" && <span className="why danger">{i.message}</span>}
              {i.state === "done" && i.message && i.message !== "Done." && <span className="why">{i.message}</span>}
            </span>
            <Versions from={i.from_version} to={i.to_version} />
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
