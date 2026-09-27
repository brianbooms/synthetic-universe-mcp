# Synthetic Universe × CrewAI

**Status:** Live. Payment round-trip proven 2026-09-27 — one $0.01 USDC call
through `BaseTool.run` (402 → sign → retry → 200 with data),
verified against hub build V3.9.112-INFRA.

## The idiomatic pattern

CrewAI's current custom-tool API (`crewai.tools`, verified against public
docs 2026-09-27):

- **Subclass `BaseTool`** with `name`, `description`,
  `args_schema: Type[BaseModel]` (Pydantic v2), and `_run(self, ...) -> str`.
  This is the recommended path for typed, multi-arg tools — exactly our case.
- `@tool` decorator (`from crewai.tools import tool`) — fine for quick
  single-purpose tools; less control over schema metadata.
- Tools attach to **agents** (`Agent(tools=[...])`), not tasks. They must
  return `str` — agents consume text. Errors surface as tool results, never
  exceptions.

CrewAI also accepts LangChain tools directly, so the LangChain
`SYNTHETIC_UNIVERSE_TOOLS` list in `../langchain/` works as a fallback — but
native `BaseTool` subclasses are cleaner (no extra dependency).

## Code sketch

`synthetic_universe_tools.py` in this directory:

- Same x402 client core as the LangChain sketch: `call_endpoint()`,
  `parse_402()` (terms from the live 402 `accepts[0]`, never hardcoded).
- Six `BaseTool` subclasses in `SYNTHETIC_UNIVERSE_TOOLS`: `su_get_weather`,
  `su_get_iss_passes`, `su_summarize_webpage`, `su_get_webpage_markdown`,
  `su_convert_fx`, `su_parse_feed` — sharing a `_BaseSUTool` plumbing base.
- Each `_run` returns **text**: JSON data on 200, or a `PAYMENT REQUIRED`
  block with full terms on 402. Never pays, never holds keys.
- `demo()` runs the sandbox end-to-end (Base Sepolia 402, no spend).

### Minimal end-to-end

```python
from crewai import Agent, Task, Crew
from synthetic_universe_tools import SYNTHETIC_UNIVERSE_TOOLS, SUWeatherTool

# 1. Direct call — surfaces the 402 payment requirement, no keys needed
print(SUWeatherTool()._run(lat=30.27, lon=-97.74))
# -> PAYMENT REQUIRED — Weather — current + 7-day costs 0.01 USDC on Base via x402.
#    { "scheme": "exact", "network": "base", "amount_usdc": "0.01",
#      "pay_to": "0x...", "facilitator": "https://facilitator.xpay.sh", ... }

# 2. Agent pays with ITS OWN wallet (x402-capable client), then retries:
#    payment_payload = <agent builds exact-scheme authorization, verifies/settles>
#    print(SUWeatherTool()._run(lat=30.27, lon=-97.74, x402_payment=payment_payload))
#    -> { ...weather JSON... }

# 3. Wiring into a crew
researcher = Agent(
    role="Data researcher",
    goal="Fetch pay-per-call data when the task needs it.",
    backstory="You use Synthetic Universe's $0.01/call data APIs.",
    tools=SYNTHETIC_UNIVERSE_TOOLS,
    verbose=True,
)
task = Task(description="Get current weather for Austin, TX.",
            expected_output="Weather summary.", agent=researcher)
Crew(agents=[researcher], tasks=[task]).kickoff()
```

## What "done and verified" looks like

- [ ] `pip install crewai pydantic` in a clean venv; module imports
      (check `crewai.__version__` first — API verified 2026-09-27).
- [ ] All six tools: `name` unique/snake_case, `description` states price +
      never-pays posture, `args_schema` validates (incl. optional
      `x402_payment`).
- [ ] `demo()` passes: sandbox 402 returns parsed terms (`base-sepolia`,
      `0.01` USDC, non-empty `pay_to`).
- [ ] Live (non-sandbox) `_run` of one tool returns a real 402 with `network`
      `base` — nothing spent.
- [ ] Crew smoke test: agent picks the right tool for a weather task and
      relays the PAYMENT REQUIRED terms (needs an LLM key; not run).
- [x] Full payment round-trip ($0.01 real spend) — proven live 2026-09-27
      through the framework's own tool wrapper.

## Unverified / assumptions

- CrewAI minor-version drift: the `BaseTool` contract (`_run` returning `str`,
  `args_schema: Type[BaseModel]`) is long-stable, but re-check against the
  installed version before the crew smoke test.
- Sandbox 402 shape assumed identical to mainnet shape (per hub docs);
  verified live at staging time for weather/FX only.
