# Synthetic Universe × LangChain

**Status:** Live. Payment round-trip proven 2026-09-27 — one $0.01 USDC call
through `StructuredTool.invoke` (402 → sign → retry → 200 with data),
verified against hub build V3.9.112-INFRA.

## The idiomatic pattern

LangChain's current custom-tool API (`langchain_core.tools`, verified against
public docs 2026-09-27):

- **`StructuredTool.from_function()`** — wrap a plain function with an explicit
  Pydantic `args_schema`. Best fit here: six endpoints, each with a small typed
  schema plus the optional `x402_payment` argument.
- `@tool` decorator — lighter, schema inferred from type hints. Works, but the
  explicit schema gives the model richer per-field descriptions (price, payment
  semantics), so `StructuredTool` is the recommended path.
- Subclassing `BaseTool` — for full sync/async control; unnecessary here.

Tools are passed to any agent (`create_react_agent(llm, tools)`), a CrewAI
agent, or invoked directly via `tool.invoke({...})`.

## Code sketch

`synthetic_universe_tools.py` in this directory:

- Shared x402 client core: `call_endpoint()` (GET → 200 data / 402 terms),
  `parse_402()` (extracts `accepts[0]` — scheme, network, amount, `payTo`,
  asset — never hardcoded, never invented).
- Six `StructuredTool`s in `SYNTHETIC_UNIVERSE_TOOLS`: `su_get_weather`,
  `su_get_iss_passes`, `su_summarize_webpage`, `su_get_webpage_markdown`,
  `su_convert_fx`, `su_parse_feed`.
- Each tool returns **text**: JSON data on 200, or a `PAYMENT REQUIRED` block
  with the full terms on 402 — so the agent sees exactly what a payment costs
  and where it goes. The module never pays, never holds keys.
- `demo()` runs the sandbox end-to-end (Base Sepolia 402, no spend).

### Minimal end-to-end

```python
from langchain_classic import create_react_agent  # or langgraph equivalent
from synthetic_universe_tools import SYNTHETIC_UNIVERSE_TOOLS, call_endpoint

# 1. Direct invoke — surfaces the 402 payment requirement, no keys needed
print(SYNTHETIC_UNIVERSE_TOOLS[0].invoke({"lat": 30.27, "lon": -97.74}))
# -> PAYMENT REQUIRED — Weather — current + 7-day costs 0.01 USDC on Base via x402.
#    { "scheme": "exact", "network": "base", "amount_usdc": "0.01",
#      "pay_to": "0x...", "facilitator": "https://facilitator.xpay.sh", ... }

# 2. Agent pays with ITS OWN wallet (x402-capable client), then retries:
#    payment_payload = <agent builds exact-scheme authorization, verifies/settles>
#    print(SYNTHETIC_UNIVERSE_TOOLS[0].invoke(
#        {"lat": 30.27, "lon": -97.74, "x402_payment": payment_payload}))
#    -> { ...weather JSON... }

# 3. Wiring into an agent
agent = create_react_agent(llm, SYNTHETIC_UNIVERSE_TOOLS)
```

## What "done and verified" looks like

- [ ] `pip install langchain-core pydantic` in a clean venv; module imports.
- [ ] All six tools expose the expected args via
      `tool.args_schema.model_json_schema()` (incl. optional `x402_payment`).
- [ ] `demo()` passes: sandbox 402 returns parsed terms with `network`
      `base-sepolia`, amount `0.01` USDC, non-empty `pay_to`.
- [ ] Live (non-sandbox) invoke of one tool returns a real 402 with `network`
      `base` — no payment attached, nothing spent.
- [ ] Agent smoke test: `create_react_agent` picks the right tool for
      "weather in Austin" and relays the PAYMENT REQUIRED terms (needs an LLM
      key; not run).
- [x] Full payment round-trip ($0.01 real spend) — proven live 2026-09-27
      through the framework's own tool wrapper.

## Unverified / assumptions

- `langchain_classic.create_react_agent` import path: LangChain packaging has
  been in flux (`langchain` → `langchain_classic` / `langgraph`). The
  `langchain_core.tools.StructuredTool` API itself is stable and verified;
  re-check the agent-constructor import against the installed version before
  running the agent smoke test.
- Sandbox 402 shape assumed identical to mainnet shape (per hub docs);
  verified live at staging time for weather/FX only.
