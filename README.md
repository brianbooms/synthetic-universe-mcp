# Synthetic Universe MCP Server

MCP (Model Context Protocol) server exposing the **Synthetic Universe**
pay-per-call data APIs as tools any MCP-capable agent can call — Claude,
ChatGPT, Cursor, and friends.

**Operator:** Brian Booms · **Hub:** https://pay.brianbooms.com
**Pricing:** $0.01 USDC per call on Base, settled via x402.
**Server version:** 0.1.0

## Tools

| Tool | What it does | Price |
|---|---|---|
| `get_weather` | Current + 7-day daily weather for a lat/lon (Open-Meteo) | $0.01 |
| `get_iss_passes` | Next visible ISS passes over a lat/lon (CelesTrak) | $0.01 |
| `summarize_webpage` | Cleaned-text excerpt + key sentences for a public URL | $0.01 |
| `get_webpage_markdown` | Public webpage as clean markdown | $0.01 |
| `convert_fx` | Fiat currency conversion at daily reference rates | $0.01 |
| `parse_feed` | RSS/Atom feed parsed to clean JSON (20 items max) | $0.01 |

Every endpoint is pure USDC-for-data: no accounts, no API keys, no
subscription. Resale of data outputs is explicitly permitted by the hub.

## Install

Requires Node 20+.

```bash
git clone https://github.com/brianbooms/synthetic-universe-mcp.git
cd synthetic-universe-mcp
npm install
npm run build
```

## Claude Desktop config

Add to your Claude Desktop config file
(`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS,
`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "synthetic-universe": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/synthetic-universe/dist/index.js"]
    }
  }
}
```

Replace `/ABSOLUTE/PATH/TO/synthetic-universe` with the real path, e.g.
`/home/hatch/workspace/ops/mcp/synthetic-universe`. Restart Claude Desktop;
the six tools appear under the `synthetic-universe` server.

## Payment flow (how the $0.01 works)

The hub's endpoints answer **HTTP 402** (x402 payment required) until paid.
This server **never pays on your behalf and holds no private keys**.

1. You call a tool, e.g. `get_weather` with `{lat: 30.27, lon: -97.74}`.
2. The server calls the hub. The hub answers 402 with payment requirements.
3. The tool result comes back as `PAYMENT REQUIRED` with the full terms:
   amount (0.01 USDC), asset (USDC), network (`base`), `pay_to` address,
   and facilitator (`https://facilitator.xpay.sh`).
4. Your x402-capable agent client builds the `exact`-scheme payment
   authorization with **its own wallet**, verifies/settles it via the
   facilitator, and retries the tool with the resulting payload in the
   optional `x402_payment` argument.
5. The server forwards it as the `X-PAYMENT` header; the hub settles and
   returns your data.

If your client cannot do x402 payments, the tool result still tells you
exactly what a payment would cost and where it goes — nothing is charged
silently, ever.

## Pricing

All six tools: **$0.01 USDC per call on Base** (10000 atomic units).
## Framework integrations

- [LangChain](./langchain) — `synthetic_universe_tools.py` exposes the six hub tools as LangChain `StructuredTool`s.
- [CrewAI](./crewai) — `synthetic_universe_tools.py` exposes the six hub tools as CrewAI `BaseTool`s.
- [ElizaOS](./elizaos) — TypeScript plugin (`src/index.ts`, `src/actions.ts`, `src/x402.ts`) wiring the six tools into ElizaOS with x402 payment handling.

The payment round-trip was proven live 2026-09-27 against hub build V3.9.112-INFRA at $0.01 USDC/call on Base.

Prices are read from the live hub's 402 challenge bodies at call time, so
the tool result always reflects current on-chain terms. Tool descriptions
state the price up front.

## Security

- No secrets, no credentials, no private keys anywhere in this package.
- The optional `x402_payment` argument is forwarded verbatim as an HTTP
  header — never inspected, never logged, never stored.
- `pay_to` is always taken from the live 402 response, never hardcoded.

## Status

Public release v0.1.0 (2026-09-27), built against hub build V3.9.112-INFRA.
Not published to npm; not submitted to any directory yet.

## Environment note

The MCP SDK's default stdio spawn only inherits a minimal environment
(`HOME`, `PATH`, etc.). If your network needs an HTTP(S) egress proxy,
make sure your MCP host passes `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`
through to the server process, or the hub will be unreachable.

## HTTP API

Prefer raw HTTP over the MCP server? All sixteen data endpoints live at `https://pay.brianbooms.com`. Unpaid call returns HTTP 402 with the payment terms; pay $0.01 USDC on Base (exact scheme) via the x402 flow and retry with the payment proof.

| Endpoint | Example |
|---|---|
| GET /api/v1/data/weather | ?lat=30.27&lon=-97.74 |
| GET /api/v1/data/iss-pass | ?lat=30.27&lon=-97.74 |
| GET /api/v1/data/summarize | ?url=https://example.com |
| GET /api/v1/data/readability | ?url=https://example.com |
| GET /api/v1/data/fx | ?from=USD&to=EUR&amount=10 |
| GET /api/v1/data/feed | ?url=https://example.com/rss |
| GET /api/v1/data/geocode | ?q=Leander,TX |
| GET /api/v1/data/time | ?tz=America/Chicago |
| GET /api/v1/data/crypto | ?symbol=BTC |
| GET /api/v1/data/wiki | ?topic=Austin,Texas |
| GET /api/v1/data/dns | ?domain=example.com&type=A |
| GET /api/v1/data/astronomy | ?lat=30.27&lon=-97.74 |
| GET /api/v1/data/holidays | ?country=US |
| GET /api/v1/data/country | ?code=DE |
| GET /api/v1/data/cert | ?domain=example.com |
| GET /api/v1/data/httpcheck | ?url=https://example.com |

Paid (HTTP 200) responses return data fields at the top level — there is no `data` wrapper. See the integration quickstart at https://brianbooms.com/quickstart/ for the response format and copy-paste clients.
