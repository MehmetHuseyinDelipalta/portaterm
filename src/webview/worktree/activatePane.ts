import type { SplitNode } from "../SplitModel";
import { getAllSessionIds } from "../SplitModel";

export interface ActivatePaneDeps {
  tabLayouts: ReadonlyMap<string, SplitNode>;
  canDisplayTab(tabId: string): boolean;
  navigatePane(paneId: string): void;
}

export function activatePane(paneId: string, deps: ActivatePaneDeps): boolean {
  for (const [tabId, layout] of deps.tabLayouts) {
    if (!getAllSessionIds(layout).includes(paneId)) {
      continue;
    }
    if (!deps.canDisplayTab(tabId)) {
      return false;
    }
    deps.navigatePane(paneId);
    return true;
  }
  return false;
}
