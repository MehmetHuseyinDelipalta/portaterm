import type { ProvisionEntry } from "../../types/messages";
import type { ClaimedRegularFile, HeldRegularFile } from "../../utils/heldRegularFile";

export interface HeldProvisionSource {
  readonly canonicalPath: string;
  readonly file: HeldRegularFile;
}

export type ProvisionMaterial =
  | { readonly origin: "model"; readonly entry: ProvisionEntry }
  | {
      readonly origin: "held-file";
      readonly entry: ProvisionEntry & { readonly mode: "copy" };
      readonly canonicalPath: string;
      readonly file: ClaimedRegularFile;
    };

const disposedClaims = new WeakSet<ClaimedRegularFile>();

export function provisionEntryOf(material: ProvisionMaterial): ProvisionEntry {
  return material.entry;
}

export function modelProvisionMaterials(entries: readonly ProvisionEntry[]): readonly ProvisionMaterial[] {
  return entries.map((entry) => ({ origin: "model", entry }));
}

export function claimProvisionMaterials(
  entries: readonly ProvisionEntry[],
  heldFiles: ReadonlyMap<string, HeldProvisionSource>,
): readonly ProvisionMaterial[] | undefined {
  const materials: ProvisionMaterial[] = [];
  try {
    for (const entry of entries) {
      const source = heldFiles.get(entry.id);
      if (source === undefined) {
        materials.push({ origin: "model", entry });
        continue;
      }
      if (!isCopyEntry(entry)) {
        disposeProvisionMaterials(materials);
        return undefined;
      }
      const file = source.file.claim();
      if (file === undefined) {
        disposeProvisionMaterials(materials);
        return undefined;
      }
      materials.push({ origin: "held-file", entry, canonicalPath: source.canonicalPath, file });
    }
    return materials;
  } catch {
    disposeProvisionMaterials(materials);
    return undefined;
  }
}

function isCopyEntry(entry: ProvisionEntry): entry is ProvisionEntry & { readonly mode: "copy" } {
  return entry.mode === "copy";
}

export function disposeProvisionMaterials(materials: readonly ProvisionMaterial[]): void {
  for (const material of materials) {
    if (material.origin === "model" || disposedClaims.has(material.file)) {
      continue;
    }
    try {
      material.file.dispose();
      disposedClaims.add(material.file);
    } catch {
      // Continue disposing sibling claims; a later owner may retry this one.
    }
  }
}
