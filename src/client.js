// Core client: preflight the 402 quote, enforce a hard spend cap, then pay with x402 (USDC on Base).
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_BASE_URL = "https://egg-verify.onrender.com";
export const BASE_MAINNET = "eip155:8453";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const MAX_TEXT = 500;

/** Validate and build the request body for an endpoint. Throws on bad input. */
export function buildBody(endpoint, args) {
  const str = (v, name) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`${name} is required`);
    if (v.length > MAX_TEXT) throw new Error(`${name} must be at most ${MAX_TEXT} characters`);
    return v.trim();
  };
  const url = (u) => {
    let p;
    try { p = new URL(u); } catch { throw new Error(`not a URL: ${u}`); }
    if (!/^https?:$/.test(p.protocol)) throw new Error(`only http(s) URLs: ${u}`);
    return p.toString();
  };
  if (endpoint === "verify") return { claim: str(args.claim, "claim"), url: url(args.url) };
  const max = endpoint === "scout" ? 3 : endpoint === "deepdive" ? 8 : null;
  if (max === null) throw new Error(`unknown endpoint: ${endpoint}`);
  if (!Array.isArray(args.urls) || args.urls.length === 0) throw new Error("urls must be a non-empty array");
  if (args.urls.length > max) throw new Error(`${endpoint} takes at most ${max} urls`);
  return { brief: str(args.brief, "brief"), urls: args.urls.map(url) };
}

/** Decode a PAYMENT-REQUIRED header (base64 JSON) and return the Base USDC requirement. */
export function parseQuote(header) {
  if (!header) throw new Error("402 response had no PAYMENT-REQUIRED header");
  const req = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const acc = (req.accepts || []).find((a) => a.network === BASE_MAINNET && a.asset?.toLowerCase() === USDC_BASE.toLowerCase());
  if (!acc) throw new Error("seller does not accept USDC on Base mainnet");
  return { amountAtomic: BigInt(acc.amount), usd: Number(acc.amount) / 1e6, payTo: acc.payTo, scheme: acc.scheme };
}

/**
 * Create a client. opts: { privateKey, baseUrl, maxUsdPerCall, fetchImpl }
 * maxUsdPerCall is enforced BEFORE anything is signed.
 */
export function createEggClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const maxUsd = Number(opts.maxUsdPerCall ?? 0.05);
  const fetchImpl = opts.fetchImpl || fetch;
  let paidFetch = null;
  const getPaidFetch = () => {
    if (paidFetch) return paidFetch;
    if (!opts.privateKey) throw new Error("EGG_PAYER_KEY is not set: a Base wallet key holding USDC is required for paid calls");
    const account = privateKeyToAccount(opts.privateKey);
    const client = new x402Client().register(BASE_MAINNET, new ExactEvmScheme(account));
    paidFetch = wrapFetchWithPayment(fetchImpl, client);
    return paidFetch;
  };

  async function call(endpoint, args) {
    const body = JSON.stringify(buildBody(endpoint, args));
    const init = { method: "POST", headers: { "content-type": "application/json" }, body };
    const url = `${baseUrl}/${endpoint}`;
    // 1) Unpaid preflight: read the quote, never sign.
    const pre = await fetchImpl(url, init);
    if (pre.status !== 402) {
      if (pre.ok) return { result: await pre.json(), paid: false };
      throw new Error(`preflight HTTP ${pre.status}: ${(await pre.text()).slice(0, 300)}`);
    }
    const quote = parseQuote(pre.headers.get("payment-required"));
    if (quote.usd > maxUsd) throw new Error(`price $${quote.usd} exceeds cap $${maxUsd}; raise EGG_MAX_USD to allow it`);
    // 2) Paid call.
    const res = await getPaidFetch()(url, init);
    const text = await res.text();
    if (!res.ok) throw new Error(`paid call HTTP ${res.status}: ${text.slice(0, 300)}`);
    const pr = res.headers.get("payment-response");
    const settlement = pr ? decodePaymentResponseHeader(pr) : null;
    return { result: JSON.parse(text), paid: true, priceUsd: quote.usd, payTo: quote.payTo, settlement, txHash: settlement?.transaction || null };
  }

  return {
    verify: (claim, url) => call("verify", { claim, url }),
    scout: (brief, urls) => call("scout", { brief, urls }),
    deepdive: (brief, urls) => call("deepdive", { brief, urls }),
    call,
  };
}

export function clientFromEnv(env = process.env) {
  return createEggClient({ privateKey: env.EGG_PAYER_KEY, baseUrl: env.EGG_BASE_URL, maxUsdPerCall: env.EGG_MAX_USD ?? 0.05 });
}
