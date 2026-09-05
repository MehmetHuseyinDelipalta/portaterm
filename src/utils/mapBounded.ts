// src/utils/mapBounded.ts — Run a task over items with a ceiling on how many
// are in flight, results by input index.
//
// Extracted from WorktreeDiscovery so repository RESOLUTION and repository
// LISTING share one implementation: both are per-folder git spawns whose only
// ordering requirement is that the result array follows workspace-folder order.

export async function mapBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T, index);
    }
  }

  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
