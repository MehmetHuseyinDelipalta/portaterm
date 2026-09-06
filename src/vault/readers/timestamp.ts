const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const LEGACY_EPOCH_MS = /^[1-9]\d{12}$/;

/** A store-native epoch-millisecond value. Strings are not numbers at this boundary. */
export function parseEpochMilliseconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : undefined;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** An RFC3339 timestamp string, without loose or normalizing date parsing. */
export function parseRfc3339Timestamp(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = RFC3339.exec(value);
  if (!match) {
    return undefined;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** A transcript timestamp: epoch milliseconds as a number, or an RFC3339 string. */
export function parseStoredTimestamp(value: unknown): number | undefined {
  return parseEpochMilliseconds(value) ?? parseRfc3339Timestamp(value);
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
