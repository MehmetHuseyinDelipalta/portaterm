// src/providers/worktreeHost/actions/provision.test.ts — OBL-4: the arms read
// the host's live state, not a copy taken when the factory ran.
//
// `provisionBaseline` is written by a handler that is STILL in `WorktreeHost.ts`
// (the create-defaults case) and read here, by the save arm. That write happens
// long after `createProvisionActions` returns, so a map copied at the factory
// boundary would leave the save reading an empty baseline — and `tookSource`,
// the one thing the baseline decides, would come out false for every save.

import { describe, expect, it } from "vitest";
import type { ProvisionModel } from "../../../types/messages";
import { createProvisionOfferStore } from "../../../worktree/provisioning/offerStore";
import type { NativeConfigDivergence } from "../../../worktree/provisioning/writeNativeConfig";
import type { WorktreeSurface } from "../hostTypes";
import { createProvisionActions, type ProvisionDeps } from "./provision";

const SURFACE = { id: "s1" } as unknown as WorktreeSurface;
const REPO_ID = "repo-1";
const OPENING = 7;
const SLOT = `s1 ${REPO_ID} ${OPENING}`;

/** A model whose active provider is `native`: a baseline naming anything else is a take. */
function modelOn(activeId: "native" | "asimov"): ProvisionModel {
  return {
    entries: [],
    setup: [],
    ports: [],
    providers: [
      { id: activeId, files: [".x"], present: [".x"], active: true },
      { id: activeId === "native" ? "asimov" : "native", files: [".y"], present: [], active: false },
    ],
    excluded: [],
    contenders: [],
    problems: [],
  };
}

/**
 * Deps built from real containers, exactly as the host passes them.
 *
 * The maps are returned so the test can write into them AFTER the factory has
 * run — which is the only way to tell a reference from a copy.
 */
function harness() {
  const provisionBaseline = new Map<string, string>();
  const offers = createProvisionOfferStore();
  const wrote: NativeConfigDivergence[] = [];
  const model = modelOn("native");
  const offer = offers.issue({ surface: "s1", repoId: REPO_ID }, model);

  const deps: ProvisionDeps = {
    ADDED_COPY_SOURCE: "added",
    MAX_ADDED_COPY_FILES: 8,
    MAX_ADDED_STEPS: 8,
    addedCopyFiles: new Map(),
    addedSteps: new Map(),
    provisionBaseline,
    provisionSwitch: new Map(),
    lifecycle: { isLive: (key, token) => key === "s1" && token === OPENING },
    offers,
    cache: { read: () => ({ repos: [{ repoId: REPO_ID, mainPath: "/repo" }] as never }) },
    options: {
      readProvisioning: async () => model,
      writeNativeConfig: async (_root, divergence) => {
        wrote.push(divergence);
        return { outcome: "written", lockLeft: false } as never;
      },
    },
    deliver: () => true,
    disposed: () => false,
    hasSurface: () => true,
    surfaceKey: () => "s1",
    previewProvisioning: async (_repo, m) => m,
    withAdded: (_k, _s, m) => ({ model: m, heldFiles: new Map() }),
    withoutAdded: (m) => m,
    privateIdsFor: () => new Set(),
    issueWithAdded: (k, _s, m) => offers.issue(k, m),
    roomForOneMoreSetup: () => true,
  };

  // Wired HERE, at factory time — before the baseline is written, exactly as the
  // host wires it before its create-defaults handler ever runs. Building the
  // actions after the write instead would make a copied map indistinguishable
  // from a shared one, and the test vacuous.
  const arms = createProvisionActions(deps);
  return { arms, provisionBaseline, offerId: offer.offerId, wrote };
}

function save(arms: ReturnType<typeof createProvisionActions>, offerId: string): void {
  arms.worktreeProvisionSave(SURFACE, {
    type: "worktreeProvisionSave",
    repoId: REPO_ID,
    opening: OPENING,
    switch: 1,
    offerId,
    kept: [],
  });
}

describe("provision arms read live host state", () => {
  it("sees a baseline written after the factory ran, and reports the take", async () => {
    const { arms, provisionBaseline, offerId, wrote } = harness();
    // The write the host's create-defaults handler makes, after wiring.
    provisionBaseline.set(SLOT, "asimov");

    save(arms, offerId);
    await Promise.resolve();
    await Promise.resolve();

    expect(wrote).toHaveLength(1);
    expect(wrote[0]?.tookSource).toBe(true);
  });

  it("reports no take when the baseline names the provider still active", async () => {
    const { arms, provisionBaseline, offerId, wrote } = harness();
    provisionBaseline.set(SLOT, "native");

    save(arms, offerId);
    await Promise.resolve();
    await Promise.resolve();

    expect(wrote).toHaveLength(1);
    expect(wrote[0]?.tookSource).toBe(false);
  });
});
