/// <reference path="../apps/extension/.wxt/types/imports.d.ts" />
import { afterEach, expect, test } from "bun:test";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_GATEWAY_URL } from "@homepage/agent-core";
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

test("fresh installs default to the local Magpie endpoint and still require setup", async () => {
  storage();
  expect(await loadSettings()).toMatchObject({
    baseUrl: DEFAULT_GATEWAY_URL, model: DEFAULT_GATEWAY_MODEL, apiKey: "", connectionConfigured: false,
  });
});

test("a legacy credential alone does not count as a configured gateway", async () => {
  storage({ apiKey: "legacy-key" });
  expect((await loadSettings()).connectionConfigured).toBe(false);
});

test("custom endpoints and model IDs survive saving and reload", async () => {
  const { writes } = storage();
  await saveConnection({ baseUrl: "http://localhost:3425/v1/", apiKey: "", model: " my/custom-model " });
  expect(writes).toHaveLength(1);
  expect(await loadSettings()).toMatchObject({
    baseUrl: "http://localhost:3425/v1", model: "my/custom-model", apiKey: "", connectionConfigured: true,
  });
});

test("invalid connection settings do not overwrite the saved destination or key", async () => {
  const { data, writes } = storage({ apiKey: "existing-key", baseUrl: DEFAULT_GATEWAY_URL });
  await expect(saveConnection({ apiKey: "new-key", baseUrl: "not a url", model: "custom" })).rejects.toThrow();
  expect(writes).toHaveLength(0);
  expect(data.apiKey).toBe("existing-key");
  expect(data.baseUrl).toBe(DEFAULT_GATEWAY_URL);
});

test("a missing model is rejected before anything is saved", async () => {
  storage();
  await expect(saveConnection({ baseUrl: DEFAULT_GATEWAY_URL, apiKey: "key", model: "  " })).rejects.toThrow("model ID");
});

test("rebuild schedule defaults to 12h and migrates legacy hour values", async () => {
  storage();
  expect((await loadSettings()).rebuildSchedule).toBe("12h");
  storage({ autoRebuildIntervalHours: 24 });
  expect((await loadSettings()).rebuildSchedule).toBe("24h");
  storage({ rebuildSchedule: "0 9 * * mon", autoRebuildIntervalHours: 6 });
  expect((await loadSettings()).rebuildSchedule).toBe("0 9 * * mon");
});
