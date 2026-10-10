import { expect, test } from "bun:test";
import { describeSchedule, isDue, nextRunAt, parseSchedule } from "../apps/extension/lib/schedule";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

test("accepts duration shorthands and bare hours", () => {
  expect(parseSchedule("15m")).toMatchObject({ kind: "duration", milliseconds: 15 * MINUTE });
  expect(parseSchedule("1h")).toMatchObject({ kind: "duration", milliseconds: HOUR });
  expect(parseSchedule("2d")).toMatchObject({ kind: "duration", milliseconds: 2 * DAY });
  expect(parseSchedule("1w")).toMatchObject({ kind: "duration", milliseconds: 7 * DAY });
  expect(parseSchedule("90 min")).toMatchObject({ kind: "duration", milliseconds: 90 * MINUTE });
  expect(parseSchedule("12")).toMatchObject({ kind: "duration", milliseconds: 12 * HOUR });
  expect(parseSchedule(12)).toMatchObject({ kind: "duration", milliseconds: 12 * HOUR });
});

test("rejects a duration that is out of range or malformed", () => {
  expect(parseSchedule("0m")).toEqual({ kind: "off" });
  expect(parseSchedule("90d")).toEqual({ kind: "off" });
  expect(parseSchedule("soon")).toEqual({ kind: "off" });
  expect(parseSchedule("")).toEqual({ kind: "off" });
  expect(parseSchedule(null)).toEqual({ kind: "off" });
  expect(parseSchedule(0)).toEqual({ kind: "off" });
});

test("treats explicit off words as disabled", () => {
  for (const value of ["off", "manual", "Never", " NONE "]) expect(parseSchedule(value)).toEqual({ kind: "off" });
});

test("parses five-field cron with wildcards, lists, ranges, steps and names", () => {
  expect(parseSchedule("0 9 * * *")).toMatchObject({ kind: "cron", expression: "0 9 * * *" });
  expect(parseSchedule("*/15 8-18 * * mon-fri")).toMatchObject({ kind: "cron" });
  expect(parseSchedule("30 6,18 * jan,jul *")).toMatchObject({ kind: "cron" });
  expect(parseSchedule("0 9 * * 7")).toMatchObject({ kind: "cron" });
});

test("rejects cron that is malformed or would never run", () => {
  // Both day fields constrained uses OR semantics in some crons; refuse it rather than guess.
  expect(parseSchedule("0 9 1 * mon")).toEqual({ kind: "off" });
  expect(parseSchedule("0 99 * * *")).toEqual({ kind: "off" });
  expect(parseSchedule("0 9 * *")).toEqual({ kind: "off" });
  expect(parseSchedule("0 9 * * * *")).toEqual({ kind: "off" });
  expect(parseSchedule("61 9 * * *")).toEqual({ kind: "off" });
  expect(parseSchedule("nope nine * * *")).toEqual({ kind: "off" });
});

test("a duration is due one interval after the last build, and not before", () => {
  const schedule = parseSchedule("1h")!;
  const last = new Date(2026, 0, 1, 9, 0);
  expect(isDue(schedule, last, null, new Date(2026, 0, 1, 9, 59))).toBe(false);
  expect(isDue(schedule, last, null, new Date(2026, 0, 1, 10, 0))).toBe(true);
  // An attempt inside the window suppresses a retry until the next interval.
  expect(isDue(schedule, last, new Date(2026, 0, 1, 10, 0), new Date(2026, 0, 1, 10, 30))).toBe(false);
});

test("a cron schedule is due once its next boundary passes", () => {
  const schedule = parseSchedule("0 9 * * *")!;
  const last = new Date(2026, 0, 1, 8, 0); // built just before 09:00
  expect(isDue(schedule, last, null, new Date(2026, 0, 1, 8, 59))).toBe(false);
  expect(isDue(schedule, last, null, new Date(2026, 0, 1, 9, 0))).toBe(true);
  // The boundary counts once, so a failed attempt does not repeat all day.
  expect(isDue(schedule, last, new Date(2026, 0, 1, 9, 1), new Date(2026, 0, 1, 17, 0))).toBe(false);
  expect(isDue(schedule, last, new Date(2026, 0, 1, 9, 1), new Date(2026, 0, 2, 9, 0))).toBe(true);
});

test("a weekday cron fires on the matching day only", () => {
  const schedule = parseSchedule("0 9 * * mon")!;
  const monday = new Date(2026, 0, 5, 10, 0); // Mon 5 Jan 2026
  expect(nextRunAt(schedule, monday)?.getDate()).toBe(12);
  expect(isDue(schedule, new Date(2026, 0, 4, 10, 0), null, monday)).toBe(true);
});

test("next run is searchable but bounded", () => {
  expect(parseSchedule("0 0 31 2 *")).toEqual({ kind: "off" }); // 31 February never happens
  const now = new Date(2026, 5, 1, 12, 0);
  expect(nextRunAt(parseSchedule("0 9 * * *")!, now)).toEqual(new Date(2026, 5, 2, 9, 0));
  expect(nextRunAt(parseSchedule("off")!, now)).toBeNull();
});

test("the preview describes what the schedule will do", () => {
  const now = new Date(2026, 0, 1, 9, 0);
  expect(describeSchedule(parseSchedule("15m")!, now)).toContain("every 15 minutes");
  expect(describeSchedule(parseSchedule("90m")!, now)).toContain("1.5 hours");
  expect(describeSchedule(parseSchedule("2d")!, now)).toContain("every 2 days");
  const cron = describeSchedule(parseSchedule("0 9 * * *")!, now);
  expect(cron).toContain("Runs on schedule");
  // Weekday and time only: no mixed-language "today at" wording.
  expect(cron).toMatch(/\d{1,2}:\d{2}/);
  expect(describeSchedule(parseSchedule("off")!, now)).toBe("Automatic rebuilds are off.");
});

test("hour-based cron boundaries resolve to the same minute each day", () => {
  const schedule = parseSchedule("30 6 * * *")!;
  const next = nextRunAt(schedule, new Date(2026, 0, 1, 7, 0));
  expect(next?.getHours()).toBe(6);
  expect(next?.getMinutes()).toBe(30);
  expect(next?.getDate()).toBe(2);
});
