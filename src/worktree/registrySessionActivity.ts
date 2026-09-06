import type { LiveActivity } from "../shared/paneEvidence";

/** Map only lifecycle values the Claude registry contract currently recognizes. */
export function registrySessionActivity(status: unknown): LiveActivity | undefined {
  switch (status) {
    case "busy":
      return "running";
    case "waiting":
      return "waiting";
    case "idle":
      return "idle";
    default:
      return undefined;
  }
}
