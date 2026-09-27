/**
 * x402 client core for the Synthetic Universe ElizaOS plugin.
 *
 * No keys, never pays on behalf of callers. Calls the hub; on HTTP 402
 * parses the payment terms from the live 402 body and hands them back so
 * the agent (if x402-capable) can pay with its own wallet and retry.
 */

export const BASE_URL = "https://pay.brianbooms.com";
/** Facilitator advertised by the hub's /.well-known/x402.json. Informational only. */
export const FACILITATOR = "https://facilitator.xpay.sh";

export interface PaymentTerms {
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

function atomicToUsdc(atomic: string): string {
  const n = BigInt(atomic);
  const whole = n / 1_000_000n;
  const frac = (n % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parse402(body: unknown): PaymentTerms | null {
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
      `(2) verify/settle it via the facilitator ${FACILITATOR} ` +
      `(/verify then /settle, or your x402 client library); ` +
      `(3) retry this action with the resulting payment payload after the ` +
      `"x402_payment:" marker in your message (forwarded as the X-PAYMENT ` +
      `header). This plugin never pays for you and holds no keys.`,
  };
}

export interface CallResult {
  ok: boolean;
  status: number;
  data?: unknown;
  payment?: PaymentTerms;
  error?: string;
}

export async function callEndpoint(
  path: string,
  params: Record<string, string | number | undefined>,
  x402Payment?: string,
  sandbox = false,
): Promise<CallResult> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  if (sandbox) q.set("sandbox", "1");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (x402Payment) headers["X-PAYMENT"] = x402Payment;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}?${q.toString()}`, {
      headers,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    return { ok: false, status: 0, error: `network_error: ${String(e)}` };
  }
  if (res.status === 402) {
    const body = await res.json().catch(() => null);
    const payment = parse402(body);
    if (!payment)
      return { ok: false, status: 402, error: "payment_required_but_unparseable_402" };
    return { ok: true, status: 402, payment };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: `hub_error_${res.status}: ${text.slice(0, 300)}` };
  }
  const data = await res.json().catch(() => null);
  return { ok: true, status: 200, data };
}

export function resultText(title: string, result: CallResult): string {
  if (result.payment) {
    return (
      `PAYMENT REQUIRED — ${title} costs 0.01 USDC on Base via x402.\n\n` +
      JSON.stringify(result.payment, null, 2)
    );
  }
  if (!result.ok) return `ERROR calling ${title}: ${result.error}`;
  return JSON.stringify(result.data, null, 2);
}
