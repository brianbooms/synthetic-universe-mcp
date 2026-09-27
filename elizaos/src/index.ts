import type { Plugin } from "@elizaos/core";
import { syntheticUniverseActions } from "./actions.js";

/**
 * Synthetic Universe plugin for ElizaOS — payment round-trip proven live 2026-09-27.
 *
 * Exposes the six Synthetic Universe x402 pay-per-call data APIs
 * ($0.01 USDC/call on Base) as ElizaOS actions. The plugin never pays on
 * behalf of callers and holds no private keys.
 */
export const syntheticUniversePlugin: Plugin = {
  name: "synthetic-universe",
  description:
    "Pay-per-call data APIs (weather, ISS passes, webpage summary/markdown, " +
    "FX, RSS feeds) — $0.01 USDC per call on Base via x402. The plugin never " +
    "pays for callers; on HTTP 402 it returns the payment terms so an " +
    "x402-capable agent can pay with its own wallet and retry.",
  actions: syntheticUniverseActions,
};

export default syntheticUniversePlugin;
