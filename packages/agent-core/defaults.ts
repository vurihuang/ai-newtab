/**
 * Caps applied by the gateway build. They live here rather than in a prompt so
 * the same numbers bound the history digest, the page excerpts and the logs.
 */
export const DEFAULTS = {
  daysToAnalyze: 14,
  maxResults: 30,
  loadDelayMs: 8000,
  /** Cap on titles carried per domain in the digest. */
  sampleTitles: 5,
} as const;
