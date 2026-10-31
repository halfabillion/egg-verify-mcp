#!/usr/bin/env node
// One-shot CLI: egg-verify "<claim>" <url>   (pays $0.05 USDC on Base, prints verdict + tx hash)
import { clientFromEnv } from "./client.js";
const [claim, url] = process.argv.slice(2);
if (!claim || !url) { console.error('usage: egg-verify "<claim>" <url>'); process.exit(2); }
try {
  const r = await clientFromEnv().verify(claim, url);
  console.log(JSON.stringify(r, null, 2));
} catch (e) { console.error("error:", e.message); process.exit(1); }
