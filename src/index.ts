#!/usr/bin/env node
/**
 * Synthetic Universe MCP server (stdio transport).
 *
 * Exposes the Synthetic Universe pay-per-call data APIs as MCP tools.
 * Every call is $0.01 USDC on Base via x402. This server NEVER pays on
 * behalf of callers and holds NO keys — see src/x402.ts and README.md.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ENDPOINTS } from "./endpoints.js";
import { callEndpoint } from "./x402.js";

const server = new McpServer(
  {
    name: "synthetic-universe",
    version: "0.1.0",
    description:
      "Pay-per-call data APIs (weather, ISS passes, webpage summary/markdown, FX, RSS feeds) — $0.01 USDC per call on Base via x402. The server never pays for you; on HTTP 402 it returns the payment requirements so your x402-capable client can pay and retry.",
  },
  { capabilities: { tools: {} } },
);

for (const ep of ENDPOINTS) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of ep.params) {
    const base = p.type === "number" ? z.number() : z.string();
    const described = base.describe(p.description);
    shape[p.name] = p.required ? described : described.optional();
  }
  // Optional x402 payment payload: an x402-capable client passes the
  // base64 payment payload here after paying; it is forwarded verbatim as
  // the X-PAYMENT header. Never inspected, never stored.
  shape["x402_payment"] = z
    .string()
    .optional()
    .describe(
      "Optional x402 payment payload (base64) from a payment you already made for this exact resource. Forwarded as the X-PAYMENT header.",
    );

  server.registerTool(
    ep.tool,
    {
      title: `${ep.title} — ${ep.priceUsdc} USDC/call`,
      description: ep.description,
      inputSchema: shape,
    },
    async (args) => {
      const { x402_payment, ...rest } = args as Record<string, unknown>;
      const result = await callEndpoint(ep, rest, typeof x402_payment === "string" ? x402_payment : undefined);
      if (result.payment) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `PAYMENT REQUIRED — ${ep.title} costs ${ep.priceUsdc} USDC on Base via x402.\n\n` +
                JSON.stringify(result.payment, null, 2),
            },
          ],
        };
      }
      if (!result.ok) {
        return {
          content: [{ type: "text" as const, text: `ERROR calling ${ep.title}: ${result.error}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.data, null, 2) }],
      };
    },
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("synthetic-universe-mcp failed to start:", err);
  process.exit(1);
});
