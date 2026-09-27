/**
 * Synthetic Universe actions for ElizaOS — payment round-trip proven live 2026-09-27.
 *
 * Six actions, one per x402 pay-per-call data API ($0.01 USDC/call on Base).
 * ElizaOS actions have no declared JSON args schema (unlike LangChain /
 * CrewAI) — parameters are extracted from the message text by convention
 * (`name: value` pairs), which the LLM fills in when it invokes the action.
 * See README.md "Unverified" for what to harden before production use.
 */

import type { Action } from "@elizaos/core";
import { callEndpoint, resultText } from "./x402.js";

/** Pull `name: value` / `name=value` out of message text. */
function extractParam(text: string, name: string): string | undefined {
  const m = text.match(new RegExp(`${name}\\s*[:=]\\s*([^\\s,;]+)`, "i"));
  return m?.[1];
}

/** Optional payment payload convention: `x402_payment:<base64url>` in the message. */
function extractPayment(text: string): string | undefined {
  const m = text.match(/x402_payment:\s*([A-Za-z0-9\-_]+={0,2})/);
  return m?.[1];
}

interface EndpointDef {
  action: string;
  path: string;
  title: string;
  description: string;
  similes: string[];
  params: { name: string; hint: string }[];
  example: string;
}

const PRICE = "$0.01 USDC per call on Base via x402";
const NEVER_PAYS =
  "This action never pays for you and holds no keys; on 402 it returns the payment terms.";

const ENDPOINTS: EndpointDef[] = [
  {
    action: "GET_WEATHER",
    path: "/api/v1/data/weather",
    title: "Weather — current + 7-day",
    description: `Current + 7-day daily weather for a coordinate (Open-Meteo). ${PRICE}. ${NEVER_PAYS}`,
    similes: ["GET WEATHER", "WEATHER FORECAST", "CHECK WEATHER"],
    params: [
      { name: "lat", hint: "Latitude, -90 to 90" },
      { name: "lon", hint: "Longitude, -180 to 180" },
    ],
    example: "What's the weather in Austin? lat: 30.27 lon: -97.74",
  },
  {
    action: "GET_ISS_PASSES",
    path: "/api/v1/data/iss-pass",
    title: "ISS passes — next visible",
    description: `Next visible International Space Station passes over a coordinate (CelesTrak). ${PRICE}. ${NEVER_PAYS}`,
    similes: ["ISS PASSES", "SPACE STATION", "WHEN IS ISS VISIBLE"],
    params: [
      { name: "lat", hint: "Latitude, -90 to 90" },
      { name: "lon", hint: "Longitude, -180 to 180" },
    ],
    example: "When is the ISS visible over Austin? lat: 30.27 lon: -97.74",
  },
  {
    action: "SUMMARIZE_WEBPAGE",
    path: "/api/v1/data/summarize",
    title: "Webpage summary",
    description: `Cleaned-text excerpt + key sentences for any public webpage. ${PRICE}. ${NEVER_PAYS}`,
    similes: ["SUMMARIZE PAGE", "SUMMARIZE URL", "TLDR WEBPAGE"],
    params: [{ name: "url", hint: "Public http(s) URL to summarize" }],
    example: "Summarize this page: url: https://example.com/article",
  },
  {
    action: "GET_WEBPAGE_MARKDOWN",
    path: "/api/v1/data/readability",
    title: "Webpage as clean markdown",
    description: `Any public webpage rendered as clean markdown (readability extraction). ${PRICE}. ${NEVER_PAYS}`,
    similes: ["PAGE TO MARKDOWN", "READABILITY", "EXTRACT ARTICLE"],
    params: [{ name: "url", hint: "Public http(s) URL to convert" }],
    example: "Get this page as markdown: url: https://example.com/article",
  },
  {
    action: "CONVERT_FX",
    path: "/api/v1/data/fx",
    title: "FX conversion",
    description: `Fiat currency conversion at daily reference rates. ${PRICE}. ${NEVER_PAYS}`,
    similes: ["CONVERT CURRENCY", "EXCHANGE RATE", "FX RATE"],
    params: [
      { name: "from", hint: "Source currency code, e.g. USD" },
      { name: "to", hint: "Target currency code, e.g. EUR" },
      { name: "amount", hint: "Amount to convert (default 1)" },
    ],
    example: "Convert 100 USD to EUR: from: USD to: EUR amount: 100",
  },
  {
    action: "PARSE_FEED",
    path: "/api/v1/data/feed",
    title: "RSS/Atom feed to JSON",
    description: `RSS/Atom feed parsed to clean JSON (20 items max, HTML stripped). ${PRICE}. ${NEVER_PAYS}`,
    similes: ["PARSE RSS", "READ FEED", "FEED TO JSON"],
    params: [{ name: "url", hint: "Public RSS/Atom feed URL" }],
    example: "Parse this feed: url: https://example.com/feed.xml",
  },
];

function makeAction(def: EndpointDef): Action {
  const paramDoc = def.params.map((p) => `${p.name} (${p.hint})`).join(", ");
  return {
    name: def.action,
    description: `${def.description} Parameters in message text as name: value — ${paramDoc}.`,
    similes: def.similes,
    validate: async (_runtime, message) => {
      const text = (message.content.text ?? "").toLowerCase();
      // Required params are all except amount/x402_payment conventions.
      const required = def.params.filter((p) => p.name !== "amount");
      return required.every((p) => text.includes(p.name.toLowerCase()));
    },
    handler: async (_runtime, message, _state, _options, callback) => {
      const text = message.content.text ?? "";
      const params: Record<string, string | undefined> = {};
      for (const p of def.params) params[p.name] = extractParam(text, p.name);
      const payment = extractPayment(text);
      const result = await callEndpoint(def.path, params, payment);
      const out = resultText(def.title, result);
      if (callback) await callback({ text: out });
      return { success: result.ok, text: out };
    },
    examples: [
      [
        { name: "user", content: { text: def.example } },
        {
          name: "agent",
          content: { text: `I'll fetch that (${def.title}, ${PRICE}).` },
        },
      ],
    ],
  };
}

export const syntheticUniverseActions: Action[] = ENDPOINTS.map(makeAction);
