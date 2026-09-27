"""
Synthetic Universe tools for CrewAI — payment round-trip proven live 2026-09-27.

Six CrewAI BaseTool subclasses wrapping the Synthetic Universe x402
pay-per-call data APIs ($0.01 USDC/call on Base). The tools NEVER pay on
behalf of callers and hold NO private keys: on HTTP 402 they return the
payment terms as the tool result so the agent (if x402-capable) can pay
with its own wallet and retry.

Ground facts (2026-09-27):
- Hub: https://pay.brianbooms.com, build V3.9.112-INFRA
- Sandbox testnet: ?sandbox=1 for Base Sepolia challenges (no spend).
- Facilitator (informational): https://facilitator.xpay.sh
"""

from __future__ import annotations

import json
from typing import Optional, Type

import requests

from crewai.tools import BaseTool
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


def parse_402(body) -> Optional[dict]:
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


def call_endpoint(path: str, params: dict,
                   x402_payment: Optional[str] = None,
                   sandbox: bool = False) -> dict:
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
    except Exception as e:
        return {"ok": False, "status": 0, "error": f"network_error: {e}"}
    if res.status_code == 200:
        return {"ok": True, "status": 200,
                "data": res.json()}
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


def _result_text(title: str, result: dict) -> str:
    if result.get("payment"):
        return (
            f"PAYMENT REQUIRED — {title} costs 0.01 USDC on Base via x402.\n\n"
            + json.dumps(result["payment"], indent=2)
        )
    if not result.get("ok"):
        return f"ERROR calling {title}: {result.get('error')}"
    return json.dumps(result["data"], indent=2)


# ---------------------------------------------------------------------------
# Tool definitions: one BaseTool subclass per endpoint
# ---------------------------------------------------------------------------

_PAYMENT_FIELD = Field(
    default=None,
    description="Optional x402 payment payload (base64) from a payment you "
                "already made for this exact resource. Forwarded as X-PAYMENT.",
)


class _BaseSUTool(BaseTool):
    """Shared plumbing. Subclasses set name/description/args_schema/_run."""

    _path: str = ""
    _title: str = ""

    def _call(self, params: dict,
              x402_payment: Optional[str] = None) -> str:
        return _result_text(self._title,
                            call_endpoint(self._path, params, x402_payment))


class WeatherInput(BaseModel):
    lat: float = Field(description="Latitude, -90 to 90.")
    lon: float = Field(description="Longitude, -180 to 180.")
    x402_payment: Optional[str] = _PAYMENT_FIELD


class SUWeatherTool(_BaseSUTool):
    name: str = "su_get_weather"
    description: str = (
        "Current + 7-day daily weather for a coordinate (Open-Meteo). "
        "$0.01 USDC per call on Base via x402. This tool never pays for you; "
        "on 402 it returns the payment terms so your x402-capable client can "
        "pay with its own wallet and retry.")
    args_schema: Type[BaseModel] = WeatherInput
    _path: str = "/api/v1/data/weather"
    _title: str = "Weather — current + 7-day"

    def _run(self, lat: float, lon: float,
             x402_payment: Optional[str] = None) -> str:
        return self._call({"lat": lat, "lon": lon}, x402_payment)


class ISSInput(BaseModel):
    lat: float = Field(description="Latitude, -90 to 90.")
    lon: float = Field(description="Longitude, -180 to 180.")
    x402_payment: Optional[str] = _PAYMENT_FIELD


class SUIssPassesTool(_BaseSUTool):
    name: str = "su_get_iss_passes"
    description: str = (
        "Next visible ISS passes over a coordinate (CelesTrak). "
        "$0.01 USDC per call on Base via x402. Never pays for you; "
        "on 402 returns payment terms.")
    args_schema: Type[BaseModel] = ISSInput
    _path: str = "/api/v1/data/iss-pass"
    _title: str = "ISS passes — next visible"

    def _run(self, lat: float, lon: float,
             x402_payment: Optional[str] = None) -> str:
        return self._call({"lat": lat, "lon": lon}, x402_payment)


class UrlInput(BaseModel):
    url: str = Field(description="Public http(s) URL.")
    x402_payment: Optional[str] = _PAYMENT_FIELD


class SUSummarizeTool(_BaseSUTool):
    name: str = "su_summarize_webpage"
    description: str = (
        "Cleaned-text excerpt + key sentences for a public webpage. "
        "$0.01 USDC per call on Base via x402. Never pays for you; "
        "on 402 returns payment terms.")
    args_schema: Type[BaseModel] = UrlInput
    _path: str = "/api/v1/data/summarize"
    _title: str = "Webpage summary"

    def _run(self, url: str, x402_payment: Optional[str] = None) -> str:
        return self._call({"url": url}, x402_payment)


class SUReadabilityTool(_BaseSUTool):
    name: str = "su_get_webpage_markdown"
    description: str = (
        "Public webpage as clean markdown (readability extraction). "
        "$0.01 USDC per call on Base via x402. Never pays for you; "
        "on 402 returns payment terms.")
    args_schema: Type[BaseModel] = UrlInput
    _path: str = "/api/v1/data/readability"
    _title: str = "Webpage as clean markdown"

    def _run(self, url: str, x402_payment: Optional[str] = None) -> str:
        return self._call({"url": url}, x402_payment)


class SUFeedTool(_BaseSUTool):
    name: str = "su_parse_feed"
    description: str = (
        "RSS/Atom feed parsed to clean JSON (20 items max). "
        "$0.01 USDC per call on Base via x402. Never pays for you; "
        "on 402 returns payment terms.")
    args_schema: Type[BaseModel] = UrlInput
    _path: str = "/api/v1/data/feed"
    _title: str = "RSS/Atom feed to JSON"

    def _run(self, url: str, x402_payment: Optional[str] = None) -> str:
        return self._call({"url": url}, x402_payment)


class FxInput(BaseModel):
    from_currency: str = Field(description="Source currency code, e.g. USD.")
    to_currency: str = Field(description="Target currency code, e.g. EUR.")
    amount: float = Field(default=1.0, description="Amount to convert.")
    x402_payment: Optional[str] = _PAYMENT_FIELD


class SUFxTool(_BaseSUTool):
    name: str = "su_convert_fx"
    description: str = (
        "Fiat currency conversion at daily reference rates. "
        "$0.01 USDC per call on Base via x402. Never pays for you; "
        "on 402 returns payment terms.")
    args_schema: Type[BaseModel] = FxInput
    _path: str = "/api/v1/data/fx"
    _title: str = "FX conversion"

    def _run(self, from_currency: str, to_currency: str, amount: float = 1.0,
             x402_payment: Optional[str] = None) -> str:
        return self._call({"from": from_currency, "to": to_currency,
                           "amount": amount}, x402_payment)


SYNTHETIC_UNIVERSE_TOOLS: list[BaseTool] = [
    SUWeatherTool(), SUIssPassesTool(), SUSummarizeTool(),
    SUReadabilityTool(), SUFxTool(), SUFeedTool(),
]


# ---------------------------------------------------------------------------
# End-to-end sketch
# ---------------------------------------------------------------------------

def demo() -> None:
    """Sandbox end-to-end: one tool call, 402 path, no spend."""
    tool = SUWeatherTool()
    print("tool:", tool.name, "| args:", sorted(tool.args_schema.model_json_schema()["properties"]))
    r = call_endpoint("/api/v1/data/weather",
                      {"lat": 30.27, "lon": -97.74}, sandbox=True)
    print(_result_text("Weather — current + 7-day", r)[:600])
    print("\nDirect _run (live 402, no payment attached):")
    print(tool._run(lat=30.27, lon=-97.74)[:400])
