import { failDomain } from "./errors.ts";

const RFC_3339 =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_MINUTE = 60_000_000_000n;

export function rfc3339ToEpochNanoseconds(
  value: string,
  field = "timestamp",
): bigint {
  const match = RFC_3339.exec(value);
  if (match === null) {
    failDomain({
      code: "INVALID_TIMESTAMP",
      field,
      message: `${field} must be an RFC 3339 timestamp with an explicit offset`,
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7] ?? "";
  const zone = match[8];
  const offsetSign = match[9];
  const offsetHour = Number(match[10] ?? "0");
  const offsetMinute = Number(match[11] ?? "0");

  const localMilliseconds = Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
  );
  const local = new Date(localMilliseconds);
  const calendarFieldsAreValid =
    year >= 100 &&
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute &&
    local.getUTCSeconds() === second;

  if (
    !calendarFieldsAreValid ||
    offsetHour > 23 ||
    offsetMinute > 59 ||
    (zone !== "Z" && offsetSign === undefined)
  ) {
    failDomain({
      code: "INVALID_TIMESTAMP",
      field,
      message: `${field} contains an invalid date, time, or offset`,
    });
  }

  const offsetDirection = offsetSign === "-" ? -1 : 1;
  const offsetMilliseconds =
    zone === "Z"
      ? 0
      : offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  const instantMilliseconds = localMilliseconds - offsetMilliseconds;
  const fractionalNanoseconds = BigInt(fraction.padEnd(9, "0") || "0");

  return (
    BigInt(instantMilliseconds) * NANOSECONDS_PER_MILLISECOND +
    fractionalNanoseconds
  );
}

export function compareRfc3339(left: string, right: string): number {
  const leftInstant = rfc3339ToEpochNanoseconds(left);
  const rightInstant = rfc3339ToEpochNanoseconds(right);
  return leftInstant < rightInstant ? -1 : leftInstant > rightInstant ? 1 : 0;
}

export function ageInNanoseconds(now: string, eventAt: string): bigint {
  return (
    rfc3339ToEpochNanoseconds(now, "now") -
    rfc3339ToEpochNanoseconds(eventAt, "eventAt")
  );
}

export const minutesToNanoseconds = (minutes: number): bigint =>
  BigInt(minutes) * NANOSECONDS_PER_MINUTE;
