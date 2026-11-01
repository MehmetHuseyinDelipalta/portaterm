// src/vault/readers/claudeReader.ts — Read Claude Code sessions (metadata only)
// + dispatch on-demand session detail.
// See: specs/agent-session-index/spec.md (Read Claude Code sessions; Metadata-only),
//      design.md D4 (bounded title preview), D7 (cwd encoding), D8 (defensive parse),
//      docs/research/20260528-cmux-vault-mechanism.md §3.
//
// Sessions live at `<root>/projects/<encoded-cwd>/*.jsonl` where root is
// `$CLAUDE_CONFIG_DIR` else `~/.claude`, and the encoded-cwd dir name is the
// project cwd with every `/` replaced by `-`. We stream each file and stop once
// the title (first user message) and model (first assistant message) are found —
// the full transcript is never loaded.
//
// This module is the reader's entry point + metadata scanner; the heavier
// concerns are split out: path/id safety (claudePaths), bounded JSONL streaming
// (claudeRecords), team threading (claudeTeam), and nested children
// (claudeChildren). The shared classifier lives in ./detail.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { provesAbsence } from "../../utils/fsPresence";
import { mapBounded } from "../../utils/mapBounded";
import { isResolvedPathInsideRoot, prepareResolvedRoot } from "../../utils/resolvedPathBoundary";
import type { ReaderListCache, ReaderRefreshHint, ReaderResultWithState } from "../cacheTypes";
import { boundedPreview } from "../preview";
import { formatEntryId, type VaultEntryLookup, type VaultSessionDetail, type VaultSessionEntry } from "../types";
import { type ClaudeChildId, parseClaudeChildId } from "./claudeChildIds";
import {
  listClaudeSubagentStubs,
  listClaudeWorkflowNodes,
  readClaudeSubagentDetail,
  readClaudeWorkflowAgentDetail,
  readClaudeWorkflowDetail,
} from "./claudeChildren";
import {
  type ClaudeReaderOptions,
  claudeRoots,
  decodeProjectDir,
  isSafeSessionId,
  listJsonlFiles,
  resolveClaudeSessionPath,
  resolveClaudeSubagentPath,
  resolveClaudeWorkflowAgentPath,
  scanClaudeSessionPath,
} from "./claudePaths";
import { extractUserText, readLatestTailFields } from "./claudeRecords";
import { scanClaudeTranscript } from "./claudeScan";
import { buildTeamThread, readClaudeTeamSegment, recordTeamIdentity, teammateMessageHook } from "./claudeTeam";
import {
  boundTimeline,
  clampDetailLimit,
  classifyClaudeStyleEvents,
  finalizeDetail,
  MAX_TIMELINE_ITEMS,
  mergeTimestampedItems,
  scopeDirectChildren,
  sourceVerdict,
} from "./detail";
import { streamJsonlObjects } from "./jsonlStream";
import { findRecordLine, type RecordLineResult } from "./recordLine";

const NOT_FOUND = { ok: false, reason: "not-found" } as const;

export { listClaudeWorkflowStubs } from "./claudeChildren";
// Re-export the public reader surface so existing importers (VaultService, the
// Codex reader's `ReaderResult` type, and the reader tests) keep their paths.
export type { ClaudeReaderOptions } from "./claudePaths";
export { claudeSessionMtime, resolveClaudeSessionPath, resolveClaudeSubagentPath } from "./claudePaths";

export interface ReaderResult {
  entries: VaultSessionEntry[];
  unreadable: number;
}

interface ClaudeFileFields {
  cwd?: string;
  gitBranch?: string;
  permissionMode?: string;
  model?: string;
  /** The first human prompt (or a legacy summary) — the LAST resort for a title. */
  title?: string;
  /** True when at least one line parsed as JSON — otherwise the file is junk. */
  parsedAnyLine: boolean;
  /**
   * True when the session has real content: a human prompt (a non-meta user
   * record whose text survives `cleanPromptText`) OR an assistant turn (which
   * carries any tool use). A session with NEITHER — e.g. a transcript holding
   * only a `/clear` command + caveat banner — is junk the list hides (D18).
   */
  hasContent: boolean;
  /**
   * True when this session is a non-lead TEAM MEMBER: an early record (within the
   * metadata head scan) carries BOTH a non-empty `agentName` and `teamName` — it
   * was born into a team rather than spawning one. The top-level list excludes
   * these (nest-workflow-team-sessions D5); a leader has neither on its early
   * records (the team is created mid-session). The predicate MUST match the
   * team-grouping predicate (D4) so an `agentName`-only session is never hidden.
   */
  isTeamMember: boolean;
}

async function parseClaudeFile(filePath: string): Promise<ClaudeFileFields | null> {
  const fields: ClaudeFileFields = { parsedAnyLine: false, isTeamMember: false, hasContent: false };
  let summary: string | undefined;
  let haveUser = false;
  let haveAssistant = false;

  try {
    for await (const { record: obj } of streamJsonlObjects(filePath)) {
      fields.parsedAnyLine = true;

      if (fields.cwd === undefined && typeof obj.cwd === "string") {
        fields.cwd = obj.cwd;
      }
      if (fields.gitBranch === undefined && typeof obj.gitBranch === "string") {
        fields.gitBranch = obj.gitBranch;
      }
      // Permission mode is session STATE, not an attribute — LAST one in this
      // window wins, never the first (D1). The tail scan overrides it below.
      if (typeof obj.permissionMode === "string") {
        fields.permissionMode = obj.permissionMode;
      }
      if (summary === undefined && obj.type === "summary" && typeof obj.summary === "string") {
        summary = obj.summary;
      }
      if (!haveUser && obj.type === "user" && obj.isMeta !== true && obj.isSidechain !== true) {
        const text = extractUserText(obj);
        if (text) {
          fields.title = text;
          // Team-member detection (D5, W2): decided on this FIRST identity record
          // — a teammate is born into a team with both fields here; a leader has
          // neither (the team it later creates comes after this record).
          fields.isTeamMember = recordTeamIdentity(obj) !== null;
          haveUser = true;
        }
      }
      if (!haveAssistant && obj.type === "assistant") {
        const model = (obj.message as { model?: unknown } | undefined)?.model;
        if (typeof model === "string") {
          fields.model = model;
          haveAssistant = true;
        }
      }
      // Title + model are the last-appearing fields we need; cwd/branch/mode
      // sit on earlier lines, so stop here to avoid loading the transcript.
      if (haveUser && haveAssistant) {
        break;
      }
    }
  } catch {
    return null; // stream/open failure → unreadable
  }

  if (!fields.parsedAnyLine) {
    return null;
  }
  fields.hasContent = haveUser || haveAssistant;
  if (fields.title === undefined && summary !== undefined) {
    fields.title = summary;
  }
  return fields;
}

/**
 * On-demand bounded detail for a Claude session: resolve the file by id, stream
 * + classify its mixed-event records. Returns null when the session can't be
 * located or read.
 */
export async function readClaudeDetail(
  sessionId: string,
  options: ClaudeReaderOptions = {},
  limit?: number,
): Promise<VaultSessionDetail | null> {
  // A child id carries a marker (`:subagent:` / `:workflow:` / `:wfagent:` /
  // `:team:`); a plain session id parses to null and falls through to the
  // main-session path below. Each child branch resolves by id under the projects
  // root (containment-checked) — never a webview-supplied path (D2/D6).
  const child = parseClaudeChildId(sessionId);
  if (child) {
    return readClaudeChildDetail(child, sessionId, options, limit);
  }

  const filePath = await resolveClaudeSessionPath(sessionId, options);
  if (!filePath) {
    return null;
  }
  // Collect the leader's team context across the WHOLE stream (even records the
  // head+tail bound later drops) so a team episode buried mid-transcript is still
  // grouped (D4), and detect whether THIS session is itself a non-lead member —
  // a member must NOT synthesize its own Team group (recursive peer nesting, W3),
  // so team groups are leader-only.
  // Two whole-stream side-collectors share the single pass: team context (D4) and
  // the root's `Agent`/`Task` spawn ids (non-sidechain only) used to scope subagent
  // stubs to root's DIRECT children — so a subagent spawned inside another subagent
  // is NOT flattened under the root (support-nested-subagent-preview D2).
  const read = await scanClaudeTranscript(filePath, { includeSidechain: false });
  if (read === null) {
    return null;
  }
  const ctx = read.team;
  // childStubs = flat subagents ∪ workflow groups (each folds into its spawn call
  // or merges by timestamp). Team members are NOT collapsed groups any more:
  // their communication turns are threaded as `teammateTurn` nodes (D13/D14). A
  // member resolves an empty team set → no teammate turns under it (W3).
  const teamScanNames = ctx.selfIsMember ? new Set<string>() : ctx.teamNames;
  const [subStubs, wfNodes, teammateTurns] = await Promise.all([
    listClaudeSubagentStubs(sessionId, options),
    listClaudeWorkflowNodes(sessionId, options),
    buildTeamThread(filePath, teamScanNames, ctx.colorByMember),
  ]);
  // Progress-bearing runs render INLINE as self-collapsing `workflowBoard` items (no
  // wrapper layer) — threaded with the teammate turns by timestamp below. Fallback
  // runs fold in as lazy "Workflow:" group stubs (classify merges them).
  const childStubs = [...scopeDirectChildren(subStubs, read.spawnIds), ...wfNodes.stubs];
  const detail = classifyClaudeStyleEvents(read.records, {
    limit,
    childStubs,
    teammateMessage: teammateMessageHook,
    usage: read.usage,
  });
  // Thread the teammate turns + inline workflow boards into the classified timeline
  // by timestamp, then re-bound (classify already bounded its stream-derived items) (D14).
  const extras = [...teammateTurns, ...wfNodes.boards];
  if (extras.length > 0) {
    const merged = mergeTimestampedItems(detail.timeline, extras);
    const bounded = boundTimeline(merged, clampDetailLimit(limit) ?? MAX_TIMELINE_ITEMS);
    detail.timeline = bounded.timeline;
    if (bounded.truncated) {
      detail.truncated = true;
    }
  }
  return finalizeDetail(formatEntryId("claude", sessionId), detail, sourceVerdict(read.truncated));
}

/**
 * The verbatim transcript line whose record carries `msgRef` (its `uuid`), for the
 * per-message Raw copy (D5). Aggregate child ids (a workflow group, a team turn)
 * span no single file and resolve to null. Returns null when nothing matches or the
 * line exceeds `maxBytes`.
 */
export async function readClaudeMessageRecord(
  sessionId: string,
  msgRef: string,
  options: ClaudeReaderOptions = {},
  maxBytes?: number,
): Promise<RecordLineResult> {
  if (!isSafeSessionId(msgRef)) {
    return NOT_FOUND;
  }
  const child = parseClaudeChildId(sessionId);
  let filePath: string | null;
  switch (child?.kind) {
    case undefined:
      filePath = await resolveClaudeSessionPath(sessionId, options);
      break;
    case "subagent":
      filePath = await resolveClaudeSubagentPath(child.parentId, child.stem, options);
      break;
    case "wfagent":
      filePath = await resolveClaudeWorkflowAgentPath(child.parentId, child.wfId, child.stem, options);
      break;
    default:
      filePath = null;
  }
  // A uuid rides plumbing records too (summaries, trailers), so matching it
  // alone would resolve one of those as the message the locator names.
  return filePath
    ? findRecordLine(
        filePath,
        (rec) => rec.uuid === msgRef && (rec.type === "user" || rec.type === "assistant"),
        maxBytes,
        { needles: [`"uuid":${JSON.stringify(msgRef)}`] },
      )
    : NOT_FOUND;
}

/** Dispatch a parsed child id to its resolver (nest-workflow-team-sessions D2). */
async function readClaudeChildDetail(
  child: ClaudeChildId,
  sessionId: string,
  options: ClaudeReaderOptions,
  limit: number | undefined,
): Promise<VaultSessionDetail | null> {
  switch (child.kind) {
    case "subagent":
      return readClaudeSubagentDetail(child.parentId, child.stem, sessionId, options, limit);
    case "workflow":
      return readClaudeWorkflowDetail(child.parentId, child.wfId, sessionId, options, limit);
    case "wfagent":
      return readClaudeWorkflowAgentDetail(child.parentId, child.wfId, child.stem, sessionId, options, limit);
    case "teamTurn":
      return readClaudeTeamSegment(child.memberId, child.turn, options, limit);
  }
}

/**
 * Build one Claude entry from its session file (metadata + first/last record).
 * Shared by the list scan and the single-entry resolve so both produce identical
 * entries. Throws on stat/read failure (caller catches → unreadable); returns
 * null when the file has no usable records (D8). The cwd falls back to the decoded
 * project-dir name (the file's parent) when the transcript omits it.
 */
async function buildClaudeEntry(
  filePath: string,
  sessionId: string,
  configDir: string | undefined,
): Promise<{ entry: VaultSessionEntry; isTeamMember: boolean; isEmpty: boolean } | null> {
  const stat = await fs.stat(filePath);
  const fields = await parseClaudeFile(filePath);
  if (!fields) {
    return null;
  }
  // Claude's own display precedence, so a row reads as it does in Claude: the
  // name the user gave the session > the title Claude generated > the last
  // prompt > the first prompt.
  const tail = await readLatestTailFields(filePath);
  const title = tail.customTitle ?? tail.aiTitle ?? tail.lastPrompt ?? fields.title ?? "";
  const entry: VaultSessionEntry = {
    id: formatEntryId("claude", sessionId),
    agent: "claude",
    sessionId,
    title: boundedPreview(title),
    cwd: fields.cwd ?? decodeProjectDir(path.basename(path.dirname(filePath))),
    modified: stat.mtimeMs,
    gitBranch: fields.gitBranch,
    flags: {
      model: fields.model,
      // The mode as of the END of the session: the tail scan sees every change the
      // head window stopped short of, so it wins when it found one (D1). Neither
      // scan finding one leaves the flag off — the CLI applies its own default.
      permissionMode: tail.permissionMode ?? fields.permissionMode,
      configDir,
    },
    // File-backed → the webview shows file-targeting context-menu items;
    // the host re-derives this path by id, never trusting it (D9).
    sessionPath: filePath,
  };
  // isTeamMember / isEmpty ride alongside (not on the entry) so the list path can
  // EXCLUDE members (D5) and content-less junk (D18), while the single-entry
  // resolve still returns them — both are real sessions, launchable by explicit
  // id even when hidden from the list.
  return { entry, isTeamMember: fields.isTeamMember, isEmpty: !fields.hasContent };
}

/** Session files read at once in a full pass. */
export const CLAUDE_SCAN_CONCURRENCY = 16;

type ClaudeFilesCache = Extract<ReaderListCache, { kind: "files" }>;
type FileStamp = ClaudeFilesCache["files"][string]["stamp"];

/** What one session file contributes to the list. */
type ClaudeFileOutcome =
  | { kind: "listed"; stamp: FileStamp; entry: VaultSessionEntry }
  | { kind: "excluded"; stamp: FileStamp }
  | { kind: "unreadable" }
  /** Not a session of the list: gone, or resolving outside the store. */
  | { kind: "none" };

const sameStamp = (a: FileStamp | undefined, b: FileStamp): boolean =>
  a !== undefined && a.mtimeMs === b.mtimeMs && a.size === b.size;

/**
 * Classify one session file, reading its body only when its stamp is new: an
 * unchanged file listed before reuses its entry, and an unchanged file excluded
 * before (a team member, or no content) stays excluded.
 */
async function readClaudeSessionFile(
  filePath: string,
  configDir: string | undefined,
  resolvedRoot: NonNullable<Awaited<ReturnType<typeof prepareResolvedRoot>>>,
  prev: ClaudeFilesCache | undefined,
  missingIsGone: boolean,
): Promise<ClaudeFileOutcome> {
  // Being LISTED under the root is not evidence of being inside it: a symlink
  // here resolves wherever it likes, and everything below this line stats and
  // reads the file. One entry is skipped, not the directory — a link out of the
  // store is a lost row, not a lost project.
  if (!(await isResolvedPathInsideRoot(filePath, resolvedRoot))) {
    return { kind: "none" };
  }
  try {
    const stat = await fs.stat(filePath);
    const stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    const cached = prev?.files[filePath];
    if (cached && sameStamp(cached.stamp, stamp)) {
      // Unchanged + previously LISTED file — reuse the cached entry without a
      // body read (skips the metadata stream + the 64 KB ai-title tail, the
      // dominant cost).
      return { kind: "listed", stamp, entry: cached.entry };
    }
    if (sameStamp(prev?.excluded?.[filePath], stamp)) {
      return { kind: "excluded", stamp };
    }
    const built = await buildClaudeEntry(filePath, path.basename(filePath, ".jsonl"), configDir);
    if (!built) {
      return { kind: "unreadable" };
    }
    // Members thread under their leader (D5); content-less sessions (only a
    // /clear, a caveat banner, …) are junk — neither is listed (D18).
    return built.isTeamMember || built.isEmpty
      ? { kind: "excluded", stamp }
      : { kind: "listed", stamp, entry: built.entry };
  } catch (err) {
    return missingIsGone && provesAbsence(err) ? { kind: "none" } : { kind: "unreadable" };
  }
}

/** The session files a watcher's changed paths touch, or `null` when only a full pass can tell. */
async function hintedSessionFiles(paths: readonly string[], projectsDir: string): Promise<string[] | null> {
  const files: string[] = [];
  const inside = projectsDir + path.sep;
  for (const changed of paths) {
    if (!changed.startsWith(inside)) {
      return null; // outside the store, or the store itself
    }
    const parts = changed.slice(inside.length).split(path.sep);
    if (parts.length < 2) {
      return null; // a project folder
    }
    if (parts.length > 2) {
      continue; // below a project folder (a session's own subagents): never a list row
    }
    if (!parts[1].endsWith(".jsonl")) {
      return null;
    }
    // A full pass lists only real project folders (a symlinked one is skipped).
    try {
      if (!(await fs.lstat(path.join(projectsDir, parts[0]))).isDirectory()) {
        continue;
      }
    } catch (err) {
      if (!provesAbsence(err)) {
        return null;
      }
    }
    files.push(path.join(projectsDir, parts[0], parts[1]));
  }
  return files;
}

/** The list, and the cache for the next pass, from every file's outcome. */
function claudeListResult(outcomes: ReadonlyMap<string, ClaudeFileOutcome>): ReaderResultWithState {
  const files: ClaudeFilesCache["files"] = {};
  const excluded: Record<string, FileStamp> = {};
  const unreadablePaths: string[] = [];
  const entries: VaultSessionEntry[] = [];
  for (const [filePath, outcome] of outcomes) {
    if (outcome.kind === "listed") {
      files[filePath] = { stamp: outcome.stamp, entry: outcome.entry };
      entries.push(outcome.entry);
    } else if (outcome.kind === "excluded") {
      excluded[filePath] = outcome.stamp;
    } else if (outcome.kind === "unreadable") {
      unreadablePaths.push(filePath);
    }
  }
  return {
    entries,
    unreadable: unreadablePaths.length,
    cache: { kind: "files", files, excluded, unreadablePaths },
  };
}

/** Every file of `prev` as the outcome it had, to carry forward past a hinted pass. */
function previousOutcomes(prev: ClaudeFilesCache): Map<string, ClaudeFileOutcome> {
  const outcomes = new Map<string, ClaudeFileOutcome>();
  for (const [filePath, file] of Object.entries(prev.files)) {
    outcomes.set(filePath, { kind: "listed", stamp: file.stamp, entry: file.entry });
  }
  for (const [filePath, stamp] of Object.entries(prev.excluded ?? {})) {
    outcomes.set(filePath, { kind: "excluded", stamp });
  }
  for (const filePath of prev.unreadablePaths ?? []) {
    outcomes.set(filePath, { kind: "unreadable" });
  }
  return outcomes;
}

/**
 * List Claude sessions, incrementally (cache-vault-load D3). When `prev` carries
 * a per-file cache, each session file is `stat`-ed and — if its `(mtimeMs, size)`
 * is unchanged — its entry is reused WITHOUT re-reading the body (skipping the
 * metadata stream and the 64 KB ai-title tail read, the dominant cost); a file
 * excluded last time is likewise not read to be excluded again. Files absent
 * from disk drop out of the returned cache, so deletions reconcile. The returned
 * cache is keyed by current paths only.
 *
 * With a watcher's `hint`, only the session files it names are looked at again
 * and every other file keeps what `prev` says of it — unless a path is one only
 * a full pass can account for (outside the store, a folder), or there is no
 * `prev` to carry forward.
 *
 * Stays option-first for back-compat; `prev` is an optional second argument.
 */
export async function readClaudeSessions(
  options: ClaudeReaderOptions = {},
  prev?: ReaderListCache,
  hint?: ReaderRefreshHint,
): Promise<ReaderResultWithState> {
  const { configDir, projectsDir } = claudeRoots(options);
  const prevFiles = prev?.kind === "files" ? prev : undefined;
  const empty: ReaderResultWithState = { entries: [], unreadable: 0, cache: { kind: "files", files: {} } };

  // The root is resolved once for the whole listing, not once per file — it
  // cannot move within a pass in any way this pass would observe, and a store
  // with a long history makes that a syscall per session (D8). Null means the
  // root itself does not resolve, so nothing is inside it and there is nothing
  // to list.
  if (hint && prevFiles) {
    const named = await hintedSessionFiles(hint.paths, projectsDir);
    if (named) {
      const resolvedRoot = await prepareResolvedRoot(projectsDir);
      if (resolvedRoot === null) {
        return empty;
      }
      const outcomes = previousOutcomes(prevFiles);
      const fresh = await mapBounded(named, CLAUDE_SCAN_CONCURRENCY, (filePath) =>
        readClaudeSessionFile(filePath, configDir, resolvedRoot, prevFiles, true),
      );
      for (const [i, filePath] of named.entries()) {
        outcomes.set(filePath, fresh[i] as ClaudeFileOutcome);
      }
      return claudeListResult(outcomes);
    }
  }

  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    // No store → zero entries (not an error), and an empty cache so the next
    // refresh re-discovers the dir if the user starts using the agent.
    return empty;
  }
  const resolvedProjectsRoot = await prepareResolvedRoot(projectsDir);
  if (resolvedProjectsRoot === null) {
    return empty;
  }

  const filePaths = (
    await mapBounded(projectDirs, CLAUDE_SCAN_CONCURRENCY, (projectDir) =>
      listJsonlFiles(path.join(projectsDir, projectDir)),
    )
  ).flat();
  const read = await mapBounded(filePaths, CLAUDE_SCAN_CONCURRENCY, (filePath) =>
    readClaudeSessionFile(filePath, configDir, resolvedProjectsRoot, prevFiles, false),
  );
  return claudeListResult(new Map(filePaths.map((filePath, i) => [filePath, read[i] as ClaudeFileOutcome])));
}

/**
 * Resolve ONE Claude session by id — the single-entry counterpart to
 * readClaudeSessions, used by VaultService for fast stored-session launch (no full-store
 * scan; D3). Answers conclusively: `absent` only from an exhaustive scan that did
 * not find the file, `unknown` from any scan or build that failed.
 */
export async function lookupClaudeEntry(
  sessionId: string,
  options: ClaudeReaderOptions = {},
): Promise<VaultEntryLookup> {
  const { configDir } = claudeRoots(options);
  const scan = await scanClaudeSessionPath(sessionId, options);
  if (!scan.path) {
    // Only a scan that searched everywhere may call the session absent.
    return scan.exhaustive ? { status: "absent" } : { status: "unknown" };
  }
  try {
    // Resolve-by-id returns the entry even for a team member (it's a real,
    // launchable session) — only the list path hides members (D5).
    const built = await buildClaudeEntry(scan.path, sessionId, configDir);
    // The file is there and we could not turn it into an entry: the session
    // exists, so this is never absence.
    return built ? { status: "found", entry: built.entry } : { status: "unknown" };
  } catch {
    return { status: "unknown" };
  }
}
