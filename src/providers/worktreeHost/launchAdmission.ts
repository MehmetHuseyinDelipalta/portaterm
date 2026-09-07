// src/providers/worktreeHost/launchAdmission.ts — What this window will let a
// surface start, and whether the request in hand came from that answer.
//
// Extracted from `createWorktreeHost` by change `decompose-worktree-host`
// (design.md D1, task 2_2). Admission checked one WeakMap and one counter that
// sat 900 lines above it among the provisioning state, so "which offer is this
// request quoting" could only be asked by building a host and posting at it.
//
// `offerSeq` came with them. It is declared beside the provisioning fields but
// minted only by `publishLaunchTargets`, and a binding belongs to its WRITER
// (OBL-7): every offer id this host hands out is issued here, so the ids stay
// monotonic because nothing else can advance the sequence.
//
// `launchTarget` did NOT come: it reads the current cache, which is a lookup
// (task 2_5), and it arrives as a dep.

import type { WorktreeAgentLaunchFields } from "../../types/messages";
import { MAX_CONTINUATION_INSTRUCTION } from "../../vault/continuationLimits";
import type { VaultLaunchTarget } from "../../vault/types";
import type { AdmittedLaunch, LaunchTargetRecord, WorktreeActions, WorktreeSurface } from "./hostTypes";

/**
 * The published bound on a seed prompt. Absent is fine — a launch without one
 * is not an error; oversized is not, and it is refused rather than truncated,
 * because a silently shortened first turn is a different instruction.
 */
export function admissiblePrompt(prompt: unknown): prompt is string | undefined {
  return prompt === undefined || (typeof prompt === "string" && prompt.length <= MAX_CONTINUATION_INSTRUCTION);
}

export interface LaunchAdmissionDeps {
  /** `options.actions`, read at call time rather than captured. */
  actions(): WorktreeActions | undefined;
  /** The registration the host currently publishes for one worktree (task 2_5). */
  launchTarget(worktreeId: string): LaunchTargetRecord | undefined;
}

export interface LaunchAdmission {
  /** Everything about a launch that the host itself published, re-checked. */
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  /** The target a request named, only if it quoted the current registration. */
  admittedTarget(fields: unknown): AdmittedLaunch | undefined;
  /** Resolve the start-capable targets for `surface`, remember them, and answer. */
  publishLaunchTargets(surface: WorktreeSurface): Promise<void>;
  /** The launcher's option bag, with absent fields absent rather than undefined. */
  launchOpts(fields: WorktreeAgentLaunchFields): { permissionChoiceId?: string; prompt?: string };
}

export function createLaunchAdmission(deps: LaunchAdmissionDeps): LaunchAdmission {
  /**
   * What each surface was told it could start, keyed by the surface itself so a
   * detached one takes its answer with it. Admission checks THIS, not a fresh
   * probe: the offer is what the request has to have come from.
   */
  const publishedTargets = new WeakMap<WorktreeSurface, { offerId: string; targets: readonly VaultLaunchTarget[] }>();

  /** Monotonic, so a re-published answer supersedes the one in flight. */
  let offerSeq = 0;

  return {
    /**
     * The shapes are read as `unknown` rather than trusted from the message
     * type: the router asserts a name, not a payload, so a field that is null or
     * a number reaches this function exactly as a well-formed one does.
     */
    admissibleLaunch(surface, fields) {
      if (typeof fields !== "object" || fields === null) {
        return false;
      }
      const { agent, permissionChoiceId, prompt, offerId } = fields as Record<string, unknown>;
      if (typeof agent !== "string" || !admissiblePrompt(prompt)) {
        return false;
      }
      if (permissionChoiceId !== undefined && typeof permissionChoiceId !== "string") {
        return false;
      }
      const offer = publishedTargets.get(surface);
      // The answer this request was chosen from must be the answer this surface
      // currently holds. A post that never arrived leaves the panel quoting an id
      // the host has replaced, and refusing that is the safe direction: the user
      // sees an action do nothing rather than one act on a list nobody rendered.
      if (offer === undefined || offerId !== offer.offerId) {
        return false;
      }
      const target = offer.targets.find((t) => t.agent === agent);
      if (target === undefined) {
        return false;
      }
      // A prompt for an agent that cannot be seeded would be silently dropped by
      // the builder, which is the one outcome worse than refusing it.
      if (prompt !== undefined && prompt !== "" && !target.canSeedPrompt) {
        return false;
      }
      return permissionChoiceId === undefined || target.permissionChoices.some((c) => c.id === permissionChoiceId);
    },

    /**
     * Only reached where a worktree already exists — a create names no worktree
     * yet, and stays outside this guard by design (design.md D10).
     */
    admittedTarget(fields) {
      const { worktreeId, generation } = fields as Record<string, unknown>;
      if (typeof worktreeId !== "string") {
        return undefined;
      }
      const target = deps.launchTarget(worktreeId);
      if (target === undefined || generation !== target.generation) {
        return undefined;
      }
      return { worktreeId, ...target };
    },

    async publishLaunchTargets(surface) {
      const targets = (await deps.actions()?.launchTargets?.()) ?? [];
      offerSeq += 1;
      const offerId = `offer-${offerSeq}`;
      publishedTargets.set(surface, { offerId, targets });
      surface.post({ type: "vaultLaunchTargets", capability: "start", targets: [...targets], offerId });
    },

    launchOpts(fields) {
      return {
        ...(fields.permissionChoiceId === undefined ? {} : { permissionChoiceId: fields.permissionChoiceId }),
        ...(fields.prompt === undefined ? {} : { prompt: fields.prompt }),
      };
    },
  };
}
