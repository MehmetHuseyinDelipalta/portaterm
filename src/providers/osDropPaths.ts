// Extension-host: resolve the real paths of files dropped from the OS file
// manager (Finder) onto a terminal.
//
// The sandboxed webview sees a Finder drop only as bare `File` objects — no
// `File.path`, no `webUtils.getPathForFile()`. The paths still live on the
// macOS drag pasteboard, which keeps the last drag's items until the next drag
// starts, so the host reads them from there. The webview sends the dropped
// file NAMES along; the pasteboard is trusted only when its basenames match
// them, so a stale pasteboard from an earlier drag never types a wrong path.

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import { escapePathForShell } from "../utils/shellEscape";

const execFileAsync = promisify(execFile);

/**
 * JXA: print the drag pasteboard's file URLs as a JSON array of POSIX paths.
 * Finder writes file-reference URLs (`file:///.file/id=…`); `filePathURL`
 * resolves those to a real path and is the identity on an ordinary file URL.
 */
const READ_DRAG_PASTEBOARD_JXA = `
ObjC.import("AppKit");
const items = $.NSPasteboard.pasteboardWithName($.NSPasteboardNameDrag).pasteboardItems;
const out = [];
for (let i = 0; i < items.count; i++) {
  const s = items.objectAtIndex(i).stringForType("public.file-url");
  if (s.isNil()) continue;
  const url = $.NSURL.URLWithString(s).filePathURL;
  if (!url.isNil()) out.push(url.path.js);
}
JSON.stringify(out);
`;

/** Paths currently on the macOS drag pasteboard; `[]` when unreadable or not macOS. */
export async function readOsDragPaths(platform: NodeJS.Platform = process.platform): Promise<string[]> {
  if (platform !== "darwin") {
    return [];
  }
  try {
    const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", READ_DRAG_PASTEBOARD_JXA], {
      timeout: 3000,
    });
    const parsed: unknown = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
  } catch {
    return [];
  }
}

/**
 * Order `paths` to follow `names` when the two describe the same set of files
 * (basename for name, as a multiset); `null` on any mismatch. A mismatch means
 * the pasteboard is not this drop's — e.g. a stale one left by an earlier drag.
 */
export function matchDropPaths(paths: readonly string[], names: readonly string[]): string[] | null {
  if (names.length === 0 || paths.length !== names.length) {
    return null;
  }
  const remaining = [...paths];
  const ordered: string[] = [];
  for (const name of names) {
    const index = remaining.findIndex((p) => path.basename(p) === name);
    if (index === -1) {
      return null;
    }
    ordered.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return ordered;
}

/**
 * Resolve an OS drop of `names` and type the shell-escaped paths into `tabId`,
 * the same way "Insert Path in Portaterm" does. Returns whether anything was written.
 */
export async function handleInsertOsDropPaths(
  tabId: string,
  names: readonly string[],
  write: (tabId: string, data: string) => void,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const paths = matchDropPaths(await readOsDragPaths(platform), names);
  if (!paths) {
    return false;
  }
  write(tabId, `${paths.map(escapePathForShell).join(" ")} `);
  return true;
}
