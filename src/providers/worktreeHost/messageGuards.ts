// src/providers/worktreeHost/messageGuards.ts — Shape predicates over inbound messages.
//
// Moved out of `createWorktreeHost` by change `decompose-worktree-host-controller`
// (design.md D1). These check the SHAPE of a message that crossed `postMessage`,
// where the type is gone; they hold no host state and capture nothing, which is
// why they can live outside the host closure at all.

import type {
  BranchDeleteRequest,
  DestinationDisposition,
  ProvisionSelection,
  WorktreeActionMessage,
  WorktreeAfterCreate,
  WorktreeCopyFileAskMessage,
  WorktreeCreateMode,
  WorktreeProvisionSaveMessage,
  WorktreeProvisionSwitchMessage,
  WorktreeSetupStepAskMessage,
} from "../../types/messages";
import { MAX_MODEL_ROWS } from "../../worktree/provisioning/providerKit";

/**
 * Is this an opening the host could have issued?
 *
 * Openings are minted by increment from 1, so a safe positive integer is the
 * whole shape check. Lives here rather than beside the opening maps because the
 * guards below call it and it captures nothing.
 */
export function namedOpening(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Does this object carry ONLY the keys its variant declares?
 *
 * A variant that merely has the fields it requires is not the variant: the
 * union's whole safety property is that `reuse` cannot carry a base ref and a
 * non-launching after-create cannot carry an agent. `messages.contract.test.ts`
 * proves a typed producer cannot build those, but a message crosses
 * `postMessage`, where the type is gone — so the same exactness is re-checked
 * here or it is not checked at all (round-1 B2, W1).
 *
 * A forbidden key is refused whatever it holds, `undefined` included. Treating
 * an undefined value as absence sounds harmless — it is what an optional field
 * can look like after a serialization round trip — but every optional field a
 * variant legitimately has is already named in its own allow-list, so the only
 * keys the exemption ever admitted were the forbidden ones: `reuse` with
 * `baseRef: undefined`, `none` with `agent: undefined` (round-2 W1). Whether an
 * ALLOWED key may hold `undefined` stays the variant validator's decision.
 */
function onlyKeys(value: unknown, allowed: readonly string[]): boolean {
  return Object.keys(value as Record<string, unknown>).every((key) => allowed.includes(key));
}

/**
 * Does this inbound value name one of the five branch modes, with the fields
 * that mode requires?
 *
 * A discriminant the webview invented would otherwise reach `sourceOf`, whose
 * `switch` is total over the five and therefore has no arm to catch it.
 */
export function isKnownCreateMode(mode: unknown): mode is WorktreeCreateMode {
  if (typeof mode !== "object" || mode === null) {
    return false;
  }
  const m = mode as { kind?: unknown; branch?: unknown; baseRef?: unknown; repairPath?: unknown };
  const named = (v: unknown): boolean => typeof v === "string" && v.length > 0;
  switch (m.kind) {
    case "fresh":
      return (
        onlyKeys(mode, ["kind", "branch", "baseRef"]) &&
        named(m.branch) &&
        (m.baseRef === undefined || named(m.baseRef))
      );
    case "fresh-detached":
      return onlyKeys(mode, ["kind", "baseRef"]) && named(m.baseRef);
    case "reuse":
      return onlyKeys(mode, ["kind", "branch"]) && named(m.branch);
    case "reattach":
      return (
        onlyKeys(mode, ["kind", "branch", "repairPath", "expectedOid"]) &&
        named(m.branch) &&
        named(m.repairPath) &&
        named((mode as { expectedOid?: unknown }).expectedOid)
      );
    case "adopt":
      return (
        onlyKeys(mode, ["kind", "branch", "adoptPath", "expectedBranchOid"]) &&
        named(m.branch) &&
        named((mode as { adoptPath?: unknown }).adoptPath) &&
        named((mode as { expectedBranchOid?: unknown }).expectedBranchOid)
      );
    default:
      return false;
  }
}

/**
 * Which destination rule the create may ask for.
 *
 * `debris` is refused outright, not merely unvalidated. It selects
 * `mustMatchDebrisAuthorization`, which drops the emptiness requirement on the
 * strength of a fingerprint the host issued — and this extension has no debris
 * producer and no store to redeem one against until WT-012.12. Admitting the
 * variant here would let an inbound message weaken the destination rule with
 * an authorization nobody ever granted (round-1 B1).
 */
/**
 * A selection is two fields and nothing else: an offer id, and the ids ticked
 * in it. Both are strings the webview chose, so both are checked here rather
 * than downstream — the resolution below reads them the moment this returns.
 */
export function isKnownProvision(provision: unknown): provision is ProvisionSelection {
  if (typeof provision !== "object" || provision === null || !onlyKeys(provision, ["offerId", "itemIds"])) {
    return false;
  }
  const p = provision as { offerId?: unknown; itemIds?: unknown };
  return (
    typeof p.offerId === "string" &&
    p.offerId.length > 0 &&
    Array.isArray(p.itemIds) &&
    p.itemIds.every((id) => typeof id === "string")
  );
}

export function isKnownMigration(value: unknown): value is { readonly offerId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    onlyKeys(value, ["offerId"]) &&
    typeof (value as { offerId?: unknown }).offerId === "string" &&
    (value as { offerId: string }).offerId.length > 0
  );
}

/** Setup capabilities carry exactly the opaque values the host can redeem. */
export function isKnownSetupRetry(msg: unknown): msg is Extract<WorktreeActionMessage, { type: "worktreeSetupRetry" }> {
  if (typeof msg !== "object" || msg === null || !onlyKeys(msg, ["type", "worktreeId", "retryId"])) {
    return false;
  }
  const m = msg as { worktreeId?: unknown; retryId?: unknown };
  return (
    typeof m.worktreeId === "string" && m.worktreeId.length > 0 && typeof m.retryId === "string" && m.retryId.length > 0
  );
}

export function isKnownSetupOutput(
  msg: unknown,
): msg is Extract<WorktreeActionMessage, { type: "worktreeSetupViewOutput" }> {
  if (typeof msg !== "object" || msg === null || !onlyKeys(msg, ["type", "outputId"])) {
    return false;
  }
  const m = msg as { outputId?: unknown };
  return typeof m.outputId === "string" && m.outputId.length > 0;
}

/**
 * A branch-delete opt-in: five non-empty strings echoed back from a report
 * the host itself issued, and nothing else. Shape only — the guard replaces
 * every OID here with the redeemed fingerprint's own issued evidence, so
 * this check exists to keep a malformed payload from reaching that redeem
 * call at all, not to make the OIDs here trustworthy (design.md D2, D10).
 */
export function isKnownDeleteBranchRequest(value: unknown): value is BranchDeleteRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !onlyKeys(value, ["branch", "expectedBranchOid", "defaultBranch", "expectedDefaultOid", "fingerprint"])
  ) {
    return false;
  }
  const v = value as Record<string, unknown>;
  const named = (field: unknown): field is string => typeof field === "string" && field.length > 0;
  return (
    named(v.branch) &&
    named(v.expectedBranchOid) &&
    named(v.defaultBranch) &&
    named(v.expectedDefaultOid) &&
    named(v.fingerprint)
  );
}

/**
 * A switch is four scalars and nothing else.
 *
 * The Boundary this enforces: no field of it can carry a file, a path, a
 * command, or a model. `onlyKeys` is what makes that a property of the
 * MESSAGE rather than of the fields this function happens to read — an extra
 * key smuggled alongside would otherwise reach whatever read the payload next.
 */
export function isKnownSwitch(msg: unknown): msg is WorktreeProvisionSwitchMessage {
  if (typeof msg !== "object" || msg === null || !onlyKeys(msg, ["type", "repoId", "opening", "switch", "provider"])) {
    return false;
  }
  const m = msg as { repoId?: unknown; opening?: unknown; switch?: unknown; provider?: unknown };
  return (
    typeof m.repoId === "string" &&
    m.repoId.length > 0 &&
    namedOpening(m.opening) &&
    typeof m.switch === "number" &&
    Number.isInteger(m.switch) &&
    m.switch > 0 &&
    typeof m.provider === "string"
  );
}

export function isKnownSave(msg: unknown): msg is WorktreeProvisionSaveMessage {
  if (
    typeof msg !== "object" ||
    msg === null ||
    !onlyKeys(msg, ["type", "repoId", "opening", "switch", "offerId", "kept"])
  ) {
    return false;
  }
  const m = msg as {
    repoId?: unknown;
    opening?: unknown;
    switch?: unknown;
    offerId?: unknown;
    kept?: unknown;
  };
  return (
    typeof m.repoId === "string" &&
    m.repoId.length > 0 &&
    namedOpening(m.opening) &&
    typeof m.switch === "number" &&
    Number.isInteger(m.switch) &&
    m.switch > 0 &&
    typeof m.offerId === "string" &&
    m.offerId.length > 0 &&
    Array.isArray(m.kept) &&
    // Bounded, though the ids are host-minted and every one of them is checked
    // against the offer: an oversized array costs work rather than authority,
    // and this is the one array in the pair that had no bound at all
    // (.reviews/round-1.md F016).
    m.kept.length <= MAX_MODEL_ROWS &&
    m.kept.every((id) => typeof id === "string")
  );
}

/**
 * The same Boundary as `isKnownSwitch`, one level deeper: `onlyKeys` on the
 * message AND on `op`, and `kind` checked as a literal — the union is erased
 * at runtime, so a discriminant the webview invented would otherwise reach a
 * `switch` with no arm for it (plan attack F5). Nothing here can carry text.
 */
export function isKnownCopyFileAsk(msg: unknown): msg is WorktreeCopyFileAskMessage {
  if (typeof msg !== "object" || msg === null || !onlyKeys(msg, ["type", "repoId", "opening", "switch"])) {
    return false;
  }
  const m = msg as { repoId?: unknown; opening?: unknown; switch?: unknown };
  return (
    typeof m.repoId === "string" &&
    m.repoId.length > 0 &&
    namedOpening(m.opening) &&
    typeof m.switch === "number" &&
    Number.isInteger(m.switch) &&
    m.switch > 0
  );
}

export function isKnownStepAsk(msg: unknown): msg is WorktreeSetupStepAskMessage {
  if (typeof msg !== "object" || msg === null || !onlyKeys(msg, ["type", "repoId", "opening", "switch", "op"])) {
    return false;
  }
  const m = msg as { repoId?: unknown; opening?: unknown; switch?: unknown; op?: unknown };
  if (
    typeof m.repoId !== "string" ||
    m.repoId.length === 0 ||
    !namedOpening(m.opening) ||
    typeof m.switch !== "number" ||
    !Number.isInteger(m.switch) ||
    m.switch <= 0 ||
    typeof m.op !== "object" ||
    m.op === null
  ) {
    return false;
  }
  const op = m.op as { kind?: unknown; offerId?: unknown; itemId?: unknown };
  if (op.kind === "add") {
    return onlyKeys(op, ["kind"]);
  }
  if (op.kind !== "edit" && op.kind !== "remove") {
    return false;
  }
  return (
    onlyKeys(op, ["kind", "offerId", "itemId"]) &&
    typeof op.offerId === "string" &&
    op.offerId.length > 0 &&
    typeof op.itemId === "string" &&
    op.itemId.length > 0
  );
}

export function isKnownDisposition(disposition: unknown): disposition is DestinationDisposition {
  if (typeof disposition !== "object" || disposition === null) {
    return false;
  }
  const d = disposition as { kind?: unknown; authorization?: unknown };
  if (d.kind === "free") {
    return onlyKeys(disposition, ["kind"]);
  }
  // The debris variant authorizes a DELETE, so every field is checked rather
  // than trusted: without this the create was dropped here and the whole
  // recover path was unreachable in production (round-1 B2).
  if (d.kind !== "debris" || !onlyKeys(disposition, ["kind", "authorization"])) {
    return false;
  }
  const auth = d.authorization as { path?: unknown; fingerprint?: unknown } | null;
  return (
    typeof auth === "object" &&
    auth !== null &&
    typeof auth.path === "string" &&
    auth.path.length > 0 &&
    typeof auth.fingerprint === "string" &&
    auth.fingerprint.length > 0 &&
    onlyKeys(auth, ["path", "fingerprint"])
  );
}

/** The same check for what happens afterwards; the agent variant must name an agent. */
export function isKnownAfterCreate(after: unknown): after is WorktreeAfterCreate {
  if (typeof after !== "object" || after === null) {
    return false;
  }
  const a = after as { kind?: unknown; agent?: unknown; waitForSetup?: unknown };
  switch (a.kind) {
    case "none":
    case "terminal":
    case "newWindow":
    case "addToWorkspace":
      // Exact, not merely sufficient: an agent field on a variant that does not
      // launch is refused rather than ignored. Ignoring it accepts a message
      // that contradicts itself, and leaves the next reader to decide which
      // half was meant (round-1 B2).
      return onlyKeys(after, ["kind"]);
    case "agent":
      return (
        onlyKeys(after, ["kind", "waitForSetup", "agent", "permissionChoiceId", "prompt", "offerId", "generation"]) &&
        // The gate that sequences the agent behind the setup runner. Absent, it
        // reaches the capability as `undefined` and the sequencing changes
        // silently, which is why the boolean is required rather than defaulted.
        typeof a.waitForSetup === "boolean" &&
        typeof a.agent === "string" &&
        a.agent.length > 0
      );
    default:
      return false;
  }
}
