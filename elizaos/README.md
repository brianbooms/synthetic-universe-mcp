# Synthetic Universe × ElizaOS

**Status:** Live. Payment round-trip proven 2026-09-27 — one $0.01 USDC call
through the real `GET_WEATHER` action (402 → sign → retry → 200 with data),
verified against hub build V3.9.112-INFRA.

## The idiomatic pattern

ElizaOS's current plugin API (`@elizaos/core`, verified against public
plugin sources 2026-09-27):

- A **Plugin** object: `{ name, description, actions: [...], providers?,
  evaluators?, services?, routes? }`, exported from the package's
  `src/index.ts`.
- Each **Action**: `{ name, description, similes, examples,
  validate: async (runtime, message) => boolean,
  handler: async (runtime, message, state, options, callback) => ActionResult }`.
- Actions live in `src/actions/<name>.ts`, are re-exported, and pushed into
  the plugin's `actions` array. The agent runtime matches user messages to
  actions via `similes` + `examples` + `validate`.

Key difference from LangChain/CrewAI: **actions have no declared JSON args
schema** — parameters come from the message text, filled in by the LLM when
it invokes the action. This sketch uses a `name: value` convention parsed by
regex (see "Unverified" below for what to harden).

## Code sketch

`src/` in this directory:

- `x402.ts` — client core: `callEndpoint()` (GET → 200 data / 402 terms),
  `parse402()` (terms from the live 402 `accepts[0]`, never hardcoded),
  `resultText()`.
- `actions.ts` — six actions built by a `makeAction()` factory:
  `GET_WEATHER`, `GET_ISS_PASSES`, `SUMMARIZE_WEBPAGE`,
  `GET_WEBPAGE_MARKDOWN`, `CONVERT_FX`, `PARSE_FEED`. Each has similes,
  a `validate` checking required params are present in the message, and a
  handler that calls the hub and `callback`s the result text.
- `index.ts` — the `syntheticUniversePlugin` export.
- `package.json` — sketch manifest (`private: true`, `@elizaos/core` peer).

### Minimal end-to-end

```ts
import { syntheticUniversePlugin } from "./src/index.js";
// register syntheticUniversePlugin in the agent's character/plugins config

// 1. User: "What's the weather in Austin? lat: 30.27 lon: -97.74"
//    -> validate passes -> handler calls hub -> hub answers 402 ->
//    agent replies:
//    "PAYMENT REQUIRED — Weather — current + 7-day costs 0.01 USDC on Base via x402.
//     { scheme: exact, network: base, amount_usdc: '0.01', pay_to: '0x...',
//       facilitator: 'https://facilitator.xpay.sh', ... }"

// 2. Agent (x402-capable, own wallet) builds the exact-scheme authorization,
//    verifies/settles via the facilitator, then retries:
//    User: "lat: 30.27 lon: -97.74 x402_payment:<base64 payload>"
//    -> handler forwards it as X-PAYMENT -> hub settles -> weather JSON.
```

## What "done and verified" looks like

- [ ] `tsc` builds cleanly against the installed `@elizaos/core` version;
      `Action`/`Plugin` types line up (no `as any` escapes).
- [ ] `parse402()` unit test: fixture 402 body → correct terms
      (`base`, `0.01` USDC, non-empty `pay_to`); malformed body → `null`.
- [ ] Each action's `validate` returns true for its example message and false
      when a required param is missing.
- [ ] Handler sandbox test: message with `lat`/`lon` → callback receives a
      `PAYMENT REQUIRED` block with parsed Base Sepolia terms (needs a way to
      pass `sandbox=1` — not yet wired as a handler-level flag).
- [ ] Live (non-sandbox) handler test returns a real 402 with `network`
      `base` — nothing spent.
- [x] Full payment round-trip ($0.01 real spend) — proven live 2026-09-27
      through the real action handler.

## Unverified / assumptions

- **ElizaOS moves fast.** The `Plugin`/`Action` shape was verified against
  public plugin sources on 2026-09-27, but re-verify `validate`/`handler`
  signatures and the `ActionResult` return contract against the exact
  installed `@elizaos/core` version before running anything.
- **Parameter extraction is sketch-level.** The `name: value` regex convention
  works for the demo but is brittle (URLs contain colons; the `url:` param
  regex stops at whitespace — fine for bare URLs, fragile otherwise).
  Production hardening: a dedicated extraction step (LLM or structured parse)
  before the handler, plus per-action unit tests on adversarial messages.
- **`x402_payment:` in message text is a staging convention**, not an ElizaOS
  standard. A real deployment should carry the payload in action state/options
  rather than user-visible text.
- Sandbox 402 shape assumed identical to mainnet shape (per hub docs);
  verified live at staging time for weather/FX only.
