// src/providers/vaultTags.ts — "Edit Tags…" for a vault session.
//
// The webview names the session by id; the host owns the editor. A multi-select
// picker lists every tag already in use, the session's own tags checked, so a
// tag is reused rather than retyped with a different spelling. Typing offers
// what was typed as a new tag (a comma separates several). A new tag comes
// checked unless the text also matches a tag in use: then the user is most
// likely filtering for that one, and Enter must not add the fragment as well.

import * as vscode from "vscode";
import { normalizeVaultTag, normalizeVaultTags } from "../vault/VaultMarksRegistry";
import type { VaultService } from "../vault/VaultService";

export const NEW_TAG_DESCRIPTION = "New tag";

export interface TagPickItem {
  label: string;
  description?: string;
  alwaysShow?: boolean;
}

interface Disposable {
  dispose(): unknown;
}

/** The slice of `vscode.QuickPick` the tag editor drives — a fake in tests. */
export interface TagQuickPick {
  title: string | undefined;
  placeholder: string | undefined;
  canSelectMany: boolean;
  items: readonly TagPickItem[];
  selectedItems: readonly TagPickItem[];
  value: string;
  onDidChangeValue(listener: (value: string) => unknown): Disposable;
  onDidChangeSelection(listener: (items: readonly TagPickItem[]) => unknown): Disposable;
  onDidAccept(listener: () => unknown): Disposable;
  onDidHide(listener: () => unknown): Disposable;
  show(): void;
  hide(): void;
  dispose(): void;
}

const key = (tag: string) => tag.toLowerCase();

/**
 * The picker's items for a typed value: the typed tags not yet in use first
 * (marked new, shown whatever the filter), then the session's own tags in the
 * order it keeps them, then every other tag in use. `autoCheck` holds the new
 * tags that match no tag in use.
 */
export function tagPickItems(
  known: readonly string[],
  current: readonly string[],
  typed: string,
): { items: TagPickItem[]; fresh: TagPickItem[]; autoCheck: TagPickItem[] } {
  const existing: string[] = [];
  const seen = new Set<string>();
  for (const tag of [...current, ...known]) {
    if (!seen.has(key(tag))) {
      seen.add(key(tag));
      existing.push(tag);
    }
  }
  const fresh: TagPickItem[] = [];
  const autoCheck: TagPickItem[] = [];
  for (const part of typed.split(",")) {
    const tag = normalizeVaultTag(part);
    if (tag !== null && !seen.has(key(tag))) {
      seen.add(key(tag));
      const item = { label: tag, description: NEW_TAG_DESCRIPTION, alwaysShow: true };
      fresh.push(item);
      if (!existing.some((other) => key(other).includes(key(tag)))) {
        autoCheck.push(item);
      }
    }
  }
  return { items: [...fresh, ...existing.map((label) => ({ label }))], fresh, autoCheck };
}

/**
 * Run the tag picker. Resolves to the chosen tags (normalized) on accept, or
 * undefined when the picker is dismissed.
 */
export function pickVaultTags(
  qp: TagQuickPick,
  current: readonly string[],
  known: readonly string[],
): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    // The user's checks on tags in use. Kept apart from the new-tag items, which
    // are rebuilt from the typed value on every keystroke.
    const checked = new Set(current.map(key));
    let fresh: TagPickItem[] = [];
    let settled = false;
    const subscriptions: Disposable[] = [];

    const render = (typed: string) => {
      const next = tagPickItems(known, current, typed);
      fresh = next.fresh;
      qp.items = next.items;
      qp.selectedItems = next.items.filter((item) =>
        next.fresh.includes(item) ? next.autoCheck.includes(item) : checked.has(key(item.label)),
      );
    };

    qp.title = "Session Tags";
    qp.placeholder = "Pick tags, or type a new one (a comma separates several) — Enter saves";
    qp.canSelectMany = true;
    subscriptions.push(
      qp.onDidChangeValue((value) => render(value)),
      qp.onDidChangeSelection((items) => {
        checked.clear();
        for (const item of items) {
          if (!fresh.includes(item)) {
            checked.add(key(item.label));
          }
        }
      }),
      qp.onDidAccept(() => {
        settled = true;
        resolve(normalizeVaultTags(qp.selectedItems.map((item) => item.label)));
        qp.hide();
      }),
      qp.onDidHide(() => {
        if (!settled) {
          settled = true;
          resolve(undefined);
        }
        for (const s of subscriptions) {
          s.dispose();
        }
        qp.dispose();
      }),
    );
    render("");
    qp.show();
  });
}

export interface VaultTagsDeps {
  vaultService: Pick<VaultService, "marksOf" | "knownTags" | "setTags">;
  createQuickPick(): TagQuickPick;
}

export function vscodeVaultTagsDeps(vaultService: VaultService): VaultTagsDeps {
  return {
    vaultService,
    createQuickPick: () => vscode.window.createQuickPick<vscode.QuickPickItem>(),
  };
}

/** Edit one session's tags. Dismissing the picker changes nothing. */
export async function editVaultTags(entryId: string, deps: VaultTagsDeps): Promise<void> {
  const current = deps.vaultService.marksOf(entryId)?.tags ?? [];
  const chosen = await pickVaultTags(deps.createQuickPick(), current, deps.vaultService.knownTags());
  if (chosen !== undefined) {
    deps.vaultService.setTags(entryId, chosen);
  }
}
