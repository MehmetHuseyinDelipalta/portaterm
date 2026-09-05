// src/worktree/provisioning/asimovProvider.ts — Read `asimov/worktree.yaml`
// into the normalized model (worktree-provisioning.md § 3.1).
//
// What is left here is what is true of THIS provider only: its file name, its
// four keys, and how a YAML mapping becomes rows. Containment, the budget, glob
// expansion and problem reporting moved to `providerKit.ts` when the second and
// third adapters arrived — three copies of a containment rule is three chances
// for one of them to drift (design.md D2).
//
// Nothing in this module writes. It reads the provider file and, for a glob,
// the directory that glob names — and every path it touches is checked for
// containment first.

import { parse as parseYaml } from "yaml";
import type { ProvisionModel } from "../../types/messages";
import { messageOf } from "../errorMessage";
import {
  type AdapterRead,
  type Authorized,
  type Draft,
  modelFromDraft,
  newDraft,
  type OpenedProviderFile,
  openProviderFile,
  type ProviderAdapter,
  type ProviderBudget,
  type ProviderContext,
  type ProviderDeps,
  problem,
  readInlineKeys,
  report,
} from "./providerKit";

/** Repo-relative, POSIX. The one file this adapter reads. */
export const ASIMOV_PROVIDER_FILE = "asimov/worktree.yaml";

const ASIMOV: ProviderContext = { id: "asimov", file: ASIMOV_PROVIDER_FILE };

/** The four keys § 3.1 maps. Anything else is reported rather than ignored. */
const KNOWN_KEYS = new Set(["copy", "link", "ports", "setup"]);

// Only ever returned from `fromOpened`, which absence never reaches, so the
// file this names is one that was there.
const PROVIDERS = [
  { id: "asimov" as const, files: [ASIMOV_PROVIDER_FILE], present: [ASIMOV_PROVIDER_FILE], active: true },
];

export const asimovAdapter: ProviderAdapter = {
  id: "asimov",
  files: [ASIMOV_PROVIDER_FILE],

  /**
   * `null` for an absent file and a model for every other outcome.
   *
   * The distinction matters because a file that is not there and one that
   * declares nothing are not the same detection answer. Falling through a
   * present-but-empty file would offer another tool's answer to a question this
   * repository has already answered (design.md D3).
   */
  async read(
    deps: ProviderDeps,
    repoRoot: string,
    budget: ProviderBudget,
    authorized?: Authorized,
  ): Promise<AdapterRead | null> {
    const opened = await openProviderFile(deps, repoRoot, ASIMOV, undefined, authorized);
    if (opened.kind === "absent" || (opened.kind === "problem" && opened.at === "root")) {
      return null;
    }
    const model = await fromOpened(opened, deps, repoRoot, budget);
    return { model, suggestible: opened.kind === "text" && model.problems.length === 0 };
  },
};

/**
 * Everything after the file has been authorized and opened.
 *
 * Split out so the adapter opens the file exactly once; a second open would be
 * a second chance for the file to change under the check.
 */
async function fromOpened(
  opened: Exclude<OpenedProviderFile, { kind: "absent" }>,
  deps: ProviderDeps,
  repoRoot: string,
  budget: ProviderBudget,
): Promise<ProvisionModel> {
  // The draft is opened before the first thing that can go wrong, because EVERY
  // problem is charged to the shared budget — including the ones on a path that
  // never reaches a row. These three returns used to build `problems: [...]` by
  // hand and charge nothing, which was harmless while one adapter answered per
  // read: two do not, and a native draft sitting exactly at the cap plus a
  // malformed inherited file yielded a 201st row (design.md D9).
  const draft: Draft = newDraft(ASIMOV, budget);
  const label = `\`${ASIMOV_PROVIDER_FILE}\``;

  if (opened.kind === "problem") {
    report(draft, label, opened.problem);
    // A root that will not resolve is not this provider being present, so it is
    // the one problem reported without a providers row.
    return { ...modelFromDraft(draft), ...(opened.at === "root" ? {} : { providers: PROVIDERS }) };
  }
  const root = opened.root;

  let parsed: unknown;
  try {
    parsed = parseYaml(opened.text);
  } catch (error) {
    report(draft, label, problem(ASIMOV, "malformed", messageOf(error)));
    return { ...modelFromDraft(draft), providers: PROVIDERS };
  }
  if (parsed === null || parsed === undefined) {
    return { ...modelFromDraft(draft), providers: PROVIDERS };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    report(draft, label, problem(ASIMOV, "malformed", "The file is not a mapping of keys."));
    return { ...modelFromDraft(draft), providers: PROVIDERS };
  }

  const nextId = draft.budget.nextId;
  await readInlineKeys(parsed as Record<string, unknown>, KNOWN_KEYS, repoRoot, root, deps, nextId, draft);

  // `providers` is the one field this adapter owns; the dispatcher replaces it
  // when composing multiple providers.
  return { ...modelFromDraft(draft), providers: PROVIDERS };
}
