/**
 * Auto-rebuild policy, evaluated by the worker's alarm heartbeat: once the
 * current homepage is older than the chosen schedule, rebuild headlessly so the
 * next new tab already shows a fresh one.
 *
 * Scheduling grammar and due-time math live in `schedule.ts`.
 */
import { DEFAULT_REBUILD_INTERVAL_HOURS, isDue, type Schedule } from "./schedule";

export { DEFAULT_REBUILD_INTERVAL_HOURS, PRESET_SCHEDULES, describeSchedule, isOffText, parseSchedule, type Schedule } from "./schedule";

export interface AutoRebuildInput {
  enabled: boolean;
  hasApiKey: boolean;
  isRunning: boolean;
  /** ISO timestamp of the last successful build, if any. */
  lastBuildTimestamp?: string | null;
  /** ISO timestamp of the last auto-build attempt, if any. */
  lastAutoAttemptTimestamp?: string | null;
  schedule: Schedule;
  now: Date;
}

/**
 * Conservative by design:
 * - Never fires before the first manual build, so nothing spends on the API
 *   before the user has engaged.
 * - A schedule's boundary counts once: an attempt at or after it doesn't repeat
 *   until the next one, so a failure can't loop.
 */
export function shouldAutoRebuild(input: AutoRebuildInput): boolean {
  const { enabled, hasApiKey, isRunning, lastBuildTimestamp, lastAutoAttemptTimestamp, schedule, now } = input;
  if (!enabled || !hasApiKey || isRunning || !lastBuildTimestamp) return false;
  const lastBuild = new Date(lastBuildTimestamp);
  const lastAttempt = lastAutoAttemptTimestamp ? new Date(lastAutoAttemptTimestamp) : null;
  if (Number.isNaN(lastBuild.getTime())) return false;
  if (lastAttempt && Number.isNaN(lastAttempt.getTime())) return false;
  return isDue(schedule, lastBuild, lastAttempt, now);
}
