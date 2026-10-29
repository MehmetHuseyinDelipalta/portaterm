// src/webview/vault/vaultListView.ts — Pure DOM builders for the vault session
// list: rows, group headers, the per-group "Show N more" affordance, and the
// empty / no-match status. None read panel state — interactivity is supplied via
// callbacks, so each builder is independently testable.
//
// Session-derived strings (title, cwd) are written via `textContent`; the only
// SVG inserted is the agent's real brand icon from the closed icon map (D1).

import { tabColorCss, toTabColor } from "../../shared/tabAppearance";
import type { VaultSessionEntry } from "../../vault/types";
import { setIcon } from "../shared/iconNode";
import type { PaneAgentAttention } from "../state/WebviewStateStore";
import { tabIconSvg } from "../tabIcons";
import { getAgentAccent, getAgentIcon } from "./agentIcons";
import { agentLabel, formatRelativeTime, leafSegment } from "./format";
import type { GroupMode } from "./grouping";
import {
  ICON_ARCHIVE,
  ICON_CHEVRON_DOWN,
  ICON_FOLDER,
  ICON_PIN,
  ICON_PLUS,
  ICON_RESUME,
  ICON_SEARCH,
  ICON_STAR,
  ICON_STAR_FILLED,
} from "./icons";
import { emptyState } from "./renderAtoms";

/** Row interaction handlers — supplied by the panel so the row builder stays pure. */
export interface VaultRowCallbacks {
  onActivate: (entry: VaultSessionEntry, row: HTMLElement) => void;
  onContextMenu: (entry: VaultSessionEntry, ev: MouseEvent, row: HTMLElement) => void;
  /** Absent on a surface that cannot perform the resume it would offer (B4). */
  onResume?: (entryId: string) => void;
  /** Star or unstar. Absent → the star is a mark only, and an unstarred row offers none. */
  onToggleStar?: (entry: VaultSessionEntry) => void;
  /** A tag chip was clicked — the panel filters to that tag. Absent → chips are marks only. */
  onTagClick?: (tag: string) => void;
}

/** Tag chips a row shows before folding the rest into a "+N" chip. */
export const ROW_TAG_CHIPS = 2;

export function canResumeVaultEntry(entry: VaultSessionEntry): boolean {
  return entry.agent === "cursor" ? entry.source === "cli" && entry.canResume === true : entry.canResume !== false;
}

export function cursorSourceLabel(entry: VaultSessionEntry): string | undefined {
  if (entry.agent !== "cursor") {
    return undefined;
  }
  if (entry.source === "cli") {
    return "CLI";
  }
  if (entry.source === "ide") {
    return "IDE";
  }
  return entry.sessionId.startsWith("project:") ? "Project" : undefined;
}

/** The word an open entry's Tab mark leads with, and the sentence behind it. */
const TAB_ATTENTION: Record<PaneAgentAttention["state"], { word: string; reason: string }> = {
  working: { word: "running", reason: "is working" },
  approval: { word: "approve", reason: "is waiting for your approval" },
  question: { word: "answer", reason: "is waiting for your answer" },
  unseen: { word: "done", reason: "finished — not seen yet" },
};

/**
 * Single-line CSS-grid row: badge | title | marks | cwd-chip | time, with an icon-only
 * Resume is revealed on hover/focus. Click previews the session; double-click resumes it.
 */
export function renderRow(
  entry: VaultSessionEntry,
  opts: { hideCwd?: boolean; fresh?: boolean; pinned?: boolean; open?: boolean; attention?: PaneAgentAttention },
  cb: VaultRowCallbacks,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "vault-row";
  row.setAttribute("role", "option");
  row.tabIndex = 0;
  row.dataset.entryId = entry.id;

  // Right-click opens the context menu (no separate "⋯" trigger).
  row.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    cb.onContextMenu(entry, ev, row);
  });

  // Click / Enter / Space activates the row → open the session preview.
  row.addEventListener("click", () => cb.onActivate(entry, row));
  row.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      cb.onActivate(entry, row);
    }
  });

  // Double-click resumes. Its two clicks have already opened the preview, which
  // the resume handler closes. A double-click inside a control (the Resume
  // button, the rename input) belongs to that control, not the row.
  const onRowResume = cb.onResume;
  if (onRowResume && canResumeVaultEntry(entry)) {
    row.addEventListener("dblclick", (ev) => {
      if ((ev.target as Element | null)?.closest("button, input")) {
        return;
      }
      onRowResume(entry.id);
    });
  }

  // Agent marker — a small accent-colored dot. The real brand icon lives on
  // the Agent group header + preview header, not on every row (keeps rows
  // compact and scannable).
  const dot = document.createElement("span");
  dot.className = "vault-row-dot";
  dot.dataset.tip = agentLabel(entry.agent);
  dot.setAttribute("aria-label", agentLabel(entry.agent));
  // Known accents only — a session-derived agent string never becomes a class (W6).
  const accent = getAgentAccent(entry.agent);
  if (accent) {
    dot.classList.add(`vault-row-dot--${accent}`);
  }
  row.appendChild(dot);

  // Just-updated flash: the panel flags a row whose `modified` grew (or a newly
  // appeared session). The accent var feeds the `::after` overlay in CSS; only a
  // known, closed accent may become one (never a raw session-derived string, W6).
  if (opts.fresh) {
    row.classList.add("is-fresh");
    if (accent) {
      row.style.setProperty("--_accent", `var(--vault-accent-${accent})`);
    }
  }

  // The color and icon of the tab that last ran this session: a stripe down the
  // row's left edge, and the icon ahead of the title, so the row and its tab
  // match at a glance. Known ids only, like the agent accent above.
  const tabColor = toTabColor(entry.tabColor);
  if (tabColor) {
    row.classList.add("has-tab-color");
    row.style.setProperty("--row-tab-color", tabColorCss(tabColor));
    row.dataset.tabColor = tabColor;
  }

  const titleEl = document.createElement("span");
  titleEl.className = "vault-row-title";
  // A user rename overrides the derived title (enhance-vault-sessions D1).
  const shownTitle = entry.customName || entry.title;
  titleEl.textContent = shownTitle || "(untitled session)";
  const tabIcon = tabIconSvg(entry.tabIcon);
  if (tabIcon) {
    const iconEl = document.createElement("span");
    iconEl.className = "vault-row-tab-icon";
    iconEl.dataset.icon = entry.tabIcon;
    iconEl.setAttribute("aria-hidden", "true");
    setIcon(iconEl, tabIcon);
    titleEl.prepend(iconEl);
  }
  if (shownTitle) {
    titleEl.dataset.tip = shownTitle;
  }
  // Pin and Tab marks sit in their own column between the title and the cwd,
  // so every title starts on the same line however many marks a row carries,
  // and a long title's ellipsis cannot cut a mark off. Always present, empty
  // when there is nothing to mark, to keep the grid's column count stable.
  const marksEl = document.createElement("span");
  marksEl.className = "vault-row-marks";
  // The user's star leads the marks: it is theirs, and it lasts.
  if (entry.starred) {
    row.classList.add("is-starred");
    marksEl.appendChild(renderStar(entry, true, cb.onToggleStar));
  }
  const tags = entry.tags ?? [];
  for (const tag of tags.slice(0, ROW_TAG_CHIPS)) {
    marksEl.appendChild(renderTagChip(tag, cb.onTagClick));
  }
  if (tags.length > ROW_TAG_CHIPS) {
    const more = document.createElement("span");
    more.className = "vault-row-tag vault-row-tag--more";
    more.textContent = `+${tags.length - ROW_TAG_CHIPS}`;
    more.dataset.tip = tags
      .slice(ROW_TAG_CHIPS)
      .map((t) => `#${t}`)
      .join(" ");
    more.setAttribute("aria-label", `${tags.length - ROW_TAG_CHIPS} more tags`);
    marksEl.appendChild(more);
  }
  // A pinned tab is running this session. A mark, not a control: the pin
  // belongs to the tab and is changed from the tab's context menu.
  if (opts.pinned) {
    row.classList.add("is-pinned");
    const pinMark = document.createElement("span");
    pinMark.className = "vault-row-pin";
    pinMark.dataset.tip = "Running in a pinned tab";
    pinMark.setAttribute("aria-label", "Pinned tab");
    setIcon(pinMark, ICON_PIN);
    marksEl.appendChild(pinMark);
  }
  // Some live pane runs this session, so Resume focuses it instead of
  // launching a second agent on the same transcript. Follows any pin mark.
  if (opts.open) {
    const tabMark = document.createElement("span");
    tabMark.className = "vault-row-tab";
    const status = opts.attention ? TAB_ATTENTION[opts.attention.state] : undefined;
    if (opts.attention && status) {
      // The state word leads the mark in its own colour, so a glance down the
      // list finds the session that needs you.
      tabMark.classList.add(`vault-row-tab--${opts.attention.state}`);
      const word = document.createElement("span");
      word.className = "vault-row-tab-state";
      word.textContent = status.word;
      tabMark.append(word, document.createTextNode("Tab"));
      const reason = `${opts.attention.agent} ${status.reason}`;
      tabMark.dataset.tip = `${reason} — Resume focuses its tab`;
      tabMark.setAttribute("aria-label", `Open in a tab: ${reason}`);
    } else {
      tabMark.textContent = "Tab";
      tabMark.dataset.tip = "Open in a tab — Resume focuses it";
      tabMark.setAttribute("aria-label", "Open in a tab");
    }
    marksEl.appendChild(tabMark);
  }
  const sourceLabel = cursorSourceLabel(entry);
  if (sourceLabel) {
    const sourceBadge = document.createElement("span");
    sourceBadge.className = "vault-row-source";
    sourceBadge.textContent = sourceLabel;
    sourceBadge.setAttribute("aria-label", `Cursor ${sourceLabel}`);
    titleEl.appendChild(sourceBadge);
  }
  row.append(titleEl, marksEl);
  // The row is the focus owner, so it carries the hint too: `closest()` only
  // looks upwards, and a keyboard user never lands on the title span. A nearer
  // descendant hint still wins under the pointer.
  const rowTip = [shownTitle || "(untitled session)", entry.cwd, tags.map((t) => `#${t}`).join(" ")]
    .filter(Boolean)
    .join("\n");
  row.dataset.tip = rowTip;

  if (!opts.hideCwd) {
    const cwdEl = document.createElement("span");
    cwdEl.className = "vault-row-cwd";
    if (entry.cwd) {
      cwdEl.dataset.tip = entry.cwd;
    }
    const folderIcon = document.createElement("span");
    folderIcon.className = "vault-row-cwd-icon";
    setIcon(folderIcon, ICON_FOLDER);
    const leaf = document.createElement("span");
    leaf.className = "vault-cwd-leaf";
    leaf.textContent = leafSegment(entry.cwd);
    cwdEl.append(folderIcon, leaf);
    row.appendChild(cwdEl);
  } else {
    // Keep the grid column count stable when the cwd chip is suppressed.
    const spacer = document.createElement("span");
    spacer.className = "vault-row-cwd vault-row-cwd--empty";
    row.appendChild(spacer);
  }

  const timeEl = document.createElement("span");
  timeEl.className = "vault-row-time";
  timeEl.textContent = formatRelativeTime(entry.modified);
  row.appendChild(timeEl);

  // An explicitly unsupported resume identifier must never be offered. Legacy
  // rows without the capability field retain their established Resume action.
  // A surface that cannot perform resume at all supplies no handler (B4).
  const onResume = cb.onResume;
  const resumable = onResume !== undefined && canResumeVaultEntry(entry);
  // An unstarred row offers its star on hover, beside Resume; a starred one
  // already shows it among the marks.
  const offerStar = !entry.starred && cb.onToggleStar !== undefined;
  if (!resumable && !offerStar) {
    return row;
  }
  const actions = document.createElement("span");
  actions.className = "vault-row-actions";
  if (offerStar) {
    actions.appendChild(renderStar(entry, false, cb.onToggleStar));
  }
  if (onResume && resumable) {
    const resumeBtn = document.createElement("button");
    resumeBtn.type = "button";
    resumeBtn.className = "vault-action vault-action--resume";
    resumeBtn.dataset.tip = "Resume";
    resumeBtn.setAttribute("aria-label", "Resume");
    setIcon(resumeBtn, ICON_RESUME);
    resumeBtn.addEventListener("click", (ev) => {
      ev.stopPropagation(); // don't also open the preview
      onResume(entry.id);
    });
    actions.appendChild(resumeBtn);
  }
  row.appendChild(actions);
  return row;
}

/**
 * The star: a button that flips it when the surface can, else a plain mark.
 * Its clicks stop here — the row behind it opens the preview.
 */
function renderStar(
  entry: VaultSessionEntry,
  starred: boolean,
  onToggle: ((entry: VaultSessionEntry) => void) | undefined,
): HTMLElement {
  const label = starred ? "Starred" : "Star";
  if (!onToggle) {
    const mark = document.createElement("span");
    mark.className = "vault-row-star is-starred";
    mark.dataset.tip = "Starred";
    mark.setAttribute("aria-label", label);
    setIcon(mark, ICON_STAR_FILLED);
    return mark;
  }
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = starred ? "vault-row-star is-starred" : "vault-action vault-action--star";
  btn.dataset.tip = starred ? "Starred — click to unstar" : "Star — keep this session at the top";
  btn.setAttribute("aria-label", starred ? "Unstar session" : "Star session");
  btn.setAttribute("aria-pressed", starred ? "true" : "false");
  setIcon(btn, starred ? ICON_STAR_FILLED : ICON_STAR);
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onToggle(entry);
  });
  btn.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      // The row turns these keys into a preview; the button keeps them.
      ev.stopPropagation();
    }
  });
  return btn;
}

/** One `#tag` chip: a filter button when the surface supplies one, else a mark. */
function renderTagChip(tag: string, onClick: ((tag: string) => void) | undefined): HTMLElement {
  const chip: HTMLElement = document.createElement(onClick ? "button" : "span");
  chip.className = "vault-row-tag";
  // Session-adjacent user text: textContent only.
  chip.textContent = `#${tag}`;
  if (onClick) {
    (chip as HTMLButtonElement).type = "button";
    chip.dataset.tip = `Show sessions tagged #${tag}`;
    chip.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick(tag);
    });
    chip.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.stopPropagation();
      }
    });
  } else {
    chip.dataset.tip = `#${tag}`;
  }
  return chip;
}

/**
 * Turn a title element into an inline rename editor (enhance-vault-sessions D1).
 * Enter (or blur) commits, Esc cancels, an empty value clears back to the derived
 * title (the host normalizes). Seeded with the current display name. Idempotent —
 * a no-op if that title is already being edited. The commit is fire-and-forget:
 * the host round-trips an overlaid list that re-renders with the new name.
 *
 * Takes the title ELEMENT rather than a row, so the preview header's own title
 * reuses this one editor and one commit path instead of growing a second (D7).
 *
 * Returns a handle that ends the edit the same way `blur` does. A caller that
 * tears down the surrounding DOM MUST call it: removing a focused node does not
 * reliably fire `blur`, so an owner relying on `onDone` alone can be left
 * believing an editor is still open (review B1).
 */
export function beginInlineRename(
  titleEl: HTMLElement,
  entry: VaultSessionEntry,
  cb: { commit: (name: string) => void; onDone?: () => void },
): { end: () => void } {
  // Already swapped for an editor — the title is detached until `finish` puts it
  // back, which is what makes a second call a no-op.
  if (!titleEl.isConnected) {
    return { end: () => {} };
  }
  const input = document.createElement("input");
  input.type = "text";
  input.className = "vault-row-rename-input";
  input.value = entry.customName || entry.title || "";
  input.setAttribute("aria-label", "Rename session");
  input.maxLength = 80;
  // Keep pointer/keyboard events inside the editor — a click must not activate the
  // row (open the preview) and keys must not reach the panel's collapse handler.
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());

  let done = false;
  const finish = (commitValue: boolean): void => {
    if (done) {
      return;
    }
    done = true;
    const value = input.value;
    input.replaceWith(titleEl);
    cb.onDone?.();
    if (commitValue) {
      cb.commit(value);
    }
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));

  titleEl.replaceWith(input);
  input.focus();
  input.select();
  // Commits, like blur — leaving the editor by any route saves; only Escape
  // cancels. `finish` is idempotent, so calling this after a real blur is a no-op.
  return { end: () => finish(true) };
}

/** "Show N more" affordance that expands a group past the per-group cap. */
export function renderShowMore(hidden: number, onExpand: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vault-show-more";
  btn.textContent = `Show ${hidden} more`;
  btn.addEventListener("click", onExpand);
  return btn;
}

/**
 * A collapsible Agent/Folder group header (chevron + brand/folder icon + count).
 *
 * `onStart` adds a quick-launch button at the trailing edge — a fresh session of
 * this group's agent. Absent → no button at all, rather than one the host would
 * refuse.
 */
export function renderGroupHeader(
  mode: GroupMode,
  key: string,
  label: string,
  count: number,
  collapsed: boolean,
  onToggle: () => void,
  onStart?: () => void,
): HTMLElement {
  const header = document.createElement("div");
  header.className = "vault-group-header";
  if (collapsed) {
    header.classList.add("is-collapsed");
  }
  // Both Agent and Folder groups collapse: a leading chevron rotates with the
  // state and the whole header toggles it (the row cap "Show more" is separate).
  const chevron = document.createElement("span");
  chevron.className = "vault-group-chevron";
  setIcon(chevron, ICON_CHEVRON_DOWN);
  chevron.setAttribute("aria-hidden", "true");
  header.appendChild(chevron);
  if (mode === "agent") {
    // The agent's real brand icon (key is the agent id). SVG comes ONLY from
    // the closed agent-icon map (never session data) → safe innerHTML (D1).
    const badge = document.createElement("span");
    badge.className = "vault-badge vault-group-badge";
    const icon = getAgentIcon(key);
    if (icon) {
      badge.classList.add(`vault-badge--${icon.accent}`);
      setIcon(badge, icon.svg);
    } else {
      badge.textContent = label.slice(0, 2);
    }
    header.appendChild(badge);
  } else {
    header.classList.add("vault-group-header--folder");
    const folderIcon = document.createElement("span");
    folderIcon.className = "vault-group-icon";
    setIcon(folderIcon, ICON_FOLDER);
    header.appendChild(folderIcon);
  }
  const labelEl = document.createElement("span");
  labelEl.className = "vault-group-label";
  labelEl.textContent = label;
  const countEl = document.createElement("span");
  countEl.className = "vault-group-count";
  countEl.textContent = `· ${count}`;
  header.append(labelEl, countEl);
  if (onStart) {
    header.appendChild(renderStartButton(label, onStart));
    // A button with no name takes one from its contents, so the start control's
    // label would otherwise be read out as part of the header's.
    header.setAttribute("aria-label", `${label}, ${count} session${count === 1 ? "" : "s"}`);
  }
  // Interactive toggle: clickable + keyboard-operable, state announced.
  header.setAttribute("role", "button");
  header.tabIndex = 0;
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.dataset.tip = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  header.addEventListener("click", onToggle);
  header.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  });
  return header;
}

/**
 * The group header's quick-launch control. Its click and keys stop at the button:
 * the header behind it toggles the group, and a launch must not also fold it.
 */
function renderStartButton(label: string, onStart: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vault-group-action";
  setIcon(btn, ICON_PLUS);
  const tip = `Start a new ${label} session in the workspace root`;
  btn.setAttribute("aria-label", tip);
  btn.dataset.tip = tip;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    onStart();
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      // Stopped, not prevented: the button still turns the key into its own
      // click, which the listener above stops.
      e.stopPropagation();
    }
  });
  return btn;
}

/** Build the empty / no-match status element, or null when the list has rows. */
export function buildListStatus(args: {
  totalCount: number;
  visibleCount: number;
  folderOnly: boolean;
  /** "Starred only" is on. Absent reads as off. */
  starredOnly?: boolean;
  contextCwd: string | null;
  query: string;
  /** Turns the folder filter off — offered when the filter alone hides everything. */
  onShowAll?: () => void;
  /** Turns the starred filter off — offered when it is what leaves the list empty. */
  onShowUnstarred?: () => void;
}): HTMLElement | null {
  if (args.totalCount === 0) {
    return emptyState(
      ICON_ARCHIVE,
      "No AI sessions yet",
      "Sessions appear here after you run an AI agent in a terminal.",
    );
  }
  if (args.visibleCount === 0) {
    // Distinct no-match state (NOT the empty state) — actionable hint. With no
    // query, the folder filter alone hides every entry, so all of them live in
    // other folders: say how many and offer the way back to them.
    // The starred filter is named first: with it on, an empty list most often
    // means nothing is starred (here) yet, whatever the folder filter says.
    if (args.starredOnly && !args.query) {
      const here = args.folderOnly && args.contextCwd;
      return emptyState(
        ICON_STAR,
        here ? "No starred sessions in this folder" : "No starred sessions",
        "Star a session from its row or its right-click menu to keep it here.",
        args.onShowUnstarred ? { label: "Show all sessions", onClick: args.onShowUnstarred } : undefined,
      );
    }
    if (args.folderOnly && args.contextCwd && !args.query) {
      const n = args.totalCount;
      return emptyState(
        ICON_SEARCH,
        "No sessions in this folder",
        `${n} ${n === 1 ? "session" : "sessions"} in other folders.`,
        args.onShowAll ? { label: "Show all sessions", onClick: args.onShowAll } : undefined,
      );
    }
    return emptyState(ICON_SEARCH, "No matching sessions", "Try a shorter query or clear the This folder filter.");
  }
  return null;
}
