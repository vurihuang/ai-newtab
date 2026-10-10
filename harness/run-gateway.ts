/** A real gateway build using fixture history and public pages, never browser history. */
import { mkdirSync, writeFileSync } from "node:fs";
import { DEFAULT_GATEWAY_MODEL, DEFAULT_GATEWAY_URL, runGatewayBuild } from "@homepage/agent-core";
import { nodeBridge, OUT_DIR, OUT_PATH } from "./node-bridge";

const result = await runGatewayBuild({
  config: {
    baseUrl: process.env.GATEWAY_BASE_URL || DEFAULT_GATEWAY_URL,
    apiKey: process.env.GATEWAY_API_KEY || "",
    model: process.env.GATEWAY_MODEL || DEFAULT_GATEWAY_MODEL,
  },
  bridge: nodeBridge,
  userSystemPrompt: process.env.HOMEPAGE_PROMPT,
  signal: AbortSignal.timeout(600_000),
  callbacks: {
    onPhase: (phase, detail) => console.log(`[${phase}] ${detail ?? ""}`),
    onLog: (line) => console.log(line),
  },
});
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, result.code);
console.log(`Saved ${result.code.length} characters to ${OUT_PATH}`);
