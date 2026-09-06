// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { WebViewToExtensionMessage, WorktreeTreeResponseMessage } from "../../../types/messages";
import { WorktreeController } from "../WorktreeController";
import { singleRepoPresence, twoRepoTree } from "../worktreeFixtures";
import type { WorktreeRowActivation } from "../worktreeViewTypes";

const REPO_A = "/Users/dev/Projects/ai-oss/anywhere-terminal/.git";

interface Harness {
  controller: WorktreeController;
  posts: WebViewToExtensionMessage[];
}

function ready(): Harness {
  const posts: WebViewToExtensionMessage[] = [];
  const state: Record<string, unknown> = {};
  const controller = WorktreeController.mount({
    host: document.body,
    postMessage: (msg) => posts.push(msg),
    store: {
      getState: () => state as never,
      updateState: (patch) => Object.assign(state, patch),
    },
    init: { workspaceRoot: "/repo", rowActivation: "focus" as WorktreeRowActivation },
    now: () => 1_000_000,
  });
  document.body.appendChild(controller.element);
  controller.setVisible(true);
  const tree: WorktreeTreeResponseMessage = {
    type: "worktreeTreeResponse",
    tree: twoRepoTree(),
    presence: singleRepoPresence(1_000_000),
  };
  controller.handleTreeResponse(tree);
  posts.length = 0;
  return { controller, posts };
}

/** The create form's outbound callbacks, as the view really received them. */
function dialogDeps(h: Harness) {
  return (
    h.controller as unknown as {
      view: {
        deps: {
          createDialogDeps(): {
            onProvisionSwitch(r: { repoId: string; switch: number; provider: string }): void;
            onProvisionSave(r: { repoId: string; switch: number; offerId: string; kept: string[] }): void;
            onAuthorizeDebris(r: { repoId: string; ask: string; path: string }): void;
            onSetupStepAsk(r: { repoId: string; switch: number; op: { kind: "add" } }): void;
          };
        };
      };
    }
  ).view.deps.createDialogDeps();
}

/**
 * The four builders that read the LIVE `refsToken`, against the three that send
 * the opening captured when the form was composed (design.md D1).
 *
 * The existing controller suite compares requests only WITHIN one unchanged
 * opening, so switching these three to the captured opening survives it. That
 * gap is what let `405f9c77` and `86df1b30` ship; these tests close it, so the
 * asymmetry cannot be flattened by a later refactor without going red
 * (design.md OBL-3).
 */
describe("outbound create requests after the opening is superseded", () => {
  it("sends a provisioning switch on the CURRENT token, not the composing one", () => {
    const h = ready();
    h.controller.openCreate();
    const deps = dialogDeps(h);

    h.controller.openCreate(); // token advances to 2; `deps` was composed under 1
    deps.onProvisionSwitch({ repoId: REPO_A, switch: 3, provider: "asimov" });

    expect(h.posts.find((m) => m.type === "worktreeProvisionSwitch")).toMatchObject({ opening: 2 });
  });

  it("sends a provisioning save on the CURRENT token, not the composing one", () => {
    const h = ready();
    h.controller.openCreate();
    const deps = dialogDeps(h);

    h.controller.openCreate();
    deps.onProvisionSave({ repoId: REPO_A, switch: 3, offerId: "offer-1", kept: ["i1"] });

    expect(h.posts.find((m) => m.type === "worktreeProvisionSave")).toMatchObject({ opening: 2 });
  });

  it("sends a debris authorization on the CURRENT token, not the composing one", () => {
    const h = ready();
    h.controller.openCreate();
    const deps = dialogDeps(h);

    h.controller.openCreate();
    deps.onAuthorizeDebris({ repoId: REPO_A, ask: "a1", path: "/tmp/x" });

    expect(h.posts.find((m) => m.type === "worktreeAuthorizeDebris")).toMatchObject({ token: 2 });
  });

  it("still sends a setup-step ask on the COMPOSING opening — the other half of the asymmetry", () => {
    const h = ready();
    h.controller.openCreate();
    const deps = dialogDeps(h);

    h.controller.openCreate();
    deps.onSetupStepAsk({ repoId: REPO_A, switch: 7, op: { kind: "add" } });

    expect(h.posts.find((m) => m.type === "worktreeSetupStepAsk")).toMatchObject({ opening: 1 });
  });
});
