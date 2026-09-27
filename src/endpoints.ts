/**
 * Endpoint definitions for the Synthetic Universe MCP server.
 *
 * Source of truth: the live x402 pay server build V3.9.111-X402JSON
 * (~/workspace/ops/x402/pay-server/worker-2026-09-27-v39111-x402json.js)
 * and the live 402 challenge bodies at https://pay.brianbooms.com.
 *
 * Every endpoint below is $0.01 USDC on Base (10000 atomic units, USDC has
 * 6 decimals), payTo verified byte-identical to the live 402 responses.
 * The server never hardcodes payTo for payments — it is always read from the
 * live 402 `accepts[]` block and forwarded to the caller.
 */

export interface EndpointParam {
  name: string;
  type: "string" | "number";
  description: string;
  required: boolean;
}

export interface DataEndpoint {
  /** MCP tool name (snake_case). */
  tool: string;
  /** Path on https://pay.brianbooms.com */
  path: string;
  /** Human title. */
  title: string;
  /** Price in USDC, display string. */
  priceUsdc: string;
  /** One-line description for the MCP tool card. */
  description: string;
  params: EndpointParam[];
}

const PRICE = "$0.01 USDC on Base via x402";
const PRICE_USDC = "0.01";

export const BASE_URL = "https://pay.brianbooms.com";

/** Facilitator advertised by the hub's /.well-known/x402.json. Informational only. */
export const FACILITATOR = "https://facilitator.xpay.sh";

export const ENDPOINTS: DataEndpoint[] = [
  {
    tool: "get_weather",
    path: "/api/v1/data/weather",
    title: "Weather — current + 7-day",
    priceUsdc: PRICE_USDC,
    description: `Current + 7-day daily weather for a coordinate (Open-Meteo). ${PRICE} per call.`,
    params: [
      { name: "lat", type: "number", description: "Latitude, -90 to 90.", required: true },
      { name: "lon", type: "number", description: "Longitude, -180 to 180.", required: true },
    ],
  },
  {
    tool: "get_iss_passes",
    path: "/api/v1/data/iss-pass",
    title: "ISS passes — next visible",
    priceUsdc: PRICE_USDC,
    description: `Next visible International Space Station passes over a coordinate, computed from public CelesTrak orbital data. ${PRICE} per call.`,
    params: [
      { name: "lat", type: "number", description: "Latitude, -90 to 90.", required: true },
      { name: "lon", type: "number", description: "Longitude, -180 to 180.", required: true },
    ],
  },
  {
    tool: "summarize_webpage",
    path: "/api/v1/data/summarize",
    title: "Webpage summary",
    priceUsdc: PRICE_USDC,
    description: `Cleaned-text excerpt (8000 chars) + extractive key sentences for any public webpage. Honors robots.txt. ${PRICE} per call.`,
    params: [
      { name: "url", type: "string", description: "Public http(s) URL to summarize.", required: true },
    ],
  },
  {
    tool: "get_webpage_markdown",
    path: "/api/v1/data/readability",
    title: "Webpage as clean markdown",
    priceUsdc: PRICE_USDC,
    description: `Any public webpage rendered as clean markdown (readability extraction). ${PRICE} per call.`,
    params: [
      { name: "url", type: "string", description: "Public http(s) URL to convert.", required: true },
    ],
  },
  {
    tool: "convert_fx",
    path: "/api/v1/data/fx",
    title: "FX conversion",
    priceUsdc: PRICE_USDC,
    description: `Fiat currency conversion at daily reference rates (cross-rates computed from the USD table). ${PRICE} per call.`,
    params: [
      { name: "from", type: "string", description: "Source currency code, e.g. USD.", required: true },
      { name: "to", type: "string", description: "Target currency code, e.g. EUR.", required: true },
      { name: "amount", type: "number", description: "Amount to convert (default 1).", required: false },
    ],
  },
  {
    tool: "parse_feed",
    path: "/api/v1/data/feed",
    title: "RSS/Atom feed to JSON",
    priceUsdc: PRICE_USDC,
    description: `RSS/Atom feed parsed to clean JSON (20 items max, HTML stripped). ${PRICE} per call.`,
    params: [
      { name: "url", type: "string", description: "Public RSS/Atom feed URL.", required: true },
    ],
  },
];
