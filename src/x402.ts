/**
 * x402 payment handling for the Synthetic Universe MCP server.
 *
 * SECURITY POSTURE — read carefully:
 * - This server NEVER pays on behalf of callers and holds NO private keys.
 * - It NEVER signs, NEVER settles, and NEVER sees a payer's credentials.
 * - When the hub answers HTTP 402, the server parses the payment
 *   requirements from the 402 body and hands them back to the calling
 *   agent, which (if x402-capable) pays with its own wallet and retries.
 * - An x402-capable client may pass a pre-built payment payload via the
 *   optional `x402_payment` tool argument; it is forwarded verbatim as the
 *   X-PAYMENT header and never inspected or stored.
 */

import { BASE_URL, FACILITATOR, type DataEndpoint } from "./endpoints.js";

export interface PaymentRequirement {
  payment_required: true;
  scheme: string;
  network: string;
  amount_usdc: string;
  amount_atomic: string;
  asset: string;
  asset_address: string;
  pay_to: string;
  resource: string;
  description: string;
  facilitator: string;
  max_timeout_seconds: number;
  how_to_pay: string;
}

interface AcceptsEntry {
  scheme?: string;
  network?: string;
  maxAmountRequired?: string;
  resource?: string;
  description?: string;
  payTo?: string;
  asset?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string };
}

/** USDC on Base has 6 decimals. */
function atomicToUsdc(atomic: string): string {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parsePaymentRequirements(body: unknown): PaymentRequirement | null {
  if (!body || typeof body !== "object") return null;
  const accepts = (body as { accepts?: AcceptsEntry[] }).accepts;
  if (!Array.isArray(accepts) || accepts.length === 0) return null;
  const a = accepts[0];
  if (!a.payTo || !a.maxAmountRequired || !a.network) return null;
  return {
    payment_required: true,
    scheme: a.scheme ?? "exact",
    network: a.network,
    amount_usdc: atomicToUsdc(a.maxAmountRequired),
    amount_atomic: a.maxAmountRequired,
    asset: a.extra?.name ?? "USD Coin",
    asset_address: a.asset ?? "",
    pay_to: a.payTo,
    resource: a.resource ?? "",
    description: a.description ?? "",
    facilitator: FACILITATOR,
    max_timeout_seconds: a.maxTimeoutSeconds ?? 300,
    how_to_pay:
      "This is an x402 pay-per-call API. To complete the call: (1) build an " +
      '"exact"-scheme payment authorization for the amount above in USDC on ' +
      `network "${a.network}" payable to the pay_to address; ` +
      `(2) have it verified/settled via the facilitator ${FACILITATOR} ` +
      `(/verify then /settle, or use your x402 client library); ` +
      `(3) retry this tool with the resulting payment payload in the ` +
      `"x402_payment" argument (it is forwarded as the X-PAYMENT header). ` +
      `This MCP server never pays for you and holds no keys — payment is ` +
      `always made by the calling agent's own wallet.`,
  };
}

export interface CallResult {
  ok: boolean;
  status: number;
  data?: unknown;
  payment?: PaymentRequirement;
  error?: string;
}

/**
 * Call a hub data endpoint. Returns parsed data on 200, or the payment
 * requirements on 402 so the calling agent can pay and retry.
 */
export async function callEndpoint(
  ep: DataEndpoint,
  args: Record<string, unknown>,
  x402Payment?: string,
): Promise<CallResult> {
  const url = new URL(BASE_URL + ep.path);
  for (const p of ep.params) {
    const v = args[p.name];
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(p.name, String(v));
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (x402Payment) headers["X-PAYMENT"] = x402Payment;

  let res: Response;
  try {
    res = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(30000) });
  } catch (e) {
    return { ok: false, status: 0, error: `network_error: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (res.status === 402) {
    const body = await res.json().catch(() => null);
    const payment = parsePaymentRequirements(body);
    if (!payment) return { ok: false, status: 402, error: "payment_required_but_unparseable_402" };
    return { ok: true, status: 402, payment };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `hub_error_${res.status}: ${text.slice(0, 300)}` };
  }

  const data = await res.json().catch(() => null);
  return { ok: true, status: 200, data };
}
