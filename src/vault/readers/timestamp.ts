const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const LEGACY_EPOCH_MS = /^[1-9]\d{12}$/;

/** A store-native epoch-millisecond value. Strings are not numbers at this boundary. */
export function parseEpochMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

/** A transcript timestamp: epoch milliseconds as a number, or an RFC3339 string. */
export function parseStoredTimestamp(value: unknown): number | undefined {
  const epoch = parseEpochMilliseconds(value);
  if (epoch !== undefined) {
    return epoch;
  }
  if (typeof value !== "string" || !RFC3339.test(value)) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Claude workflow manifests historically wrote startTime as a 13-digit string. */
export function parseWorkflowStartTime(value: unknown): number | undefined {
  const epoch = parseEpochMilliseconds(value);
  if (epoch !== undefined) {
    return epoch;
  }
  if (typeof value !== "string" || !LEGACY_EPOCH_MS.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}
