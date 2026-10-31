# egg-verify-mcp

MCP server and CLI for [egg-verify](https://egg-verify.onrender.com): pay-per-call claim checks, scouting and deep dives, paid in USDC on Base over x402 v2. No account and no API key, just a Base wallet.

- `verify_claim`: check a claim against one public URL ($0.05)
- `scout`: up to 3 URLs against a brief ($0.50)
- `deep_dive`: up to 8 URLs, synthesis plus open questions ($2.00)

Every call first reads the seller's 402 quote **without signing anything**, and refuses if the price is above `EGG_MAX_USD` (default `0.05`). Only then does it sign the x402 payment. Every paid result includes the settlement transaction hash.

## Install

```sh
git clone <this repo> && cd egg-verify-mcp && npm install
```

## Use from an MCP client (Claude Desktop, Cursor, etc.)

```json
{
  "mcpServers": {
    "egg-verify": {
      "command": "node",
      "args": ["/path/to/egg-verify-mcp/src/server.js"],
      "env": { "EGG_PAYER_KEY": "0x<base wallet private key holding a little USDC>", "EGG_MAX_USD": "0.05" }
    }
  }
}
```

## One-shot CLI

```sh
EGG_PAYER_KEY=0x... node src/cli.js "Example Domain is for use in illustrative examples" https://example.com
```

Prints the verdict, evidence, price and `txHash`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `EGG_PAYER_KEY` | none | Private key of a Base wallet holding USDC (no ETH needed; x402 exact uses EIP-3009) |
| `EGG_MAX_USD` | `0.05` | Hard cap per call; raise to `0.5` for scout or `2` for deep_dive |
| `EGG_BASE_URL` | `https://egg-verify.onrender.com` | Seller base URL |

Use a dedicated wallet holding only what you mean to spend.

## Tests

```sh
npm test
```

The tests run against an in-process mock seller. They cover input validation, quote parsing, the spend cap (nothing signed when over the cap), and a full 402, sign, retry, settle round trip with a throwaway key.

## License

MIT
