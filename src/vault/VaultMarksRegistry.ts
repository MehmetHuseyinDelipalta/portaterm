// src/vault/VaultMarksRegistry.ts — Global persistence of the user's stars and
// tags on vault sessions, keyed by entryId ("<agent>:<sessionId>").
//
// A tab pin lasts as long as the tab: it marks a session only while a pinned
// tab runs it (see pinnedVaultSessions.ts). A star or a tag is the user's own
// mark on the session itself, so it survives the tab, the window and a restart.
//
// Mirrors VaultCustomNameRegistry: the in-memory map is authoritative, every
// change fires a fire-and-forget snapshot to the Memento, and VaultService
// applies it as a serve-time overlay — it NEVER writes an agent's own store.

import { type TabColorId, type TabIconId, toTabColor, toTabIcon } from "../shared/tabAppearance";

/** Longest tag kept; longer input is truncated. */
export const VAULT_TAG_MAX_LENGTH = 32;
/** Most tags one session keeps; extra input is dropped. */
export const VAULT_TAGS_PER_SESSION = 12;

/** globalState key for the vault marks record. */
const VAULT_MARKS_STORAGE_KEY = "portaterm.vaultMarks";

/** One session's marks. Absent fields mean "not starred" / "no tags" / "no color" / "no icon". */
export interface VaultEntryMarks {
  starred?: true;
  tags?: string[];
  /**
   * The color and icon of the tab that last ran this session, so a resume opens
   * its new tab wearing them and the vault row shows them while it is closed.
   */
  tabColor?: TabColorId;
  tabIcon?: TabIconId;
}

/**
 * Normalize one user-typed tag: trim, drop leading `#`s, turn inner whitespace
 * into a single `-` (a tag is one token, so `#tag` search can address it), and
 * cap the length. Null when nothing is left.
 */
export function normalizeVaultTag(input: string): string | null {
  const tag = input.trim().replace(/^#+/, "").trim().replace(/\s+/g, "-");
  if (tag.length === 0) {
    return null;
  }
  return tag.length > VAULT_TAG_MAX_LENGTH ? tag.slice(0, VAULT_TAG_MAX_LENGTH) : tag;
}

/**
 * Normalize a tag list: each tag normalized, empties dropped, duplicates removed
 * case-insensitively (the first spelling wins), capped at
 * {@link VAULT_TAGS_PER_SESSION}. Order is kept — it is the order the user chose.
 */
export function normalizeVaultTags(inputs: readonly string[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const input of inputs) {
    const tag = normalizeVaultTag(input);
    if (tag === null || seen.has(tag.toLowerCase())) {
      continue;
    }
    seen.add(tag.toLowerCase());
    tags.push(tag);
    if (tags.length === VAULT_TAGS_PER_SESSION) {
      break;
    }
  }
  return tags;
}

/** Minimal subset of `vscode.Memento`, declared locally so tests need no vscode. */
export interface VaultMarksStorage {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export class VaultMarksRegistry {
  private readonly cache: Map<string, VaultEntryMarks>;
  private readonly listeners = new Set<(entryId: string) => void>();

  constructor(private readonly storage: VaultMarksStorage) {
    this.cache = this.loadFromStorage();
  }

  /** The marks on an entryId, or undefined when it carries none. */
  get(entryId: string): VaultEntryMarks | undefined {
    const marks = this.cache.get(entryId);
    return marks ? { ...marks, ...(marks.tags ? { tags: [...marks.tags] } : {}) } : undefined;
  }

  /** Star or unstar an entry. A no-op change neither persists nor notifies. */
  setStarred(entryId: string, starred: boolean): void {
    const current = this.cache.get(entryId);
    if ((current?.starred === true) === starred) {
      return;
    }
    this.write(entryId, { ...current, starred: starred ? true : undefined });
  }

  /** Replace an entry's tags (normalized). An empty list clears them. */
  setTags(entryId: string, tags: readonly string[]): void {
    const next = normalizeVaultTags(tags);
    const current = this.cache.get(entryId);
    if (JSON.stringify(current?.tags ?? []) === JSON.stringify(next)) {
      return;
    }
    this.write(entryId, { ...current, tags: next.length > 0 ? next : undefined });
  }

  /**
   * Record the color and icon a tab running this entry now wears — both, as they
   * stand, so a value left out is cleared. A no-op change neither persists nor notifies.
   */
  setTabAppearance(entryId: string, appearance: { tabColor?: TabColorId; tabIcon?: TabIconId }): void {
    const current = this.cache.get(entryId);
    if (current?.tabColor === appearance.tabColor && current?.tabIcon === appearance.tabIcon) {
      return;
    }
    this.write(entryId, { ...current, tabColor: appearance.tabColor, tabIcon: appearance.tabIcon });
  }

  /** Snapshot of every entry's marks, keyed by entryId. */
  all(): Readonly<Record<string, VaultEntryMarks>> {
    const snapshot: Record<string, VaultEntryMarks> = {};
    for (const [k, v] of this.cache) {
      snapshot[k] = v;
    }
    return snapshot;
  }

  /**
   * Every tag in use on any session, each spelling once (case-insensitively),
   * sorted — what the tag picker offers to reuse.
   */
  knownTags(): string[] {
    const byKey = new Map<string, string>();
    for (const marks of this.cache.values()) {
      for (const tag of marks.tags ?? []) {
        if (!byKey.has(tag.toLowerCase())) {
          byKey.set(tag.toLowerCase(), tag);
        }
      }
    }
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  /** Run `listener` after every change that persisted. Returns its disposer. */
  onDidChange(listener: (entryId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private write(entryId: string, marks: VaultEntryMarks): void {
    const kept: VaultEntryMarks = {
      ...(marks.starred ? { starred: true as const } : {}),
      ...(marks.tags && marks.tags.length > 0 ? { tags: marks.tags } : {}),
      ...(marks.tabColor ? { tabColor: marks.tabColor } : {}),
      ...(marks.tabIcon ? { tabIcon: marks.tabIcon } : {}),
    };
    if (Object.keys(kept).length > 0) {
      this.cache.set(entryId, kept);
    } else {
      this.cache.delete(entryId);
    }
    this.saveSnapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(entryId);
      } catch (err) {
        console.error("[Portaterm] Vault marks listener failed:", err);
      }
    }
  }

  private loadFromStorage(): Map<string, VaultEntryMarks> {
    const raw = this.storage.get(VAULT_MARKS_STORAGE_KEY);
    const result = new Map<string, VaultEntryMarks>();
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return result;
    }
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        continue;
      }
      const record = v as { starred?: unknown; tags?: unknown; tabColor?: unknown; tabIcon?: unknown };
      const tags = Array.isArray(record.tags)
        ? normalizeVaultTags(record.tags.filter((t): t is string => typeof t === "string"))
        : [];
      const marks: VaultEntryMarks = {
        ...(record.starred === true ? { starred: true as const } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      };
      // An id this build does not know is dropped, like a malformed tag.
      const tabColor = toTabColor(record.tabColor);
      const tabIcon = toTabIcon(record.tabIcon);
      if (tabColor) {
        marks.tabColor = tabColor;
      }
      if (tabIcon) {
        marks.tabIcon = tabIcon;
      }
      if (Object.keys(marks).length > 0) {
        result.set(k, marks);
      }
    }
    return result;
  }

  private saveSnapshot(): void {
    void this.storage.update(VAULT_MARKS_STORAGE_KEY, this.all()).then(undefined, (err) => {
      console.error("[Portaterm] Failed to persist vault marks:", err);
    });
  }
}
