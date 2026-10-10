/**
 * Rebuild scheduling. One parser serves the Settings preview and the worker's
 * rebuild check, so what the field promises is what the alarm enforces.
 *
 * Accepted grammar:
 * - Duration: `15m`, `1h`, `2d`, `1w`, or a bare number of hours (`12`).
 * - Cron: standard five fields (`0 9 * * *`), with `*`, ranges, lists, steps,
 *   and three-letter names (`mon`, `jan`). Minute resolution matches the
 *   worker's one-minute alarm heartbeat.
 * - `off` (or an empty value) disables the schedule.
 */

export type Schedule =
  | { kind: "off" }
  | { kind: "duration"; milliseconds: number; text: string }
  | { kind: "cron"; expression: string; text: string };

/** 30 days, to keep a stored duration finite and the preview meaningful. */
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
/** How far a search looks for the next matching time before giving up. */
const SEARCH_HORIZON_DAYS = 60;
/** Validation looks further out, so a yearly expression is still accepted. */
const VALIDATION_HORIZON_DAYS = 400;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_REBUILD_INTERVAL_HOURS = 12;
export const PRESET_SCHEDULES: { value: string; label: string }[] = [
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "1d", label: "Every day" },
  { value: "2d", label: "Every 2 days" },
  { value: "0 9 * * *", label: "Daily at 09:00 (cron)" },
  { value: "0 9 * * mon", label: "Mondays at 09:00 (cron)" },
];

type FieldSet = { kind: "any" } | { kind: "values"; values: globalThis.Set<number> };

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** Expand one cron field into a predicate. Returns null when it is malformed. */
function parseField(field: string, min: number, max: number, names?: string[]): FieldSet | null {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [rangeText, stepText, ...extra] = part.split("/");
    if (extra.length || !rangeText) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    let start: number;
    let end: number;
    if (rangeText === "*") {
      start = min;
      end = max;
    } else {
      const [startText, endText, ...rest] = rangeText.split("-");
      if (rest.length) return null;
      const read = (text: string): number | null => {
        const name = names?.indexOf(text.toLowerCase()) ?? -1;
        if (name !== -1) return name + (names === MONTH_NAMES ? 1 : 0);
        const value = Number(text);
        return text !== "" && Number.isInteger(value) ? value : null;
      };
      const from = read(startText);
      const to = endText === undefined ? from : read(endText);
      if (from === null || to === null || from < min || to > max || from > to) return null;
      start = from;
      end = to;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size ? { kind: "values", values } : null;
}

interface CronExpression {
  fields: FieldSet[];
  /** Day-of-month and day-of-week are both constrained, which most cron quirks make unsafe. */
  plain: boolean;
}

function parseCron(expression: string): CronExpression | null {
  const fields = expression.trim().toLowerCase().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  // Reject the OR-semantics case rather than silently running the wrong days.
  if (dayOfMonth !== "*" && dayOfWeek !== "*") return null;
  const normalizedWeekday = dayOfWeek
    .split(",")
    // `7` is Sunday for cron; map single values so 7 and 0 both work.
    .map((part) => (/^\d+$/.test(part) ? String(Number(part) % 7) : part))
    .join(",");
  const parsed = [
    parseField(minute, 0, 59),
    parseField(hour, 0, 23),
    parseField(dayOfMonth, 1, 31),
    parseField(month, 1, 12, MONTH_NAMES),
    parseField(normalizedWeekday, 0, 6, WEEKDAY_NAMES),
  ];
  if (parsed.some((field) => field === null)) return null;
  return { fields: parsed as FieldSet[], plain: true };
}

const matches = (set: FieldSet, value: number) => set.kind === "any" || set.values.has(value);

function floorToMinute(date: Date) {
  return Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS;
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/**
 * First matching time strictly after `from`, or null when nothing matches inside
 * the horizon. Strictly-after matters: the current minute has already arrived,
 * so reporting it would make a schedule look due the moment it is saved.
 */
function nextCronRun(expression: string, from: Date, horizonDays = SEARCH_HORIZON_DAYS): Date | null {
  const cron = parseCron(expression);
  if (!cron) return null;
  const [minuteSet, hourSet, domSet, monthSet, dowSet] = cron.fields;
  const horizon = from.getTime() + horizonDays * DAY_MS;
  for (const day = startOfDay(from); day.getTime() < horizon; day.setDate(day.getDate() + 1)) {
    if (!matches(monthSet, day.getMonth() + 1)) continue;
    const domMatches = matches(domSet, day.getDate());
    // Cron day-of-week uses 0-6 with Sunday as 0; getDay() already does.
    const dowMatches = matches(dowSet, day.getDay());
    if (!domMatches || !dowMatches) continue;
    // A matching day still needs a matching hour and minute after `from`.
    const firstCandidate = Math.max(day.getTime(), floorToMinute(from) + MINUTE_MS);
    for (let candidate = firstCandidate; candidate < day.getTime() + DAY_MS; candidate += MINUTE_MS) {
      if (candidate > horizon) break;
      const time = new Date(candidate);
      if (matches(hourSet, time.getHours()) && matches(minuteSet, time.getMinutes())) return time;
    }
  }
  return null;
}

/** Parse a stored or typed schedule. `off` disables rebuilding. */
export function parseSchedule(input: string | number | null | undefined): Schedule {
  if (input === null || input === undefined) return { kind: "off" };
  if (typeof input === "number") {
    return input > 0 && input * 3_600_000 <= MAX_DURATION_MS
      ? { kind: "duration", milliseconds: input * 3_600_000, text: `${input}h` }
      : { kind: "off" };
  }

  const text = input.trim();
  if (!text || /^(off|none|never|manual)$/i.test(text)) return { kind: "off" };

  // Duration first: "90 min" has a space but is not cron.
  const duration = text.match(/^(\d+(?:\.\d+)?)\s*(m|min|minutes?|h|hr|hours?|d|days?|w|weeks?)?$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = ((duration[2] ?? "h").toLowerCase()[0] ?? "h") as string;
    const multiplier = unit === "m" ? MINUTE_MS : unit === "d" ? DAY_MS : unit === "w" ? 7 * DAY_MS : 3_600_000;
    const milliseconds = amount * multiplier;
    if (milliseconds > 0 && milliseconds <= MAX_DURATION_MS) {
      return { kind: "duration", milliseconds, text };
    }
    return { kind: "off" };
  }

  // A year-long window accepts yearly expressions while still rejecting
  // combinations that can never happen, such as 31 February.
  return nextCronRun(text, new Date(), VALIDATION_HORIZON_DAYS)
    ? { kind: "cron", expression: text, text }
    : { kind: "off" };
}

/** Ongoing occurrence at or after `from`; durations land exactly on `from`. */
export function nextRunAt(schedule: Schedule, from: Date): Date | null {
  if (schedule.kind === "off") return null;
  if (schedule.kind === "duration") return from;
  return nextCronRun(schedule.expression, from);
}

/** Whether a scheduled rebuild is due, given the last build and last attempt. */
export function isDue(schedule: Schedule, lastBuild: Date, lastAttempt: Date | null, now: Date): boolean {
  if (schedule.kind === "off") return false;
  // A duration is due as soon as one interval has elapsed.
  if (schedule.kind === "duration") {
    return now.getTime() - lastBuild.getTime() >= schedule.milliseconds &&
      (!lastAttempt || now.getTime() - lastAttempt.getTime() >= schedule.milliseconds);
  }
  // Cron is due when a boundary has passed since the last build and since the
  // last attempt. Comparing against the attempt as well keeps an earlier
  // boundary from firing again after its own retry.
  const passed = (reference: Date) => {
    const boundary = nextRunAt(schedule, reference);
    return Boolean(boundary && boundary.getTime() <= now.getTime());
  };
  return passed(lastBuild) && (!lastAttempt || passed(lastAttempt));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Next run time as text, short enough for a form hint. */
export function describeSchedule(schedule: Schedule, now = new Date()): string {
  if (schedule.kind === "off") return "Automatic rebuilds are off.";
  if (schedule.kind === "duration") {
    const minutes = Math.round(schedule.milliseconds / MINUTE);
    const label = minutes < 60
      ? `${minutes} minute${minutes === 1 ? "" : "s"}`
      : minutes < 60 * 36
        ? `${Math.round(minutes / 60)} hours`
        : `${Math.round(minutes / (60 * 24))} days`;
    const next = new Date(now.getTime() + schedule.milliseconds);
    return `Rebuilds ${label} after the last one — next around ${format(next, now)}.`;
  }
  const next = nextRunAt(schedule, now);
  return next
    ? `Runs on schedule — next ${format(next, now)}.`
    : "This expression matches no time in the next 60 days.";
}

function format(date: Date, now: Date): string {
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${date.toLocaleDateString([], { weekday: "long" })} at ${time}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}
