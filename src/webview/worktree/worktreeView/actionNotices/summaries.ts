// src/webview/worktree/worktreeView/actionNotices/summaries.ts — The sentences
// a provisioning result is read as: what came over, what was left, and why.
//
// Extracted from `actionNotices.ts` by change `decompose-worktree-view`
// (design.md D1, task 3_12). The three summarisers are pure — result in,
// sentence out — and sat below the notice machinery that places and retires the
// DOM, which is state and timers. Nothing in them touches either.
//
// The timer map and `dispose` deliberately did NOT come: separating them is
// OBL-2's defeater.

import type { ProvisionResultContest, ProvisionStepResult, WorktreeActionResult } from "../../worktreeViewTypes";

export function setupSummary(
  setup: WorktreeActionResult["setup"],
): { body: string; tone: "neutral" | "warn"; reason?: string } | undefined {
  if (setup === undefined || setup.length === 0) {
    return undefined;
  }
  const ok = setup.filter((step) => step.outcome.kind === "ok");
  const failed = setup.filter((step) => step.outcome.kind === "failed");
  const skipped = setup.filter((step) => step.outcome.kind === "skipped");
  const body = [
    `${ok.length} of ${setup.length} setup steps completed.`,
    ...(failed.length === 0 ? [] : [`${failed.length} failed.`]),
    ...(skipped.length === 0 ? [] : [`${skipped.length} skipped.`]),
  ].join(" ");
  const reasons = [...failed, ...skipped].map(
    (step) => `${step.script}: ${"reason" in step.outcome ? step.outcome.reason : step.outcome.kind}`,
  );
  return {
    body,
    tone: failed.length === 0 && skipped.length === 0 ? "neutral" : "warn",
    ...(reasons.length === 0 ? {} : { reason: reasons.join("\n") }),
  };
}

export function portSummary(
  ports: WorktreeActionResult["ports"],
  warnings: WorktreeActionResult["portWarnings"],
): { body: string; tone: "neutral" | "warn"; reason?: string } | undefined {
  if ((ports === undefined || ports.length === 0) && (warnings === undefined || warnings.length === 0)) {
    return undefined;
  }
  const byName = new Map<string, NonNullable<WorktreeActionResult["ports"]>[number]>();
  const priority = (port: NonNullable<WorktreeActionResult["ports"]>[number]): number => {
    if (port.outcome.kind === "failed") {
      return 3;
    }
    return port.preview !== undefined && port.preview !== port.outcome.port ? 2 : 1;
  };
  for (const port of ports ?? []) {
    const current = byName.get(port.name);
    if (current === undefined || priority(port) > priority(current)) {
      byName.set(port.name, port);
    }
  }
  const unique = [...byName.values()];
  const ready = unique.filter((port) => port.outcome.kind !== "failed");
  const failed = unique.filter((port) => port.outcome.kind === "failed");
  const moved = ready.filter(
    (port) => port.preview !== undefined && port.outcome.kind !== "failed" && port.preview !== port.outcome.port,
  );
  const warningText = [
    ...(warnings?.includes("lockReleaseFailed")
      ? ["The allocation lock could not be released; later port allocations may be blocked."]
      : []),
    ...(warnings?.includes("lockRetained")
      ? [
          "A repository lock was retained because a timed-out write may still finish; related worktree setup may remain blocked until cleanup.",
        ]
      : []),
    ...(warnings?.includes("temporaryCleanupFailed")
      ? ["Port claims were saved, but temporary-file cleanup did not finish."]
      : []),
    ...(warnings?.includes("excludeFailed")
      ? ["The repository-local exclude could not be updated; .env.worktree may appear in Git status."]
      : []),
  ];
  const body = [
    ...(unique.length === 0 ? [] : [`${ready.length} of ${unique.length} ports ready.`]),
    ...warningText,
  ].join(" ");
  const reasons = [
    ...moved.map(
      (port) => `${port.name}: ${port.preview} → ${port.outcome.kind === "failed" ? "failed" : port.outcome.port}`,
    ),
    ...failed.map((port) => `${port.name}: ${port.outcome.kind === "failed" ? port.outcome.reason : "failed"}`),
  ];
  return {
    body,
    tone: failed.length > 0 || warningText.length > 0 ? "warn" : "neutral",
    ...(reasons.length === 0 ? {} : { reason: reasons.join("\n") }),
  };
}

/**
 * One sentence about what was brought over, and the reasons behind it.
 *
 * `refused` and `failed` are the two the user has to be told about: the first
 * is a rule they can work around, the second is something that went wrong.
 * `skipped` is neither — it means the file was already there — so it is
 * counted and not dwelt on.
 */
export function provisionSummary(
  steps: readonly ProvisionStepResult[] | undefined,
  contests: readonly ProvisionResultContest[] = [],
): { body: string; tone: "neutral" | "warn"; reason?: string } | undefined {
  /**
   * Which contest a row belongs to — a marker, never the membership.
   *
   * Rebuilding the full list per row put the `O(N²)` the wire had just shed
   * straight back into the notice and the DOM (.reviews/round-1.md F001). The
   * membership is listed once, below the rows, and each row carries only a
   * number into it.
   *
   * An index that does not resolve is SAID rather than dropped: silently
   * falling back to the bare reason removes every declaring file exactly where
   * the obligation to name them lives (F002).
   */
  const cited = new Set<number>();
  const withContest = (step: ProvisionStepResult, reason: string): string => {
    if (step.contest === undefined) {
      return reason;
    }
    const members = contests[step.contest]?.members;
    if (members === undefined || members.length === 0) {
      return `${reason} [contest ${step.contest + 1}, which was not reported]`;
    }
    cited.add(step.contest);
    return `${reason} [contest ${step.contest + 1}]`;
  };

  /** Each cited contest's membership, once, in index order. */
  const contestLines = (): readonly string[] =>
    [...cited]
      .sort((a, b) => a - b)
      .map(
        (at) =>
          `Contest ${at + 1}, one destination these may all name: ${(contests[at]?.members ?? [])
            .map((member) => `${member.path} (declared in ${member.source})`)
            .join(", ")}`,
      );
  if (steps === undefined || steps.length === 0) {
    return undefined;
  }
  // Arrival is what this apply WROTE. `skipped` means the destination was
  // already there, so counting it said "1 of 1 brought over" for an apply that
  // wrote nothing (.reviews/round-4.md F026).
  const bad = steps.filter((s) => s.outcome.kind === "refused" || s.outcome.kind === "failed");
  const untouched = steps.filter((s) => s.outcome.kind === "skipped");
  // A link the platform refused is not a link the provider got. PLAN Acceptance
  // requires the degradation be said per entry, and rendered as a plain copy it
  // was said nowhere.
  const degraded = steps.filter((s) => s.outcome.kind === "degradedToCopy");
  const arrived = steps.length - bad.length - untouched.length;
  // A directory entry has one outcome and many nodes: it reports `copied` while
  // descendants inside it were skipped or refused. Counting only the top level
  // told the user everything arrived when some of it had not (round-2 F018).
  const inside = steps.flatMap((s) => s.details ?? []);
  const counts = [
    `${arrived} of ${steps.length} brought over.`,
    ...(degraded.length === 0 ? [] : [`${degraded.length} copied instead of linked.`]),
    ...(untouched.length === 0 ? [] : [`${untouched.length} already there.`]),
  ];
  if (bad.length === 0 && inside.length === 0 && degraded.length === 0 && untouched.length === 0) {
    return { body: counts[0] ?? "", tone: "neutral" };
  }
  const body = counts.join(" ");
  return {
    body: inside.length === 0 ? body : `${body} ${inside.length} inside them did not arrive.`,
    tone: "warn",
    reason: [
      ...bad.map((s) => `${s.path}: ${withContest(s, "reason" in s.outcome ? s.outcome.reason : s.outcome.kind)}`),
      ...degraded.map((s) => `${s.path}: the platform had no symlink to give, so it was copied`),
      ...untouched.map(
        (s) => `${s.path}: ${withContest(s, "reason" in s.outcome ? s.outcome.reason : s.outcome.kind)}`,
      ),
      ...inside.map((d) => `${d.path}: ${d.reason}`),
      // After the rows, because it explains them.
      ...contestLines(),
    ].join("\n"),
  };
}
