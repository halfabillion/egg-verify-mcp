import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { buildBody, parseQuote, createEggClient, USDC_BASE } from "../src/client.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const quote = (amount) => b64({
  x402Version: 2, error: "Payment required",
  resource: { url: "https://egg.test/verify", description: "t", mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: String(amount), asset: USDC_BASE,
    payTo: "0x146ECb985fc03640F44aD0c8d9aB16eb233d1A83", maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }],
});

// Mock seller: 402 without a payment header, 200 + PAYMENT-RESPONSE with one.
function mockSeller(amount, log = []) {
  return async (url, init = {}) => {
    const h = new Headers(url instanceof Request ? url.headers : init.headers || {});
    if (url instanceof Request) url = url.url;
    const sig = h.get("payment-signature") || h.get("x-payment");
    log.push({ url: String(url), paid: !!sig, sig });
    if (!sig) return new Response("{}", { status: 402, headers: { "payment-required": quote(amount), "content-type": "application/json" } });
    return new Response(JSON.stringify({ verdict: "SUPPORTED", confidence: "high", evidence: ["quoted"], method: "mock" }), {
      status: 200,
      headers: { "content-type": "application/json",
        "payment-response": b64({ success: true, transaction: "0xabc123", network: "eip155:8453", payer: "0xpayer" }) },
    });
  };
}

test("buildBody validates verify input", () => {
  assert.deepEqual(buildBody("verify", { claim: " x ", url: "https://a.b/c" }), { claim: "x", url: "https://a.b/c" });
  assert.throws(() => buildBody("verify", { claim: "", url: "https://a.b" }), /claim is required/);
  assert.throws(() => buildBody("verify", { claim: "x".repeat(501), url: "https://a.b" }), /at most 500/);
  assert.throws(() => buildBody("verify", { claim: "x", url: "ftp://a.b" }), /only http/);
  assert.throws(() => buildBody("verify", { claim: "x", url: "nope" }), /not a URL/);
});

test("buildBody enforces url limits for scout/deepdive", () => {
  assert.throws(() => buildBody("scout", { brief: "b", urls: ["https://a", "https://b", "https://c", "https://d"] }), /at most 3/);
  assert.equal(buildBody("deepdive", { brief: "b", urls: Array(8).fill("https://a.b/") }).urls.length, 8);
  assert.throws(() => buildBody("deepdive", { brief: "b", urls: [] }), /non-empty/);
  assert.throws(() => buildBody("bogus", {}), /unknown endpoint/);
});

test("parseQuote reads the Base USDC requirement", () => {
  const q = parseQuote(quote(50000));
  assert.equal(q.usd, 0.05);
  assert.equal(q.amountAtomic, 50000n);
  assert.throws(() => parseQuote(null), /no PAYMENT-REQUIRED/);
  assert.throws(() => parseQuote(b64({ accepts: [{ network: "eip155:1", asset: "0x0", amount: "1" }] })), /USDC on Base/);
});

test("spend cap blocks an over-priced call before anything is signed", async () => {
  const log = [];
  const egg = createEggClient({ privateKey: generatePrivateKey(), baseUrl: "https://egg.test", maxUsdPerCall: 0.05, fetchImpl: mockSeller(2_000_000, log) });
  await assert.rejects(egg.deepdive("brief", ["https://a.b/"]), /exceeds cap/);
  assert.equal(log.length, 1);
  assert.equal(log[0].paid, false);
});

test("missing key fails clearly and sends no payment", async () => {
  const log = [];
  const egg = createEggClient({ baseUrl: "https://egg.test", fetchImpl: mockSeller(50000, log) });
  await assert.rejects(egg.verify("c", "https://a.b/"), /EGG_PAYER_KEY/);
  assert.ok(log.every((l) => !l.paid));
});

test("paid flow signs an x402 payment and returns the settlement tx hash", async () => {
  const log = [];
  const egg = createEggClient({ privateKey: generatePrivateKey(), baseUrl: "https://egg.test", fetchImpl: mockSeller(50000, log) });
  const r = await egg.verify("Example Domain is for illustrative examples", "https://example.com/");
  assert.equal(r.paid, true);
  assert.equal(r.priceUsd, 0.05);
  assert.equal(r.txHash, "0xabc123");
  assert.equal(r.result.verdict, "SUPPORTED");
  const paidReq = log.find((l) => l.paid);
  assert.ok(paidReq, "a signed request was sent");
  const payload = JSON.parse(Buffer.from(paidReq.sig, "base64").toString());
  assert.equal(payload.accepted?.network ?? payload.network, "eip155:8453");
});
