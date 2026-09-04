# Tasks: prove-entry-reconstruction-on-windows

The reconstruction recipe in `docs/design/worktree-create.md` § 2.4 writes into git's own
administrative directory and was verified on macOS only. Every one of its four files carries a path,
one of them absolute. A platform where it half-works is worse than one where it plainly fails.

- [x] 1_1 Record the macOS control the Windows run is diffed against — verified: node scripts/verify-windows-worktree-entry.mjs && pnpm exec tsc --noEmit -p tsconfig.json exit 0
  - **Refs**: docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: The recipe's result on the platform it was designed against is captured verbatim
    - Verify: command node scripts/verify-windows-worktree-entry.mjs
  - **Plan**:
    1. `asimov/changes/prove-entry-reconstruction-on-windows/evidence/darwin-control.txt` holds the RESULT block from running the existing harness on darwin.

- [x] 1_2 Execute the recipe on Windows and record the answer — verified: manual — Ran scripts/verify-windows-worktree-entry.mjs on GitHub windows-2022 (git 2.55.0.windows.5, node v22.23.2) via workflow_dispatch on 9ef8c750 — run 33848956772: verdict RECIPE FAILS (3 of 11). Re-ran the same harness on darwin (git 2.50.1): RECIPE WORKS, 11 of 11. Both RESULT blocks kept verbatim in evidence/windows-run.txt and evidence/darwin-control.txt; docs/design/worktree-create.md 2.4 now records both verdicts, the separator cause, and the fix adoption must meet before it is offered on Windows.
  - **Deps**: 1_1
  - **Refs**: docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: The Windows RESULT block is recorded in § 2.4, verdict either way
    - Verify: manual run scripts/verify-windows-worktree-entry.mjs on a Windows machine and record its RESULT block
  - **Plan**:
    1. On a Windows machine with git and node, run `node scripts/verify-windows-worktree-entry.mjs` in a clone of this repository and keep the RESULT block.
    2. `docs/design/worktree-create.md` § 2.4 records the verdict beside the macOS control — and, if the recipe does not work there, states that adoption is refused on Windows with the captured failure as the reason rather than offered and left to fail.
  - **Boundary**: The harness is not modified to make a platform pass. If it fails on Windows, the failure is the finding.

## 2. Make the one remaining action a push

- [x] 1_3 Land the branch-scoped Windows runner so the spike can be executed without a Windows machine — verified: node -e "const y=require('node:fs').readFileSync('.github/workflows/verify-windows-worktree-entry.yml','utf8'); for (const k of ['windows-2022','verify-windows-worktree-entry.mjs','persist-credentials: false','contents: read','workflow_dispatch']) { if (!y.includes(k)) { console.error('missing '+k); process.exit(1); } }" && pnpm exec tsc --noEmit -p tsconfig.json exit 0
  - **Deps**: 1_1
  - **Refs**: design.md
  - **Acceptance**:
    - Outcome: One workflow runs the committed spike script on Windows and prints its RESULT block
    - Verify: command node -e "const y=require('node:fs').readFileSync('.github/workflows/verify-windows-worktree-entry.yml','utf8'); for (const k of ['windows-2022','verify-windows-worktree-entry.mjs','persist-credentials: false','contents: read','workflow_dispatch']) { if (!y.includes(k)) { console.error('missing '+k); process.exit(1); } }"
  - **Plan**:
    1. Create `.github/workflows/verify-windows-worktree-entry.yml` modelled on orca's daemon-relocation spike workflow: `runs-on: windows-2022`, triggered on push to this branch only plus `workflow_dispatch`, `permissions: contents: read`, a `paths:` filter naming the spike script and the workflow itself, and a `concurrency` group.
    2. In the same file, give it three steps — checkout at v6 with `persist-credentials: false`, setup-node at v6 pinned to Node 22, and a run step invoking the already-committed spike script — with no package install, since that script imports only `node:` builtins.
    3. In the same file, head-comment WHY it exists and that it is the one action that needs a push, so a reader does not mistake it for the repository adopting CI generally.

- [x] 1_4 Replace the withheld-as-unverified reason with the captured failure — verified: pnpm exec tsc --noEmit -p tsconfig.json && pnpm exec tsc --noEmit -p tsconfig.json && VITEST_MAX_THREADS=3 pnpm run test:unit exit 0
  - **Deps**: 1_2
  - **Refs**: docs/design/worktree-create.md#24-adopt-re-registers-a-surviving-checkout
  - **Acceptance**:
    - Outcome: `adoptSupported`'s stated reason for withholding adopt on win32 is the recorded Windows failure, not an unrun recipe
    - Verify: command `pnpm exec tsc --noEmit -p tsconfig.json`
  - **Plan**:
    1. `src/providers/WorktreeHost.ts` — the `adoptSupported` doc comment says the recipe "has been run only on darwin" and that adopt is withheld "as unverified — never refused as failing, which is a claim nobody has established". 1_2 established it. State the verdict, the cause, and what has to change before the default can flip.
    2. The default value does not move: a FAIL leaves win32 false, which is what it already is. This task changes what the code says, not what it does.
  - **Boundary**: The recipe is not fixed here and the default is not flipped. Comment only — no behavioural edit.

