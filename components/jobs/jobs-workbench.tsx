"use client";
import { Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isAbortError,
  type JobRecord,
  type JobsClient,
  jobsClient,
} from "@/lib/jobs/client";
import { JOB_LIMITS } from "@/lib/jobs/contract";

const ACTIVE_STATES = new Set(["queued", "running", "awaiting_approval"]);

const STATE_LABEL: Record<JobRecord["state"], string> = {
  queued: "Queued",
  running: "Running",
  awaiting_approval: "Awaiting approval",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
};

const STATE_VARIANT: Record<
  JobRecord["state"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "secondary",
  running: "default",
  awaiting_approval: "outline",
  completed: "secondary",
  cancelled: "outline",
  failed: "destructive",
};

const ERROR_TEXT: Record<string, string> = {
  job_limits: "The job reached its attempt or time limit.",
  job_source_unavailable:
    "The source artifact revision is no longer available.",
  job_approval_expired: "The approval window expired before the job continued.",
  job_invite_required:
    "The job stopped because the invite is no longer active.",
};

function shortId(id: string) {
  return `${id.slice(0, 8)}…`;
}

function formatExpiry(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.getTime() <= Date.now()
    ? `expired ${date.toLocaleString()}`
    : date.toLocaleString();
}

function JobDetails({ job }: { job: JobRecord }) {
  return (
    <dl className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <dt className="font-medium">Job id</dt>
        <dd className="min-w-0 break-all font-mono text-xs">{job.id}</dd>
      </div>
      {/* Identity only: the artifacts API serves current head content, so no
      revision-pinned download is offered here. */}
      <div className="flex flex-wrap gap-2">
        <dt className="font-medium">Source</dt>
        <dd className="min-w-0 break-all font-mono text-xs">
          {job.source.artifactId} · version {job.source.version}
        </dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="font-medium">Action revision</dt>
        <dd className="font-mono text-xs">{job.actionRevision}</dd>
      </div>
      <div className="flex flex-wrap gap-2">
        <dt className="font-medium">Checkpoint digest</dt>
        <dd className="font-mono text-xs" title={job.checkpoint ?? undefined}>
          {job.checkpoint ? `${job.checkpoint.slice(0, 16)}…` : "none"}
        </dd>
      </div>
      {job.approvalExpiresAt && (
        <div className="flex flex-wrap gap-2">
          <dt className="font-medium">Approval expiry</dt>
          <dd>{formatExpiry(job.approvalExpiresAt)}</dd>
        </div>
      )}
      {job.error && (
        <div className="flex flex-wrap gap-2">
          <dt className="font-medium">Stopped</dt>
          <dd>{ERROR_TEXT[job.error] ?? job.error}</dd>
        </div>
      )}
      {job.proposal && (
        <div className="space-y-1">
          <dt className="font-medium">Proposed report (plain text)</dt>
          <dd className="whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-xs">
            {job.proposal}
          </dd>
        </div>
      )}
      {job.state === "completed" && job.resultArtifactId && (
        <div className="flex flex-wrap gap-2">
          <dt className="font-medium">Result</dt>
          <dd>
            <a
              className="underline underline-offset-4"
              href={`/api/artifacts?id=${encodeURIComponent(job.resultArtifactId)}&download=source`}
            >
              Download completed report
            </a>
          </dd>
        </div>
      )}
    </dl>
  );
}

export function JobsWorkbench({
  client = jobsClient,
  pollMs = 10_000,
}: {
  client?: JobsClient;
  pollMs?: number;
}) {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<JobRecord | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");

  // Cancellation bumps this sequence; every list/detail read captures it at
  // start and discards its result if a cancel began after, so an older
  // authoritative response can never revert a cancellation in the UI.
  const cancelSeq = useRef(0);
  // One controller for in-flight list/detail reads; superseded reads, hidden
  // tabs and unmount abort it.
  const readsAbort = useRef<AbortController | null>(null);
  const cancelAbort = useRef<AbortController | null>(null);
  const listActive = useRef(0);
  const cancelBusy = useRef(false);
  // The opener and the job it targeted drive focus return (F04 dialog
  // contract), including when the Cancel button unmounts after success.
  const cancelTargetRef = useRef<JobRecord | null>(null);
  const cancelTriggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const beginRead = useCallback(() => {
    readsAbort.current?.abort();
    const controller = new AbortController();
    readsAbort.current = controller;
    return controller;
  }, []);

  const load = useCallback(
    async (options?: { force?: boolean }) => {
      if (!options?.force && listActive.current > 0) return;
      listActive.current += 1;
      setLoadFailed(false);
      const seqAtStart = cancelSeq.current;
      const controller = beginRead();
      try {
        const next = await client.list(controller.signal);
        if (cancelSeq.current !== seqAtStart || controller.signal.aborted)
          return;
        setJobs(next);
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted)
          setLoadFailed(true);
      } finally {
        listActive.current -= 1;
      }
    },
    [beginRead, client],
  );

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!options?.force && listActive.current > 0) return;
      listActive.current += 1;
      setRefreshing(true);
      const seqAtStart = cancelSeq.current;
      const controller = beginRead();
      try {
        const next = await client.list(controller.signal);
        if (cancelSeq.current !== seqAtStart || controller.signal.aborted)
          return;
        setJobs(next);
        setNotice("");
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted)
          setNotice("Could not refresh. Showing the last known status.");
      } finally {
        listActive.current -= 1;
        if (listActive.current === 0) setRefreshing(false);
      }
    },
    [beginRead, client],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const hasActive = !!jobs?.some((job) => ACTIVE_STATES.has(job.state));
  useEffect(() => {
    if (!hasActive) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [hasActive, pollMs, refresh]);

  // In-flight reads stop when the page is hidden or left entirely; intentional
  // aborts are never shown as failures by the catch paths above.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") readsAbort.current?.abort();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      readsAbort.current?.abort();
      cancelAbort.current?.abort();
    };
  }, []);

  const restoreCancelFocus = useCallback(() => {
    const jobId = cancelTargetRef.current?.id;
    if (!jobId) return;
    const trigger = cancelTriggerRefs.current.get(jobId);
    if (trigger?.isConnected) {
      trigger.focus();
      return;
    }
    // The row's Cancel button unmounts once the job is terminal; the Details
    // button is the stable fallback in that row.
    document
      .querySelector<HTMLButtonElement>(`[data-job-details="${jobId}"]`)
      ?.focus();
  }, []);

  const openCancelDialog = useCallback((job: JobRecord) => {
    cancelTargetRef.current = job;
    setCancelError("");
    setCancelTarget(job);
  }, []);

  const cancelJob = useCallback(async () => {
    const target = cancelTargetRef.current;
    if (!target || cancelBusy.current) return;
    cancelBusy.current = true;
    cancelSeq.current += 1;
    readsAbort.current?.abort();
    const controller = new AbortController();
    cancelAbort.current = controller;
    setCancelling(true);
    setCancelError("");
    try {
      const updated = await client.cancel(target.id, controller.signal);
      // The cancel's own result always applies; older list/detail reads were
      // invalidated above and discard themselves.
      setJobs(
        (previous) =>
          previous?.map((job) => (job.id === updated.id ? updated : job)) ??
          previous,
      );
      setExpanded((previous) => (previous === target.id ? null : previous));
      setCancelTarget(null);
      // Storage is authoritative: await a fresh list that supersedes any
      // pre-cancel request still in flight.
      await refresh({ force: true });
    } catch (error) {
      if (!isAbortError(error) && !controller.signal.aborted)
        setCancelError(
          "The cancellation did not complete. Try again, or keep the job and refresh to see its current status.",
        );
    } finally {
      cancelBusy.current = false;
      setCancelling(false);
      if (cancelAbort.current === controller) cancelAbort.current = null;
    }
  }, [client, refresh]);

  const toggleDetails = useCallback(
    async (job: JobRecord) => {
      const next = expanded === job.id ? null : job.id;
      setExpanded(next);
      if (next !== job.id) return;
      const seqAtStart = cancelSeq.current;
      const controller = beginRead();
      try {
        const current = await client.read(job.id, controller.signal);
        if (cancelSeq.current !== seqAtStart || controller.signal.aborted)
          return;
        setJobs(
          (previous) =>
            previous?.map((entry) =>
              entry.id === current.id ? current : entry,
            ) ?? previous,
        );
      } catch {
        // The list stays usable if a single detail read fails or is aborted;
        // intentional aborts must never surface as errors.
      }
    },
    [beginRead, client, expanded],
  );

  return (
    <main className="mx-auto w-full min-w-0 max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link
          href="/chat"
          className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Conversations
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          Durable jobs
        </h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
          Status of durable jobs recorded for your account. Storage is the
          source of truth for every state shown here.
        </p>
      </div>
      <section
        aria-label="Availability notice"
        className="rounded-lg border border-border p-4"
      >
        <h2 className="text-sm font-medium">Viewing only</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Starting new jobs, approving proposals and worker delivery are not
          available from this page: production worker delivery is not
          configured. Existing job records are shown as stored, including ones
          awaiting approval that cannot be approved here.
        </p>
      </section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Jobs</h2>
        <Button
          variant="outline"
          size="sm"
          aria-busy={refreshing}
          onClick={() => void refresh({ force: true })}
        >
          <RefreshCw
            aria-hidden="true"
            className={`size-4 motion-reduce:animate-none ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>
      <div role="alert" aria-live="assertive">
        {notice && <p className="text-sm text-destructive">{notice}</p>}
      </div>
      {loadFailed ? (
        <div className="rounded-lg border border-border p-4 text-center">
          <p role="alert" className="text-sm text-destructive">
            Durable jobs could not be loaded.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void load({ force: true })}
          >
            Try again
          </Button>
        </div>
      ) : jobs === null ? (
        <output
          aria-busy="true"
          className="flex items-center justify-center gap-2 py-16 text-muted-foreground"
        >
          <Loader2
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          Loading durable jobs…
        </output>
      ) : jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No durable jobs are recorded for your account. Job records appear here
          once jobs have been created through a configured delivery path.
        </p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li key={job.id} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={STATE_VARIANT[job.state]}>
                    {STATE_LABEL[job.state]}
                  </Badge>
                  <span className="min-w-0 break-all font-mono text-xs text-muted-foreground">
                    {shortId(job.id)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Attempt {job.attempts} of {JOB_LIMITS.attempts}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={expanded === job.id}
                    data-job-details={job.id}
                    onClick={() => void toggleDetails(job)}
                  >
                    {expanded === job.id ? "Hide details" : "Details"}
                  </Button>
                  {ACTIVE_STATES.has(job.state) && (
                    <Button
                      variant="outline"
                      size="sm"
                      ref={(element) => {
                        if (element)
                          cancelTriggerRefs.current.set(job.id, element);
                        else cancelTriggerRefs.current.delete(job.id);
                      }}
                      onClick={() => openCancelDialog(job)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Source revision {job.source.version} of{" "}
                <span className="break-all font-mono text-xs">
                  {job.source.artifactId}
                </span>
                {job.state === "awaiting_approval" &&
                  " · approval cannot be given here: production worker delivery is not configured"}
              </p>
              {job.error && (
                <p className="mt-1 text-sm text-destructive">
                  {ERROR_TEXT[job.error] ?? job.error}
                </p>
              )}
              {expanded === job.id && (
                <div className="mt-3">
                  <JobDetails job={job} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreCancelFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this durable job?</AlertDialogTitle>
            <AlertDialogDescription>
              Cancelling prevents future attempts of this job. It does not
              guarantee that work already in progress has terminated, and it
              does not issue any refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div role="alert" aria-live="assertive">
            {cancelError && (
              <p className="text-sm text-destructive">{cancelError}</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>
              Keep job
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancelling}
              aria-busy={cancelling}
              onClick={(event) => {
                event.preventDefault();
                void cancelJob();
              }}
            >
              {cancelling ? (
                <Loader2
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {cancelling ? "Cancelling…" : "Cancel job"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Job records are private saved data and are included in account export
        and deletion. Cancellation is not proof that remote work stopped; this
        local fixture adapter starts no remote work.
      </p>
    </main>
  );
}
