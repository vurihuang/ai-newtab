import {
  DEFAULT_MODEL,
  DEFAULT_BLOCKED_SITES,
  DEFAULT_GATEWAY_URL,
  DEFAULT_GATEWAY_MODEL,
  MODEL_CHOICES,
  normalizeGatewayUrl,
  STORAGE_KEYS as AGENT_KEYS,
  type KVStore,
} from "@homepage/agent-core";
import { DEFAULT_REBUILD_INTERVAL_HOURS } from "./schedule";

/**
 * Everything the extension persists, in one place. All of it lives in
 * chrome.storage.local — including the API key, which anyone with access to the
 * browser profile can read. Fine for a tool you run yourself; not for one you
 * distribute (see ARCHITECTURE.md → Privacy).
 */
export const KEYS = {
  ...AGENT_KEYS,
  homepage: "homepageData",
  systemPrompt: "systemPrompt",
  blockedSites: "blockedSites",
  model: "model",
  provider: "provider",
  baseUrl: "baseUrl",
  connectionConfigured: "connectionConfigured",
  gatewayBuildInProgress: "gatewayBuildInProgress",
  autoRebuild: "autoRebuild",
  /** ISO timestamp of the last auto-build *attempted* (success or not). */
  lastAutoBuildAttempt: "lastAutoBuildAttempt",
  /** Duration (`12h`) or cron expression for the scheduled rebuild. */
  rebuildSchedule: "rebuildSchedule",
  /** Legacy hours-based value, migrated into `rebuildSchedule` on read. */
  rebuildIntervalHours: "autoRebuildIntervalHours",
  /** Throttled mirror of the live build state, for tabs that open while the worker sleeps. */
  buildSnapshot: "buildSnapshot",
} as const;

export interface Homepage {
  /** The agent's raw TSX source. */
  code: string;
  /** ISO timestamp of when it was built. */
  timestamp: string;
}

export interface ConnectionSettings {
  provider: "openai" | "anthropic";
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Settings extends ConnectionSettings {
  connectionConfigured: boolean;
  systemPrompt: string;
  blockedSites: string[];
  /** Unset means on — auto-rebuild is opt-out. */
  autoRebuild: boolean;
  /** Duration or cron expression; defaults to every 12 hours. */
  rebuildSchedule: string;
}

/** The `KVStore` agent-core persists its agent/environment/session IDs through. */
export const extensionStore: KVStore = {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await browser.storage.local.get(key);
    return result[key] as T | undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    await browser.storage.local.set({ [key]: value });
  },
  async remove(key: string): Promise<void> {
    await browser.storage.local.remove(key);
  },
};

export async function loadSettings(): Promise<Settings> {
  const s = await browser.storage.local.get([
    KEYS.apiKey,
    KEYS.systemPrompt,
    KEYS.blockedSites,
    KEYS.model,
    KEYS.provider,
    KEYS.baseUrl,
    KEYS.connectionConfigured,
    KEYS.autoRebuild,
    KEYS.rebuildSchedule,
    KEYS.rebuildIntervalHours,
  ]);
  const model = s[KEYS.model] as string | undefined;
  // Preserve pre-fork Anthropic installations; new installs start with Magpie.
  const provider = s[KEYS.provider] === "anthropic" || (!s[KEYS.provider] && s[KEYS.apiKey])
    ? "anthropic" : "openai";
  return {
    provider,
    baseUrl: (s[KEYS.baseUrl] as string | undefined) ?? DEFAULT_GATEWAY_URL,
    connectionConfigured: s[KEYS.connectionConfigured] === true || Boolean(s[KEYS.apiKey]),
    apiKey: (s[KEYS.apiKey] as string | undefined) ?? "",
    systemPrompt: (s[KEYS.systemPrompt] as string | undefined) ?? "",
    blockedSites: (s[KEYS.blockedSites] as string[] | undefined) ?? [...DEFAULT_BLOCKED_SITES],
    model: provider === "openai"
      ? model?.trim() || DEFAULT_GATEWAY_MODEL
      : MODEL_CHOICES.find((m) => m.id === model)?.id ?? DEFAULT_MODEL,
    autoRebuild: s[KEYS.autoRebuild] !== false,
    rebuildSchedule: (s[KEYS.rebuildSchedule] as string | undefined) ??
      ((s[KEYS.rebuildIntervalHours] as number | undefined) ? `${s[KEYS.rebuildIntervalHours]}h` : `${DEFAULT_REBUILD_INTERVAL_HOURS}h`),
  };
}

export async function saveSetting<K extends "apiKey" | "systemPrompt" | "blockedSites" | "model" | "autoRebuild" | "rebuildSchedule">(
  key: K,
  value: Settings[K],
): Promise<void> {
  await browser.storage.local.set({ [KEYS[key]]: value });
}

export function validateConnection(connection: ConnectionSettings): ConnectionSettings {
  const model = connection.model.trim();
  if (!model) throw new Error("Enter a model ID.");
  const apiKey = connection.apiKey.trim();
  if (connection.provider === "anthropic") {
    if (!apiKey) throw new Error("Enter your Anthropic API key.");
    if (!MODEL_CHOICES.some((m) => m.id === model)) throw new Error("Choose a supported Anthropic model.");
  }
  return {
    provider: connection.provider,
    model,
    apiKey,
    baseUrl: connection.provider === "openai" ? normalizeGatewayUrl(connection.baseUrl) : connection.baseUrl,
  };
}

export async function saveConnection(connection: ConnectionSettings): Promise<ConnectionSettings> {
  const valid = validateConnection(connection);
  // Save the destination, credential and model together, never a partial config.
  await browser.storage.local.set({ ...valid, [KEYS.connectionConfigured]: true });
  return valid;
}

export async function loadHomepage(): Promise<Homepage | undefined> {
  return extensionStore.get<Homepage>(KEYS.homepage);
}

export async function saveHomepage(code: string): Promise<void> {
  const homepage: Homepage = { code, timestamp: new Date().toISOString() };
  await extensionStore.set(KEYS.homepage, homepage);
}
