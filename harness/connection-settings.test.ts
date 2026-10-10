/// <reference path="../apps/extension/.wxt/types/imports.d.ts" />
import { afterEach, expect, test } from "bun:test";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_GATEWAY_URL, DEFAULT_MODEL } from "@homepage/agent-core";
import { loadSettings, saveConnection } from "../apps/extension/lib/storage";

const originalBrowser = Object.getOwnPropertyDescriptor(globalThis, "browser");
afterEach(() => {
  if (originalBrowser) Object.defineProperty(globalThis, "browser", originalBrowser);
  else Reflect.deleteProperty(globalThis, "browser");
});
function storage(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const writes: Record<string, unknown>[] = [];
  Object.defineProperty(globalThis, "browser", { configurable: true, value: { storage: { local: {
    async get(keys: string[]) { return Object.fromEntries(keys.map((key) => [key, data[key]])); },
    async set(values: Record<string, unknown>) { writes.push(values); Object.assign(data, values); },
  } } } });
  return { data, writes };
}

test("fresh installs default to Magpie and still require setup", async () => {
  storage();
  expect(await loadSettings()).toMatchObject({
    provider: "openai", baseUrl: DEFAULT_GATEWAY_URL, model: DEFAULT_GATEWAY_MODEL,
    apiKey: "", connectionConfigured: false,
  });
});

test("existing Anthropic credentials do not get routed to Magpie", async () => {
  storage({ apiKey: "legacy-anthropic-key", model: DEFAULT_MODEL });
  expect(await loadSettings()).toMatchObject({ provider: "anthropic", model: DEFAULT_MODEL, connectionConfigured: true });
});

test("custom model IDs and optional credentials survive saving and reload", async () => {
  const { writes } = storage();
  await saveConnection({ provider: "openai", baseUrl: "http://localhost:3425/v1/", apiKey: "", model: " my/custom-model " });
  expect(writes).toHaveLength(1);
  expect(await loadSettings()).toMatchObject({
    provider: "openai", baseUrl: "http://localhost:3425/v1", model: "my/custom-model",
    apiKey: "", connectionConfigured: true,
  });
});

test("invalid connection settings do not overwrite the saved destination or key", async () => {
  const { data, writes } = storage({ provider: "openai", apiKey: "existing-key", baseUrl: DEFAULT_GATEWAY_URL });
  await expect(saveConnection({ provider: "openai", apiKey: "new-key", baseUrl: "not a url", model: "custom" })).rejects.toThrow();
  expect(writes).toHaveLength(0);
  expect(data.apiKey).toBe("existing-key");
  expect(data.baseUrl).toBe(DEFAULT_GATEWAY_URL);
});

test("Anthropic mode requires a key and a supported model", async () => {
  storage();
  await expect(saveConnection({ provider: "anthropic", baseUrl: "", apiKey: "", model: DEFAULT_MODEL })).rejects.toThrow("API key");
  await expect(saveConnection({ provider: "anthropic", baseUrl: "", apiKey: "key", model: "unknown" })).rejects.toThrow("supported Anthropic model");
});
