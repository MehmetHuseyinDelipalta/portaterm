import { describe, expect, it, vi } from "vitest";
import type { ProvisionEntry } from "../../types/messages";
import type { ClaimedRegularFile, HeldRegularFile } from "../../utils/heldRegularFile";
import {
  claimProvisionMaterials,
  disposeProvisionMaterials,
  type HeldProvisionSource,
  modelProvisionMaterials,
  type ProvisionMaterial,
  provisionEntryOf,
} from "./provisionMaterial";

function entry(id: string, over: Partial<ProvisionEntry> = {}): ProvisionEntry {
  return { id, path: `.env.${id}`, mode: "copy", source: "asimov/worktree.yaml", ...over };
}

function holder(claim: () => ClaimedRegularFile | undefined) {
  return { claim: vi.fn(claim), dispose: vi.fn(() => undefined) } satisfies HeldRegularFile;
}

function claimed() {
  return {
    acquireSource: vi.fn(() => undefined),
    dispose: vi.fn(() => undefined),
  } satisfies ClaimedRegularFile;
}

function sources(
  entries: readonly ProvisionEntry[],
  files: readonly HeldRegularFile[],
): ReadonlyMap<string, HeldProvisionSource> {
  return new Map(entries.map((item, index) => [item.id, { canonicalPath: `/repo/${item.path}`, file: files[index]! }]));
}

describe("claimProvisionMaterials", () => {
  it("keeps ordinary rows explicitly model-owned", () => {
    const configured = entry("model", { source: "claimed-like-marker", suggestion: "Added for this create" });

    const materials = modelProvisionMaterials([configured]);

    expect(materials).toEqual([{ origin: "model", entry: configured }]);
    expect(materials?.[0] && provisionEntryOf(materials[0])).toBe(configured);
  });

  it("claims a selected sidecar as required held-file material", () => {
    const selected = entry("held");
    const claim = claimed();

    const materials = claimProvisionMaterials([selected], sources([selected], [holder(() => claim)]));

    expect(materials).toEqual([
      { origin: "held-file", entry: selected, canonicalPath: "/repo/.env.held", file: claim },
    ]);
    expect(materials?.[0] && provisionEntryOf(materials[0])).toBe(selected);
  });

  it("rolls back every earlier claim when a later selected holder cannot be claimed", () => {
    const first = entry("first");
    const second = entry("second");
    const firstClaim = claimed();

    const materials = claimProvisionMaterials(
      [first, second],
      sources([first, second], [holder(() => firstClaim), holder(() => undefined)]),
    );

    expect(materials).toBeUndefined();
    expect(firstClaim.dispose).toHaveBeenCalledOnce();
  });

  it("rolls back when one holder throws instead of degrading that row to model material", () => {
    const first = entry("first");
    const second = entry("second");
    const firstClaim = claimed();

    expect(
      claimProvisionMaterials(
        [first, second],
        sources(
          [first, second],
          [
            holder(() => firstClaim),
            holder(() => {
              throw new Error("spent");
            }),
          ],
        ),
      ),
    ).toBeUndefined();
    expect(firstClaim.dispose).toHaveBeenCalledOnce();
  });

  it("refuses a held sidecar on a non-copy row and rolls back prior claims", () => {
    const first = entry("first");
    const linked = entry("linked", { mode: "link" });
    const firstClaim = claimed();
    const linkedClaim = claimed();
    const linkedHolder = holder(() => linkedClaim);

    const materials = claimProvisionMaterials(
      [first, linked],
      sources([first, linked], [holder(() => firstClaim), linkedHolder]),
    );

    expect(materials).toBeUndefined();
    expect(firstClaim.dispose).toHaveBeenCalledOnce();
    expect(linkedHolder.claim).not.toHaveBeenCalled();
    expect(linkedClaim.dispose).not.toHaveBeenCalled();
  });

  it("continues rollback after one claim disposal throws and lets that claim retry", () => {
    const first = claimed();
    first.dispose.mockImplementationOnce(() => {
      throw new Error("close request failed");
    });
    const second = claimed();
    const materials: ProvisionMaterial[] = [
      {
        origin: "held-file",
        entry: entry("first") as ProvisionEntry & { readonly mode: "copy" },
        canonicalPath: "/repo/.env.first",
        file: first,
      },
      {
        origin: "held-file",
        entry: entry("second") as ProvisionEntry & { readonly mode: "copy" },
        canonicalPath: "/repo/.env.second",
        file: second,
      },
    ];

    disposeProvisionMaterials(materials);
    disposeProvisionMaterials(materials);

    expect(first.dispose).toHaveBeenCalledTimes(2);
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it("disposes held claims once across repeated cleanup", () => {
    const file = claimed();
    const material: ProvisionMaterial = {
      origin: "held-file",
      entry: entry("held") as ProvisionEntry & { readonly mode: "copy" },
      canonicalPath: "/repo/.env.held",
      file,
    };

    disposeProvisionMaterials([material]);
    disposeProvisionMaterials([material]);

    expect(file.dispose).toHaveBeenCalledOnce();
  });
});
