// src/vault/readers/claudeScan.ts — One pass over a Claude transcript for a
// detail read: the bounded head+tail records plus the whole-stream facts the
// detail builders need (team context, spawned subagent ids, token usage).
//
// The pass goes through the shared follow cache (`jsonlFollow.ts`), so reading
// the same transcript again — the live follow re-reads it on every write, "load
// more" re-reads it unchanged — parses only what was appended since.

import type { VaultSessionUsage } from "../types";
import { teamContextCollector } from "./claudeTeam";
import { createClaudeUsageCollector } from "./claudeUsage";
import { createBoundedRecordBuffer, createSpawnIdCollector } from "./detail";
import { type JsonlFollowCache, jsonlFollowCache } from "./jsonlFollow";

type Rec = Record<string, unknown>;

export interface ClaudeTranscriptScan {
  records: Rec[];
  truncated: boolean;
  team: { teamNames: Set<string>; selfIsMember: boolean; colorByMember: Map<string, string> };
  /** `Agent`/`Task` tool_use ids spawned in this transcript (non-sidechain only unless `includeSidechain`). */
  spawnIds: Set<string>;
  usage: VaultSessionUsage | undefined;
}

function scanState(includeSidechain: boolean) {
  return {
    buffer: createBoundedRecordBuffer(),
    team: teamContextCollector(),
    spawn: createSpawnIdCollector(includeSidechain),
    usage: createClaudeUsageCollector(),
  };
}

/**
 * Scan `filePath` for a detail read. `includeSidechain` is true for a subagent's
 * own file (every record is the sidechain) and false for a main session. `null`
 * when the file cannot be read.
 *
 * Everything returned is a copy: the kept state goes on being fed by later reads.
 */
export function scanClaudeTranscript(
  filePath: string,
  options: { includeSidechain: boolean },
  cache: JsonlFollowCache = jsonlFollowCache,
): Promise<ClaudeTranscriptScan | null> {
  return cache.read(
    `claude:${options.includeSidechain ? "sidechain" : "main"}\0${filePath}`,
    filePath,
    () => scanState(options.includeSidechain),
    (state, record) => {
      // Collectors BEFORE buffering, so they see every record even when the
      // head+tail bound later drops the middle of a very large transcript (W1).
      state.team.onRecord(record);
      state.spawn.onRecord(record);
      state.usage.onRecord(record);
      state.buffer.push(record);
    },
    (state) => {
      const { records, truncated } = state.buffer.result();
      const usage = state.usage.result();
      return {
        records,
        truncated,
        team: {
          teamNames: new Set(state.team.ctx.teamNames),
          selfIsMember: state.team.ctx.selfIsMember,
          colorByMember: new Map(state.team.ctx.colorByMember),
        },
        spawnIds: new Set(state.spawn.ids),
        usage: usage === undefined ? undefined : structuredClone(usage),
      };
    },
  );
}
