"""
Synthetic Universe tools for LangChain — payment round-trip proven live 2026-09-27.

Wraps the six Synthetic Universe x402 pay-per-call data APIs as LangChain
StructuredTools. Every call is $0.01 USDC on Base. This module NEVER pays on
behalf of callers and holds NO private keys: on HTTP 402 it returns the
payment terms as a tool result so the calling agent (if x402-capable) can
pay with its own wallet and retry.

Ground facts (2026-09-27):
- Hub: https://pay.brianbooms.com, build V3.9.112-INFRA
- Sandbox testnet: append ?sandbox=1 (or X-X402-Testnet: 1 header) for
  Base Sepolia challenges — safe for verifying the 402 path without spend.
- Facilitator (informational): https://facilitator.xpay.sh
"""

from __future__ import annotations

import json
from typing import Any, Optional

import requests

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

BASE_URL = "https://pay.brianbooms.com"
FACILITATOR = "https://facilitator.xpay.sh"  # informational only


# ---------------------------------------------------------------------------
# x402 client core (no keys, never pays)
# ---------------------------------------------------------------------------

def _atomic_to_usdc(atomic: str) -> str:
    n = int(atomic)
    whole, frac = divmod(n, 1_000_000)
    frac_s = str(frac).rjust(6, "0").rstrip("0")
    return f"{whole}.{frac_s}" if frac_s else str(whole)


def parse_402(body: Any) -> Optional[dict]:
    """Extract payment terms from a hub 402 body. Never invents payTo."""
    if not isinstance(body, dict):
        return None
    accepts = body.get("accepts")
    if not isinstance(accepts, list) or not accepts:
        return None
    a = accepts[0]
    if not (a.get("payTo") and a.get("maxAmountRequired") and a.get("network")):
        return None
    return {
        "payment_required": True,
        "scheme": a.get("scheme", "exact"),
        "network": a["network"],
        "amount_usdc": _atomic_to_usdc(str(a["maxAmountRequired"])),
        "amount_atomic": str(a["maxAmountRequired"]),
        "asset": (a.get("extra") or {}).get("name", "USD Coin"),
        "asset_address": a.get("asset", ""),
        "pay_to": a["payTo"],
        "resource": a.get("resource", ""),
        "description": a.get("description", ""),
        "facilitator": FACILITATOR,
        "max_timeout_seconds": a.get("maxTimeoutSeconds", 300),
        "how_to_pay": (
            "This is an x402 pay-per-call API. To complete the call: (1) build an "
            '"exact"-scheme payment authorization for the amount above in USDC on '
            'network "{net}" payable to the pay_to address; (2) verify/settle it via '
            "the facilitator {fac} (/verify then /settle, or your x402 client "
            "library); (3) retry this tool with the resulting payment payload in "
            "the x402_payment argument (forwarded as the X-PAYMENT header). This "
            "tool never pays for you and holds no keys."
        ).format(net=a["network"], fac=FACILITATOR),
    }


def call_endpoint(
    path: str,
    params: dict,
    x402_payment: Optional[str] = None,
    sandbox: bool = False,
) -> dict:
    """Call a hub data endpoint. Returns data on 200, payment terms on 402."""
    q = {k: v for k, v in params.items() if v is not None}
    if sandbox:
        q["sandbox"] = "1"
    url = BASE_URL + path
    # requests (not urllib): urllib hits Cloudflare error 1010 on its default
    # User-Agent and suffers truncated reads on our edge; requests is the
    # reliable path for agents calling these tools.
    headers = {"Accept": "application/json",
               "User-Agent": "synthetic-universe-x402/1.0"}
    if x402_payment:
        headers["X-PAYMENT"] = x402_payment
    try:
        res = requests.get(url, params=q, headers=headers, timeout=30)
    except Exception as e:  # network errors surface as tool results, not raises
        return {"ok": False, "status": 0, "error": f"network_error: {e}"}
    if res.status_code == 200:
        return {"ok": True, "status": 200, "data": res.json()}
    if res.status_code == 402:
        try:
            terms = parse_402(res.json())
        except Exception:
            terms = None
        if terms:
            return {"ok": True, "status": 402, "payment": terms}
        return {"ok": False, "status": 402,
                "error": "payment_required_but_unparseable_402"}
    return {"ok": False, "status": res.status_code,
            "error": f"hub_error_{res.status_code}"}


def _tool_result(title: str, price: str, result: dict) -> str:
    if result.get("payment"):
        return (
            f"PAYMENT REQUIRED — {title} costs {price} USDC on Base via x402.\n\n"
            + json.dumps(result["payment"], indent=2)
        )
    if not result.get("ok"):
        return f"ERROR calling {title}: {result.get('error')}"
    return json.dumps(result["data"], indent=2)


# ---------------------------------------------------------------------------
# Tool definitions: one StructuredTool per endpoint
# ---------------------------------------------------------------------------

class _WeatherIn(BaseModel):
    lat: float = Field(description="Latitude, -90 to 90.")
    lon: float = Field(description="Longitude, -180 to 180.")
    x402_payment: Optional[str] = Field(
        default=None,
        description="Optional x402 payment payload (base64) from a payment you "
                    "already made for this exact resource. Forwarded as X-PAYMENT.",
    )


def _weather(lat: float, lon: float, x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/weather",
                      {"lat": lat, "lon": lon}, x402_payment)
    return _tool_result("Weather — current + 7-day", "0.01", r)


class _IssIn(BaseModel):
    lat: float = Field(description="Latitude, -90 to 90.")
    lon: float = Field(description="Longitude, -180 to 180.")
    x402_payment: Optional[str] = Field(default=None, description=(
        "Optional x402 payment payload (base64) for this exact resource."))


def _iss(lat: float, lon: float, x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/iss-pass",
                      {"lat": lat, "lon": lon}, x402_payment)
    return _tool_result("ISS passes — next visible", "0.01", r)


class _UrlIn(BaseModel):
    url: str = Field(description="Public http(s) URL.")
    x402_payment: Optional[str] = Field(default=None, description=(
        "Optional x402 payment payload (base64) for this exact resource."))


def _summarize(url: str, x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/summarize", {"url": url}, x402_payment)
    return _tool_result("Webpage summary", "0.01", r)


def _markdown(url: str, x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/readability", {"url": url}, x402_payment)
    return _tool_result("Webpage as clean markdown", "0.01", r)


def _feed(url: str, x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/feed", {"url": url}, x402_payment)
    return _tool_result("RSS/Atom feed to JSON", "0.01", r)


class _FxIn(BaseModel):
    from_currency: str = Field(description="Source currency code, e.g. USD.")
    to_currency: str = Field(description="Target currency code, e.g. EUR.")
    amount: float = Field(default=1.0, description="Amount to convert.")
    x402_payment: Optional[str] = Field(default=None, description=(
        "Optional x402 payment payload (base64) for this exact resource."))


def _fx(from_currency: str, to_currency: str, amount: float = 1.0,
        x402_payment: Optional[str] = None) -> str:
    r = call_endpoint("/api/v1/data/fx",
                      {"from": from_currency, "to": to_currency,
                       "amount": amount}, x402_payment)
    return _tool_result("FX conversion", "0.01", r)


def _make(name: str, desc: str, schema: type[BaseModel], func) -> StructuredTool:
    return StructuredTool.from_function(
        func=func, name=name, description=desc, args_schema=schema,
        return_direct=False,
    )


SYNTHETIC_UNIVERSE_TOOLS: list[StructuredTool] = [
    _make("su_get_weather",
          "Current + 7-day daily weather for a coordinate (Open-Meteo). "
          "$0.01 USDC per call on Base via x402. On 402, returns payment terms "
          "so your x402-capable client can pay and retry; this tool never pays.",
          _WeatherIn, _weather),
    _make("su_get_iss_passes",
          "Next visible ISS passes over a coordinate (CelesTrak). "
          "$0.01 USDC per call on Base via x402. Never pays for you; "
          "on 402 returns payment terms.",
          _IssIn, _iss),
    _make("su_summarize_webpage",
          "Cleaned-text excerpt + key sentences for a public webpage. "
          "$0.01 USDC per call on Base via x402. Never pays for you; "
          "on 402 returns payment terms.",
          _UrlIn, _summarize),
    _make("su_get_webpage_markdown",
          "Public webpage as clean markdown (readability). "
          "$0.01 USDC per call on Base via x402. Never pays for you; "
          "on 402 returns payment terms.",
          _UrlIn, _markdown),
    _make("su_convert_fx",
          "Fiat currency conversion at daily reference rates. "
          "$0.01 USDC per call on Base via x402. Never pays for you; "
          "on 402 returns payment terms.",
          _FxIn, _fx),
    _make("su_parse_feed",
          "RSS/Atom feed parsed to clean JSON (20 items max). "
          "$0.01 USDC per call on Base via x402. Never pays for you; "
          "on 402 returns payment terms.",
          _UrlIn, _feed),
]


# ---------------------------------------------------------------------------
# End-to-end sketch (run with: python -c "from synthetic_universe_tools import demo; demo()")
# ---------------------------------------------------------------------------

def demo() -> None:
    """Sandbox end-to-end: one tool call, 402 path, no spend."""
    tool = SYNTHETIC_UNIVERSE_TOOLS[0]  # su_get_weather
    print("schema:", tool.name, "->", sorted(tool.args_schema.model_json_schema()["properties"]))
    # sandbox=1 exercises the 402 path on Base Sepolia without real payment
    r = call_endpoint("/api/v1/data/weather",
                      {"lat": 30.27, "lon": -97.74}, sandbox=True)
    print(_tool_result("Weather — current + 7-day", "0.01", r)[:600])
    print("\nInvoke via tool interface (live 402, no payment attached):")
    print(tool.invoke({"lat": 30.27, "lon": -97.74})[:400])
