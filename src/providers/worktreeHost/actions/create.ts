// src/providers/worktreeHost/actions/create.ts — Everything the create form asks for.
//
// Extracted from `handleAction` by change `decompose-worktree-host-controller`
// (design.md D1, task 2_4): the eight create arms plus the ten helpers only they
// called. Defaults, refs, probe, destination, debris and the submit itself share
// one opening, one set of maps and one notion of which token is live, which is
// why they cut as a unit rather than one arm at a time.

import type {
  ExtensionToWebViewMessage,
  ProvisionModel,
  ResolvedDisposition,
  WorktreeActionMessage,
} from "../../../types/messages";
import type { MigrationRepositoryBinding } from "../../../worktree/migrateChanges";
import type { ProvisionOfferStore } from "../../../worktree/provisioning/offerStore";
import type { WorktreeRepo } from "../../../worktree/types";
import type { createWorktreeCache } from "../../../worktree/WorktreeCache";
import type { WorktreeHostOptions } from "../../WorktreeHost";
import type { MigrationOffer, Opening, WorktreeActions, WorktreeSurface } from "../hostTypes";
import { namedOpening } from "../messageGuards";
import type { OpeningLifecycle } from "../openingLifecycle";
import { answerDebrisAuthorization } from "./create/debris";
import { handleCreateDefaults } from "./create/defaultsArm";
import { handlePickDestination } from "./create/destinationPick";
import { answerCreateProbe, isWellFormedProbe } from "./create/probes";
import { handleWorktreeRefs } from "./create/refsArm";
import { handleSetupRetry, handleWorktreeCreate } from "./create/submitArm";

/** One arm, once the dispatcher has proved `actions` is there. */
type Arm<T extends WorktreeActionMessage["type"]> = (
  surface: WorktreeSurface,
  msg: Extract<WorktreeActionMessage, { type: T }>,
  actions: WorktreeActions,
) => void;

/**
 * What the create arms need from the host.
 *
 * Maps and the offer store cross by REFERENCE — the host keeps writing to them
 * while a form is open, and a copy would freeze this module's view at wiring
 * time (design.md D4, OBL-4). `disposed` and `bumpMigrationSequence` are
 * accessors because a `let` binding cannot be shared through an object field.
 */
export interface CreateDeps {
  readonly cache: ReturnType<typeof createWorktreeCache>;
  readonly lifecycle: OpeningLifecycle;
  readonly openings: Map<string, Opening>;
  readonly migrationOffers: Map<string, MigrationOffer>;
  readonly migrationReading: Map<
    string,
    { sequence: number; repoId: string; sourceWorktreeId: string; sourceGeneration: number }
  >;
  readonly offers: ProvisionOfferStore;
  readonly provisionBaseline: Map<string, string>;
  readonly provisionReading: Map<string, number>;
  readonly options: WorktreeHostOptions;
  hasSurface(surface: WorktreeSurface): boolean;
  actionPath(worktreeId: string, allowMissing: boolean): string | undefined;
  admissibleLaunch(surface: WorktreeSurface, fields: unknown): boolean;
  currentMigrationRegistration(repoId: string): MigrationRepositoryBinding["registration"] | undefined;
  deliver(surface: WorktreeSurface, message: ExtensionToWebViewMessage): boolean;
  disposed(): boolean;
  bumpMigrationSequence(): number;
  issueWithAdded(
    offerKey: { surface: string; repoId: string },
    slot: string,
    model: ProvisionModel,
  ): { readonly offerId: string; readonly model: ProvisionModel };
  openingFor(s: WorktreeSurface, repoId: string, token: number): Opening | undefined;
  openingKey(s: WorktreeSurface, repoId: string): string;
  perform(run: () => Promise<void>): void;
  previewProvisioning(repo: WorktreeRepo, model: ProvisionModel): Promise<ProvisionModel>;
  repoIdOf(worktreeId: string): string | undefined;
  resolveDestination(
    repo: WorktreeRepo,
    branch: string,
    override?: string,
    chosen?: string,
  ): {
    root: string;
    base: string;
    bare: string;
    freePath: string;
    occupiedCandidate?: { path: string; disposition: ResolvedDisposition };
  };
  retireOpening(key: string): void;
  surfaceKey(s: WorktreeSurface): string;
  vettedOverride(candidate: string | undefined, repo: WorktreeRepo): Promise<string | undefined>;
}

export function createCreateActions(deps: CreateDeps) {
  const { cache, lifecycle, openingFor, retireOpening, surfaceKey } = deps;

  const worktreeCreate: Arm<"worktreeCreate"> = (surface, msg, actions) => {
    handleWorktreeCreate(deps, surface, msg, actions);
  };

  const worktreeSetupRetry: Arm<"worktreeSetupRetry"> = (surface, msg, actions) => {
    handleSetupRetry(deps, surface, msg, actions);
  };

  const worktreePickDestination: Arm<"worktreePickDestination"> = (surface, msg, _actions) => {
    handlePickDestination(deps, surface, msg);
  };

  const worktreeCreateProbe: Arm<"worktreeCreateProbe"> = (surface, msg, _actions) => {
    // The discriminant alone is not the payload. Every field crosses a
    // trust boundary and then enters async logic, where a wrong type is an
    // unhandled rejection rather than a refusal (round-3 W1).
    if (!isWellFormedProbe(msg)) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    // Marked BEFORE the await, which is the whole point: recording it after
    // would leave the window every superseded continuation resumes inside.
    // A probe whose token is not the opening's is unowned — a superseded
    // opening, or a token nobody minted — and must not create sequence
    // state for one (round-4 B7).
    const opening = openingFor(surface, msg.repoId, msg.token);
    if (opening === undefined || opening.latestSeq >= msg.seq) {
      return;
    }
    opening.latestSeq = msg.seq;
    // WITHDRAWN here, not when the new answer lands. Between admitting a
    // newer probe and posting its answer the previous candidate stayed
    // authorizable, which is the whole window a user's edit was supposed to
    // close (round-2 B1).
    opening.debrisCandidate = null;
    // WITHDRAWN with it, and for the same reason: between admitting a newer
    // probe and posting its answer, the previous repair stayed submittable.
    opening.publishedRepair = null;
    void answerCreateProbe(deps, surface, msg, repo, opening);
    return;
  };

  const worktreeAuthorizeDebris: Arm<"worktreeAuthorizeDebris"> = (surface, msg, _actions) => {
    if (
      typeof msg.path !== "string" ||
      msg.path.length === 0 ||
      typeof msg.token !== "number" ||
      typeof msg.ask !== "number"
    ) {
      return;
    }
    const repo = cache.read().repos.find((r) => r.repoId === msg.repoId);
    if (repo === undefined) {
      return;
    }
    const opening = openingFor(surface, msg.repoId, msg.token);
    // The path this opening's latest answer PUBLISHED as debris, and no
    // other. A request naming any other directory is not the request the
    // panel makes, and answering it would hand out a delete for a
    // destination the user was never shown (round-1 B1).
    if (opening === undefined || opening.debrisCandidate !== msg.path) {
      return;
    }
    void answerDebrisAuthorization(deps, surface, msg);
    return;
  };

  const worktreeCreateClosed: Arm<"worktreeCreateClosed"> = (surface, msg, _actions) => {
    // The only signal that a create conversation ENDED. Closure cannot be
    // inferred from the next opening: a form cancelled and never reopened
    // is exactly the case such a rule would never reach, and it is the case
    // that matters most — its read keeps the right to mint host authority
    // for a form the user dismissed (design.md D3).
    const key = surfaceKey(surface);
    // Retirement spends the same authority an answer does. A close naming
    // an opening this surface no longer holds is a late or replayed message
    // from a form already replaced; honouring it would let it silence the
    // form the user is looking at now (D2).
    //
    // The shape check is defensive and honestly so: a live opening is
    // always a positive integer, so the comparison already refuses every
    // malformed value, and no test can tell the two apart. It is here
    // because reading an unvalidated field as an identity is wrong, not
    // because a symptom was measured.
    if (!namedOpening(msg.opening) || !lifecycle.isLive(key, msg.opening)) {
      return;
    }
    // What the opening issued goes with it (D5). A create citing an evicted
    // id needs no new refusal path: § 2.4 already requires no create, no
    // provisioning, a freshly resolved model, and a second submission.
    retireOpening(key);
    return;
  };

  const requestWorktreeCreateDefaults: Arm<"requestWorktreeCreateDefaults"> = (surface, msg, _actions) => {
    handleCreateDefaults(deps, surface, msg);
  };

  const requestWorktreeRefs: Arm<"requestWorktreeRefs"> = (surface, msg, _actions) => {
    handleWorktreeRefs(deps, surface, msg);
  };

  return {
    worktreeCreate,
    worktreeSetupRetry,
    worktreePickDestination,
    worktreeCreateProbe,
    worktreeAuthorizeDebris,
    worktreeCreateClosed,
    requestWorktreeCreateDefaults,
    requestWorktreeRefs,
  };
}
