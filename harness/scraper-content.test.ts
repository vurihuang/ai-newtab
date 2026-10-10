/// <reference path="../apps/extension/.wxt/types/imports.d.ts" />
import { expect, test } from "bun:test";

test("a long hidden page returns its loaded HTML without waiting for scroll timers", async () => {
  const names = ["defineContentScript", "window", "document", "location"];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const values = [
    (definition: unknown) => definition,
    { innerHeight: 684, scrollTo() {} },
    { visibilityState: "hidden", documentElement: { scrollHeight: 111873 }, title: "Models", body: { innerHTML: '<a href="/models/model">Model</a>' } },
    { href: "https://openrouter.ai/models" },
  ];
  names.forEach((name, i) => Object.defineProperty(globalThis, name, { configurable: true, value: values[i] }));
  try {
    const module = await import("../apps/extension/entrypoints/scraper.content");
    const definition = module.default as unknown as { main: () => unknown };
    const result = definition.main();
    // Hidden pages may throttle each timer to a minute. Extraction must not
    // depend on timers at all; the browser bridge already waits for page load.
    expect(result).not.toBeInstanceOf(Promise);
    expect(result).toEqual({ url: "https://openrouter.ai/models", title: "Models", html: '<a href="/models/model">Model</a>' });
  } finally {
    names.forEach((name, i) => {
      if (previous[i]) Object.defineProperty(globalThis, name, previous[i]!);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
